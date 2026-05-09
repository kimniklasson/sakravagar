import { createClient } from "@supabase/supabase-js";
import { jsonResponse, parseBboxParam, serverErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PAGE_SIZE = 1000;

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

type LargeRoadRow = {
  fid: number;
  element_id: string;
  class: LargeRoadClass;
  rank: number;
  speed_limit: number | null;
  road_type: string | null;
  length_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

export async function GET(req: Request) {
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 20,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400 });
  }

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const rows: LargeRoadRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await client
      .rpc("large_roads_in_bbox", {
        min_lng: bbox.minLng,
        min_lat: bbox.minLat,
        max_lng: bbox.maxLng,
        max_lat: bbox.maxLat,
      })
      .range(from, to);

    if (error) {
      return serverErrorResponse("large roads query failed", error);
    }

    const page = (data ?? []) as LargeRoadRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const segments: LargeRoadSegment[] = rows
    .filter((row) => row.class === "high_speed" && row.speed_limit !== null && row.speed_limit >= 80)
    .map((row) => ({
      fid: row.fid,
      element_id: row.element_id,
      class: row.class,
      rank: row.rank,
      speed_limit: row.speed_limit,
      road_type: row.road_type,
      length_m: row.length_m,
      geometry: row.geometry,
    }));

  return jsonResponse({ segments }, { cacheSeconds: 300 });
}
