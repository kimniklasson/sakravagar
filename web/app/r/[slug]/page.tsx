import styles from "../../page.module.css";
import { createClient } from "@supabase/supabase-js";
import MapLoader from "@/components/Map/MapLoader";
import { parseRouteSharePayload, parseSlug, type RouteSharePayload } from "@/lib/routeShareSchema";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SNAPSHOT_MAX_BYTES = 300_000;

type PublicSnapshotRpcRow = {
  payload: unknown | null;
  expires_at: string;
  expired: boolean;
};

async function getInitialSharedRoutePayload(slug: string): Promise<RouteSharePayload | null> {
  const parsedSlug = parseSlug(slug);
  if (!supabaseUrl || !supabaseAnon || !parsedSlug) return null;

  const client = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("get_public_route_snapshot", { p_slug: parsedSlug });
  if (error) {
    console.warn("shared route server prefetch failed", error);
    return null;
  }

  const row = ((data as PublicSnapshotRpcRow[] | null) ?? [])[0];
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
