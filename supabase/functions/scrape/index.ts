// Edge Function: scrapar Trafikverkets Situation/Deviation-API och upsertar
// olyckshändelser i `events`. Schemaläggs via pg_cron + pg_net (se migration
// 20260425_schedule_scrape.sql). Manuell trigger:
//   curl -X POST "$SUPABASE_URL/functions/v1/scrape" \
//        -H "Authorization: Bearer $SCRAPE_SHARED_SECRET"
//
// Auth: vi deployar med --no-verify-jwt och kräver istället en delad
// hemlighet (SCRAPE_SHARED_SECRET) i Authorization-headern. Det gör att
// pg_net kan kalla utan att hantera Supabase-JWT.

import { createClient } from "npm:@supabase/supabase-js@2";

const TRAFIKVERKET_URL = "https://api.trafikinfo.trafikverket.se/v2/data.json";

type Deviation = {
  Id: string;
  IconId?: string;
  Message?: string;
  MessageType?: string;
  RoadNumber?: string;
  CountyNo?: number[];
  ModifiedTime?: string;
  Geometry?: { WGS84?: string };
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

function buildQuery(apiKey: string): string {
  return `<REQUEST>
  <LOGIN authenticationkey="${apiKey}" />
  <QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="1000">
    <FILTER>
      <EQ name="Deviation.MessageType" value="Olycka" />
    </FILTER>
  </QUERY>
</REQUEST>`;
}

async function fetchDeviations(apiKey: string): Promise<Deviation[]> {
  const res = await fetch(TRAFIKVERKET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: buildQuery(apiKey),
  });
  if (!res.ok) {
    throw new Error(`Trafikverket API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const results: Array<{ Situation?: Array<{ Deviation?: Deviation[] }> }> =
    json?.RESPONSE?.RESULT ?? [];
  const situations = results.flatMap((r) => r.Situation ?? []);
  return situations
    .flatMap((s) => s.Deviation ?? [])
    .filter((d) => d.MessageType === "Olycka");
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

Deno.serve(async (req: Request) => {
  const sharedSecret = Deno.env.get("SCRAPE_SHARED_SECRET");
  if (sharedSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${sharedSecret}`) {
      return new Response("unauthorized", { status: 401 });
    }
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
    const deviations = await fetchDeviations(apiKey);
    const rows = deviations
      .map((d) => deviationToRow(d, now))
      .filter((r): r is UpsertRow => r !== null);

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

    const summary = {
      ok: true,
      fetched: deviations.length,
      upserted,
      skipped_no_coord: deviations.length - rows.length,
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
