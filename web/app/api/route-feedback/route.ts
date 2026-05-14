import {
  parseFeedbackVote,
  parseJsonObject,
  parseRouteSharePayload,
  parseUuid,
} from "@/lib/routeShareSchema";
import { createServerSupabaseClient, type SupabaseJson } from "@/lib/supabaseServer";
import { jsonResponse, requestIdFromRequest, serverErrorResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const SNAPSHOT_MAX_BYTES = 300_000;
const FEEDBACK_SNAPSHOT_TTL_DAYS = 90;

// Supabase CLI currently emits nullable RPC args as non-nullable strings.
const PRIVATE_ROUTE_SNAPSHOT_SLUG = null as unknown as string;

export async function POST(req: Request) {
  const requestId = requestIdFromRequest(req);
  if (!url || !serviceKey) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"), { requestId });
  }

  const body = (await req.json().catch(() => null)) as {
    vote?: unknown;
    snapshot?: unknown;
    routeMeta?: unknown;
    searchMeta?: unknown;
  } | null;

  const vote = parseFeedbackVote(body?.vote);
  if (!vote) return jsonResponse({ error: "invalid vote" }, { status: 400, requestId });

  const parsedSnapshot = parseRouteSharePayload(body?.snapshot, {
    maxBytes: SNAPSHOT_MAX_BYTES,
    label: "snapshot",
  });
  if (!parsedSnapshot.ok) return jsonResponse({ error: parsedSnapshot.error }, { status: 400, requestId });

  const snapshot = parsedSnapshot.value;
  const routeMeta = parseJsonObject(body?.routeMeta) ?? {};
  const searchMeta = parseJsonObject(body?.searchMeta) ?? {};
  const client = createServerSupabaseClient(url, serviceKey);
  const expiresAt = new Date(Date.now() + FEEDBACK_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: snapshotData, error: snapshotErrorResponse } = await client.rpc("create_route_snapshot", {
    p_slug: PRIVATE_ROUTE_SNAPSHOT_SLUG,
    p_is_public: false,
    p_payload: snapshot as unknown as SupabaseJson,
    p_expires_at: expiresAt,
  });
  if (snapshotErrorResponse) {
    return serverErrorResponse("route feedback snapshot create failed", snapshotErrorResponse, { requestId });
  }

  const snapshotRow = (snapshotData ?? [])[0];
  if (!snapshotRow?.id) {
    return serverErrorResponse(
      "route feedback snapshot missing id",
      new Error("missing snapshot id"),
      { requestId },
    );
  }

  const { data: feedbackId, error: feedbackError } = await client.rpc("create_route_feedback", {
    p_snapshot_id: snapshotRow.id,
    p_vote: vote,
    p_comment: "",
    p_route_meta: routeMeta as unknown as SupabaseJson,
    p_search_meta: searchMeta as unknown as SupabaseJson,
  });
  if (feedbackError) {
    return serverErrorResponse("route feedback create failed", feedbackError, { requestId });
  }

  return jsonResponse({ id: feedbackId, expiresAt: snapshotRow.expires_at }, { requestId });
}

export async function DELETE(req: Request) {
  const requestId = requestIdFromRequest(req);
  if (!url || !serviceKey) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"), { requestId });
  }

  const { searchParams } = new URL(req.url);
  const id = parseUuid(searchParams.get("id"));
  if (!id) return jsonResponse({ error: "invalid feedback id" }, { status: 400, requestId });

  const client = createServerSupabaseClient(url, serviceKey);
  const { data, error } = await client.rpc("delete_route_feedback", {
    p_feedback_id: id,
  });
  if (error) return serverErrorResponse("route feedback delete failed", error, { requestId });

  return jsonResponse({ deleted: data === true }, { requestId });
}
