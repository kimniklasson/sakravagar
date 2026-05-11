import { createClient } from "@supabase/supabase-js";
import { jsonResponse, logApiObservation, parseBboxParam, serverErrorResponse, SWEDEN_DATA_BOUNDS } from "../_utils";

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
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 30,
    bounds: SWEDEN_DATA_BOUNDS,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400 });
  }
  const startedAt = Date.now();
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("traffic_flow_segments_in_bbox", {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
    active_since: activeSince,
  });
  if (error) {
    return serverErrorResponse("traffic flow query failed", error);
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

  logApiObservation("traffic-flow", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    rowCount: segments.length,
  });

  return jsonResponse({ segments }, { cacheSeconds: 20 });
}
