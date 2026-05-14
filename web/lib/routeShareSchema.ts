import type { DisturbanceCategory } from "@trafik/shared";
import type { RouteAvoidState, RouteLine } from "./routeTypes";

export type RouteProvider = "graphhopper" | "osrm";
export type RouteStopSource = "manual" | "gps";
export type RouteFeedbackVote = "up" | "down";

export type RouteStop = {
  id: string;
  label: string;
  coordinates: [number, number] | null;
  source: RouteStopSource;
};

export type RouteSharePayload = {
  version: 1;
  createdAt: string;
  stops: RouteStop[];
  routeAvoids: RouteAvoidState;
  selectedRoute: RouteLine;
  provider: RouteProvider | null;
  selectedRouteRank: number;
  presentedRouteCount: number;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ROUTE_AVOID_KEYS = [
  "highSpeed",
  "trafficIntensity",
  "cityTraffic",
  "bridges",
  "tunnels",
  "largeRoundabouts",
  "multilane",
] as const;
const ROUTE_ANNOTATION_SEGMENT_KEYS = [
  "highSpeed",
  "trafficIntensity",
  "cityTraffic",
  "bridges",
  "tunnels",
  "largeRoundabouts",
  "multilane",
] as const;
const ROUTE_ADDED_AVOID_KEYS = new Set<string>(["largeRoundabouts", "multilane"]);
const ROUTE_ANNOTATION_POINT_KEYS = ["disturbances", "liveAccidents"] as const;
const DISTURBANCE_CATEGORIES = new Set<DisturbanceCategory>(["roadwork", "traffic", "other"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[A-Za-z0-9_-]{10,64}$/;

export function payloadByteLength(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function parseSlug(value: unknown): string | null {
  return typeof value === "string" && SLUG_RE.test(value.trim()) ? value.trim() : null;
}

export function parseUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

export function parseFeedbackVote(value: unknown): RouteFeedbackVote | null {
  return value === "up" || value === "down" ? value : null;
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

export function parseRouteSharePayload(
  payload: unknown,
  opts: { maxBytes: number; label?: "payload" | "snapshot" },
): ValidationResult<RouteSharePayload> {
  const label = opts.label ?? "payload";
  if (!isPlainObject(payload)) return invalid(`${label} must be an object`);
  if (payload.version !== 1) return invalid(`unsupported ${label} version`);
  if (typeof payload.createdAt !== "string" || Number.isNaN(Date.parse(payload.createdAt))) {
    return invalid(`${label} createdAt invalid`);
  }
  if (payloadByteLength(payload) > opts.maxBytes) return invalid(`${label} too large`);

  const stops = parseRouteStops(payload.stops);
  if (!stops) return invalid(`${label} stops invalid`);
  const routeAvoids = parseRouteAvoids(payload.routeAvoids);
  if (!routeAvoids) return invalid(`${label} routeAvoids invalid`);
  const selectedRoute = parseRouteLine(payload.selectedRoute);
  if (!selectedRoute) return invalid(`${label} selectedRoute invalid`);
  const provider = parseRouteProvider(payload.provider);
  if (provider === undefined) return invalid(`${label} provider invalid`);
  if (!isSafeIntegerInRange(payload.selectedRouteRank, 0, 100)) {
    return invalid(`${label} selectedRouteRank invalid`);
  }
  if (!isSafeIntegerInRange(payload.presentedRouteCount, 1, 100)) {
    return invalid(`${label} presentedRouteCount invalid`);
  }

  return {
    ok: true,
    value: {
      version: 1,
      createdAt: payload.createdAt,
      stops,
      routeAvoids,
      selectedRoute,
      provider,
      selectedRouteRank: payload.selectedRouteRank,
      presentedRouteCount: payload.presentedRouteCount,
    },
  };
}

function invalid(error: string): ValidationResult<never> {
  return { ok: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function parseCoordinate(value: unknown): [number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isFiniteNumber(value[0]) ||
    !isFiniteNumber(value[1])
  ) {
    return null;
  }
  const [lng, lat] = value;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 ? [lng, lat] : null;
}

function parseLineString(value: unknown): GeoJSON.LineString | null {
  if (!isPlainObject(value) || value.type !== "LineString" || !Array.isArray(value.coordinates)) {
    return null;
  }
  if (value.coordinates.length < 2 || value.coordinates.length > 1_000) return null;
  const coordinates = value.coordinates.map(parseCoordinate);
  return coordinates.every(Boolean)
    ? { type: "LineString", coordinates: coordinates as [number, number][] }
    : null;
}

function parseRouteStops(value: unknown): RouteStop[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10) return null;
  const stops = value.map((stop) => {
    if (!isPlainObject(stop)) return null;
    if (typeof stop.id !== "string" || stop.id.length < 1 || stop.id.length > 80) return null;
    if (typeof stop.label !== "string" || stop.label.length > 200) return null;
    if (stop.source !== "manual" && stop.source !== "gps") return null;
    const coordinates = stop.coordinates === null ? null : parseCoordinate(stop.coordinates);
    if (stop.coordinates !== null && !coordinates) return null;
    return {
      id: stop.id,
      label: stop.label,
      coordinates,
      source: stop.source,
    } satisfies RouteStop;
  });
  return stops.every(Boolean) ? stops as RouteStop[] : null;
}

function parseRouteAvoids(value: unknown): RouteAvoidState | null {
  if (!isPlainObject(value)) return null;
  const entries = ROUTE_AVOID_KEYS.map((key) => {
    const optionValue = value[key];
    if (optionValue === undefined && ROUTE_ADDED_AVOID_KEYS.has(key)) return [key, false];
    return [key, optionValue];
  });
  if (!entries.every(([, optionValue]) => typeof optionValue === "boolean")) return null;
  return Object.fromEntries(entries) as RouteAvoidState;
}

function parseRouteProvider(value: unknown): RouteProvider | null | undefined {
  if (value === null) return null;
  if (value === "graphhopper" || value === "osrm") return value;
  return undefined;
}

function parseNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isFiniteNumber(value) ? value : undefined;
}

function parseRouteMetricRecord(value: unknown): RouteLine["avoidScores"] | null {
  if (!isPlainObject(value)) return null;
  const entries = ROUTE_AVOID_KEYS.map((key) => [
    key,
    value[key] === undefined && ROUTE_ADDED_AVOID_KEYS.has(key)
      ? null
      : parseNullableNumber(value[key]),
  ]);
  if (entries.some(([, optionValue]) => optionValue === undefined)) return null;
  return Object.fromEntries(entries) as RouteLine["avoidScores"];
}

function parseRouteExposure(value: unknown): RouteLine["exposure"] | null {
  if (!isPlainObject(value)) return null;
  const legacyKeys = [
    "highSpeedMeters",
    "trafficIntensityMeters",
    "cityTrafficMeters",
    "disturbances",
    "liveAccidents",
    "bridgeMeters",
    "tunnelMeters",
  ] as const;
  const addedKeys = ["largeRoundaboutMeters", "multilaneMeters"] as const;
  const addedKeySet = new Set<string>(addedKeys);
  const keys = [...legacyKeys, ...addedKeys] as const;
  const entries = keys.map((key) => [
    key,
    value[key] === undefined && addedKeySet.has(key)
      ? null
      : parseNullableNumber(value[key]),
  ]);
  if (entries.some(([, optionValue]) => optionValue === undefined)) return null;
  return Object.fromEntries(entries) as RouteLine["exposure"];
}

function parseRouteAnnotations(value: unknown): RouteLine["annotations"] | null {
  if (!isPlainObject(value)) return null;
  const segmentEntries = ROUTE_ANNOTATION_SEGMENT_KEYS.map((key) => {
    const segments = value[key] ?? (ROUTE_ADDED_AVOID_KEYS.has(key) ? [] : undefined);
    if (!Array.isArray(segments) || segments.length > 200) return null;
    const parsed = segments.map((segment) => {
      if (!isPlainObject(segment) || segment.kind !== key) return null;
      const geometry = parseLineString(segment.geometry);
      return geometry ? { kind: key, geometry } : null;
    });
    return parsed.every(Boolean) ? [key, parsed] : null;
  });
  const pointEntries = ROUTE_ANNOTATION_POINT_KEYS.map((key) => {
    const points = value[key];
    if (!Array.isArray(points) || points.length > 300) return null;
    const parsed = points.map((point) => {
      if (!isPlainObject(point) || point.kind !== key) return null;
      const coordinates = parseCoordinate(point.coordinates);
      if (!coordinates) return null;
      if (
        point.category !== undefined &&
        (typeof point.category !== "string" || !DISTURBANCE_CATEGORIES.has(point.category as DisturbanceCategory))
      ) {
        return null;
      }
      return {
        kind: key,
        coordinates,
        ...(point.category ? { category: point.category as DisturbanceCategory } : {}),
      };
    });
    return parsed.every(Boolean) ? [key, parsed] : null;
  });
  if (segmentEntries.some((entry) => entry === null) || pointEntries.some((entry) => entry === null)) {
    return null;
  }
  const entries = [...segmentEntries, ...pointEntries] as [keyof RouteLine["annotations"], unknown][];
  return Object.fromEntries(entries) as RouteLine["annotations"];
}

function parseRouteLine(value: unknown): RouteLine | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 120) return null;
  if (typeof value.source !== "string" || value.source.length < 1 || value.source.length > 120) return null;
  if (!isFiniteNumber(value.distanceMeters) || value.distanceMeters < 0) return null;
  if (!isFiniteNumber(value.durationSeconds) || value.durationSeconds < 0) return null;
  const geometry = parseLineString(value.geometry);
  if (!geometry) return null;
  const safetyScore = parseNullableNumber(value.safetyScore);
  if (safetyScore === undefined) return null;
  const avoidScores = parseRouteMetricRecord(value.avoidScores);
  const exposure = parseRouteExposure(value.exposure);
  const annotations = parseRouteAnnotations(value.annotations);
  if (!avoidScores || !exposure || !annotations) return null;
  return {
    id: value.id,
    source: value.source,
    distanceMeters: value.distanceMeters,
    durationSeconds: value.durationSeconds,
    geometry,
    safetyScore,
    avoidScores,
    exposure,
    annotations,
  };
}
