import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { jsonResponse, serverErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteOrigin = process.env.PUBLIC_SITE_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_ORIGIN;
const SNAPSHOT_MAX_BYTES = 300_000;
const PUBLIC_SNAPSHOT_TTL_DAYS = 30;

type SnapshotRpcRow = {
  id: string;
  slug: string | null;
  expires_at: string;
};

type PublicSnapshotRpcRow = {
  payload: unknown | null;
  expires_at: string;
  expired: boolean;
};

function payloadByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isRouteLineLike(value: unknown): boolean {
  if (!isObject(value)) return false;
  const geometry = value.geometry;
  if (!isObject(geometry) || geometry.type !== "LineString") return false;
  const coordinates = geometry.coordinates;
  return (
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.distanceMeters === "number" &&
    typeof value.durationSeconds === "number" &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.every(isCoordinate)
  );
}

function validateSnapshotPayload(payload: unknown): string | null {
  if (!isObject(payload)) return "payload must be an object";
  if (payload.version !== 1) return "unsupported payload version";
  if (!Array.isArray(payload.stops) || payload.stops.length < 2 || payload.stops.length > 10) {
    return "payload stops invalid";
  }
  if (!isObject(payload.routeAvoids)) return "payload routeAvoids invalid";
  if (!isRouteLineLike(payload.selectedRoute)) return "payload selectedRoute invalid";
  if (payloadByteLength(payload) > SNAPSHOT_MAX_BYTES) return "payload too large";
  return null;
}

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
  const slug = searchParams.get("slug")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(slug)) {
    return jsonResponse({ error: "invalid slug" }, { status: 400 });
  }

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("get_public_route_snapshot", { p_slug: slug });
  if (error) return serverErrorResponse("route share lookup failed", error);

  const row = ((data as PublicSnapshotRpcRow[] | null) ?? [])[0];
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
  const payload = body?.payload;
  const payloadError = validateSnapshotPayload(payload);
  if (payloadError) {
    return jsonResponse({ error: payloadError }, { status: 400 });
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const expiresAt = new Date(Date.now() + PUBLIC_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = makeSlug();
    const { data, error } = await client.rpc("create_route_snapshot", {
      p_slug: slug,
      p_is_public: true,
      p_payload: payload,
      p_expires_at: expiresAt,
    });

    if (!error) {
      const row = ((data as SnapshotRpcRow[] | null) ?? [])[0];
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
