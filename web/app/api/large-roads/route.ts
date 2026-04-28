import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const bbox = searchParams.get("bbox");
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  const nums = bbox.split(",").map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite)) {
    return NextResponse.json({ error: "invalid bbox" }, { status: 400 });
  }
  const [minLng, minLat, maxLng, maxLat] = nums as [number, number, number, number];

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("large_roads_in_bbox", {
    min_lng: minLng,
    min_lat: minLat,
    max_lng: maxLng,
    max_lat: maxLat,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const segments: LargeRoadSegment[] = ((data ?? []) as LargeRoadRow[]).map((row) => ({
    fid: row.fid,
    element_id: row.element_id,
    class: row.class,
    rank: row.rank,
    speed_limit: row.speed_limit,
    road_type: row.road_type,
    length_m: row.length_m,
    geometry: row.geometry,
  }));

  return NextResponse.json({ segments });
}
