import type { Metadata } from "next";
import styles from "../../page.module.css";
import MapLoader from "@/components/Map/MapLoader";
import { parseRouteSharePayload, parseSlug, type RouteSharePayload } from "@/lib/routeShareSchema";
import { createServerSupabaseClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Delad rutt – Säkra vägar",
  robots: {
    index: false,
    follow: false,
  },
};

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SNAPSHOT_MAX_BYTES = 300_000;

async function getInitialSharedRoutePayload(slug: string): Promise<RouteSharePayload | null> {
  const parsedSlug = parseSlug(slug);
  if (!supabaseUrl || !supabaseAnon || !parsedSlug) return null;

  const client = createServerSupabaseClient(supabaseUrl, supabaseAnon);
  const { data, error } = await client.rpc("get_public_route_snapshot", { p_slug: parsedSlug });
  if (error) {
    console.warn("shared route server prefetch failed", error);
    return null;
  }

  const row = (data ?? [])[0];
  if (!row || row.expired || !row.payload) return null;
  const payload = parseRouteSharePayload(row.payload, { maxBytes: SNAPSHOT_MAX_BYTES });
  if (!payload.ok) {
    console.warn("shared route server prefetch payload invalid", payload.error);
    return null;
  }
  return payload.value;
}

export default async function SharedRoutePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const initialSharedRoutePayload = await getInitialSharedRoutePayload(slug);

  return (
    <main className={styles.main}>
      <MapLoader
        sharedRouteSlug={slug}
        initialSharedRoutePayload={initialSharedRoutePayload}
      />
    </main>
  );
}
