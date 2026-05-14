import { randomBytes } from "node:crypto";
import { parseRouteSharePayload, parseSlug } from "@/lib/routeShareSchema";
import { createServerSupabaseClient, type SupabaseJson } from "@/lib/supabaseServer";
import { jsonResponse, serverErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteOrigin = process.env.PUBLIC_SITE_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_ORIGIN;
const SNAPSHOT_MAX_BYTES = 300_000;
const PUBLIC_SNAPSHOT_TTL_DAYS = 30;

function makeSlug(): string {
  return randomBytes(12).toString("base64url");
}

function requestOrigin(req: Request): string {
  if (siteOrigin) {
    try {
      return new URL(siteOrigin).origin;
    } catch {
      // Fall through to the request-derived origin.
    }
  }
  const fallback = new URL(req.url).origin;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return fallback;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  try {
    const origin = new URL(`${proto}://${host}`).origin;
    return proto === "https" || origin.startsWith("http://localhost") ? origin : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(req: Request) {
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const slug = parseSlug(searchParams.get("slug"));
  if (!slug) {
    return jsonResponse({ error: "invalid slug" }, { status: 400 });
  }

  const client = createServerSupabaseClient(url, anon);
  const { data, error } = await client.rpc("get_public_route_snapshot", { p_slug: slug });
  if (error) return serverErrorResponse("route share lookup failed", error);

  const row = (data ?? [])[0];
  if (!row) return jsonResponse({ error: "not found" }, { status: 404 });
  if (row.expired) {
    return jsonResponse({ error: "expired", expiresAt: row.expires_at }, { status: 410 });
  }

  return jsonResponse({ payload: row.payload, expiresAt: row.expires_at }, { cacheSeconds: 30 });
}

export async function POST(req: Request) {
  if (!url || !serviceKey) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const body = (await req.json().catch(() => null)) as { payload?: unknown } | null;
  const parsedPayload = parseRouteSharePayload(body?.payload, { maxBytes: SNAPSHOT_MAX_BYTES });
  if (!parsedPayload.ok) {
    return jsonResponse({ error: parsedPayload.error }, { status: 400 });
  }
  const payload = parsedPayload.value;

  const client = createServerSupabaseClient(url, serviceKey);
  const expiresAt = new Date(Date.now() + PUBLIC_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = makeSlug();
    const { data, error } = await client.rpc("create_route_snapshot", {
      p_slug: slug,
      p_is_public: true,
      p_payload: payload as unknown as SupabaseJson,
      p_expires_at: expiresAt,
    });

    if (!error) {
      const row = (data ?? [])[0];
      if (!row?.slug) return serverErrorResponse("route share missing slug", new Error("missing slug"));
      return jsonResponse({
        slug: row.slug,
        url: `${requestOrigin(req)}/r/${row.slug}`,
        expiresAt: row.expires_at,
      });
    }

    if (error.code !== "23505") {
      return serverErrorResponse("route share create failed", error);
    }
  }

  return serverErrorResponse("route share slug collision", new Error("slug collision"));
}
