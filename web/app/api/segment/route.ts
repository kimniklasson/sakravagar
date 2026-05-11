import { createClient } from "@supabase/supabase-js";
import { jsonResponse, serverErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export type SegmentRecentEvent = {
  id: string;
  message: string | null;
  severity: string | null;
  road_number: string | null;
  first_seen: string;
};

export type SegmentDetail = {
  fid: number;
  element_id: string | number | null;
  langd_m: number | null;
  adt_total: number | null;
  matar: number | null;
  events_count: number;
  data_window_days: number;
  risk_per_passage_pct: number | null;
  risk_per_milj_fordon: number | null;
  recent_events: SegmentRecentEvent[];
};

export async function GET(req: Request) {
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const fidRaw = searchParams.get("fid");
  if (!fidRaw) {
    return jsonResponse({ error: "fid required" }, { status: 400 });
  }
  const fid = Number(fidRaw);
  if (!Number.isSafeInteger(fid) || fid < 0 || fid > 1_000_000_000) {
    return jsonResponse({ error: "fid must be a safe integer" }, { status: 400 });
  }

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("segment_detail", { p_fid: fid });

  if (error) {
    return serverErrorResponse("segment detail query failed", error);
  }
  if (!data) {
    return jsonResponse({ error: "segment not found" }, { status: 404 });
  }

  return jsonResponse({ segment: data as SegmentDetail }, { cacheSeconds: 3600 });
}
