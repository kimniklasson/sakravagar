import { createClient } from "@supabase/supabase-js";
import { jsonResponse, serverErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const SNAPSHOT_MAX_BYTES = 300_000;
const FEEDBACK_SNAPSHOT_TTL_DAYS = 90;

type FeedbackVote = "up" | "down";

type SnapshotRpcRow = {
  id: string;
  slug: string | null;
  expires_at: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function payloadByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

function normalizeVote(value: unknown): FeedbackVote | null {
  return value === "up" || value === "down" ? value : null;
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function validateSnapshotPayload(payload: unknown): string | null {
  if (!isObject(payload)) return "snapshot must be an object";
  if (payload.version !== 1) return "unsupported snapshot version";
  if (!isObject(payload.selectedRoute)) return "snapshot selectedRoute invalid";
  if (!Array.isArray(payload.stops) || payload.stops.length < 2) return "snapshot stops invalid";
  if (payloadByteLength(payload) > SNAPSHOT_MAX_BYTES) return "snapshot too large";
  return null;
}

export async function POST(req: Request) {
  if (!url || !serviceKey) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const body = (await req.json().catch(() => null)) as {
    vote?: unknown;
    snapshot?: unknown;
    routeMeta?: unknown;
    searchMeta?: unknown;
  } | null;

  const vote = normalizeVote(body?.vote);
  if (!vote) return jsonResponse({ error: "invalid vote" }, { status: 400 });

  const snapshot = body?.snapshot;
  const snapshotError = validateSnapshotPayload(snapshot);
  if (snapshotError) return jsonResponse({ error: snapshotError }, { status: 400 });

  const routeMeta = isObject(body?.routeMeta) ? body.routeMeta : {};
  const searchMeta = isObject(body?.searchMeta) ? body.searchMeta : {};
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const expiresAt = new Date(Date.now() + FEEDBACK_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: snapshotData, error: snapshotErrorResponse } = await client.rpc("create_route_snapshot", {
    p_slug: null,
    p_is_public: false,
    p_payload: snapshot,
    p_expires_at: expiresAt,
  });
  if (snapshotErrorResponse) {
    return serverErrorResponse("route feedback snapshot create failed", snapshotErrorResponse);
  }

  const snapshotRow = ((snapshotData as SnapshotRpcRow[] | null) ?? [])[0];
  if (!snapshotRow?.id) {
    return serverErrorResponse("route feedback snapshot missing id", new Error("missing snapshot id"));
  }

  const { data: feedbackId, error: feedbackError } = await client.rpc("create_route_feedback", {
    p_snapshot_id: snapshotRow.id,
    p_vote: vote,
    p_comment: null,
    p_route_meta: routeMeta,
    p_search_meta: searchMeta,
  });
  if (feedbackError) {
    return serverErrorResponse("route feedback create failed", feedbackError);
  }

  return jsonResponse({ id: feedbackId, expiresAt: snapshotRow.expires_at });
}

export async function DELETE(req: Request) {
  if (!url || !serviceKey) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"));
  }

  const { searchParams } = new URL(req.url);
  const id = normalizeUuid(searchParams.get("id"));
  if (!id) return jsonResponse({ error: "invalid feedback id" }, { status: 400 });

  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("delete_route_feedback", {
    p_feedback_id: id,
  });
  if (error) return serverErrorResponse("route feedback delete failed", error);

  return jsonResponse({ deleted: data === true });
}
