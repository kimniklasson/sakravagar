import { createClient } from "@supabase/supabase-js";
import { jsonResponse, parseBboxParam, serverErrorResponse, SWEDEN_DATA_BOUNDS } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ACTIVE_WINDOW_MS = 90 * 60 * 1000;

export type DisturbanceCategory = "roadwork" | "traffic";

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

function categoryFromMessageType(messageType: string | null): DisturbanceCategory | null {
  const t = (messageType ?? "").toLowerCase();
  if (t.includes("vägarbete") || t.includes("roadwork")) return "roadwork";
  if (t.includes("kö") || t.includes("trafik") || t.includes("queue")) return "traffic";
  return null;
}

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
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

  const client = createClient(url, anon, { auth: { persistSession: false } });

  let query = client
    .from("disturbances_public")
    .select("id, lng, lat, icon_id, message_type, road_number, message, severity, first_seen, last_seen")
    .gte("last_seen", activeSince)
    .order("last_seen", { ascending: false })
    .limit(2000);

  query = query
    .gte("lng", bbox.minLng)
    .lte("lng", bbox.maxLng)
    .gte("lat", bbox.minLat)
    .lte("lat", bbox.maxLat);

  const { data, error } = await query;
  if (error) {
    return serverErrorResponse("disturbances query failed", error);
  }

  const points: DisturbancePoint[] = (data ?? []).flatMap((row) => {
    const messageType = (row.message_type ?? null) as string | null;
    const category = categoryFromMessageType(messageType);
    if (!category) return [];
    return [{
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
    }];
  });

  return jsonResponse({ points }, { cacheSeconds: 30 });
}
