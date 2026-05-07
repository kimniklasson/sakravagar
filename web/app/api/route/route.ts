import { createClient } from "@supabase/supabase-js";
import { jsonResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
const OSRM_PROFILE = process.env.OSRM_PROFILE ?? "driving";
const GRAPHHOPPER_BASE_URL = process.env.GRAPHHOPPER_BASE_URL;
const GRAPHHOPPER_TOKEN = process.env.GRAPHHOPPER_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const MIN_SWEDEN_LNG = 9;
const MAX_SWEDEN_LNG = 25;
const MIN_SWEDEN_LAT = 54;
const MAX_SWEDEN_LAT = 70;

export type RouteLine = {
  id: string;
  source: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
  safetyScore: number | null;
  avoidScores: {
    accidentHistory: number | null;
    highSpeed: number | null;
    trafficIntensity: number | null;
    disturbances: number | null;
    bridges: number | null;
    tunnels: number | null;
  };
  exposure: {
    accidentHistory: number | null;
    highSpeedMeters: number | null;
    trafficIntensityMeters: number | null;
    disturbances: number | null;
    bridgeMeters: number | null;
    tunnelMeters: number | null;
    accidentHistoryEvents: number | null;
  };
  annotations: RouteAnnotations;
};

export type RouteAnnotationSegmentKind = "highSpeed" | "trafficIntensity" | "bridges" | "tunnels";
export type RouteAnnotationPointKind = "disturbances" | "accidentHistory";

export type RouteAnnotationSegment = {
  kind: RouteAnnotationSegmentKind;
  geometry: GeoJSON.LineString;
};

export type RouteAnnotationPoint = {
  kind: RouteAnnotationPointKind;
  coordinates: [number, number];
  category?: "roadwork" | "traffic";
};

export type RouteAnnotations = {
  highSpeed: RouteAnnotationSegment[];
  trafficIntensity: RouteAnnotationSegment[];
  bridges: RouteAnnotationSegment[];
  tunnels: RouteAnnotationSegment[];
  disturbances: RouteAnnotationPoint[];
  accidentHistory: RouteAnnotationPoint[];
};

type RouteAvoidOption = keyof RouteLine["avoidScores"];

type RouteAvoidState = Record<RouteAvoidOption, boolean>;

type OsrmRoute = {
  source?: string;
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
  roadEnvironmentDetails?: GraphHopperPathDetail[];
  maxSpeedDetails?: GraphHopperPathDetail[];
};

type OsrmResponse = {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
};

type GraphHopperPath = {
  distance: number;
  time: number;
  points: GeoJSON.LineString;
  details?: {
    road_environment?: GraphHopperPathDetail[];
    max_speed?: GraphHopperPathDetail[];
  };
};

type GraphHopperResponse = {
  message?: string;
  paths?: GraphHopperPath[];
};

type GraphHopperPathDetail = [number, number, string | number | null];

type GraphHopperRule = {
  if: string;
  multiply_by: string;
};

type GraphHopperAreaFeature = {
  type: "Feature";
  id: string;
  properties: Record<string, never>;
  geometry: GeoJSON.Polygon;
};

type GraphHopperCustomModel = {
  priority?: GraphHopperRule[];
  areas?: {
    type: "FeatureCollection";
    features: GraphHopperAreaFeature[];
  };
};

type RouteRequest = {
  coordinates?: unknown;
  alternatives?: unknown;
  avoid?: unknown;
  maxExtraMinutes?: unknown;
  preview?: unknown;
};

type RouteProvider = "graphhopper" | "osrm";

type RouteFetchResult = {
  provider: RouteProvider;
  routes: OsrmRoute[];
};

type RiskRow = {
  fid: number;
  events_count?: number | null;
  risk_per_milj_fordon: number;
  geometry: GeoJSON.LineString;
};

type LargeRoadRow = {
  fid: number;
  speed_limit: number | null;
  length_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

type AdtRow = {
  fid: number;
  adt_total: number | null;
  adt_tung?: number | null;
  matar?: number | null;
  geometry: GeoJSON.LineString;
};

type TrafficFlowRow = {
  site_id: number;
  fid: number;
  vehicle_flow_rate: number | null;
  average_vehicle_speed: number | null;
  data_quality: string | null;
  measurement_time: string | null;
  last_seen: string;
  sample_count: number;
  snap_distance_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

type DisturbanceRow = {
  id: string;
  lng: number;
  lat: number;
  message_type: string | null;
};

type EventRow = {
  id: string;
  lng: number;
  lat: number;
};

type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

const calmRouteCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_class == MOTORWAY", multiply_by: "0.03" },
    { if: "road_class == TRUNK", multiply_by: "0.08" },
    { if: "road_class == PRIMARY", multiply_by: "0.25" },
    { if: "max_speed >= 100", multiply_by: "0.02" },
    { if: "max_speed >= 90", multiply_by: "0.04" },
    { if: "max_speed >= 80", multiply_by: "0.45" },
  ],
};

const avoidBridgeCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_environment == BRIDGE", multiply_by: "0.12" },
  ],
};

const avoidTunnelCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_environment == TUNNEL", multiply_by: "0.03" },
  ],
};

const RISK_PENALTY_MAX_AREAS = 48;
const DISTURBANCE_PENALTY_MAX_AREAS = 32;
const TRAFFIC_INTENSITY_ADT_PENALTY_MAX_AREAS = 56;
const TRAFFIC_INTENSITY_FLOW_PENALTY_MAX_AREAS = 24;
const RISK_PENALTY_PADDING_METERS = 140;
const DISTURBANCE_PENALTY_RADIUS_METERS = 450;
const TRAFFIC_INTENSITY_PENALTY_PADDING_METERS = 120;
const PENALTY_ZONE_BBOX_PADDING = 0.08;
const PENALTY_ZONE_MAX_BBOX_AREA = 80;
const TRAFFIC_FLOW_ACTIVE_WINDOW_MS = 45 * 60 * 1000;

const routeAvoidOptions = ["accidentHistory", "highSpeed", "trafficIntensity", "disturbances", "bridges", "tunnels"] as const;

const noAvoids: RouteAvoidState = {
  accidentHistory: false,
  highSpeed: false,
  trafficIntensity: false,
  disturbances: false,
  bridges: false,
  tunnels: false,
};

function isCoordinate(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lng, lat] = value;
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= MIN_SWEDEN_LNG &&
    lng <= MAX_SWEDEN_LNG &&
    lat >= MIN_SWEDEN_LAT &&
    lat <= MAX_SWEDEN_LAT
  );
}

function parseAvoidState(value: unknown): RouteAvoidState {
  if (!value || typeof value !== "object") return noAvoids;
  const input = value as Partial<Record<RouteAvoidOption, unknown>>;
  return {
    accidentHistory: input.accidentHistory === true,
    highSpeed: input.highSpeed === true,
    trafficIntensity: input.trafficIntensity === true,
    disturbances: input.disturbances === true,
    bridges: input.bridges === true,
    tunnels: input.tunnels === true,
  };
}

function activeAvoidOptions(avoid: RouteAvoidState): RouteAvoidOption[] {
  return routeAvoidOptions.filter((option) => avoid[option]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function routeBbox(routes: OsrmRoute[], padding = 0.025): Bbox | null {
  const coords = routes.flatMap((route) => route.geometry.coordinates);
  if (!coords.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const coord of coords) {
    const lng = coord[0];
    const lat = coord[1];
    if (
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) continue;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return {
    minLng: clamp(minLng - padding, MIN_SWEDEN_LNG, MAX_SWEDEN_LNG),
    minLat: clamp(minLat - padding, MIN_SWEDEN_LAT, MAX_SWEDEN_LAT),
    maxLng: clamp(maxLng + padding, MIN_SWEDEN_LNG, MAX_SWEDEN_LNG),
    maxLat: clamp(maxLat + padding, MIN_SWEDEN_LAT, MAX_SWEDEN_LAT),
  };
}

function routeExtraMinutes(route: OsrmRoute, baseline: OsrmRoute): number {
  return Math.max(0, (route.duration - baseline.duration) / 60);
}

function isRouteWithinMaxExtra(
  route: OsrmRoute,
  baseline: OsrmRoute,
  maxExtraMinutes: number | null,
): boolean {
  return maxExtraMinutes === null || routeExtraMinutes(route, baseline) <= maxExtraMinutes;
}

function graphHopperMaxWeightFactor(
  baseline: OsrmRoute,
  maxExtraMinutes: number | null,
): number {
  if (maxExtraMinutes === null) return 4.0;
  const baselineMinutes = Math.max(10, baseline.duration / 60);
  return clamp(1 + (maxExtraMinutes / baselineMinutes) * 1.6, 1.15, 2.8);
}

function bboxArea(bbox: Bbox): number {
  return (bbox.maxLng - bbox.minLng) * (bbox.maxLat - bbox.minLat);
}

function degreesLat(meters: number): number {
  return meters / 110_540;
}

function degreesLng(meters: number, lat: number): number {
  const latFactor = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return meters / (111_320 * latFactor);
}

function boxPolygon(minLng: number, minLat: number, maxLng: number, maxLat: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]],
  };
}

function pointPenaltyArea(
  id: string,
  lng: number,
  lat: number,
  radiusMeters: number,
): GraphHopperAreaFeature | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const lngPad = degreesLng(radiusMeters, lat);
  const latPad = degreesLat(radiusMeters);
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: boxPolygon(lng - lngPad, lat - latPad, lng + lngPad, lat + latPad),
  };
}

function linePenaltyArea(
  id: string,
  line: GeoJSON.Position[],
  paddingMeters: number,
): GraphHopperAreaFeature | null {
  const coords: Array<[number, number]> = [];
  for (const coord of line) {
    const [lng, lat] = coord;
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    coords.push([lng, lat]);
  }
  if (!coords.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let latSum = 0;

  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
    latSum += lat;
  }

  const centerLat = latSum / coords.length;
  const lngPad = degreesLng(paddingMeters, centerLat);
  const latPad = degreesLat(paddingMeters);
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: boxPolygon(minLng - lngPad, minLat - latPad, maxLng + lngPad, maxLat + latPad),
  };
}

function mergeCustomModels(
  ...models: Array<GraphHopperCustomModel | null | undefined>
): GraphHopperCustomModel | undefined {
  const priority = models.flatMap((model) => model?.priority ?? []);
  const features = models.flatMap((model) => model?.areas?.features ?? []);
  if (!priority.length && !features.length) return undefined;

  return {
    ...(priority.length ? { priority } : {}),
    ...(features.length
      ? {
          areas: {
            type: "FeatureCollection" as const,
            features,
          },
        }
      : {}),
  };
}

function routeGeometryKey(route: OsrmRoute): string {
  const coords = route.geometry.coordinates;
  const first = coords[0];
  const last = coords.at(-1);
  return [
    Math.round(route.distance / 25),
    Math.round(route.duration / 15),
    first ? `${first[0]?.toFixed(4)},${first[1]?.toFixed(4)}` : "",
    last ? `${last[0]?.toFixed(4)},${last[1]?.toFixed(4)}` : "",
    coords.length,
  ].join("|");
}

function dedupeRoutes(routes: OsrmRoute[]): OsrmRoute[] {
  const seen = new Set<string>();
  const deduped: OsrmRoute[] = [];
  for (const route of routes) {
    const key = routeGeometryKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(route);
  }
  return deduped;
}

function project([lng, lat]: GeoJSON.Position, originLat: number): [number, number] {
  const x = (lng ?? 0) * 111_320 * Math.cos((originLat * Math.PI) / 180);
  const y = (lat ?? 0) * 110_540;
  return [x, y];
}

function distancePointToSegmentMeters(
  point: GeoJSON.Position,
  start: GeoJSON.Position,
  end: GeoJSON.Position,
  originLat: number,
): number {
  const [px, py] = project(point, originLat);
  const [ax, ay] = project(start, originLat);
  const [bx, by] = project(end, originLat);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distancePointToLineMeters(
  point: GeoJSON.Position,
  line: GeoJSON.Position[],
  originLat: number,
): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) {
    const start = line[i - 1];
    const end = line[i];
    if (!start || !end) continue;
    best = Math.min(best, distancePointToSegmentMeters(point, start, end, originLat));
  }
  return best;
}

function distanceBetweenCoordinatesMeters(
  start: GeoJSON.Position,
  end: GeoJSON.Position,
  originLat: number,
): number {
  const [ax, ay] = project(start, originLat);
  const [bx, by] = project(end, originLat);
  return Math.hypot(bx - ax, by - ay);
}

function sampleLine(line: GeoJSON.Position[]): GeoJSON.Position[] {
  if (line.length <= 24) return line;
  const step = Math.max(1, Math.floor(line.length / 24));
  const sampled = line.filter((_, index) => index % step === 0);
  const last = line.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function flattenLineString(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): GeoJSON.Position[][] {
  return geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];
}

function lineLengthMeters(line: GeoJSON.Position[], originLat: number): number {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    if (!start || !end) continue;
    meters += distanceBetweenCoordinatesMeters(start, end, originLat);
  }
  return meters;
}

function geometryLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  originLat: number,
): number {
  return flattenLineString(geometry).reduce((sum, line) => sum + lineLengthMeters(line, originLat), 0);
}

function midpoint(line: GeoJSON.Position[]): GeoJSON.Position | null {
  if (!line.length) return null;
  return line[Math.floor(line.length / 2)] ?? null;
}

function routeOriginLat(route: OsrmRoute): number {
  const coords = route.geometry.coordinates;
  if (!coords.length) return 60;
  return coords.reduce((sum, coord) => sum + (coord[1] ?? 60), 0) / coords.length;
}

function toLngLat(coord: GeoJSON.Position | undefined): [number, number] | null {
  if (!coord) return null;
  const [lng, lat] = coord;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function emptyRouteAnnotations(): RouteAnnotations {
  return {
    highSpeed: [],
    trafficIntensity: [],
    bridges: [],
    tunnels: [],
    disturbances: [],
    accidentHistory: [],
  };
}

function routeSegmentAnnotationsFromMask(
  route: OsrmRoute,
  kind: RouteAnnotationSegmentKind,
  includeSegment: (segmentIndex: number) => boolean,
): RouteAnnotationSegment[] {
  const coords = route.geometry.coordinates;
  const segments: RouteAnnotationSegment[] = [];
  let current: [number, number][] = [];

  const flush = () => {
    if (current.length >= 2) {
      segments.push({
        kind,
        geometry: { type: "LineString", coordinates: current },
      });
    }
    current = [];
  };

  for (let index = 0; index < coords.length - 1; index += 1) {
    const start = toLngLat(coords[index]);
    const end = toLngLat(coords[index + 1]);
    if (!start || !end || !includeSegment(index)) {
      flush();
      continue;
    }
    if (!current.length) current.push(start);
    current.push(end);
  }
  flush();
  return segments;
}

function roadEnvironmentSegments(
  route: OsrmRoute,
  environment: "BRIDGE" | "TUNNEL",
  kind: RouteAnnotationSegmentKind,
): RouteAnnotationSegment[] {
  const details = route.roadEnvironmentDetails;
  if (!details) return [];

  const included = new Set<number>();
  const coords = route.geometry.coordinates;
  for (const [fromIndex, toIndex, value] of details) {
    if (typeof value !== "string" || value.toUpperCase() !== environment) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));
    for (let index = from + 1; index <= to; index += 1) {
      included.add(index - 1);
    }
  }

  return routeSegmentAnnotationsFromMask(route, kind, (segmentIndex) => included.has(segmentIndex));
}

function speedLimitFromDetail(value: string | number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const speed = Number(match[0]);
  return Number.isFinite(speed) ? speed : null;
}

function highSpeedMetricFromDetails(route: OsrmRoute): RouteMetric | null {
  const details = route.maxSpeedDetails;
  if (!details) return null;

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return { score: 0, exposure: 0 };

  const originLat = routeOriginLat(route);
  let score = 0;
  let meters = 0;

  for (const [fromIndex, toIndex, value] of details) {
    const speed = speedLimitFromDetail(value);
    if (speed === null || speed < 90) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));

    for (let index = from + 1; index <= to; index += 1) {
      const start = coords[index - 1];
      const end = coords[index];
      if (!start || !end) continue;
      const segmentMeters = distanceBetweenCoordinatesMeters(start, end, originLat);
      meters += segmentMeters;
      score += (segmentMeters / 1000) * (1 + (speed - 90) / 20);
    }
  }

  return {
    score: score / Math.max(1, route.distance / 1000),
    exposure: Math.min(meters, route.distance),
  };
}

function highSpeedSegmentsFromDetails(route: OsrmRoute): RouteAnnotationSegment[] | null {
  const details = route.maxSpeedDetails;
  if (!details) return null;

  const coords = route.geometry.coordinates;
  const included = new Set<number>();
  for (const [fromIndex, toIndex, value] of details) {
    const speed = speedLimitFromDetail(value);
    if (speed === null || speed < 90) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));
    for (let index = from + 1; index <= to; index += 1) {
      included.add(index - 1);
    }
  }

  return routeSegmentAnnotationsFromMask(route, "highSpeed", (segmentIndex) => included.has(segmentIndex));
}

function highSpeedSegments(route: OsrmRoute, rows: LargeRoadRow[]): RouteAnnotationSegment[] {
  const detailSegments = highSpeedSegmentsFromDetails(route);
  if (detailSegments) return detailSegments;
  if (!rows.length || route.geometry.coordinates.length < 2) return [];

  const samples: GeoJSON.Position[] = [];
  for (const row of rows) {
    if ((row.speed_limit ?? 0) < 90) continue;
    for (const segment of flattenLineString(row.geometry)) {
      const mid = midpoint(segment);
      if (mid) samples.push(mid);
      samples.push(...sampleLine(segment));
    }
  }
  if (!samples.length) return [];

  const originLat = routeOriginLat(route);
  return routeSegmentAnnotationsFromMask(route, "highSpeed", (segmentIndex) => {
    const start = route.geometry.coordinates[segmentIndex];
    const end = route.geometry.coordinates[segmentIndex + 1];
    if (!start || !end) return false;
    const mid: GeoJSON.Position = [
      ((start[0] ?? 0) + (end[0] ?? 0)) / 2,
      ((start[1] ?? 0) + (end[1] ?? 0)) / 2,
    ];
    return samples.some((sample) => distancePointToSegmentMeters(sample, start, end, originLat) <= 130 ||
      distancePointToSegmentMeters(mid, sample, sample, originLat) <= 130);
  });
}

function disturbanceCategory(messageType: string | null): "roadwork" | "traffic" {
  const t = (messageType ?? "").toLowerCase();
  if (t.includes("vägarbete") || t.includes("roadwork")) return "roadwork";
  return "traffic";
}

function disturbancePoints(route: OsrmRoute, rows: DisturbanceRow[]): RouteAnnotationPoint[] {
  if (!rows.length) return [];
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  return rows.flatMap((row) => (
    distancePointToLineMeters([row.lng, row.lat], line, originLat) <= 450
      ? [{
          kind: "disturbances" as const,
          coordinates: [row.lng, row.lat] as [number, number],
          category: disturbanceCategory(row.message_type),
        }]
      : []
  ));
}

function accidentHistoryPoints(route: OsrmRoute, rows: EventRow[]): RouteAnnotationPoint[] {
  if (!rows.length) return [];
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  return rows.flatMap((row) => (
    distancePointToLineMeters([row.lng, row.lat], line, originLat) <= 120
      ? [{
          kind: "accidentHistory" as const,
          coordinates: [row.lng, row.lat] as [number, number],
        }]
      : []
  ));
}

type RouteMetric = {
  score: number | null;
  exposure: number | null;
};

function scoreRisk(route: OsrmRoute, rows: RiskRow[]): RouteMetric {
  if (!rows.length) return { score: 0, exposure: 0 };
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  let score = 0;

  for (const row of rows) {
    const points = sampleLine(row.geometry.coordinates);
    const mid = midpoint(row.geometry.coordinates);
    const samples = mid ? [...points, mid] : points;
    const nearRoute = samples.some(
      (point) => distancePointToLineMeters(point, line, originLat) <= 90,
    );
    if (nearRoute) {
      score += Math.max(0, row.risk_per_milj_fordon);
    }
  }

  const normalized = score / Math.max(1, route.distance / 1000);
  return { score: normalized, exposure: normalized };
}

function scoreHighSpeed(route: OsrmRoute, rows: LargeRoadRow[]): RouteMetric {
  const detailMetric = highSpeedMetricFromDetails(route);
  if (detailMetric) return detailMetric;

  if (!rows.length) return { score: 0, exposure: 0 };
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  let score = 0;
  let highSpeedMeters = 0;

  for (const row of rows) {
    const speed = row.speed_limit ?? 0;
    if (speed < 90) continue;
    const nearRoute = flattenLineString(row.geometry).some((segment) => {
      const mid = midpoint(segment);
      if (!mid) return false;
      return distancePointToLineMeters(mid, line, originLat) <= 100;
    });
    if (nearRoute) {
      const lengthKm = Math.max(0.05, (row.length_m ?? 100) / 1000);
      highSpeedMeters += lengthKm * 1000;
      score += lengthKm * (1 + (speed - 90) / 20);
    }
  }

  return {
    score: score / Math.max(1, route.distance / 1000),
    exposure: Math.min(highSpeedMeters, route.distance),
  };
}

function disturbanceWeight(messageType: string | null): number {
  const t = (messageType ?? "").toLowerCase();
  if (t.includes("kö") || t.includes("trafik") || t.includes("queue")) return 1.4;
  if (t.includes("vägarbete") || t.includes("roadwork")) return 1;
  return 0.8;
}

function scoreDisturbances(route: OsrmRoute, rows: DisturbanceRow[]): RouteMetric {
  if (!rows.length) return { score: 0, exposure: 0 };
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  let score = 0;
  let count = 0;

  for (const row of rows) {
    const distance = distancePointToLineMeters([row.lng, row.lat], line, originLat);
    if (distance <= 450) {
      count += 1;
      score += disturbanceWeight(row.message_type);
    }
  }

  return {
    score: score / Math.max(1, route.distance / 10_000),
    exposure: count,
  };
}

function adtIntensityScore(adtTotal: number | null): number {
  const adt = Math.max(0, adtTotal ?? 0);
  if (adt < 2_000) return 0;
  if (adt < 5_000) return 0.12;
  if (adt < 10_000) return 0.28;
  if (adt < 20_000) return 0.55;
  if (adt < 40_000) return 0.78;
  if (adt < 60_000) return 0.92;
  return 1;
}

function adtPenaltyMultiplier(row: AdtRow): string {
  const score = adtIntensityScore(row.adt_total);
  if (score >= 0.92) return "0.22";
  if (score >= 0.78) return "0.32";
  if (score >= 0.55) return "0.45";
  return "0.65";
}

function trafficFlowCategory(row: TrafficFlowRow): "calm" | "moving" | "busy" | "slow" {
  const flow = row.vehicle_flow_rate ?? 0;
  const speed = row.average_vehicle_speed;
  if ((typeof speed === "number" && speed < 25) || flow >= 2500) return "slow";
  if ((typeof speed === "number" && speed < 45) || flow >= 1600) return "busy";
  if (flow >= 800) return "moving";
  return "calm";
}

function trafficFlowIntensityScore(row: TrafficFlowRow): number {
  switch (trafficFlowCategory(row)) {
    case "slow":
      return 0.82;
    case "busy":
      return 0.62;
    case "moving":
      return 0.28;
    case "calm":
      return 0.08;
  }
}

function trafficFlowPenaltyMultiplier(row: TrafficFlowRow): string {
  switch (trafficFlowCategory(row)) {
    case "slow":
      return "0.28";
    case "busy":
      return "0.42";
    case "moving":
      return "0.68";
    case "calm":
      return "0.9";
  }
}

function adtRowNearRoute(route: OsrmRoute, row: AdtRow, originLat: number): boolean {
  const line = route.geometry.coordinates;
  const mid = midpoint(row.geometry.coordinates);
  const samples = mid ? [...sampleLine(row.geometry.coordinates), mid] : sampleLine(row.geometry.coordinates);
  return samples.some((point) => distancePointToLineMeters(point, line, originLat) <= 95);
}

function trafficFlowRowNearRoute(route: OsrmRoute, row: TrafficFlowRow, originLat: number): boolean {
  const line = route.geometry.coordinates;
  return flattenLineString(row.geometry).some((segment) => {
    const mid = midpoint(segment);
    const samples = mid ? [...sampleLine(segment), mid] : sampleLine(segment);
    return samples.some((point) => distancePointToLineMeters(point, line, originLat) <= 130);
  });
}

function scoreTrafficIntensity(route: OsrmRoute, adtRows: AdtRow[], trafficFlowRows: TrafficFlowRow[]): RouteMetric {
  if (!adtRows.length && !trafficFlowRows.length) return { score: null, exposure: null };

  const originLat = routeOriginLat(route);
  let coveredMeters = 0;
  let weightedMeters = 0;
  let intensiveMeters = 0;

  for (const row of adtRows) {
    if (!adtRowNearRoute(route, row, originLat)) continue;
    const meters = Math.max(35, geometryLengthMeters(row.geometry, originLat));
    const intensity = adtIntensityScore(row.adt_total);
    coveredMeters += meters;
    weightedMeters += meters * intensity;
    if (intensity >= 0.55) intensiveMeters += meters;
  }

  for (const row of trafficFlowRows) {
    if (!trafficFlowRowNearRoute(route, row, originLat)) continue;
    const meters = Math.max(60, geometryLengthMeters(row.geometry, originLat));
    const intensity = trafficFlowIntensityScore(row);
    coveredMeters += meters;
    weightedMeters += meters * intensity * 0.55;
    if (intensity >= 0.62) intensiveMeters += meters;
  }

  if (coveredMeters <= 0) return { score: null, exposure: null };

  const averageIntensity = weightedMeters / Math.max(1, coveredMeters);
  const intensiveShare = Math.min(1, intensiveMeters / Math.max(1, route.distance));
  return {
    score: Math.min(1, averageIntensity * 0.75 + intensiveShare * 0.35),
    exposure: Math.min(intensiveMeters, route.distance),
  };
}

function trafficIntensitySegments(
  route: OsrmRoute,
  adtRows: AdtRow[],
  trafficFlowRows: TrafficFlowRow[],
): RouteAnnotationSegment[] {
  if ((!adtRows.length && !trafficFlowRows.length) || route.geometry.coordinates.length < 2) return [];

  const originLat = routeOriginLat(route);
  const samples: GeoJSON.Position[] = [];
  for (const row of adtRows) {
    if (adtIntensityScore(row.adt_total) < 0.55) continue;
    const mid = midpoint(row.geometry.coordinates);
    if (mid) samples.push(mid);
    samples.push(...sampleLine(row.geometry.coordinates));
  }
  for (const row of trafficFlowRows) {
    if (trafficFlowIntensityScore(row) < 0.62) continue;
    for (const segment of flattenLineString(row.geometry)) {
      const mid = midpoint(segment);
      if (mid) samples.push(mid);
      samples.push(...sampleLine(segment));
    }
  }
  if (!samples.length) return [];

  return routeSegmentAnnotationsFromMask(route, "trafficIntensity", (segmentIndex) => {
    const start = route.geometry.coordinates[segmentIndex];
    const end = route.geometry.coordinates[segmentIndex + 1];
    if (!start || !end) return false;
    const mid: GeoJSON.Position = [
      ((start[0] ?? 0) + (end[0] ?? 0)) / 2,
      ((start[1] ?? 0) + (end[1] ?? 0)) / 2,
    ];
    return samples.some((sample) => distancePointToSegmentMeters(sample, start, end, originLat) <= 130 ||
      distancePointToSegmentMeters(mid, sample, sample, originLat) <= 130);
  });
}

function roadEnvironmentExposure(route: OsrmRoute, environment: "BRIDGE" | "TUNNEL"): RouteMetric {
  const details = route.roadEnvironmentDetails;
  if (!details) return { score: null, exposure: null };

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return { score: 0, exposure: 0 };

  const originLat = routeOriginLat(route);
  let meters = 0;

  for (const [fromIndex, toIndex, value] of details) {
    if (typeof value !== "string" || value.toUpperCase() !== environment) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));

    for (let index = from + 1; index <= to; index += 1) {
      const start = coords[index - 1];
      const end = coords[index];
      if (!start || !end) continue;
      meters += distanceBetweenCoordinatesMeters(start, end, originLat);
    }
  }

  return {
    score: meters / Math.max(1, route.distance / 1000),
    exposure: meters,
  };
}

async function fetchPenaltyZoneRows(
  routes: OsrmRoute[],
  avoid: RouteAvoidState,
): Promise<{
  riskRows: RiskRow[];
  disturbanceRows: DisturbanceRow[];
  adtRows: AdtRow[];
  trafficFlowRows: TrafficFlowRow[];
}> {
  const empty = { riskRows: [], disturbanceRows: [], adtRows: [], trafficFlowRows: [] };
  if (!supabaseUrl || !supabaseAnon) return empty;
  if (!avoid.accidentHistory && !avoid.disturbances && !avoid.trafficIntensity) return empty;

  const bbox = routeBbox(routes, PENALTY_ZONE_BBOX_PADDING);
  if (!bbox || bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) return empty;
  if (bboxArea(bbox) > PENALTY_ZONE_MAX_BBOX_AREA) return empty;

  const client = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
  const params = {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  };

  try {
    const activeSince = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const trafficFlowActiveSince = new Date(Date.now() - TRAFFIC_FLOW_ACTIVE_WINDOW_MS).toISOString();
    const [riskResult, disturbancesResult, adtResult, trafficFlowResult] = await Promise.all([
      avoid.accidentHistory
        ? client.rpc("risk_in_bbox", params)
        : Promise.resolve({ data: [], error: null }),
      avoid.disturbances
        ? client
            .from("disturbances_public")
            .select("id, lng, lat, message_type")
            .gte("last_seen", activeSince)
            .gte("lng", bbox.minLng)
            .lte("lng", bbox.maxLng)
            .gte("lat", bbox.minLat)
            .lte("lat", bbox.maxLat)
            .limit(120)
        : Promise.resolve({ data: [], error: null }),
      avoid.trafficIntensity
        ? client.rpc("adt_in_bbox", params)
        : Promise.resolve({ data: [], error: null }),
      avoid.trafficIntensity && bboxArea(bbox) <= 30
        ? client.rpc("traffic_flow_segments_in_bbox", {
            ...params,
            active_since: trafficFlowActiveSince,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    return {
      riskRows: riskResult.error ? [] : (riskResult.data ?? []) as RiskRow[],
      disturbanceRows: disturbancesResult.error
        ? []
        : (disturbancesResult.data ?? []) as DisturbanceRow[],
      adtRows: adtResult.error ? [] : (adtResult.data ?? []) as AdtRow[],
      trafficFlowRows: trafficFlowResult.error ? [] : (trafficFlowResult.data ?? []) as TrafficFlowRow[],
    };
  } catch (err) {
    console.warn("route penalty zone lookup failed", err);
    return empty;
  }
}

function riskPenaltyMultiplier(row: RiskRow): string {
  const risk = Math.max(0, row.risk_per_milj_fordon);
  if (risk >= 20) return "0.3";
  if (risk >= 10) return "0.4";
  return "0.55";
}

function disturbancePenaltyMultiplier(messageType: string | null): string {
  const weight = disturbanceWeight(messageType);
  if (weight >= 1.3) return "0.25";
  if (weight >= 1) return "0.4";
  return "0.6";
}

function buildPenaltyZoneCustomModel(
  rows: {
    riskRows: RiskRow[];
    disturbanceRows: DisturbanceRow[];
    adtRows: AdtRow[];
    trafficFlowRows: TrafficFlowRow[];
  },
  avoid: RouteAvoidState,
): GraphHopperCustomModel | undefined {
  const features: GraphHopperAreaFeature[] = [];
  const priority: GraphHopperRule[] = [];

  if (avoid.accidentHistory) {
    for (const row of rows.riskRows.slice(0, RISK_PENALTY_MAX_AREAS)) {
      const feature = linePenaltyArea(
        `risk_${row.fid}`,
        row.geometry.coordinates,
        RISK_PENALTY_PADDING_METERS,
      );
      if (!feature) continue;
      features.push(feature);
      priority.push({
        if: `in_${feature.id}`,
        multiply_by: riskPenaltyMultiplier(row),
      });
    }
  }

  if (avoid.disturbances) {
    const disturbanceRows = [...rows.disturbanceRows]
      .sort((a, b) => disturbanceWeight(b.message_type) - disturbanceWeight(a.message_type))
      .slice(0, DISTURBANCE_PENALTY_MAX_AREAS);

    for (const [index, row] of disturbanceRows.entries()) {
      const feature = pointPenaltyArea(
        `disturbance_${index + 1}`,
        row.lng,
        row.lat,
        DISTURBANCE_PENALTY_RADIUS_METERS,
      );
      if (!feature) continue;
      features.push(feature);
      priority.push({
        if: `in_${feature.id}`,
        multiply_by: disturbancePenaltyMultiplier(row.message_type),
      });
    }
  }

  if (avoid.trafficIntensity) {
    const adtRows = [...rows.adtRows]
      .filter((row) => adtIntensityScore(row.adt_total) >= 0.55)
      .sort((a, b) => adtIntensityScore(b.adt_total) - adtIntensityScore(a.adt_total))
      .slice(0, TRAFFIC_INTENSITY_ADT_PENALTY_MAX_AREAS);

    for (const row of adtRows) {
      const feature = linePenaltyArea(
        `traffic_intensity_adt_${row.fid}`,
        row.geometry.coordinates,
        TRAFFIC_INTENSITY_PENALTY_PADDING_METERS,
      );
      if (!feature) continue;
      features.push(feature);
      priority.push({
        if: `in_${feature.id}`,
        multiply_by: adtPenaltyMultiplier(row),
      });
    }

    const trafficFlowRows = [...rows.trafficFlowRows]
      .filter((row) => trafficFlowIntensityScore(row) >= 0.62)
      .sort((a, b) => trafficFlowIntensityScore(b) - trafficFlowIntensityScore(a))
      .slice(0, TRAFFIC_INTENSITY_FLOW_PENALTY_MAX_AREAS);

    for (const [index, row] of trafficFlowRows.entries()) {
      const line = flattenLineString(row.geometry)[0];
      if (!line) continue;
      const feature = linePenaltyArea(
        `traffic_intensity_flow_${index + 1}_${row.site_id}_${row.fid}`,
        line,
        TRAFFIC_INTENSITY_PENALTY_PADDING_METERS,
      );
      if (!feature) continue;
      features.push(feature);
      priority.push({
        if: `in_${feature.id}`,
        multiply_by: trafficFlowPenaltyMultiplier(row),
      });
    }
  }

  return mergeCustomModels({
    priority,
    areas: features.length
      ? {
          type: "FeatureCollection",
          features,
        }
      : undefined,
  });
}

async function buildRoutePreferenceCustomModel(
  baselineRoutes: OsrmRoute[],
  avoid: RouteAvoidState,
): Promise<GraphHopperCustomModel | undefined> {
  const penaltyRows = await fetchPenaltyZoneRows(baselineRoutes, avoid);
  const penaltyModel = buildPenaltyZoneCustomModel(penaltyRows, avoid);
  return mergeCustomModels(
    avoid.highSpeed ? calmRouteCustomModel : undefined,
    avoid.bridges ? avoidBridgeCustomModel : undefined,
    avoid.tunnels ? avoidTunnelCustomModel : undefined,
    penaltyModel,
  );
}

type RouteScoreResult = Pick<RouteLine, "avoidScores" | "exposure" | "annotations">;

async function scoreRouteAlternatives(routes: OsrmRoute[], avoid: RouteAvoidState): Promise<RouteScoreResult[]> {
  const baseScores = routes.map((route) => {
    const bridges = roadEnvironmentExposure(route, "BRIDGE");
    const tunnels = roadEnvironmentExposure(route, "TUNNEL");
    const annotations = emptyRouteAnnotations();
    annotations.bridges = roadEnvironmentSegments(route, "BRIDGE", "bridges");
    annotations.tunnels = roadEnvironmentSegments(route, "TUNNEL", "tunnels");
    return {
      avoidScores: {
        accidentHistory: null,
        highSpeed: null,
        trafficIntensity: null,
        disturbances: null,
        bridges: bridges.score,
        tunnels: tunnels.score,
      },
      exposure: {
        accidentHistory: null,
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        disturbances: null,
        bridgeMeters: bridges.exposure,
        tunnelMeters: tunnels.exposure,
        accidentHistoryEvents: null,
      },
      annotations,
    };
  });

  if (!supabaseUrl || !supabaseAnon) return baseScores;

  const bbox = routeBbox(routes);
  if (!bbox || bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) return baseScores;

  const fallbackScores = routes.map((route, index) => {
    const base = baseScores[index];
    return base ?? {
      avoidScores: {
        accidentHistory: null,
        highSpeed: null,
        trafficIntensity: null,
        disturbances: null,
        bridges: null,
        tunnels: null,
      },
      exposure: {
        accidentHistory: null,
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        disturbances: null,
        bridgeMeters: null,
        tunnelMeters: null,
        accidentHistoryEvents: null,
      },
      annotations: emptyRouteAnnotations(),
    };
  });

  const client = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
  const params = {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  };

  try {
    const activeSince = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const trafficFlowActiveSince = new Date(Date.now() - TRAFFIC_FLOW_ACTIVE_WINDOW_MS).toISOString();
    const [riskResult, largeRoadsResult, disturbancesResult, eventsResult, adtResult, trafficFlowResult] = await Promise.all([
      bboxArea(bbox) <= 80
        ? client.rpc("risk_in_bbox", params)
        : Promise.resolve({ data: [], error: null }),
      bboxArea(bbox) <= 40
        ? client.rpc("large_roads_in_bbox", params)
        : Promise.resolve({ data: [], error: null }),
      client
        .from("disturbances_public")
        .select("id, lng, lat, message_type")
        .gte("last_seen", activeSince)
        .gte("lng", bbox.minLng)
        .lte("lng", bbox.maxLng)
        .gte("lat", bbox.minLat)
        .lte("lat", bbox.maxLat)
        .limit(500),
      bboxArea(bbox) <= 80
        ? client
            .from("events_public")
            .select("id, lng, lat")
            .gte("lng", bbox.minLng)
            .lte("lng", bbox.maxLng)
            .gte("lat", bbox.minLat)
            .lte("lat", bbox.maxLat)
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
      avoid.trafficIntensity && bboxArea(bbox) <= 80
        ? client.rpc("adt_in_bbox", params)
        : Promise.resolve({ data: [], error: null }),
      avoid.trafficIntensity && bboxArea(bbox) <= 30
        ? client.rpc("traffic_flow_segments_in_bbox", {
            ...params,
            active_since: trafficFlowActiveSince,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    const riskRows = riskResult.error ? [] : (riskResult.data ?? []) as RiskRow[];
    const largeRoadRows = largeRoadsResult.error
      ? []
      : ((largeRoadsResult.data ?? []) as LargeRoadRow[]).filter(
          (row) => row.speed_limit !== null && row.speed_limit >= 90,
        );
    const disturbanceRows = disturbancesResult.error
      ? []
      : (disturbancesResult.data ?? []) as DisturbanceRow[];
    const eventRows = eventsResult.error
      ? []
      : (eventsResult.data ?? []) as EventRow[];
    const adtRows = adtResult.error ? [] : (adtResult.data ?? []) as AdtRow[];
    const trafficFlowRows = trafficFlowResult.error
      ? []
      : (trafficFlowResult.data ?? []) as TrafficFlowRow[];

    return routes.map((route) => {
      const accidentHistory = scoreRisk(route, riskRows);
      const highSpeed = scoreHighSpeed(route, largeRoadRows);
      const trafficIntensity = avoid.trafficIntensity
        ? scoreTrafficIntensity(route, adtRows, trafficFlowRows)
        : { score: null, exposure: null };
      const disturbances = scoreDisturbances(route, disturbanceRows);
      const bridges = roadEnvironmentExposure(route, "BRIDGE");
      const tunnels = roadEnvironmentExposure(route, "TUNNEL");
      const accidentPoints = accidentHistoryPoints(route, eventRows);
      const annotations = emptyRouteAnnotations();
      annotations.highSpeed = highSpeedSegments(route, largeRoadRows);
      annotations.trafficIntensity = avoid.trafficIntensity
        ? trafficIntensitySegments(route, adtRows, trafficFlowRows)
        : [];
      annotations.bridges = roadEnvironmentSegments(route, "BRIDGE", "bridges");
      annotations.tunnels = roadEnvironmentSegments(route, "TUNNEL", "tunnels");
      annotations.disturbances = disturbancePoints(route, disturbanceRows);
      annotations.accidentHistory = accidentPoints;
      return {
        avoidScores: {
          accidentHistory: accidentHistory.score,
          highSpeed: highSpeed.score,
          trafficIntensity: trafficIntensity.score,
          disturbances: disturbances.score,
          bridges: bridges.score,
          tunnels: tunnels.score,
        },
        exposure: {
          accidentHistory: accidentHistory.exposure,
          highSpeedMeters: highSpeed.exposure,
          trafficIntensityMeters: trafficIntensity.exposure,
          disturbances: disturbances.exposure,
          bridgeMeters: bridges.exposure,
          tunnelMeters: tunnels.exposure,
          accidentHistoryEvents: accidentPoints.length,
        },
        annotations,
      };
    });
  } catch (err) {
    console.warn("route scoring failed", err);
    return fallbackScores;
  }
}

async function fetchOsrmRoutes(coordinates: [number, number][], alternatives: number): Promise<OsrmRoute[]> {
  const coordinateParam = coordinates
    .map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(";");

  const url = new URL(`/route/v1/${OSRM_PROFILE}/${coordinateParam}`, OSRM_BASE_URL);
  url.search = new URLSearchParams({
    alternatives: alternatives > 0 ? String(alternatives) : "false",
    overview: "full",
    geometries: "geojson",
    steps: "false",
  }).toString();

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    console.error("route provider failed", await res.text());
    throw new Error("route provider failed");
  }

  const osrm = (await res.json()) as OsrmResponse;
  if (osrm.code !== "Ok" || !osrm.routes?.length) {
    throw new Error(osrm.message ?? "route not found");
  }

  return osrm.routes.map((route, index) => ({
    ...route,
    source: index === 0 ? "fastest" : `osrm-alternative-${index}`,
  }));
}

async function fetchGraphHopperRoute(
  coordinates: [number, number][],
  opts: {
    source: string;
    customModel?: GraphHopperCustomModel;
    alternativeRoutes?: number;
    maxWeightFactor?: number;
  },
): Promise<OsrmRoute[]> {
  if (!GRAPHHOPPER_BASE_URL) throw new Error("GraphHopper base URL missing");

  const url = new URL("/route", GRAPHHOPPER_BASE_URL);
  const body: Record<string, unknown> = {
    points: coordinates,
    profile: "car",
    locale: "sv",
    points_encoded: false,
    instructions: false,
    calc_points: true,
    details: ["road_environment", "max_speed"],
  };

  if (opts.customModel) {
    body["ch.disable"] = true;
    body.custom_model = opts.customModel;
  }

  if (opts.alternativeRoutes && opts.alternativeRoutes > 1) {
    body.algorithm = "alternative_route";
    body["alternative_route.max_paths"] = Math.max(2, Math.min(8, opts.alternativeRoutes));
    body["alternative_route.max_weight_factor"] = opts.maxWeightFactor ?? 1.45;
    body["alternative_route.max_share_factor"] = opts.maxWeightFactor && opts.maxWeightFactor > 2.5 ? 0.82 : 0.65;
  }

  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (GRAPHHOPPER_TOKEN) headers["X-Routing-Token"] = GRAPHHOPPER_TOKEN;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("graphhopper route provider failed", await res.text());
    throw new Error("route provider failed");
  }

  const graphhopper = (await res.json()) as GraphHopperResponse;
  if (!graphhopper.paths?.length) {
    throw new Error(graphhopper.message ?? "route not found");
  }

  return graphhopper.paths.map((path, index) => ({
    source: index === 0 ? opts.source : `${opts.source}-alternative-${index}`,
    distance: path.distance,
    duration: path.time / 1000,
    geometry: path.points,
    roadEnvironmentDetails: path.details?.road_environment,
    maxSpeedDetails: path.details?.max_speed,
  }));
}

async function fetchProviderRoutes(
  coordinates: [number, number][],
  alternatives: number,
  avoid: RouteAvoidState,
  maxExtraMinutes: number | null,
): Promise<RouteFetchResult> {
  const activeOptions = activeAvoidOptions(avoid);
  if (!GRAPHHOPPER_BASE_URL) {
    return {
      provider: "osrm",
      routes: await fetchOsrmRoutes(coordinates, activeOptions.length > 0 ? alternatives : 0),
    };
  }

  const fastestRoutes = await fetchGraphHopperRoute(coordinates, { source: "fastest" });
  const baseline = fastestRoutes[0];
  if (!baseline) return { provider: "graphhopper", routes: fastestRoutes };
  const maxWeightFactor = graphHopperMaxWeightFactor(baseline, maxExtraMinutes);
  const pathCount = maxExtraMinutes === null ? alternatives + 5 : alternatives + 1;
  const genericAlternativeRequests: Array<Promise<OsrmRoute[]>> = [];

  if (activeOptions.length > 0) {
    genericAlternativeRequests.push(
      fetchGraphHopperRoute(coordinates, {
        source: "fastest-alternatives",
        alternativeRoutes: pathCount,
        maxWeightFactor,
      }),
    );
  }

  const preferenceModel = activeOptions.length > 0
    ? await buildRoutePreferenceCustomModel(fastestRoutes, avoid)
    : undefined;
  const preferenceRequests: Array<Promise<OsrmRoute[]>> = [];

  if (preferenceModel) {
    const source = [
      avoid.highSpeed ? "high-speed" : null,
      avoid.accidentHistory ? "accident-history" : null,
      avoid.trafficIntensity ? "traffic-intensity" : null,
      avoid.disturbances ? "disturbances" : null,
      avoid.bridges ? "bridges" : null,
      avoid.tunnels ? "tunnels" : null,
    ].filter(Boolean).join("-");

    preferenceRequests.push(
      fetchGraphHopperRoute(coordinates, {
        source: `avoid-${source}`,
        customModel: preferenceModel,
      }),
      fetchGraphHopperRoute(coordinates, {
        source: `avoid-${source}-alternatives`,
        customModel: preferenceModel,
        alternativeRoutes: pathCount,
        maxWeightFactor,
      }),
    );
  }

  if (avoid.highSpeed && !avoid.disturbances) {
    const diverseModel = await buildRoutePreferenceCustomModel(fastestRoutes, {
      ...avoid,
      disturbances: true,
    });
    if (diverseModel) {
      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: "avoid-high-speed-diverse",
          customModel: diverseModel,
        }),
        fetchGraphHopperRoute(coordinates, {
          source: "avoid-high-speed-diverse-alternatives",
          customModel: diverseModel,
          alternativeRoutes: pathCount,
          maxWeightFactor,
        }),
      );
    }
  }

  const [preferenceResults, genericAlternativeResults] = await Promise.all([
    Promise.allSettled(preferenceRequests),
    Promise.allSettled(genericAlternativeRequests),
  ]);
  const routes = [
    ...fastestRoutes,
    ...preferenceResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ...genericAlternativeResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  ];

  if (!routes.length) {
    const reason = [...preferenceResults, ...genericAlternativeResults]
      .find((result) => result.status === "rejected")?.reason;
    throw reason instanceof Error ? reason : new Error("route provider failed");
  }

  const budgetedRoutes = dedupeRoutes(routes).filter((route, index) => {
    if (index === 0) return true;
    return isRouteWithinMaxExtra(route, baseline, maxExtraMinutes);
  });
  const limit = activeOptions.length > 0
    ? maxExtraMinutes === null
      ? Math.max(10, alternatives + 7)
      : Math.max(4, alternatives + 3)
    : 1;
  return { provider: "graphhopper", routes: budgetedRoutes.slice(0, limit) };
}

export async function POST(req: Request) {
  let body: RouteRequest;
  try {
    body = (await req.json()) as RouteRequest;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.coordinates)) {
    return jsonResponse({ error: "coordinates must be an array" }, { status: 400 });
  }

  const coordinates = body.coordinates;
  if (coordinates.length < 2 || coordinates.length > 10) {
    return jsonResponse({ error: "route requires 2-10 coordinates" }, { status: 400 });
  }
  if (!coordinates.every(isCoordinate)) {
    return jsonResponse({ error: "coordinates outside Sweden bounds" }, { status: 400 });
  }

  const alternatives =
    typeof body.alternatives === "number"
      ? Math.max(0, Math.min(3, Math.floor(body.alternatives)))
      : 2;
  const avoid = parseAvoidState(body.avoid);
  const preview = body.preview === true;
  const maxExtraMinutes =
    typeof body.maxExtraMinutes === "number" && Number.isFinite(body.maxExtraMinutes)
      ? Math.max(0, body.maxExtraMinutes)
      : null;

  try {
    const routeResult = preview
      ? await fetchProviderRoutes(coordinates, 0, noAvoids, null)
      : alternatives === 0
        ? await fetchProviderRoutes(coordinates, 0, noAvoids, null)
        : await fetchProviderRoutes(coordinates, alternatives, avoid, maxExtraMinutes);
    const providerRoutes = routeResult.routes;
    const scores = preview ? [] : await scoreRouteAlternatives(providerRoutes, avoid);
    const routes: RouteLine[] = providerRoutes.map((route, index) => ({
      id: `route-${index + 1}`,
      source: preview ? "preview" : route.source ?? `candidate-${index + 1}`,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
      safetyScore: scores[index]?.avoidScores.accidentHistory ?? null,
      avoidScores: scores[index]?.avoidScores ?? {
        accidentHistory: null,
        highSpeed: null,
        trafficIntensity: null,
        disturbances: null,
        bridges: null,
        tunnels: null,
      },
      exposure: scores[index]?.exposure ?? {
        accidentHistory: null,
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        disturbances: null,
        bridgeMeters: null,
        tunnelMeters: null,
        accidentHistoryEvents: null,
      },
      annotations: scores[index]?.annotations ?? emptyRouteAnnotations(),
    }));

    return jsonResponse({ routes, avoid, maxExtraMinutes, provider: routeResult.provider }, { cacheSeconds: 300 });
  } catch (err) {
    console.error("routing failed", err);
    return jsonResponse({ error: "routing failed" }, { status: 502 });
  }
}
