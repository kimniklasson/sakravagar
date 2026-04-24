import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;

type EventPoint = {
  id: string;
  lng: number;
  lat: number;
  icon_id: string | null;
  road_number: string | null;
  last_seen: string;
};

export async function GET(req: Request) {
  if (!url || !anon) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const since = searchParams.get("since");
  const bbox = searchParams.get("bbox"); // "minLng,minLat,maxLng,maxLat"

  const client = createClient(url, anon, { auth: { persistSession: false } });

  let query = client
    .from("events_public")
    .select("id, lng, lat, icon_id, road_number, last_seen")
    .order("last_seen", { ascending: false })
    .limit(5000);

  if (since) query = query.gte("last_seen", since);

  if (bbox) {
    const nums = bbox.split(",").map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = nums as [number, number, number, number];
      query = query
        .gte("lng", minLng)
        .lte("lng", maxLng)
        .gte("lat", minLat)
        .lte("lat", maxLat);
    }
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const points: EventPoint[] = (data ?? []).map((row) => ({
    id: row.id as string,
    lng: row.lng as number,
    lat: row.lat as number,
    icon_id: (row.icon_id ?? null) as string | null,
    road_number: (row.road_number ?? null) as string | null,
    last_seen: row.last_seen as string,
  }));

  return NextResponse.json({ points });
}
