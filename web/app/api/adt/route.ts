import { createServerSupabaseClient, type PublicFunctionRow } from "@/lib/supabaseServer";
import { jsonResponse, logApiObservation, parseBboxParam, serverErrorResponse, SWEDEN_DATA_BOUNDS } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type AdtSegment = {
  fid: number;
  adt_total: number;
  adt_tung: number | null;
  matar: number | null;
  geometry: GeoJSON.LineString;
};

type AdtRow = PublicFunctionRow<"adt_in_bbox">;

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
  const client = createServerSupabaseClient(url, anon);
  const { data, error } = await client.rpc("adt_in_bbox", {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  });

  if (error) {
    return serverErrorResponse("adt query failed", error);
  }

  const segments: AdtSegment[] = ((data ?? []) satisfies AdtRow[]).map((row) => ({
    fid: row.fid,
    adt_total: row.adt_total,
    adt_tung: row.adt_tung,
    matar: row.matar,
    geometry: row.geometry as unknown as GeoJSON.LineString,
  }));

  logApiObservation("adt", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    rowCount: segments.length,
  });

  return jsonResponse({ segments }, { cacheSeconds: 86_400 });
}
