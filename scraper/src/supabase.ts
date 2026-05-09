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

export type TrafficFlowUpsertRow = {
  id: string;
  site_id: number;
  measurement_time: string | null;
  measurement_or_calculation_period: number | null;
  vehicle_type: string | null;
  vehicle_flow_rate: number | null;
  average_vehicle_speed: number | null;
  data_quality: string | null;
  county_no: number | null;
  region_id: number | null;
  deleted: boolean;
  specific_lane: string | null;
  measurement_side: string | null;
  geom: string;
  last_seen: string;
  modified_time: string | null;
  raw: unknown;
};

export type UpsertResult = {
  attempted: number;
  batches: number;
  error: Error | null;
};

const EVENTS_UPSERT_BATCH_SIZE = 500;
const DISTURBANCES_UPSERT_BATCH_SIZE = 250;
const TRAFFIC_FLOW_UPSERT_BATCH_SIZE = 500;

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function upsertInBatches<T>(
  client: SupabaseClient,
  table: string,
  rows: T[],
  batchSize: number
): Promise<UpsertResult> {
  let attempted = 0;
  let batches = 0;
  for (const batch of chunks(rows, batchSize)) {
    const { error } = await client.from(table).upsert(batch, {
      onConflict: "id",
      ignoreDuplicates: false,
    });
    if (error) return { attempted, batches, error: new Error(error.message) };
    attempted += batch.length;
    batches += 1;
  }
  return { attempted, batches, error: null };
}

// first_seen utelämnas medvetet — defaultvärdet `now()` sätts vid insert
// och lämnas orörd vid update (eftersom kolumnen inte finns i payload).
export async function upsertEvents(
  client: SupabaseClient,
  rows: UpsertRow[]
): Promise<UpsertResult> {
  return upsertInBatches(client, "events", rows, EVENTS_UPSERT_BATCH_SIZE);
}

export async function upsertDisturbances(
  client: SupabaseClient,
  rows: DisturbanceUpsertRow[]
): Promise<UpsertResult> {
  return upsertInBatches(client, "disturbances", rows, DISTURBANCES_UPSERT_BATCH_SIZE);
}

export async function upsertTrafficFlows(
  client: SupabaseClient,
  rows: TrafficFlowUpsertRow[]
): Promise<UpsertResult> {
  return upsertInBatches(
    client,
    "traffic_flow_measurements",
    rows,
    TRAFFIC_FLOW_UPSERT_BATCH_SIZE
  );
}
