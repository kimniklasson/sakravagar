import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

type AdtRow = {
  fid: number;
  adt_total: number;
  adt_tung: number | null;
  matar: number | null;
  geometry: GeoJSON.LineString;
};

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

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("adt_in_bbox", {
    min_lng: minLng,
    min_lat: minLat,
    max_lng: maxLng,
    max_lat: maxLat,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const segments: AdtSegment[] = ((data ?? []) as AdtRow[]).map((row) => ({
    fid: row.fid,
    adt_total: row.adt_total,
    adt_tung: row.adt_tung,
    matar: row.matar,
    geometry: row.geometry,
  }));

  return NextResponse.json({ segments });
}
