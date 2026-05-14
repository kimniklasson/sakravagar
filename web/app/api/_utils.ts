import { NextResponse } from "next/server";

export type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  area: number;
};

export type BboxBounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

type BboxOptions = {
  required?: boolean;
  maxArea: number;
  bounds?: BboxBounds;
};

type JsonResponseInit = ResponseInit & {
  cacheSeconds?: number;
  requestId?: string;
};
type ApiLogLevel = "info" | "warn";

const MIN_LNG = -180;
const MAX_LNG = 180;
const MIN_LAT = -90;
const MAX_LAT = 90;
export const REQUEST_ID_HEADER = "x-request-id";
export const CLIENT_IP_HEADER = "x-client-ip";

export const SWEDEN_DATA_BOUNDS: BboxBounds = {
  minLng: 9,
  minLat: 54,
  maxLng: 25,
  maxLat: 70,
};

export function jsonResponse<T>(
  body: T,
  init: JsonResponseInit = {},
) {
  const headers = new Headers(init.headers);
  if (init.requestId) headers.set(REQUEST_ID_HEADER, init.requestId);
  if (init.cacheSeconds && init.cacheSeconds > 0) {
    headers.set(
      "Cache-Control",
      `public, s-maxage=${init.cacheSeconds}, stale-while-revalidate=${init.cacheSeconds * 2}`,
    );
  }
  return NextResponse.json(body, { ...init, headers });
}

export function serverErrorResponse(
  label: string,
  error: unknown,
  opts: { requestId?: string } = {},
) {
  logApiError(label, error, opts);
  return jsonResponse({ error: "server error" }, { status: 500, requestId: opts.requestId });
}

function loggableError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    return {
      code: err.code,
      message: err.message,
      details: err.details,
      hint: err.hint,
    };
  }
  return error;
}

export function logApiError(
  label: string,
  error: unknown,
  opts: { requestId?: string } = {},
): void {
  console.error("api_error", {
    event: "api_error",
    label,
    requestId: opts.requestId,
    error: loggableError(error),
  });
}

export function logApiWarning(
  label: string,
  error: unknown,
  opts: { requestId?: string } = {},
): void {
  console.warn("api_warning", {
    event: "api_warning",
    label,
    requestId: opts.requestId,
    error: loggableError(error),
  });
}

export function logApiObservation(
  route: string,
  fields: Record<string, unknown>,
  opts: { level?: ApiLogLevel } = {},
): void {
  const level = opts.level ?? "info";
  console[level]("api_observation", {
    event: "api_observation",
    route,
    status: "ok",
    ...fields,
  });
}

function isValidRequestId(value: string | null): value is string {
  return value !== null && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function requestIdFromRequest(req: Request): string {
  const existing = req.headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(existing) ? existing : newRequestId();
}

export function clientIpFromRequest(req: Request): string {
  const forwardedByMiddleware = req.headers.get(CLIENT_IP_HEADER)?.trim();
  if (forwardedByMiddleware) return forwardedByMiddleware;
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function isMissingPostgrestFunctionError(error: unknown, functionName: string): boolean {
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  const message = typeof err.message === "string" ? err.message : "";
  return code === "PGRST202" || message.includes(functionName);
}

export function parseBboxParam(
  value: string | null,
  opts: BboxOptions,
): { bbox: Bbox | null; error: string | null } {
  if (!value) {
    return opts.required
      ? { bbox: null, error: "bbox required" }
      : { bbox: null, error: null };
  }

  const nums = value.split(",").map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite)) {
    return { bbox: null, error: "bbox must be 4 finite numbers" };
  }

  const [minLng, minLat, maxLng, maxLat] = nums as [number, number, number, number];
  if (
    minLng < MIN_LNG ||
    maxLng > MAX_LNG ||
    minLat < MIN_LAT ||
    maxLat > MAX_LAT ||
    minLng >= maxLng ||
    minLat >= maxLat
  ) {
    return { bbox: null, error: "bbox outside valid coordinate bounds" };
  }

  if (opts.bounds && (
    minLng < opts.bounds.minLng ||
    maxLng > opts.bounds.maxLng ||
    minLat < opts.bounds.minLat ||
    maxLat > opts.bounds.maxLat
  )) {
    return { bbox: null, error: "bbox outside supported data bounds" };
  }

  const area = (maxLng - minLng) * (maxLat - minLat);
  if (area > opts.maxArea) {
    return { bbox: null, error: "bbox too large" };
  }

  return { bbox: { minLng, minLat, maxLng, maxLat, area }, error: null };
}
