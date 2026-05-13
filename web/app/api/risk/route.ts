import { createClient } from "@supabase/supabase-js";
import { jsonResponse, logApiObservation, parseBboxParam, serverErrorResponse, SWEDEN_DATA_BOUNDS } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dormant by design. Segmentrisk är pausad i UI sedan 2026-05-11 och
// riskrelaterade cronjobb är pausade i prod sedan 2026-05-13 för att skydda
// Supabase Disk IO. Behåll endpointen som vilande infrastruktur tills nytt
// produktbeslut tas, men koppla inte in den som buggfix.

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type RiskSegment = {
  fid: number;
  adt_total: number;
  events_count: number;
  risk_per_milj_fordon: number;
  geometry: GeoJSON.LineString;
};

type RiskRow = RiskSegment;

/**
 * @deprecated Dormant by design — see docs/decisions.md 2026-05-11 and 2026-05-13.
 */
export async function GET(req: Request) {
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 8,
    bounds: SWEDEN_DATA_BOUNDS,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400 });
  }

  const startedAt = Date.now();
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("risk_in_bbox", {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  });

  if (error) {
    return serverErrorResponse("risk query failed", error);
  }

  const segments: RiskSegment[] = ((data ?? []) as RiskRow[]).map((row) => ({
    fid: row.fid,
    adt_total: row.adt_total,
    events_count: row.events_count,
    risk_per_milj_fordon: row.risk_per_milj_fordon,
    geometry: row.geometry,
  }));

  logApiObservation("risk", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    rowCount: segments.length,
  });

  return jsonResponse({ segments }, { cacheSeconds: 600 });
}
