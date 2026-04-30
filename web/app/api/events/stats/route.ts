import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type EventTimestampRow = {
  first_seen?: string | null;
  last_seen?: string | null;
};

export type EventStats = {
  oldestFirstSeen: string | null;
  latestLastSeen: string | null;
  periodDays: number | null;
};

export async function GET() {
  if (!url || !anon) {
    return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  }

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const [oldestResult, latestResult] = await Promise.all([
    client
      .from("events_public")
      .select("first_seen")
      .order("first_seen", { ascending: true })
      .limit(1)
      .maybeSingle<EventTimestampRow>(),
    client
      .from("events_public")
      .select("last_seen")
      .order("last_seen", { ascending: false })
      .limit(1)
      .maybeSingle<EventTimestampRow>(),
  ]);

  const error = oldestResult.error ?? latestResult.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const oldestFirstSeen = oldestResult.data?.first_seen ?? null;
  const latestLastSeen = latestResult.data?.last_seen ?? null;
  const periodDays = oldestFirstSeen
    ? Math.max(1, Math.ceil((Date.now() - Date.parse(oldestFirstSeen)) / 86400_000))
    : null;

  return NextResponse.json({
    oldestFirstSeen,
    latestLastSeen,
    periodDays,
  } satisfies EventStats);
}
