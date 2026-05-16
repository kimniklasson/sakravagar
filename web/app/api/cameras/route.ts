import { createServerSupabaseClient, type PublicFunctionRow } from "@/lib/supabaseServer";
import {
  isMissingPostgrestFunctionError,
  jsonResponse,
  logApiObservation,
  parseBboxParam,
  requestIdFromRequest,
  serverErrorResponse,
  SWEDEN_DATA_BOUNDS,
} from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CAMERA_PAGE_SIZE = 1000;
const CAMERA_MAX_ROWS = 2500;

export type TrafficCameraPoint = {
  id: string;
  lng: number;
  lat: number;
  name: string | null;
  camera_type: string | null;
  status: string | null;
  description: string | null;
  direction: string | null;
  county_no: number | null;
  active: boolean;
  content_type: string | null;
  icon_id: string | null;
  photo_url: string | null;
  photo_time: string | null;
  has_full_size_photo: boolean | null;
  has_sketch_image: boolean | null;
  first_seen: string;
  last_seen: string;
  modified_time: string | null;
};

type TrafficCameraRow = PublicFunctionRow<"traffic_cameras_in_bbox">;

function isMissingCameraSchemaError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  const message = typeof err.message === "string" ? err.message : "";
  return code === "PGRST205" || message.includes("traffic_cameras");
}

export async function GET(req: Request) {
  const requestId = requestIdFromRequest(req);
  if (!url || !anon) {
    return serverErrorResponse("supabase env missing", new Error("missing supabase env"), { requestId });
  }

  const { searchParams } = new URL(req.url);
  const { bbox, error: bboxError } = parseBboxParam(searchParams.get("bbox"), {
    required: true,
    maxArea: 5000,
    bounds: SWEDEN_DATA_BOUNDS,
  });
  if (bboxError || !bbox) {
    return jsonResponse({ error: bboxError }, { status: 400, requestId });
  }

  const startedAt = Date.now();
  const client = createServerSupabaseClient(url, anon);
  let resultSource = "traffic_cameras_in_bbox";
  let data: TrafficCameraRow[] | null = null;
  let error: unknown = null;
  const rpcRows: TrafficCameraRow[] = [];
  for (let offset = 0; offset < CAMERA_MAX_ROWS; offset += CAMERA_PAGE_SIZE) {
    const end = Math.min(offset + CAMERA_PAGE_SIZE - 1, CAMERA_MAX_ROWS - 1);
    const page = await client.rpc("traffic_cameras_in_bbox", {
      min_lng: bbox.minLng,
      min_lat: bbox.minLat,
      max_lng: bbox.maxLng,
      max_lat: bbox.maxLat,
    }).range(offset, end);
    if (page.error) {
      error = page.error;
      break;
    }
    const rows = (page.data ?? []) as TrafficCameraRow[];
    rpcRows.push(...rows);
    if (rows.length < CAMERA_PAGE_SIZE) break;
  }
  if (!error) data = rpcRows;

  if (error && isMissingPostgrestFunctionError(error, "traffic_cameras_in_bbox")) {
    resultSource = "traffic_cameras_public_fallback";
    const fallbackRows: TrafficCameraRow[] = [];
    error = null;
    for (let offset = 0; offset < CAMERA_MAX_ROWS; offset += CAMERA_PAGE_SIZE) {
      const end = Math.min(offset + CAMERA_PAGE_SIZE - 1, CAMERA_MAX_ROWS - 1);
      const fallbackResult = await client
        .from("traffic_cameras_public")
        .select(
          "id, lng, lat, name, camera_type, status, description, direction, county_no, active, content_type, icon_id, photo_url, photo_time, has_full_size_photo, has_sketch_image, first_seen, last_seen, modified_time",
        )
        .eq("active", true)
        .eq("status", "videoOrImagesAvailable")
        .not("photo_url", "is", null)
        .gte("lng", bbox.minLng)
        .lte("lng", bbox.maxLng)
        .gte("lat", bbox.minLat)
        .lte("lat", bbox.maxLat)
        .order("photo_time", { ascending: false, nullsFirst: false })
        .range(offset, end);
      if (fallbackResult.error) {
        error = fallbackResult.error;
        break;
      }
      const rows = (fallbackResult.data ?? []) as unknown as TrafficCameraRow[];
      fallbackRows.push(...rows);
      if (rows.length < CAMERA_PAGE_SIZE) break;
    }
    data = error ? null : fallbackRows;
  }

  if (error) {
    if (isMissingCameraSchemaError(error)) {
      logApiObservation("traffic-cameras", {
        bboxArea: Number(bbox.area.toFixed(4)),
        durationMs: Date.now() - startedAt,
        requestId,
        rowCount: 0,
        source: `${resultSource}_missing_schema`,
        status: "missing_schema",
      }, { level: "warn" });
      return jsonResponse({ cameras: [] }, { cacheSeconds: 60, requestId });
    }
    return serverErrorResponse("traffic cameras query failed", error, { requestId });
  }

  const cameras: TrafficCameraPoint[] = ((data ?? []) as TrafficCameraRow[]).map((row) => ({
    id: row.id,
    lng: row.lng,
    lat: row.lat,
    name: row.name ?? null,
    camera_type: row.camera_type ?? null,
    status: row.status ?? null,
    description: row.description ?? null,
    direction: row.direction ?? null,
    county_no: row.county_no ?? null,
    active: row.active,
    content_type: row.content_type ?? null,
    icon_id: row.icon_id ?? null,
    photo_url: row.photo_url ?? null,
    photo_time: row.photo_time ?? null,
    has_full_size_photo: row.has_full_size_photo ?? null,
    has_sketch_image: row.has_sketch_image ?? null,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    modified_time: row.modified_time ?? null,
  }));

  logApiObservation("traffic-cameras", {
    bboxArea: Number(bbox.area.toFixed(4)),
    durationMs: Date.now() - startedAt,
    requestId,
    rowCount: cameras.length,
    source: resultSource,
  });

  return jsonResponse({ cameras }, { cacheSeconds: 60, requestId });
}
