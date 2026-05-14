import { LIVE_EVENT_THRESHOLD_MS } from "@trafik/shared";
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

export type EventPoint = {
  id: string;
  lng: number;
  lat: number;
  icon_id: string | null;
  road_number: string | null;
  message: string | null;
  severity: string | null;
  first_seen: string;
  last_seen: string;
};

function normalizeSinceParam(value: string | null): { since: string | null; error: string | null } {
  if (!value) return { since: null, error: null };

  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return { since: null, error: "since must be a valid date" };
  }

  return { since: new Date(time).toISOString(), error: null };
}

export async function GET(req: Request) {
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const { since, error: sinceError } = normalizeSinceParam(searchParams.get("since"));
  if (sinceError) {
    return jsonResponse({ error: sinceError }, { status: 400 });
  }

  const liveOnly = searchParams.get("live") === "1" || searchParams.get("live") === "true";
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 5000,
    bounds: SWEDEN_DATA_BOUNDS,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400 });
  }

  const startedAt = Date.now();
  const client = createServerSupabaseClient(url, anon);
  const liveSince = liveOnly
    ? new Date(Date.now() - LIVE_EVENT_THRESHOLD_MS).toISOString()
    : null;

  let resultSource = "events_in_bbox";
  let { data, error } = await client.rpc("events_in_bbox", {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
    p_since: since ?? undefined,
    p_live_since: liveSince ?? undefined,
  });

  if (error && isMissingPostgrestFunctionError(error, "events_in_bbox")) {
    resultSource = "events_public_fallback";
    let fallbackQuery = client
      .from("events_public")
      .select("id, lng, lat, icon_id, road_number, message, severity, first_seen, last_seen")
      .order("last_seen", { ascending: false })
      .limit(5000);

    if (since) fallbackQuery = fallbackQuery.gte("first_seen", since);
    if (liveSince) fallbackQuery = fallbackQuery.gte("last_seen", liveSince);

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
    return serverErrorResponse("events query failed", error);
  }

  const points: EventPoint[] = ((data ?? []) as EventPoint[]).map((row) => ({
    id: row.id as string,
    lng: row.lng as number,
    lat: row.lat as number,
    icon_id: (row.icon_id ?? null) as string | null,
    road_number: (row.road_number ?? null) as string | null,
    message: (row.message ?? null) as string | null,
    severity: (row.severity ?? null) as string | null,
    first_seen: row.first_seen as string,
    last_seen: row.last_seen as string,
  }));

  logApiObservation("events", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    liveOnly,
    rowCount: points.length,
    since: Boolean(since),
    source: resultSource,
  });

  return jsonResponse({ points }, { cacheSeconds: 30 });
}
