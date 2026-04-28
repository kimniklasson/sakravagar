import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export function makeClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export type UpsertRow = {
  id: string;
  icon_id: string | null;
  message: string | null;
  road_number: string | null;
  county_no: number | null;
  geom: string;
  last_seen: string;
  modified_time: string | null;
  raw: unknown;
};

export type DisturbanceUpsertRow = UpsertRow & {
  message_type: string | null;
  severity: string | null;
};

export type UpsertResult = {
  attempted: number;
  error: Error | null;
};

// first_seen utelämnas medvetet — defaultvärdet `now()` sätts vid insert
// och lämnas orörd vid update (eftersom kolumnen inte finns i payload).
export async function upsertEvents(
  client: SupabaseClient,
  rows: UpsertRow[]
): Promise<UpsertResult> {
  if (rows.length === 0) return { attempted: 0, error: null };

  const { error } = await client.from("events").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  return { attempted: rows.length, error: error ? new Error(error.message) : null };
}

export async function upsertDisturbances(
  client: SupabaseClient,
  rows: DisturbanceUpsertRow[]
): Promise<UpsertResult> {
  if (rows.length === 0) return { attempted: 0, error: null };

  const { error } = await client.from("disturbances").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  return { attempted: rows.length, error: error ? new Error(error.message) : null };
}
