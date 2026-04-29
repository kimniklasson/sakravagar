import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ACTIVE_WINDOW_MS = 45 * 60 * 1000;

export type TrafficFlowCategory = "calm" | "moving" | "busy" | "slow";

export type TrafficFlowSegment = {
  site_id: number;
  fid: number;
  vehicle_flow_rate: number | null;
  average_vehicle_speed: number | null;
  data_quality: string | null;
  measurement_time: string | null;
  last_seen: string;
  category: TrafficFlowCategory;
  sample_count: number;
  snap_distance_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

type TrafficFlowRow = {
  site_id: number;
  fid: number;
  vehicle_flow_rate: number | null;
  average_vehicle_speed: number | null;
  data_quality: string | null;
  measurement_time: string | null;
  last_seen: string;
  sample_count: number;
  snap_distance_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

function categoryFromFlow(flowRate: number | null, speed: number | null): TrafficFlowCategory {
  const flow = flowRate ?? 0;
  if ((typeof speed === "number" && speed < 25) || flow >= 2500) return "slow";
  if ((typeof speed === "number" && speed < 45) || flow >= 1600) return "busy";
  if (flow >= 800) return "moving";
  return "calm";
}

export async function GET(req: Request) {
  if (!url || !anon) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const bbox = searchParams.get("bbox"); // "minLng,minLat,maxLng,maxLat"
  if (!bbox) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }
  const nums = bbox.split(",").map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite)) {
    return NextResponse.json({ error: "bbox must be 4 numbers" }, { status: 400 });
  }
  const [minLng, minLat, maxLng, maxLat] = nums as [number, number, number, number];
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("traffic_flow_segments_in_bbox", {
    min_lng: minLng,
    min_lat: minLat,
    max_lng: maxLng,
    max_lat: maxLat,
    active_since: activeSince,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const segments: TrafficFlowSegment[] = ((data ?? []) as TrafficFlowRow[]).map((row) => {
    const speed = row.average_vehicle_speed;
    const flow = row.vehicle_flow_rate;
    return {
      site_id: row.site_id,
      fid: row.fid,
      vehicle_flow_rate: typeof flow === "number" ? Math.round(flow) : null,
      average_vehicle_speed: typeof speed === "number" ? Math.round(speed * 10) / 10 : null,
      data_quality: row.data_quality,
      measurement_time: row.measurement_time,
      last_seen: row.last_seen,
      category: categoryFromFlow(flow, speed),
      sample_count: row.sample_count,
      snap_distance_m: row.snap_distance_m,
      geometry: row.geometry,
    };
  });

  return NextResponse.json({ segments });
}
