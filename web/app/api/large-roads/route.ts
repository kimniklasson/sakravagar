import { createServerSupabaseClient, type PublicFunctionRow } from "@/lib/supabaseServer";
import {
  jsonResponse,
  logApiObservation,
  parseBboxParam,
  requestIdFromRequest,
  serverErrorResponse,
  SWEDEN_DATA_BOUNDS,
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type LargeRoadClass = "high_speed" | "major_road" | "motor_traffic_road" | "motorway";

export type LargeRoadSegment = {
  fid: number;
  element_id: string;
  class: LargeRoadClass;
  rank: number;
  speed_limit: number | null;
  road_type: string | null;
  length_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

type LargeRoadRow = PublicFunctionRow<"large_roads_in_bbox">;

function isHighSpeedRow(row: LargeRoadRow): row is LargeRoadRow & { class: "high_speed"; speed_limit: number } {
  return row.class === "high_speed" && row.speed_limit >= 80;
}

export async function GET(req: Request) {
  const requestId = requestIdFromRequest(req);
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"), { requestId });
  }

  const { searchParams } = new URL(req.url);
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 20,
    bounds: SWEDEN_DATA_BOUNDS,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400, requestId });
  }

  const startedAt = Date.now();
  const client = createServerSupabaseClient(url, anon);
  const { data, error } = await client.rpc("large_roads_in_bbox", {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  });
  if (error) {
    return serverErrorResponse("large roads query failed", error, { requestId });
  }

  const rows = (data ?? []) satisfies LargeRoadRow[];

  const segments: LargeRoadSegment[] = rows
    .filter(isHighSpeedRow)
    .map((row) => ({
      fid: row.fid,
      element_id: row.element_id,
      class: row.class,
      rank: row.rank,
      speed_limit: row.speed_limit,
      road_type: row.road_type,
      length_m: row.length_m,
      geometry: row.geometry as unknown as GeoJSON.LineString | GeoJSON.MultiLineString,
    }));

  logApiObservation("large-roads", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    requestId,
    returnedRows: rows.length,
    rowCount: segments.length,
  });

  return jsonResponse({ segments }, { cacheSeconds: 86_400, requestId });
}
