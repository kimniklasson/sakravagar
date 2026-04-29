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

function normalizeSecret(value: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed.startsWith("Bearer ") ? trimmed.slice("Bearer ".length).trim() : trimmed;
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
  <QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="1000">
    ${filter}
  </QUERY>
</REQUEST>`;
}

async function fetchSituationDeviations(apiKey: string, messageType?: string): Promise<Deviation[]> {
  const res = await fetch(TRAFIKVERKET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: buildQuery(apiKey, messageType),
  });
  if (!res.ok) {
    throw new Error(`Trafikverket API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const results: Array<{ Situation?: Array<{ Deviation?: Deviation[] }> }> =
    json?.RESPONSE?.RESULT ?? [];
  const situations = results.flatMap((r) => r.Situation ?? []);
  return situations.flatMap((s) => s.Deviation ?? []);
}

async function fetchDeviations(apiKey: string): Promise<Deviation[]> {
  const deviations = await fetchSituationDeviations(apiKey, "Olycka");
  return deviations.filter((d) => d.MessageType === "Olycka");
}

async function fetchDisturbances(apiKey: string): Promise<Deviation[]> {
  const deviations = await fetchSituationDeviations(apiKey);
  return deviations.filter((d) => d.MessageType !== "Olycka");
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

  const res = await fetch(TRAFIKVERKET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Trafikverket TrafficFlow API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const results: Array<{ TrafficFlow?: TrafficFlow[] }> = json?.RESPONSE?.RESULT ?? [];
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
    const [deviations, disturbances, trafficFlows] = await Promise.all([
      fetchDeviations(apiKey),
      fetchDisturbances(apiKey),
      fetchTrafficFlows(apiKey),
    ]);
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

    let upserted = 0;
    if (rows.length > 0) {
      const { error } = await client
        .from("events")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: false });
      if (error) throw new Error(`upsert: ${error.message}`);
      upserted = rows.length;
    }

    let disturbancesUpserted = 0;
    if (disturbanceRows.length > 0) {
      const { error } = await client
        .from("disturbances")
        .upsert(disturbanceRows, { onConflict: "id", ignoreDuplicates: false });
      if (error) throw new Error(`disturbance upsert: ${error.message}`);
      disturbancesUpserted = disturbanceRows.length;
    }

    let trafficFlowUpserted = 0;
    if (trafficFlowRows.length > 0) {
      const { error } = await client
        .from("traffic_flow_measurements")
        .upsert(trafficFlowRows, { onConflict: "id", ignoreDuplicates: false });
      if (error) throw new Error(`traffic flow upsert: ${error.message}`);
      trafficFlowUpserted = trafficFlowRows.length;
    }

    const summary = {
      ok: true,
      fetched: deviations.length,
      upserted,
      skipped_no_coord: deviations.length - rows.length,
      disturbances_fetched: disturbances.length,
      disturbances_upserted: disturbancesUpserted,
      disturbances_skipped_no_coord: disturbances.length - disturbanceRows.length,
      traffic_flow_fetched: trafficFlows.length,
      traffic_flow_upserted: trafficFlowUpserted,
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
