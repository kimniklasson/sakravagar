import {
  categoryFromDisturbanceMessageType,
  LIVE_EVENT_THRESHOLD_MS,
  type DisturbanceCategory,
} from "@trafik/shared";
import { createServerSupabaseClient } from "@/lib/supabaseServer";
import {
  isMissingPostgrestFunctionError,
  jsonResponse,
  logApiObservation,
  parseBboxParam,
  serverErrorResponse,
  SWEDEN_DATA_BOUNDS,
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type DisturbancePoint = {
  id: string;
  lng: number;
  lat: number;
  icon_id: string | null;
  message_type: string | null;
  category: DisturbanceCategory;
  road_number: string | null;
  message: string | null;
  severity: string | null;
  first_seen: string;
  last_seen: string;
};

export async function GET(req: Request) {
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 5000,
    bounds: SWEDEN_DATA_BOUNDS,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400 });
  }
  const startedAt = Date.now();
  const activeSince = new Date(Date.now() - LIVE_EVENT_THRESHOLD_MS).toISOString();

  const client = createServerSupabaseClient(url, anon);
  let resultSource = "disturbances_in_bbox";
  let { data, error } = await client.rpc("disturbances_in_bbox", {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
    p_active_since: activeSince,
  });

  if (error && isMissingPostgrestFunctionError(error, "disturbances_in_bbox")) {
    resultSource = "disturbances_public_fallback";
    let fallbackQuery = client
      .from("disturbances_public")
      .select("id, lng, lat, icon_id, message_type, road_number, message, severity, first_seen, last_seen")
      .gte("last_seen", activeSince)
      .order("last_seen", { ascending: false })
      .limit(2000);

    fallbackQuery = fallbackQuery
      .gte("lng", bbox.minLng)
      .lte("lng", bbox.maxLng)
      .gte("lat", bbox.minLat)
      .lte("lat", bbox.maxLat);

    const fallbackResult = await fallbackQuery;
    data = fallbackResult.data as unknown as typeof data;
    error = fallbackResult.error;
  }

  if (error) {
    return serverErrorResponse("disturbances query failed", error);
  }

  let unknownCategoryCount = 0;
  const points: DisturbancePoint[] = ((data ?? []) as DisturbancePoint[]).map((row) => {
    const messageType = (row.message_type ?? null) as string | null;
    const category = categoryFromDisturbanceMessageType(messageType);
    if (category === "other") unknownCategoryCount += 1;
    return {
      id: row.id as string,
      lng: row.lng as number,
      lat: row.lat as number,
      icon_id: (row.icon_id ?? null) as string | null,
      message_type: messageType,
      category,
      road_number: (row.road_number ?? null) as string | null,
      message: (row.message ?? null) as string | null,
      severity: (row.severity ?? null) as string | null,
      first_seen: row.first_seen as string,
      last_seen: row.last_seen as string,
    };
  });

  logApiObservation("disturbances", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    rowCount: points.length,
    source: resultSource,
    unknownCategoryCount,
  });

  return jsonResponse({ points }, { cacheSeconds: 30 });
}
