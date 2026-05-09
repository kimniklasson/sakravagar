// Edge Function: scrapar Trafikverkets Situation/Deviation- och TrafficFlow-API
// och upsertar olyckor, störningar och trafikläge. Schemaläggs via pg_cron +
// pg_net (se migration 0004_pg_cron_scrape.sql). Manuell trigger:
//   curl -X POST "$SUPABASE_URL/functions/v1/scrape" \
//        -H "Authorization: Bearer $SCRAPE_SHARED_SECRET"
//
// Auth: vi deployar med --no-verify-jwt och kräver istället en delad
// hemlighet (SCRAPE_SHARED_SECRET) i Authorization-headern. Det gör att
// pg_net kan kalla utan att hantera Supabase-JWT. Secret är obligatorisk
// — saknas den returnerar funktionen 500 (inte tyst öppen).

import { createClient } from "npm:@supabase/supabase-js@2";

const TRAFIKVERKET_URL = "https://api.trafikinfo.trafikverket.se/v2/data.json";
const SITUATION_QUERY_LIMIT = 10_000;
const TRAFIKVERKET_REQUEST_TIMEOUT_MS = 20_000;
const TRAFIKVERKET_TRAFFIC_FLOW_TIMEOUT_MS = 25_000;
const EVENTS_UPSERT_BATCH_SIZE = 500;
const DISTURBANCES_UPSERT_BATCH_SIZE = 250;
const TRAFFIC_FLOW_UPSERT_BATCH_SIZE = 500;

type Deviation = {
  Id: string;
  IconId?: string;
  Message?: string;
  MessageType?: string;
  SeverityText?: string;
  RoadNumber?: string;
  CountyNo?: number[];
  ModifiedTime?: string;
  Geometry?: { WGS84?: string };
};

type TrafficFlow = {
  SiteId: number;
  MeasurementTime?: string;
  MeasurementOrCalculationPeriod?: number;
  VehicleType?: string;
  VehicleFlowRate?: number;
  AverageVehicleSpeed?: number;
  CountyNo?: number;
  Deleted?: boolean;
  Geometry?: { WGS84?: string };
  RegionId?: number;
  DataQuality?: string;
  SpecificLane?: string;
  MeasurementSide?: string;
  ModifiedTime?: string;
};

type UpsertRow = {
  id: string;
  icon_id: string | null;
  message: string | null;
  road_number: string | null;
  county_no: number | null;
  geom: string;
  last_seen: string;
  modified_time: string | null;
  raw: unknown;
};

type DisturbanceUpsertRow = UpsertRow & {
  message_type: string | null;
  severity: string | null;
};

type TrafficFlowUpsertRow = {
  id: string;
  site_id: number;
  measurement_time: string | null;
  measurement_or_calculation_period: number | null;
  vehicle_type: string | null;
  vehicle_flow_rate: number | null;
  average_vehicle_speed: number | null;
  data_quality: string | null;
  county_no: number | null;
  region_id: number | null;
  deleted: boolean;
  specific_lane: string | null;
  measurement_side: string | null;
  geom: string;
  last_seen: string;
  modified_time: string | null;
  raw: unknown;
};

type UpsertBatchSummary = {
  attempted: number;
  batches: number;
};

function normalizeSecret(value: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed.startsWith("Bearer ") ? trimmed.slice("Bearer ".length).trim() : trimmed;
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function upsertInBatches<T>(
  client: ReturnType<typeof createClient>,
  table: string,
  rows: T[],
  batchSize: number,
): Promise<UpsertBatchSummary> {
  let attempted = 0;
  let batches = 0;
  for (const batch of chunks(rows, batchSize)) {
    const { error } = await client
      .from(table)
      .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
    attempted += batch.length;
    batches += 1;
  }
  return { attempted, batches };
}

function buildQuery(apiKey: string, messageType?: string): string {
  const filter = messageType
    ? `
    <FILTER>
      <EQ name="Deviation.MessageType" value="${messageType}" />
    </FILTER>`
    : "";

  return `<REQUEST>
  <LOGIN authenticationkey="${apiKey}" />
  <QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="${SITUATION_QUERY_LIMIT}">
    ${filter}
  </QUERY>
</REQUEST>`;
}

async function fetchTrafikverketJson(body: string, label: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(TRAFIKVERKET_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`${label} ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchSituationDeviations(apiKey: string, messageType?: string): Promise<Deviation[]> {
  const json = await fetchTrafikverketJson(
    buildQuery(apiKey, messageType),
    "Trafikverket API",
    TRAFIKVERKET_REQUEST_TIMEOUT_MS,
  );
  const results: Array<{ Situation?: Array<{ Deviation?: Deviation[] }> }> =
    (json as { RESPONSE?: { RESULT?: Array<{ Situation?: Array<{ Deviation?: Deviation[] }> }> } })
      ?.RESPONSE?.RESULT ?? [];
  const situations = results.flatMap((r) => r.Situation ?? []);
  return situations.flatMap((s) => s.Deviation ?? []);
}

function splitSituationDeviations(deviations: Deviation[]): {
  deviations: Deviation[];
  disturbances: Deviation[];
} {
  return {
    deviations: deviations.filter((d) => d.MessageType === "Olycka"),
    disturbances: deviations.filter((d) => d.MessageType !== "Olycka"),
  };
}

async function fetchTrafficFlows(apiKey: string): Promise<TrafficFlow[]> {
  const body = `<REQUEST>
  <LOGIN authenticationkey="${apiKey}" />
  <QUERY objecttype="TrafficFlow" namespace="Road.TrafficInfo" schemaversion="1.5" limit="10000">
    <FILTER>
      <AND>
        <EQ name="Deleted" value="false" />
        <EQ name="VehicleType" value="anyVehicle" />
      </AND>
    </FILTER>
  </QUERY>
</REQUEST>`;

  const json = await fetchTrafikverketJson(
    body,
    "Trafikverket TrafficFlow API",
    TRAFIKVERKET_TRAFFIC_FLOW_TIMEOUT_MS,
  );
  const results: Array<{ TrafficFlow?: TrafficFlow[] }> =
    (json as { RESPONSE?: { RESULT?: Array<{ TrafficFlow?: TrafficFlow[] }> } })?.RESPONSE?.RESULT ?? [];
  return results
    .flatMap((r) => r.TrafficFlow ?? [])
    .filter((f) => f.Deleted !== true && f.VehicleType === "anyVehicle");
}

function parseWgs84(wkt: string | undefined): { lng: number; lat: number } | null {
  if (!wkt) return null;
  const m = wkt.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

function disturbanceToRow(d: Deviation, now: string): DisturbanceUpsertRow | null {
  const base = deviationToRow(d, now);
  if (!base) return null;
  return {
    ...base,
    message_type: d.MessageType ?? null,
    severity: d.SeverityText ?? null,
  };
}

function deviationToRow(d: Deviation, now: string): UpsertRow | null {
  const coord = parseWgs84(d.Geometry?.WGS84);
  if (!coord) return null;
  const county = d.CountyNo && d.CountyNo.length > 0 ? d.CountyNo[0] ?? null : null;
  return {
    id: d.Id,
    icon_id: d.IconId ?? null,
    message: d.Message ?? null,
    road_number: d.RoadNumber ?? null,
    county_no: county,
    geom: `SRID=4326;POINT(${coord.lng} ${coord.lat})`,
    last_seen: now,
    modified_time: d.ModifiedTime ?? null,
    raw: d,
  };
}

function trafficFlowToRow(f: TrafficFlow, now: string): TrafficFlowUpsertRow | null {
  const coord = parseWgs84(f.Geometry?.WGS84);
  if (!coord) return null;
  const vehicleType = f.VehicleType ?? "unknown";
  const lane = f.SpecificLane ?? "unknown";
  const side = f.MeasurementSide ?? "unknown";
  return {
    id: `${f.SiteId}:${vehicleType}:${lane}:${side}`,
    site_id: f.SiteId,
    measurement_time: f.MeasurementTime ?? null,
    measurement_or_calculation_period: f.MeasurementOrCalculationPeriod ?? null,
    vehicle_type: f.VehicleType ?? null,
    vehicle_flow_rate: f.VehicleFlowRate ?? null,
    average_vehicle_speed: f.AverageVehicleSpeed ?? null,
    data_quality: f.DataQuality ?? null,
    county_no: f.CountyNo ?? null,
    region_id: f.RegionId ?? null,
    deleted: f.Deleted ?? false,
    specific_lane: f.SpecificLane ?? null,
    measurement_side: f.MeasurementSide ?? null,
    geom: `SRID=4326;POINT(${coord.lng} ${coord.lat})`,
    last_seen: now,
    modified_time: f.ModifiedTime ?? null,
    raw: f,
  };
}

Deno.serve(async (req: Request) => {
  const sharedSecret = normalizeSecret(Deno.env.get("SCRAPE_SHARED_SECRET"));
  if (!sharedSecret) {
    console.error("[scrape] SCRAPE_SHARED_SECRET not configured");
    return new Response("server misconfigured", { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  const bearerSecret = normalizeSecret(auth);
  const headerSecret = normalizeSecret(req.headers.get("x-scrape-secret"));
  if (bearerSecret !== sharedSecret && headerSecret !== sharedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  const apiKey = Deno.env.get("TRAFIKVERKET_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supabaseUrl || !serviceKey) {
    return new Response("missing env", { status: 500 });
  }

  const start = Date.now();
  const now = new Date().toISOString();

  try {
    const [situationDeviations, trafficFlows] = await Promise.all([
      fetchSituationDeviations(apiKey),
      fetchTrafficFlows(apiKey),
    ]);
    const { deviations, disturbances } = splitSituationDeviations(situationDeviations);
    const rows = deviations
      .map((d) => deviationToRow(d, now))
      .filter((r): r is UpsertRow => r !== null);
    const disturbanceRows = disturbances
      .map((d) => disturbanceToRow(d, now))
      .filter((r): r is DisturbanceUpsertRow => r !== null);
    const trafficFlowRows = trafficFlows
      .map((f) => trafficFlowToRow(f, now))
      .filter((r): r is TrafficFlowUpsertRow => r !== null);

    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const eventsResult = await upsertInBatches(
      client,
      "events",
      rows,
      EVENTS_UPSERT_BATCH_SIZE,
    );
    const disturbanceResult = await upsertInBatches(
      client,
      "disturbances",
      disturbanceRows,
      DISTURBANCES_UPSERT_BATCH_SIZE,
    );
    const trafficFlowResult = await upsertInBatches(
      client,
      "traffic_flow_measurements",
      trafficFlowRows,
      TRAFFIC_FLOW_UPSERT_BATCH_SIZE,
    );

    const summary = {
      ok: true,
      fetched: deviations.length,
      upserted: eventsResult.attempted,
      upsert_batches: eventsResult.batches,
      skipped_no_coord: deviations.length - rows.length,
      disturbances_fetched: disturbances.length,
      disturbances_upserted: disturbanceResult.attempted,
      disturbances_upsert_batches: disturbanceResult.batches,
      disturbances_skipped_no_coord: disturbances.length - disturbanceRows.length,
      traffic_flow_fetched: trafficFlows.length,
      traffic_flow_upserted: trafficFlowResult.attempted,
      traffic_flow_upsert_batches: trafficFlowResult.batches,
      traffic_flow_skipped_no_coord: trafficFlows.length - trafficFlowRows.length,
      elapsed_ms: Date.now() - start,
    };
    console.log("[scrape]", summary);
    return new Response(JSON.stringify(summary), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scrape] fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
