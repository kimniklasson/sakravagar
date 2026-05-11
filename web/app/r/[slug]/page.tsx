import styles from "../../page.module.css";
import { createClient } from "@supabase/supabase-js";
import MapLoader from "@/components/Map/MapLoader";
import type { RouteSharePayload } from "@/components/Map/Map";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type PublicSnapshotRpcRow = {
  payload: unknown | null;
  expires_at: string;
  expired: boolean;
};

async function getInitialSharedRoutePayload(slug: string): Promise<RouteSharePayload | null> {
  if (!supabaseUrl || !supabaseAnon || !/^[A-Za-z0-9_-]{10,64}$/.test(slug)) return null;

  const client = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("get_public_route_snapshot", { p_slug: slug });
  if (error) {
    console.warn("shared route server prefetch failed", error);
    return null;
  }

  const row = ((data as PublicSnapshotRpcRow[] | null) ?? [])[0];
  if (!row || row.expired || !row.payload) return null;
  return row.payload as RouteSharePayload;
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
