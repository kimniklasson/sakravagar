import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../db/database.types";

export type SupabaseDatabase = Database;
export type SupabaseJson = Json;
export type PublicFunctionName = keyof Database["public"]["Functions"];
export type PublicFunctionReturn<Name extends PublicFunctionName> =
  Database["public"]["Functions"][Name]["Returns"];
export type PublicFunctionRow<Name extends PublicFunctionName> =
  PublicFunctionReturn<Name> extends Array<infer Row> ? Row : never;

export function createServerSupabaseClient(url: string, key: string) {
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
