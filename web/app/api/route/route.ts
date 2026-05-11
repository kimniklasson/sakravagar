import { createClient } from "@supabase/supabase-js";
import {
  categoryFromDisturbanceMessageType,
  LIVE_EVENT_THRESHOLD_MS,
  type DisturbanceCategory,
} from "@trafik/shared";
import { isMissingPostgrestFunctionError, jsonResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    highSpeed: number | null;
    trafficIntensity: number | null;
    cityTraffic: number | null;
    bridges: number | null;
    tunnels: number | null;
  };
  exposure: {
    highSpeedMeters: number | null;
    trafficIntensityMeters: number | null;
    cityTrafficMeters: number | null;
    disturbances: number | null;
    liveAccidents: number | null;
    bridgeMeters: number | null;
    tunnelMeters: number | null;
  };
  annotations: RouteAnnotations;
};

export type RouteAnnotationSegmentKind = "highSpeed" | "trafficIntensity" | "cityTraffic" | "bridges" | "tunnels";
export type RouteAnnotationPointKind = "disturbances" | "liveAccidents";

export type RouteAnnotationSegment = {
  kind: RouteAnnotationSegmentKind;
  geometry: GeoJSON.LineString;
};

export type RouteAnnotationPoint = {
  kind: RouteAnnotationPointKind;
  coordinates: [number, number];
  category?: DisturbanceCategory;
};

export type RouteAnnotations = {
  highSpeed: RouteAnnotationSegment[];
  trafficIntensity: RouteAnnotationSegment[];
  cityTraffic: RouteAnnotationSegment[];
  bridges: RouteAnnotationSegment[];
  tunnels: RouteAnnotationSegment[];
  disturbances: RouteAnnotationPoint[];
  liveAccidents: RouteAnnotationPoint[];
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
  roadClassDetails?: GraphHopperPathDetail[];
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
    road_class?: GraphHopperPathDetail[];
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

type CityTrafficArea = {
  id: string;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
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

type RouteFetchTelemetry = {
  providerRequestCount: number;
  graphHopperRequestCount: number;
  graphHopperFulfilledCount: number;
  graphHopperRejectedCount: number;
  graphHopperTimeoutCount: number;
  genericRequestCount: number;
  preferenceRequestCount: number;
  providerRouteCount: number;
  hybridRouteCount: number;
  routeCountBeforeBudget: number;
  budgetedRouteCount: number;
  returnedRouteCount: number;
  fallback: boolean;
};

type RouteFetchResult = {
  provider: RouteProvider;
  routes: OsrmRoute[];
  telemetry: RouteFetchTelemetry;
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
    { if: "max_speed >= 100", multiply_by: "0.02" },
    { if: "max_speed >= 90", multiply_by: "0.04" },
  ],
};

const balancedCalmRouteCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_class == MOTORWAY", multiply_by: "0.16" },
    { if: "road_class == TRUNK", multiply_by: "0.24" },
    { if: "max_speed >= 100", multiply_by: "0.1" },
    { if: "max_speed >= 90", multiply_by: "0.2" },
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

const TRAFFIC_INTENSITY_ADT_RPC_LIMIT = 1200;
const TRAFFIC_INTENSITY_ADT_PENALTY_CANDIDATE_LIMIT = 180;
const TRAFFIC_INTENSITY_FLOW_PENALTY_CANDIDATE_LIMIT = 80;
const TRAFFIC_INTENSITY_ADT_PENALTY_MAX_AREAS = 20;
const TRAFFIC_INTENSITY_FLOW_PENALTY_MAX_AREAS = 8;
const TRAFFIC_INTENSITY_PENALTY_PADDING_METERS = 120;
const TRAFFIC_INTENSITY_ROUTE_MATCH_MAX_POINTS = 520;
const TRAFFIC_INTENSITY_ANNOTATION_MAX_SAMPLES = 1400;
const PENALTY_ZONE_BBOX_PADDING = 0.08;
const PENALTY_ZONE_MAX_BBOX_AREA = 80;
const TRAFFIC_FLOW_ACTIVE_WINDOW_MS = 45 * 60 * 1000;
const OSRM_ROUTE_TIMEOUT_MS = 15_000;
const GRAPHHOPPER_ROUTE_TIMEOUT_MS = 15_000;
const GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS = 7_000;
const GRAPHHOPPER_TRAFFIC_INTENSITY_TIMEOUT_MS = 9_000;
const ROUTE_FASTEST_SERVER_TIMEOUT_MS = 20_000;
const ROUTE_FILTERED_SERVER_TIMEOUT_MS = 55_000;
const ROUTE_PREVIEW_SERVER_TIMEOUT_MS = 7_000;
const HYBRID_ROUTE_MAX_JOIN_METERS = 6;
const HYBRID_ROUTE_REJOIN_AFTER_SEPARATION_METERS = 320;
const HYBRID_ROUTE_MIN_LEG_METERS = 1_500;
const HYBRID_ROUTE_MAX_SOURCE_ROUTES = 12;
const HYBRID_ROUTE_MAX_SAMPLES_PER_ROUTE = 90;
const HYBRID_ROUTE_MAX_CANDIDATES = 8;
const HYBRID_ROUTE_MAX_DISTANCE_FACTOR = 1.18;
const HYBRID_ROUTE_MAX_REFERENCE_DISTANCE_METERS = 100_000;
const HYBRID_ROUTE_CONNECTOR_SPEED_MPS = 10;
const ROUTE_SEMANTIC_DUPLICATE_HIGH_SPEED_DIFF_METERS = 700;
const ROUTE_SEMANTIC_DUPLICATE_ENVIRONMENT_DIFF_METERS = 120;
const ROUTE_PRESENTATION_DUPLICATE_DISTANCE_METERS = 2_500;
const ROUTE_PRESENTATION_DUPLICATE_SAMPLE_DISTANCE_METERS = 180;
const CITY_TRAFFIC_AREA_BBOX_PADDING = 0.18;
const CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD = 0.62;
const CITY_TRAFFIC_AREAS: CityTrafficArea[] = [
  { id: "city_stockholm", minLng: 17.65, minLat: 59.12, maxLng: 18.45, maxLat: 59.55 },
  { id: "city_goteborg", minLng: 11.62, minLat: 57.52, maxLng: 12.25, maxLat: 57.90 },
  { id: "city_malmo_lund", minLng: 12.70, minLat: 55.42, maxLng: 13.35, maxLat: 55.85 },
  { id: "city_uppsala", minLng: 17.45, minLat: 59.75, maxLng: 17.95, maxLat: 60.02 },
  { id: "city_vasteras", minLng: 16.30, minLat: 59.48, maxLng: 16.78, maxLat: 59.75 },
  { id: "city_orebro", minLng: 14.88, minLat: 59.10, maxLng: 15.40, maxLat: 59.38 },
  { id: "city_linkoping", minLng: 15.35, minLat: 58.30, maxLng: 15.85, maxLat: 58.55 },
  { id: "city_norrkoping", minLng: 15.92, minLat: 58.50, maxLng: 16.35, maxLat: 58.72 },
  { id: "city_jonkoping", minLng: 13.95, minLat: 57.62, maxLng: 14.35, maxLat: 57.90 },
  { id: "city_helsingborg", minLng: 12.55, minLat: 55.98, maxLng: 12.88, maxLat: 56.18 },
  { id: "city_boras", minLng: 12.72, minLat: 57.60, maxLng: 13.08, maxLat: 57.85 },
  { id: "city_umea", minLng: 20.05, minLat: 63.68, maxLng: 20.45, maxLat: 63.95 },
  { id: "city_gavle", minLng: 16.95, minLat: 60.55, maxLng: 17.35, maxLat: 60.82 },
  { id: "city_eskilstuna", minLng: 16.32, minLat: 59.23, maxLng: 16.65, maxLat: 59.45 },
  { id: "city_karlstad", minLng: 13.32, minLat: 59.25, maxLng: 13.70, maxLat: 59.50 },
  { id: "city_halmstad", minLng: 12.75, minLat: 56.60, maxLng: 13.05, maxLat: 56.78 },
  { id: "city_vaxjo", minLng: 14.65, minLat: 56.80, maxLng: 14.98, maxLat: 57.00 },
  { id: "city_sundsvall", minLng: 17.10, minLat: 62.28, maxLng: 17.48, maxLat: 62.52 },
  { id: "city_lulea", minLng: 22.00, minLat: 65.50, maxLng: 22.35, maxLat: 65.72 },
  { id: "city_trollhattan_vanersborg", minLng: 12.15, minLat: 58.20, maxLng: 12.45, maxLat: 58.42 },
  { id: "city_skovde", minLng: 13.75, minLat: 58.30, maxLng: 14.05, maxLat: 58.50 },
  { id: "city_kalmar", minLng: 16.18, minLat: 56.60, maxLng: 16.45, maxLat: 56.75 },
  { id: "city_kristianstad", minLng: 14.05, minLat: 55.95, maxLng: 14.35, maxLat: 56.12 },
  { id: "city_falun_borlange", minLng: 15.25, minLat: 60.35, maxLng: 15.75, maxLat: 60.65 },
];
const ROUTE_PRESENTATION_DUPLICATE_SHARE = 0.9;
const ROUTE_PRESENTATION_CONTAINED_MAX_EXTRA_METERS = 22_000;
const ROUTE_PRESENTATION_CONTAINED_SHORTER_SHARE = 0.92;
const ROUTE_PRESENTATION_CONTAINED_LONGER_SHARE = 0.72;
const ROUTE_HIGH_SPEED_CALM_WINDOW_METERS = 6_000;
const ROUTE_HIGH_SPEED_MEANINGFUL_FACTOR = 0.65;
const ROUTE_HIGH_SPEED_CALM_RETURN_LIMIT = 3;
const ROUTE_HIGH_SPEED_COMBINED_CALM_RETURN_LIMIT = 5;
const ROUTE_HIGH_SPEED_MEANINGFUL_RETURN_LIMIT = 1;
const ROUTE_HIGH_SPEED_COMBINED_MEANINGFUL_RETURN_LIMIT = 2;
const ROUTE_HIGH_SPEED_COMPARISON_LIMIT = 2;
const ROUTE_HIGH_SPEED_VIA_MAX_POINTS = 4;
const ROUTE_HIGH_SPEED_VIA_FRACTIONS = [0.22, 0.34, 0.46, 0.58] as const;
const ROUTE_HIGH_SPEED_VIA_MIN_ENDPOINT_METERS = 8_000;
const ROUTE_HIGH_SPEED_VIA_MIN_SEPARATION_METERS = 3_500;
const ROUTE_HIGH_SPEED_VIA_MAX_DISTANCE_TO_REFERENCE_METERS = 1_200;
const ROUTE_GENERATED_SPUR_MAX_SAMPLES = 180;
const ROUTE_GENERATED_SPUR_MIN_LOOP_METERS = 1_200;
const ROUTE_GENERATED_SPUR_MAX_LOOP_METERS = 24_000;
const ROUTE_GENERATED_SPUR_MAX_REJOIN_METERS = 300;
const ROUTE_GENERATED_SPUR_MIN_RATIO = 7;
const ROUTE_GENERATED_SPUR_ENDPOINT_BUFFER_METERS = 1_200;

const routeAvoidOptions = ["highSpeed", "trafficIntensity", "cityTraffic", "bridges", "tunnels"] as const;

const noAvoids: RouteAvoidState = {
  highSpeed: false,
  trafficIntensity: false,
  cityTraffic: false,
  bridges: false,
  tunnels: false,
};

class RouteDeadlineError extends Error {
  constructor(readonly timeoutMs: number) {
    super("route request timed out");
  }
}

function routeTimeoutMessage() {
  return "Tidsgränsen nåddes för sökningen. Prova igen senare, med en kortare resa eller med färre undvik-val.";
}

function routeRequestTimeoutMs(
  preview: boolean,
  alternatives: number,
  avoid: RouteAvoidState,
): number {
  if (preview) return ROUTE_PREVIEW_SERVER_TIMEOUT_MS;
  if (alternatives === 0 || activeAvoidOptions(avoid).length === 0) return ROUTE_FASTEST_SERVER_TIMEOUT_MS;
  return ROUTE_FILTERED_SERVER_TIMEOUT_MS;
}

function withRouteDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new RouteDeadlineError(timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function isRouteTimeoutError(error: unknown): boolean {
  return (
    error instanceof RouteDeadlineError ||
    (error instanceof Error && error.message.toLowerCase().includes("timed out"))
  );
}

function emptyRouteFetchTelemetry(
  fallback: boolean,
  overrides: Partial<RouteFetchTelemetry> = {},
): RouteFetchTelemetry {
  return {
    providerRequestCount: 0,
    graphHopperRequestCount: 0,
    graphHopperFulfilledCount: 0,
    graphHopperRejectedCount: 0,
    graphHopperTimeoutCount: 0,
    genericRequestCount: 0,
    preferenceRequestCount: 0,
    providerRouteCount: 0,
    hybridRouteCount: 0,
    routeCountBeforeBudget: 0,
    budgetedRouteCount: 0,
    returnedRouteCount: 0,
    fallback,
    ...overrides,
  };
}

function countRejectedTimeouts(results: PromiseSettledResult<OsrmRoute[]>[]): number {
  return results.filter((result) => result.status === "rejected" && isRouteTimeoutError(result.reason)).length;
}

function routeLogPayloadBase({
  avoid,
  alternatives,
  coordinateCount,
  maxExtraMinutes,
  preview,
}: {
  avoid: RouteAvoidState;
  alternatives: number;
  coordinateCount: number;
  maxExtraMinutes: number | null;
  preview: boolean;
}) {
  const activeAvoids = activeAvoidOptions(avoid);
  return {
    activeAvoids: activeAvoids.length ? activeAvoids.join(",") : "none",
    alternatives,
    coordinateCount,
    maxExtraMinutes: maxExtraMinutes ?? "unlimited",
    preview,
  };
}

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
    highSpeed: input.highSpeed === true,
    trafficIntensity: input.trafficIntensity === true,
    cityTraffic: input.cityTraffic === true,
    bridges: input.bridges === true,
    tunnels: input.tunnels === true,
  };
}

function activeAvoidOptions(avoid: RouteAvoidState): RouteAvoidOption[] {
  return routeAvoidOptions.filter((option) => avoid[option]);
}

function routeAvoidStateForOption(option: RouteAvoidOption): RouteAvoidState {
  return {
    ...noAvoids,
    [option]: true,
  };
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

function bboxOverlapsArea(bbox: Bbox, area: CityTrafficArea): boolean {
  return (
    bbox.minLng <= area.maxLng &&
    bbox.maxLng >= area.minLng &&
    bbox.minLat <= area.maxLat &&
    bbox.maxLat >= area.minLat
  );
}

function cityTrafficAreasForRoutes(routes: OsrmRoute[]): CityTrafficArea[] {
  const bbox = routeBbox(routes, CITY_TRAFFIC_AREA_BBOX_PADDING);
  if (!bbox) return [];
  return CITY_TRAFFIC_AREAS.filter((area) => bboxOverlapsArea(bbox, area));
}

function cityTrafficAreaFeature(area: CityTrafficArea): GraphHopperAreaFeature {
  return {
    type: "Feature",
    id: area.id,
    properties: {},
    geometry: boxPolygon(area.minLng, area.minLat, area.maxLng, area.maxLat),
  };
}

function buildCityTrafficCustomModel(routes: OsrmRoute[]): GraphHopperCustomModel | undefined {
  const features = cityTrafficAreasForRoutes(routes).map(cityTrafficAreaFeature);
  if (!features.length) return undefined;

  const priority = features.flatMap((feature): GraphHopperRule[] => [
    { if: `in_${feature.id} && road_class == MOTORWAY`, multiply_by: "0.58" },
    { if: `in_${feature.id} && road_class == TRUNK`, multiply_by: "0.62" },
    { if: `in_${feature.id} && road_class == PRIMARY`, multiply_by: "0.72" },
    { if: `in_${feature.id} && road_class == SECONDARY`, multiply_by: "0.88" },
    { if: `in_${feature.id} && max_speed >= 80`, multiply_by: "0.82" },
    { if: `in_${feature.id} && max_speed >= 60`, multiply_by: "0.9" },
  ]);

  return {
    priority,
    areas: {
      type: "FeatureCollection",
      features,
    },
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

function routesAreNearDuplicates(a: OsrmRoute, b: OsrmRoute): boolean {
  if (Math.abs(a.distance - b.distance) > 1_200) return false;
  if (Math.abs(a.duration - b.duration) > 120) return false;

  const aLine = routeMatchLine(a);
  const bLine = routeMatchLine(b);
  if (aLine.length < 2 || bLine.length < 2) return false;

  const originLat = (routeOriginLat(a) + routeOriginLat(b)) / 2;
  const aSamples = sampleLineMax(aLine, 32);
  const bSamples = sampleLineMax(bLine, 32);
  const aNear = aSamples.filter((point) => distancePointToLineMeters(point, bLine, originLat) <= 160).length;
  const bNear = bSamples.filter((point) => distancePointToLineMeters(point, aLine, originLat) <= 160).length;
  const geometricallyNear = (
    aNear / Math.max(1, aSamples.length) >= 0.88 &&
    bNear / Math.max(1, bSamples.length) >= 0.88
  );
  if (!geometricallyNear) return false;
  return !routesHaveMeaningfullyDifferentAvoidDetails(a, b);
}

function routeDetailExposureMeters(
  route: OsrmRoute,
  property: RouteDetailProperty,
  includeValue: (value: string | number | null) => boolean,
): number | null {
  const details = route[property];
  if (!details) return null;

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return 0;

  const originLat = routeOriginLat(route);
  let meters = 0;
  for (const [fromIndex, toIndex, value] of details) {
    if (!includeValue(value)) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));
    for (let index = from + 1; index <= to; index += 1) {
      const start = coords[index - 1];
      const end = coords[index];
      if (!start || !end) continue;
      meters += distanceBetweenCoordinatesMeters(start, end, originLat);
    }
  }
  return Math.min(meters, route.distance);
}

function routeHighSpeedDetailExposureMeters(route: OsrmRoute): number | null {
  return routeDetailExposureMeters(route, "maxSpeedDetails", (value) => {
    const speed = speedLimitFromDetail(value);
    return speed !== null && speed >= 90;
  });
}

function routeEnvironmentDetailExposureMeters(
  route: OsrmRoute,
  environment: "BRIDGE" | "TUNNEL",
): number | null {
  return routeDetailExposureMeters(route, "roadEnvironmentDetails", (value) => (
    typeof value === "string" && value.toUpperCase() === environment
  ));
}

function routeDetailStringForSegment(
  route: OsrmRoute,
  property: Extract<RouteDetailProperty, "roadClassDetails">,
  segmentIndex: number,
): string | null {
  const value = routeDetailValueForSegment(route, property, segmentIndex);
  return typeof value === "string" ? value.toUpperCase() : null;
}

function cityTrafficAreaForSegment(route: OsrmRoute, segmentIndex: number): CityTrafficArea | null {
  const start = route.geometry.coordinates[segmentIndex];
  const end = route.geometry.coordinates[segmentIndex + 1];
  if (!start || !end) return null;

  const lng = ((start[0] ?? 0) + (end[0] ?? 0)) / 2;
  const lat = ((start[1] ?? 0) + (end[1] ?? 0)) / 2;
  return CITY_TRAFFIC_AREAS.find((area) => (
    lng >= area.minLng &&
    lng <= area.maxLng &&
    lat >= area.minLat &&
    lat <= area.maxLat
  )) ?? null;
}

function cityTrafficFactorForSegment(route: OsrmRoute, segmentIndex: number): number {
  if (!cityTrafficAreaForSegment(route, segmentIndex)) return 0;

  const roadClass = routeDetailStringForSegment(route, "roadClassDetails", segmentIndex);
  const speed = routeSegmentSpeedLimit(route, segmentIndex);
  let factor = 0;

  if (roadClass === "MOTORWAY") factor = 1;
  else if (roadClass === "TRUNK") factor = 0.95;
  else if (roadClass === "PRIMARY") factor = 0.78;
  else if (roadClass === "SECONDARY") factor = 0.52;

  if (speed !== null) {
    if (speed >= 80) factor += 0.15;
    else if (speed >= 60) factor += 0.08;
  }

  return Math.min(1.3, factor);
}

function routeCityTrafficDetailExposureMeters(route: OsrmRoute): number | null {
  if (!route.roadClassDetails) return null;
  const coords = route.geometry.coordinates;
  if (coords.length < 2) return 0;

  const originLat = routeOriginLat(route);
  let meters = 0;
  for (let index = 0; index < coords.length - 1; index += 1) {
    if (cityTrafficFactorForSegment(route, index) < CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD) continue;
    const start = coords[index];
    const end = coords[index + 1];
    if (!start || !end) continue;
    meters += distanceBetweenCoordinatesMeters(start, end, originLat);
  }
  return Math.min(meters, route.distance);
}

function exposureDiffAboveThreshold(
  a: number | null,
  b: number | null,
  threshold: number,
): boolean {
  return a !== null && b !== null && Math.abs(a - b) >= threshold;
}

function routesHaveMeaningfullyDifferentAvoidDetails(a: OsrmRoute, b: OsrmRoute): boolean {
  return (
    exposureDiffAboveThreshold(
      routeHighSpeedDetailExposureMeters(a),
      routeHighSpeedDetailExposureMeters(b),
      ROUTE_SEMANTIC_DUPLICATE_HIGH_SPEED_DIFF_METERS,
    ) ||
    exposureDiffAboveThreshold(
      routeEnvironmentDetailExposureMeters(a, "BRIDGE"),
      routeEnvironmentDetailExposureMeters(b, "BRIDGE"),
      ROUTE_SEMANTIC_DUPLICATE_ENVIRONMENT_DIFF_METERS,
    ) ||
    exposureDiffAboveThreshold(
      routeEnvironmentDetailExposureMeters(a, "TUNNEL"),
      routeEnvironmentDetailExposureMeters(b, "TUNNEL"),
      ROUTE_SEMANTIC_DUPLICATE_ENVIRONMENT_DIFF_METERS,
    ) ||
    exposureDiffAboveThreshold(
      routeCityTrafficDetailExposureMeters(a),
      routeCityTrafficDetailExposureMeters(b),
      ROUTE_SEMANTIC_DUPLICATE_ENVIRONMENT_DIFF_METERS,
    )
  );
}

function routeAvoidDetailSortCost(route: OsrmRoute, activeOptions: RouteAvoidOption[]): number {
  let weightedCost = 0;
  let weightTotal = 0;

  const addCost = (exposureMeters: number | null, weight: number) => {
    weightedCost += (
      exposureMeters === null
        ? 1
        : Math.min(exposureMeters, route.distance) / Math.max(1, route.distance)
    ) * weight;
    weightTotal += weight;
  };

  if (activeOptions.includes("highSpeed")) {
    addCost(routeHighSpeedDetailExposureMeters(route), 5);
  }
  if (activeOptions.includes("bridges")) {
    addCost(routeEnvironmentDetailExposureMeters(route, "BRIDGE"), 1.6);
  }
  if (activeOptions.includes("tunnels")) {
    addCost(routeEnvironmentDetailExposureMeters(route, "TUNNEL"), 1.6);
  }
  if (activeOptions.includes("cityTraffic")) {
    addCost(routeCityTrafficDetailExposureMeters(route), 4);
  }

  return weightTotal > 0 ? weightedCost / weightTotal : 0;
}

function dedupeRoutes(routes: OsrmRoute[]): OsrmRoute[] {
  const seen = new Set<string>();
  const deduped: OsrmRoute[] = [];
  for (const route of routes) {
    const key = routeGeometryKey(route);
    if (seen.has(key)) continue;
    if (deduped.some((candidate) => routesAreNearDuplicates(route, candidate))) continue;
    seen.add(key);
    deduped.push(route);
  }
  return deduped;
}

function routePresentationSortCost(route: OsrmRoute, activeOptions: RouteAvoidOption[]): number {
  return activeOptions.length ? routeAvoidDetailSortCost(route, activeOptions) : 0;
}

function compareRoutesForPresentation(
  a: OsrmRoute,
  b: OsrmRoute,
  activeOptions: RouteAvoidOption[],
): number {
  const avoidCostA = routePresentationSortCost(a, activeOptions);
  const avoidCostB = routePresentationSortCost(b, activeOptions);
  if (Math.abs(avoidCostA - avoidCostB) > 0.002) return avoidCostA - avoidCostB;
  if (Math.abs(a.duration - b.duration) > 30) return a.duration - b.duration;
  if (Math.abs(a.distance - b.distance) > 50) return a.distance - b.distance;
  return 0;
}

function routeNearShare(
  samples: GeoJSON.Position[],
  comparisonLine: GeoJSON.Position[],
  originLat: number,
): number {
  if (!samples.length) return 0;
  const nearCount = samples.filter((point) => (
    distancePointToLineMeters(point, comparisonLine, originLat) <= ROUTE_PRESENTATION_DUPLICATE_SAMPLE_DISTANCE_METERS
  )).length;
  return nearCount / samples.length;
}

function routesArePresentationDuplicates(a: OsrmRoute, b: OsrmRoute): boolean {
  const aLine = routeMatchLine(a);
  const bLine = routeMatchLine(b);
  if (aLine.length < 2 || bLine.length < 2) return false;

  const originLat = (routeOriginLat(a) + routeOriginLat(b)) / 2;
  const aSamples = sampleLineMax(aLine, 48);
  const bSamples = sampleLineMax(bLine, 48);
  const aShare = routeNearShare(aSamples, bLine, originLat);
  const bShare = routeNearShare(bSamples, aLine, originLat);
  const distanceDiff = Math.abs(a.distance - b.distance);

  const geometricallyNear = (
    distanceDiff <= ROUTE_PRESENTATION_DUPLICATE_DISTANCE_METERS &&
    aShare >= ROUTE_PRESENTATION_DUPLICATE_SHARE &&
    bShare >= ROUTE_PRESENTATION_DUPLICATE_SHARE
  );
  const shorterShare = a.distance <= b.distance ? aShare : bShare;
  const longerShare = a.distance <= b.distance ? bShare : aShare;
  const containedNear = (
    distanceDiff <= ROUTE_PRESENTATION_CONTAINED_MAX_EXTRA_METERS &&
    shorterShare >= ROUTE_PRESENTATION_CONTAINED_SHORTER_SHARE &&
    longerShare >= ROUTE_PRESENTATION_CONTAINED_LONGER_SHARE
  );

  if (!geometricallyNear && !containedNear) return false;
  return !routesHaveMeaningfullyDifferentAvoidDetails(a, b);
}

function dedupeRoutesForPresentation(
  routes: OsrmRoute[],
  activeOptions: RouteAvoidOption[],
): OsrmRoute[] {
  const deduped: OsrmRoute[] = [];
  for (const route of routes) {
    const duplicateIndex = deduped.findIndex((candidate) => routesArePresentationDuplicates(route, candidate));
    if (duplicateIndex === -1) {
      deduped.push(route);
      continue;
    }

    const duplicate = deduped[duplicateIndex];
    if (duplicate && compareRoutesForPresentation(route, duplicate, activeOptions) < 0) {
      deduped[duplicateIndex] = route;
    }
  }
  return deduped;
}

type RouteDetailProperty = "maxSpeedDetails" | "roadEnvironmentDetails" | "roadClassDetails";

type HybridSegmentSource = {
  route: OsrmRoute;
  segmentIndex: number;
} | null;

type HybridJoin = {
  prefixIndex: number;
  suffixIndex: number;
  distanceMeters: number;
};

function routeCumulativeDistances(route: OsrmRoute): number[] {
  const coords = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  const cumulative = [0];
  for (let index = 1; index < coords.length; index += 1) {
    const start = coords[index - 1];
    const end = coords[index];
    cumulative[index] = (cumulative[index - 1] ?? 0) +
      (start && end ? distanceBetweenCoordinatesMeters(start, end, originLat) : 0);
  }
  return cumulative;
}

function routeGeneratedByForcedCorridor(route: OsrmRoute): boolean {
  const source = route.source ?? "";
  return source.startsWith("hybrid-") || source.startsWith("avoid-high-speed-via-");
}

function routeSpurSampleIndexes(cumulative: number[]): number[] {
  const total = cumulative.at(-1) ?? 0;
  const candidates: number[] = [];

  for (let index = 1; index < cumulative.length - 1; index += 1) {
    const fromStart = cumulative[index] ?? 0;
    if (fromStart < ROUTE_GENERATED_SPUR_ENDPOINT_BUFFER_METERS) continue;
    if (total - fromStart < ROUTE_GENERATED_SPUR_ENDPOINT_BUFFER_METERS) continue;
    candidates.push(index);
  }

  if (candidates.length <= ROUTE_GENERATED_SPUR_MAX_SAMPLES) return candidates;
  const step = candidates.length / ROUTE_GENERATED_SPUR_MAX_SAMPLES;
  const samples: number[] = [];
  for (let index = 0; index < ROUTE_GENERATED_SPUR_MAX_SAMPLES; index += 1) {
    const sample = candidates[Math.floor(index * step)];
    if (sample !== undefined) samples.push(sample);
  }
  return samples;
}

function routeHasOutAndBackSpur(route: OsrmRoute): boolean {
  const coords = route.geometry.coordinates;
  if (coords.length < 8) return false;

  const cumulative = routeCumulativeDistances(route);
  const samples = routeSpurSampleIndexes(cumulative);
  if (samples.length < 3) return false;

  const originLat = routeOriginLat(route);
  for (let startIndex = 0; startIndex < samples.length - 1; startIndex += 1) {
    const fromIndex = samples[startIndex];
    if (fromIndex === undefined) continue;
    const fromCoord = coords[fromIndex];
    const fromDistance = cumulative[fromIndex] ?? 0;
    if (!fromCoord) continue;

    for (let endIndex = startIndex + 1; endIndex < samples.length; endIndex += 1) {
      const toIndex = samples[endIndex];
      if (toIndex === undefined) continue;
      const loopDistance = (cumulative[toIndex] ?? 0) - fromDistance;
      if (loopDistance < ROUTE_GENERATED_SPUR_MIN_LOOP_METERS) continue;
      if (loopDistance > ROUTE_GENERATED_SPUR_MAX_LOOP_METERS) break;

      const toCoord = coords[toIndex];
      if (!toCoord) continue;
      const rejoinDistance = distanceBetweenCoordinatesMeters(fromCoord, toCoord, originLat);
      if (rejoinDistance > ROUTE_GENERATED_SPUR_MAX_REJOIN_METERS) continue;
      if (loopDistance / Math.max(rejoinDistance, 40) < ROUTE_GENERATED_SPUR_MIN_RATIO) continue;
      return true;
    }
  }

  return false;
}

function hybridRouteSampleIndexes(cumulative: number[]): number[] {
  const total = cumulative.at(-1) ?? 0;
  if (total < HYBRID_ROUTE_MIN_LEG_METERS * 2) return [];

  const indexes: number[] = [];
  const candidateIndexes: number[] = [];
  for (let index = 1; index < cumulative.length - 1; index += 1) {
    const fromStart = cumulative[index] ?? 0;
    const toEnd = total - fromStart;
    if (fromStart >= HYBRID_ROUTE_MIN_LEG_METERS && toEnd >= HYBRID_ROUTE_MIN_LEG_METERS) {
      candidateIndexes.push(index);
    }
  }
  if (candidateIndexes.length <= HYBRID_ROUTE_MAX_SAMPLES_PER_ROUTE) return candidateIndexes;

  const step = candidateIndexes.length / HYBRID_ROUTE_MAX_SAMPLES_PER_ROUTE;
  for (let index = 0; index < HYBRID_ROUTE_MAX_SAMPLES_PER_ROUTE; index += 1) {
    const sampleIndex = candidateIndexes[Math.floor(index * step)];
    if (sampleIndex !== undefined) indexes.push(sampleIndex);
  }
  return indexes;
}

function findHybridJoin(prefixRoute: OsrmRoute, suffixRoute: OsrmRoute): HybridJoin | null {
  const prefixCoords = prefixRoute.geometry.coordinates;
  const suffixCoords = suffixRoute.geometry.coordinates;
  if (prefixCoords.length < 4 || suffixCoords.length < 4) return null;

  const prefixCumulative = routeCumulativeDistances(prefixRoute);
  const suffixCumulative = routeCumulativeDistances(suffixRoute);
  const prefixSamples = hybridRouteSampleIndexes(prefixCumulative);
  const suffixSamples = hybridRouteSampleIndexes(suffixCumulative);
  if (!prefixSamples.length || !suffixSamples.length) return null;

  const originLat = (routeOriginLat(prefixRoute) + routeOriginLat(suffixRoute)) / 2;
  const suffixLine = routeMatchLine(suffixRoute);
  let seenMeaningfulSeparation = false;

  for (const prefixIndex of prefixSamples) {
    const prefixCoord = prefixCoords[prefixIndex];
    if (!prefixCoord) continue;
    const distanceToSuffixLine = distancePointToLineMeters(prefixCoord, suffixLine, originLat);
    if (distanceToSuffixLine > HYBRID_ROUTE_REJOIN_AFTER_SEPARATION_METERS) {
      seenMeaningfulSeparation = true;
      continue;
    }
    if (!seenMeaningfulSeparation) continue;

    let bestForPrefix: HybridJoin | null = null;
    for (const suffixIndex of suffixSamples) {
      const suffixCoord = suffixCoords[suffixIndex];
      if (!suffixCoord) continue;
      const distanceMeters = distanceBetweenCoordinatesMeters(prefixCoord, suffixCoord, originLat);
      if (distanceMeters > HYBRID_ROUTE_MAX_JOIN_METERS) continue;
      if (!bestForPrefix || distanceMeters < bestForPrefix.distanceMeters) {
        bestForPrefix = { prefixIndex, suffixIndex, distanceMeters };
      }
    }
    if (bestForPrefix) return bestForPrefix;
  }

  return null;
}

function routeDetailValueForSegment(
  route: OsrmRoute,
  property: RouteDetailProperty,
  segmentIndex: number,
): string | number | null | undefined {
  const details = route[property];
  if (!details) return undefined;
  const detail = details.find(([fromIndex, toIndex]) => {
    const from = Math.floor(fromIndex);
    const to = Math.floor(toIndex);
    return segmentIndex >= from && segmentIndex < to;
  });
  return detail?.[2];
}

function buildHybridPathDetails(
  segmentSources: HybridSegmentSource[],
  property: RouteDetailProperty,
): GraphHopperPathDetail[] | undefined {
  const details: GraphHopperPathDetail[] = [];
  let currentValue: string | number | null | undefined;
  let currentStart = -1;

  const flush = (endIndex: number) => {
    if (currentStart >= 0 && currentValue !== undefined && currentValue !== null) {
      details.push([currentStart, endIndex, currentValue]);
    }
    currentStart = -1;
    currentValue = undefined;
  };

  segmentSources.forEach((source, segmentIndex) => {
    const value = source
      ? routeDetailValueForSegment(source.route, property, source.segmentIndex)
      : undefined;
    if (value === currentValue) return;
    flush(segmentIndex);
    if (value !== undefined && value !== null) {
      currentStart = segmentIndex;
      currentValue = value;
    }
  });
  flush(segmentSources.length);

  return details.length ? details : undefined;
}

function buildHybridRoute(
  prefixRoute: OsrmRoute,
  suffixRoute: OsrmRoute,
  join: HybridJoin,
  source: string,
): OsrmRoute | null {
  const prefixCoords = prefixRoute.geometry.coordinates;
  const suffixCoords = suffixRoute.geometry.coordinates;
  const prefixJoin = prefixCoords[join.prefixIndex];
  const suffixJoin = suffixCoords[join.suffixIndex];
  if (!prefixJoin || !suffixJoin) return null;

  const coordinates: GeoJSON.Position[] = prefixCoords.slice(0, join.prefixIndex + 1);
  const segmentSources: HybridSegmentSource[] = [];
  for (let index = 0; index < join.prefixIndex; index += 1) {
    segmentSources.push({ route: prefixRoute, segmentIndex: index });
  }

  if (join.distanceMeters > 1) {
    coordinates.push(suffixJoin);
    segmentSources.push(null);
  }

  for (let index = join.suffixIndex + 1; index < suffixCoords.length; index += 1) {
    coordinates.push(suffixCoords[index] as GeoJSON.Position);
    segmentSources.push({ route: suffixRoute, segmentIndex: index - 1 });
  }

  if (coordinates.length < 2 || segmentSources.length !== coordinates.length - 1) return null;

  const originLat = coordinates.reduce((sum, coord) => sum + (coord[1] ?? 60), 0) / coordinates.length;
  const distance = lineLengthMeters(coordinates, originLat);
  const referenceDistance = Math.max(prefixRoute.distance, suffixRoute.distance);
  if (distance > referenceDistance * HYBRID_ROUTE_MAX_DISTANCE_FACTOR) return null;

  const prefixCumulative = routeCumulativeDistances(prefixRoute);
  const suffixCumulative = routeCumulativeDistances(suffixRoute);
  const prefixTotal = Math.max(1, prefixCumulative.at(-1) ?? prefixRoute.distance);
  const suffixTotal = Math.max(1, suffixCumulative.at(-1) ?? suffixRoute.distance);
  const prefixDistance = prefixCumulative[join.prefixIndex] ?? 0;
  const suffixDistance = suffixTotal - (suffixCumulative[join.suffixIndex] ?? 0);
  const duration =
    prefixRoute.duration * (prefixDistance / prefixTotal) +
    suffixRoute.duration * (suffixDistance / suffixTotal) +
    join.distanceMeters / HYBRID_ROUTE_CONNECTOR_SPEED_MPS;

  return {
    source,
    distance,
    duration,
    geometry: { type: "LineString", coordinates },
    maxSpeedDetails: buildHybridPathDetails(segmentSources, "maxSpeedDetails"),
    roadEnvironmentDetails: buildHybridPathDetails(segmentSources, "roadEnvironmentDetails"),
    roadClassDetails: buildHybridPathDetails(segmentSources, "roadClassDetails"),
  };
}

function buildHybridRoutes(routes: OsrmRoute[], activeOptions: RouteAvoidOption[]): OsrmRoute[] {
  if (activeOptions.length < 2 && !activeOptions.includes("highSpeed")) return [];
  const sourceRoutes = dedupeRoutes(routes)
    .slice(0, HYBRID_ROUTE_MAX_SOURCE_ROUTES);
  const hybrids: OsrmRoute[] = [];

  for (let prefixIndex = 0; prefixIndex < sourceRoutes.length; prefixIndex += 1) {
    const prefixRoute = sourceRoutes[prefixIndex];
    if (!prefixRoute) continue;
    for (let suffixIndex = 0; suffixIndex < sourceRoutes.length; suffixIndex += 1) {
      if (prefixIndex === suffixIndex) continue;
      const suffixRoute = sourceRoutes[suffixIndex];
      if (!suffixRoute || routesAreNearDuplicates(prefixRoute, suffixRoute)) continue;
      const referenceDistance = Math.max(prefixRoute.distance, suffixRoute.distance);
      if (referenceDistance > HYBRID_ROUTE_MAX_REFERENCE_DISTANCE_METERS) continue;
      const join = findHybridJoin(prefixRoute, suffixRoute);
      if (!join) continue;
      const hybrid = buildHybridRoute(
        prefixRoute,
        suffixRoute,
        join,
        `hybrid-${prefixIndex + 1}-${suffixIndex + 1}`,
      );
      if (!hybrid) continue;
      if (routes.some((route) => routesAreNearDuplicates(hybrid, route))) continue;
      if (hybrids.some((route) => routesAreNearDuplicates(hybrid, route))) continue;
      hybrids.push(hybrid);
    }
  }

  return dedupeRoutes(hybrids)
    .sort((a, b) => {
      const avoidCostA = routeAvoidDetailSortCost(a, activeOptions);
      const avoidCostB = routeAvoidDetailSortCost(b, activeOptions);
      if (Math.abs(avoidCostA - avoidCostB) > 0.002) return avoidCostA - avoidCostB;
      if (a.duration !== b.duration) return a.duration - b.duration;
      return a.distance - b.distance;
    })
    .slice(0, HYBRID_ROUTE_MAX_CANDIDATES);
}

function routeHighSpeedExposureForSelection(route: OsrmRoute): number {
  return routeHighSpeedDetailExposureMeters(route) ?? route.distance;
}

function compareHighSpeedAvoidanceRoutes(a: OsrmRoute, b: OsrmRoute): number {
  const exposureA = routeHighSpeedExposureForSelection(a);
  const exposureB = routeHighSpeedExposureForSelection(b);
  if (Math.abs(exposureA - exposureB) > 500) return exposureA - exposureB;
  if (Math.abs(a.duration - b.duration) > 30) return a.duration - b.duration;
  return a.distance - b.distance;
}

function compareFastestRoutes(a: OsrmRoute, b: OsrmRoute): number {
  if (Math.abs(a.duration - b.duration) > 30) return a.duration - b.duration;
  return a.distance - b.distance;
}

function addRouteForReturn(routes: OsrmRoute[], route: OsrmRoute | undefined): boolean {
  if (!route || routes.includes(route)) return false;
  routes.push(route);
  return true;
}

function selectHighSpeedRoutesForReturn(
  routes: OsrmRoute[],
  limit: number,
  activeOptions: RouteAvoidOption[],
): OsrmRoute[] {
  const baseline = routes[0];
  if (!baseline) return routes.slice(0, limit);

  const selectableRoutes = routes.filter((route, index) => (
    index === 0 ||
    !routeGeneratedByForcedCorridor(route) ||
    !routeHasOutAndBackSpur(route)
  ));
  const bestExposure = Math.min(...selectableRoutes.map(routeHighSpeedExposureForSelection));
  const baselineExposure = routeHighSpeedExposureForSelection(baseline);
  const calmThreshold = bestExposure + ROUTE_HIGH_SPEED_CALM_WINDOW_METERS;
  const meaningfulThreshold = Math.max(calmThreshold, baselineExposure * ROUTE_HIGH_SPEED_MEANINGFUL_FACTOR);
  const hasAdditionalHighSpeedFilters = activeOptions.some((option) => option !== "highSpeed");
  const calmReturnLimit = hasAdditionalHighSpeedFilters
    ? ROUTE_HIGH_SPEED_COMBINED_CALM_RETURN_LIMIT
    : ROUTE_HIGH_SPEED_CALM_RETURN_LIMIT;
  const meaningfulReturnLimit = hasAdditionalHighSpeedFilters
    ? ROUTE_HIGH_SPEED_COMBINED_MEANINGFUL_RETURN_LIMIT
    : ROUTE_HIGH_SPEED_MEANINGFUL_RETURN_LIMIT;

  const calmRoutes = selectableRoutes
    .filter((route) => routeHighSpeedExposureForSelection(route) <= calmThreshold)
    .sort(compareHighSpeedAvoidanceRoutes);
  const meaningfulRoutes = selectableRoutes
    .filter((route) => {
      const exposure = routeHighSpeedExposureForSelection(route);
      return exposure > calmThreshold && exposure <= meaningfulThreshold;
    })
    .sort(compareHighSpeedAvoidanceRoutes);
  const comparisonRoutes = selectableRoutes
    .filter((route) => {
      const exposure = routeHighSpeedExposureForSelection(route);
      return exposure > meaningfulThreshold;
    })
    .sort((a, b) => {
      const durationDiff = compareFastestRoutes(a, b);
      if (durationDiff !== 0) return durationDiff;
      return compareHighSpeedAvoidanceRoutes(a, b);
    });

  const selected: OsrmRoute[] = [];
  let highSpeedComparisonCount = 0;
  addRouteForReturn(selected, baseline);
  if (routeHighSpeedExposureForSelection(baseline) > calmThreshold) {
    highSpeedComparisonCount = 1;
  }

  let calmRouteCount = 0;
  for (const route of calmRoutes) {
    if (selected.length >= limit) break;
    if (calmRouteCount >= calmReturnLimit) break;
    if (addRouteForReturn(selected, route)) calmRouteCount += 1;
  }

  let meaningfulRouteCount = 0;
  for (const route of meaningfulRoutes) {
    if (selected.length >= limit) break;
    if (meaningfulRouteCount >= meaningfulReturnLimit) break;
    if (addRouteForReturn(selected, route)) meaningfulRouteCount += 1;
  }

  for (const route of comparisonRoutes) {
    if (selected.length >= limit) break;
    if (highSpeedComparisonCount >= ROUTE_HIGH_SPEED_COMPARISON_LIMIT) break;
    if (addRouteForReturn(selected, route)) highSpeedComparisonCount += 1;
  }

  return selected.slice(0, limit);
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

function sampleLineMax(line: GeoJSON.Position[], maxPoints: number): GeoJSON.Position[] {
  if (line.length <= maxPoints) return line;
  const step = Math.max(1, Math.floor(line.length / maxPoints));
  const sampled = line.filter((_, index) => index % step === 0);
  const last = line.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function sampleLine(line: GeoJSON.Position[]): GeoJSON.Position[] {
  return sampleLineMax(line, 24);
}

function routeMatchLine(route: OsrmRoute): GeoJSON.Position[] {
  return sampleLineMax(route.geometry.coordinates, TRAFFIC_INTENSITY_ROUTE_MATCH_MAX_POINTS);
}

function capSamples(samples: GeoJSON.Position[], maxSamples: number): GeoJSON.Position[] {
  if (samples.length <= maxSamples) return samples;
  const step = samples.length / maxSamples;
  const capped: GeoJSON.Position[] = [];
  for (let index = 0; index < maxSamples; index += 1) {
    const sample = samples[Math.floor(index * step)];
    if (sample) capped.push(sample);
  }
  return capped;
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
    cityTraffic: [],
    bridges: [],
    tunnels: [],
    disturbances: [],
    liveAccidents: [],
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

function routeSegmentSpeedLimit(route: OsrmRoute, segmentIndex: number): number | null {
  const details = route.maxSpeedDetails;
  if (!details) return null;

  for (const [fromIndex, toIndex, value] of details) {
    if (segmentIndex >= Math.floor(fromIndex) && segmentIndex < Math.ceil(toIndex)) {
      return speedLimitFromDetail(value);
    }
  }

  return null;
}

function routeLowSpeedPointNearFraction(
  route: OsrmRoute,
  fraction: number,
): [number, number] | null {
  const coords = route.geometry.coordinates;
  if (coords.length < 3) return null;

  const cumulative = routeCumulativeDistances(route);
  const total = cumulative.at(-1) ?? route.distance;
  const target = total * fraction;
  let best: { coord: [number, number]; distanceFromTarget: number } | null = null;

  for (let index = 1; index < coords.length - 1; index += 1) {
    const distanceFromStart = cumulative[index] ?? 0;
    if (distanceFromStart < ROUTE_HIGH_SPEED_VIA_MIN_ENDPOINT_METERS) continue;
    if (total - distanceFromStart < ROUTE_HIGH_SPEED_VIA_MIN_ENDPOINT_METERS) continue;

    const speed = routeSegmentSpeedLimit(route, index - 1);
    if (speed !== null && speed >= 90) continue;

    const coord = toLngLat(coords[index]);
    if (!coord) continue;

    const distanceFromTarget = Math.abs(distanceFromStart - target);
    if (!best || distanceFromTarget < best.distanceFromTarget) {
      best = { coord, distanceFromTarget };
    }
  }

  return best?.coord ?? null;
}

function pointFarEnoughFromRoutes(
  point: [number, number],
  routes: OsrmRoute[],
): boolean {
  if (!routes.length) return true;
  const originLat = point[1];
  return routes.every((route) => (
    distancePointToLineMeters(point, routeMatchLine(route), originLat) >=
      ROUTE_HIGH_SPEED_VIA_MAX_DISTANCE_TO_REFERENCE_METERS
  ));
}

function selectHighSpeedViaPoints(
  routes: OsrmRoute[],
  referenceRoutes: OsrmRoute[],
): [number, number][] {
  const selected: [number, number][] = [];

  for (const route of routes) {
    if (selected.length >= ROUTE_HIGH_SPEED_VIA_MAX_POINTS) break;
    for (const fraction of ROUTE_HIGH_SPEED_VIA_FRACTIONS) {
      if (selected.length >= ROUTE_HIGH_SPEED_VIA_MAX_POINTS) break;
      const point = routeLowSpeedPointNearFraction(route, fraction);
      if (!point) continue;
      if (!pointFarEnoughFromRoutes(point, referenceRoutes)) continue;

      const originLat = point[1];
      const tooCloseToSelected = selected.some((candidate) => (
        distanceBetweenCoordinatesMeters(point, candidate, originLat) <
          ROUTE_HIGH_SPEED_VIA_MIN_SEPARATION_METERS
      ));
      if (tooCloseToSelected) continue;
      selected.push(point);
    }
  }

  return selected;
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
    return samples.some((sample) => distancePointToSegmentMeters(sample, start, end, originLat) <= 130);
  });
}

function scoreCityTraffic(route: OsrmRoute): RouteMetric {
  if (!route.roadClassDetails) return { score: null, exposure: null };

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return { score: 0, exposure: 0 };

  const originLat = routeOriginLat(route);
  let weightedMeters = 0;
  let exposureMeters = 0;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const start = coords[index];
    const end = coords[index + 1];
    if (!start || !end) continue;
    const factor = cityTrafficFactorForSegment(route, index);
    if (factor <= 0) continue;
    const meters = distanceBetweenCoordinatesMeters(start, end, originLat);
    weightedMeters += meters * factor;
    if (factor >= CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD) exposureMeters += meters;
  }

  return {
    score: Math.min(1, weightedMeters / Math.max(1, route.distance)),
    exposure: Math.min(exposureMeters, route.distance),
  };
}

function cityTrafficSegments(route: OsrmRoute): RouteAnnotationSegment[] {
  if (!route.roadClassDetails) return [];
  return routeSegmentAnnotationsFromMask(
    route,
    "cityTraffic",
    (segmentIndex) => cityTrafficFactorForSegment(route, segmentIndex) >= CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD,
  );
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
          category: categoryFromDisturbanceMessageType(row.message_type),
        }]
      : []
  ));
}

function liveAccidentPoints(route: OsrmRoute, rows: EventRow[]): RouteAnnotationPoint[] {
  if (!rows.length) return [];
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  return rows.flatMap((row) => (
    distancePointToLineMeters([row.lng, row.lat], line, originLat) <= 120
      ? [{
          kind: "liveAccidents" as const,
          coordinates: [row.lng, row.lat] as [number, number],
        }]
      : []
  ));
}

type RouteMetric = {
  score: number | null;
  exposure: number | null;
};

function scoreHighSpeed(route: OsrmRoute, rows: LargeRoadRow[]): RouteMetric {
  const detailMetric = highSpeedMetricFromDetails(route);
  if (detailMetric) return detailMetric;

  if (!rows.length) return { score: null, exposure: null };
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

function adtRowNearLine(line: GeoJSON.Position[], row: AdtRow, originLat: number): boolean {
  const mid = midpoint(row.geometry.coordinates);
  const samples = mid ? [...sampleLine(row.geometry.coordinates), mid] : sampleLine(row.geometry.coordinates);
  return samples.some((point) => distancePointToLineMeters(point, line, originLat) <= 95);
}

function trafficFlowRowNearLine(line: GeoJSON.Position[], row: TrafficFlowRow, originLat: number): boolean {
  return flattenLineString(row.geometry).some((segment) => {
    const mid = midpoint(segment);
    const samples = mid ? [...sampleLine(segment), mid] : sampleLine(segment);
    return samples.some((point) => distancePointToLineMeters(point, line, originLat) <= 130);
  });
}

function scoreTrafficIntensity(route: OsrmRoute, adtRows: AdtRow[], trafficFlowRows: TrafficFlowRow[]): RouteMetric {
  if (!adtRows.length && !trafficFlowRows.length) return { score: null, exposure: null };

  const originLat = routeOriginLat(route);
  const line = routeMatchLine(route);
  let coveredMeters = 0;
  let weightedMeters = 0;
  let intensiveMeters = 0;

  for (const row of adtRows) {
    if (!adtRowNearLine(line, row, originLat)) continue;
    const meters = Math.max(35, geometryLengthMeters(row.geometry, originLat));
    const intensity = adtIntensityScore(row.adt_total);
    coveredMeters += meters;
    weightedMeters += meters * intensity;
    if (intensity >= 0.55) intensiveMeters += meters;
  }

  for (const row of trafficFlowRows) {
    if (!trafficFlowRowNearLine(line, row, originLat)) continue;
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

  const annotationSamples = capSamples(samples, TRAFFIC_INTENSITY_ANNOTATION_MAX_SAMPLES);
  return routeSegmentAnnotationsFromMask(route, "trafficIntensity", (segmentIndex) => {
    const start = route.geometry.coordinates[segmentIndex];
    const end = route.geometry.coordinates[segmentIndex + 1];
    if (!start || !end) return false;
    return annotationSamples.some((sample) => distancePointToSegmentMeters(sample, start, end, originLat) <= 130);
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
  adtRows: AdtRow[];
  trafficFlowRows: TrafficFlowRow[];
}> {
  const empty = { adtRows: [], trafficFlowRows: [] };
  if (!supabaseUrl || !supabaseAnon) return empty;
  if (!avoid.trafficIntensity) return empty;

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
    const trafficFlowActiveSince = new Date(Date.now() - TRAFFIC_FLOW_ACTIVE_WINDOW_MS).toISOString();
    const [adtResult, trafficFlowResult] = await Promise.all([
      avoid.trafficIntensity
        ? client.rpc("adt_in_bbox", params).limit(TRAFFIC_INTENSITY_ADT_RPC_LIMIT)
        : Promise.resolve({ data: [], error: null }),
      avoid.trafficIntensity && bboxArea(bbox) <= 30
        ? client.rpc("traffic_flow_segments_in_bbox", {
            ...params,
            active_since: trafficFlowActiveSince,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    return {
      adtRows: adtResult.error ? [] : (adtResult.data ?? []) as AdtRow[],
      trafficFlowRows: trafficFlowResult.error ? [] : (trafficFlowResult.data ?? []) as TrafficFlowRow[],
    };
  } catch (err) {
    console.warn("route penalty zone lookup failed", err);
    return empty;
  }
}

function buildPenaltyZoneCustomModel(
  rows: {
    adtRows: AdtRow[];
    trafficFlowRows: TrafficFlowRow[];
  },
  avoid: RouteAvoidState,
  baselineRoutes: OsrmRoute[],
): GraphHopperCustomModel | undefined {
  const features: GraphHopperAreaFeature[] = [];
  const priority: GraphHopperRule[] = [];
  const baselineRoute = baselineRoutes[0];
  const baselineOriginLat = baselineRoute ? routeOriginLat(baselineRoute) : 60;
  const baselineLine = baselineRoute ? routeMatchLine(baselineRoute) : [];

  if (avoid.trafficIntensity) {
    const adtRows = [...rows.adtRows]
      .filter((row) => adtIntensityScore(row.adt_total) >= 0.55)
      .filter((row) => !baselineRoute || adtRowNearLine(baselineLine, row, baselineOriginLat))
      .sort((a, b) => adtIntensityScore(b.adt_total) - adtIntensityScore(a.adt_total))
      .slice(0, TRAFFIC_INTENSITY_ADT_PENALTY_CANDIDATE_LIMIT)
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
      .filter((row) => !baselineRoute || trafficFlowRowNearLine(baselineLine, row, baselineOriginLat))
      .sort((a, b) => trafficFlowIntensityScore(b) - trafficFlowIntensityScore(a))
      .slice(0, TRAFFIC_INTENSITY_FLOW_PENALTY_CANDIDATE_LIMIT)
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
  const penaltyModel = buildPenaltyZoneCustomModel(penaltyRows, avoid, baselineRoutes);
  return mergeCustomModels(
    avoid.highSpeed ? calmRouteCustomModel : undefined,
    avoid.bridges ? avoidBridgeCustomModel : undefined,
    avoid.tunnels ? avoidTunnelCustomModel : undefined,
    avoid.cityTraffic ? buildCityTrafficCustomModel(baselineRoutes) : undefined,
    penaltyModel,
  );
}

type RouteScoreResult = Pick<RouteLine, "avoidScores" | "exposure" | "annotations">;

async function scoreRouteAlternatives(routes: OsrmRoute[], avoid: RouteAvoidState): Promise<RouteScoreResult[]> {
  const baseScores = routes.map((route) => {
    const bridges = roadEnvironmentExposure(route, "BRIDGE");
    const tunnels = roadEnvironmentExposure(route, "TUNNEL");
    const cityTraffic = scoreCityTraffic(route);
    const annotations = emptyRouteAnnotations();
    annotations.cityTraffic = avoid.cityTraffic ? cityTrafficSegments(route) : [];
    annotations.bridges = roadEnvironmentSegments(route, "BRIDGE", "bridges");
    annotations.tunnels = roadEnvironmentSegments(route, "TUNNEL", "tunnels");
    return {
      avoidScores: {
        highSpeed: null,
        trafficIntensity: null,
        cityTraffic: cityTraffic.score,
        bridges: bridges.score,
        tunnels: tunnels.score,
      },
      exposure: {
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        cityTrafficMeters: cityTraffic.exposure,
        disturbances: null,
        liveAccidents: null,
        bridgeMeters: bridges.exposure,
        tunnelMeters: tunnels.exposure,
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
        highSpeed: null,
        trafficIntensity: null,
        cityTraffic: null,
        bridges: null,
        tunnels: null,
      },
      exposure: {
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        cityTrafficMeters: null,
        disturbances: null,
        liveAccidents: null,
        bridgeMeters: null,
        tunnelMeters: null,
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
    const activeSince = new Date(Date.now() - LIVE_EVENT_THRESHOLD_MS).toISOString();
    const trafficFlowActiveSince = new Date(Date.now() - TRAFFIC_FLOW_ACTIVE_WINDOW_MS).toISOString();
    const eventsRequest = bboxArea(bbox) <= 80
      ? (async () => {
          const result = await client.rpc("events_in_bbox", {
            ...params,
            p_since: null,
            p_live_since: activeSince,
          });
          if (!result.error || !isMissingPostgrestFunctionError(result.error, "events_in_bbox")) {
            return result;
          }
          return client
            .from("events_public")
            .select("id, lng, lat")
            .gte("last_seen", activeSince)
            .gte("lng", bbox.minLng)
            .lte("lng", bbox.maxLng)
            .gte("lat", bbox.minLat)
            .lte("lat", bbox.maxLat)
            .limit(500);
        })()
      : Promise.resolve({ data: [], error: null });
    const [largeRoadsResult, disturbancesResult, eventsResult, adtResult, trafficFlowResult] = await Promise.all([
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
      eventsRequest,
      avoid.trafficIntensity && bboxArea(bbox) <= 80
        ? client.rpc("adt_in_bbox", params).limit(TRAFFIC_INTENSITY_ADT_RPC_LIMIT)
        : Promise.resolve({ data: [], error: null }),
      avoid.trafficIntensity && bboxArea(bbox) <= 30
        ? client.rpc("traffic_flow_segments_in_bbox", {
            ...params,
            active_since: trafficFlowActiveSince,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

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
      const highSpeed = scoreHighSpeed(route, largeRoadRows);
      const trafficIntensity = avoid.trafficIntensity
        ? scoreTrafficIntensity(route, adtRows, trafficFlowRows)
        : { score: null, exposure: null };
      const cityTraffic = scoreCityTraffic(route);
      const disturbances = scoreDisturbances(route, disturbanceRows);
      const bridges = roadEnvironmentExposure(route, "BRIDGE");
      const tunnels = roadEnvironmentExposure(route, "TUNNEL");
      const accidentPoints = liveAccidentPoints(route, eventRows);
      const annotations = emptyRouteAnnotations();
      annotations.highSpeed = highSpeedSegments(route, largeRoadRows);
      annotations.trafficIntensity = avoid.trafficIntensity
        ? trafficIntensitySegments(route, adtRows, trafficFlowRows)
        : [];
      annotations.cityTraffic = avoid.cityTraffic ? cityTrafficSegments(route) : [];
      annotations.bridges = roadEnvironmentSegments(route, "BRIDGE", "bridges");
      annotations.tunnels = roadEnvironmentSegments(route, "TUNNEL", "tunnels");
      annotations.disturbances = disturbancePoints(route, disturbanceRows);
      annotations.liveAccidents = accidentPoints;
      return {
        avoidScores: {
          highSpeed: highSpeed.score,
          trafficIntensity: trafficIntensity.score,
          cityTraffic: cityTraffic.score,
          bridges: bridges.score,
          tunnels: tunnels.score,
        },
        exposure: {
          highSpeedMeters: highSpeed.exposure,
          trafficIntensityMeters: trafficIntensity.exposure,
          cityTrafficMeters: cityTraffic.exposure,
          disturbances: disturbances.exposure,
          liveAccidents: accidentPoints.length,
          bridgeMeters: bridges.exposure,
          tunnelMeters: tunnels.exposure,
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OSRM_ROUTE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("route provider timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
    includeCityTrafficDetails?: boolean;
    alternativeRoutes?: number;
    maxWeightFactor?: number;
    maxShareFactor?: number;
    timeoutMs?: number;
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
    details: opts.includeCityTrafficDetails
      ? ["road_environment", "max_speed", "road_class"]
      : ["road_environment", "max_speed"],
  };

  if (opts.customModel) {
    body["ch.disable"] = true;
    body.custom_model = opts.customModel;
  }

  if (opts.alternativeRoutes && opts.alternativeRoutes > 1) {
    body.algorithm = "alternative_route";
    body["alternative_route.max_paths"] = Math.max(2, Math.min(8, opts.alternativeRoutes));
    body["alternative_route.max_weight_factor"] = opts.maxWeightFactor ?? 1.45;
    body["alternative_route.max_share_factor"] = opts.maxShareFactor
      ?? (opts.maxWeightFactor && opts.maxWeightFactor > 2.5 ? 0.82 : 0.65);
  }

  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (GRAPHHOPPER_TOKEN) headers["X-Routing-Token"] = GRAPHHOPPER_TOKEN;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? GRAPHHOPPER_ROUTE_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("route provider timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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
    roadClassDetails: path.details?.road_class,
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
    const routes = await fetchOsrmRoutes(coordinates, activeOptions.length > 0 ? alternatives : 0);
    return {
      provider: "osrm",
      routes,
      telemetry: emptyRouteFetchTelemetry(true, {
        providerRequestCount: 1,
        providerRouteCount: routes.length,
        routeCountBeforeBudget: routes.length,
        budgetedRouteCount: routes.length,
        returnedRouteCount: routes.length,
      }),
    };
  }

  let fastestRoutes: OsrmRoute[];
  try {
    fastestRoutes = await fetchGraphHopperRoute(coordinates, {
      source: "fastest",
      includeCityTrafficDetails: avoid.cityTraffic,
    });
  } catch (err) {
    if (!avoid.cityTraffic) throw err;
    console.warn("graphhopper city traffic details unavailable for fastest route", err);
    fastestRoutes = await fetchGraphHopperRoute(coordinates, { source: "fastest" });
  }
  const baseline = fastestRoutes[0];
  if (!baseline) {
    return {
      provider: "graphhopper",
      routes: fastestRoutes,
      telemetry: emptyRouteFetchTelemetry(false, {
        providerRequestCount: 1,
        graphHopperRequestCount: 1,
        graphHopperFulfilledCount: 1,
        providerRouteCount: fastestRoutes.length,
        routeCountBeforeBudget: fastestRoutes.length,
        budgetedRouteCount: fastestRoutes.length,
        returnedRouteCount: fastestRoutes.length,
      }),
    };
  }
  const maxWeightFactor = graphHopperMaxWeightFactor(baseline, maxExtraMinutes);
  if (activeOptions.length === 0) {
    const noFilterRequests = alternatives > 0
      ? [
          fetchGraphHopperRoute(coordinates, {
            source: "fastest-alternatives",
            alternativeRoutes: Math.max(3, alternatives + 2),
            maxWeightFactor: Math.max(1.8, maxWeightFactor),
          }),
        ]
      : [];
    const noFilterResults = await Promise.allSettled(noFilterRequests);
    const noFilterRoutes = dedupeRoutes([
      ...fastestRoutes,
      ...noFilterResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ]).sort((a, b) => {
      if (a.duration !== b.duration) return a.duration - b.duration;
      return a.distance - b.distance;
    });

    return {
      provider: "graphhopper",
      routes: noFilterRoutes.slice(0, 1),
      telemetry: emptyRouteFetchTelemetry(false, {
        providerRequestCount: 1 + noFilterRequests.length,
        graphHopperRequestCount: 1 + noFilterRequests.length,
        graphHopperFulfilledCount: 1 + noFilterResults.filter((result) => result.status === "fulfilled").length,
        graphHopperRejectedCount: noFilterResults.filter((result) => result.status === "rejected").length,
        graphHopperTimeoutCount: countRejectedTimeouts(noFilterResults),
        genericRequestCount: noFilterRequests.length,
        providerRouteCount: noFilterRoutes.length,
        routeCountBeforeBudget: noFilterRoutes.length,
        budgetedRouteCount: noFilterRoutes.length,
        returnedRouteCount: Math.min(1, noFilterRoutes.length),
      }),
    };
  }

  const trafficIntensityActive = avoid.trafficIntensity;
  const includeCityTrafficDetails = avoid.cityTraffic;
  const highSpeedOnly =
    avoid.highSpeed &&
    !avoid.trafficIntensity &&
    !avoid.cityTraffic &&
    !avoid.bridges &&
    !avoid.tunnels;
  const longHighSpeedSearch = avoid.highSpeed && baseline.distance >= 60_000;
  const pathCount = trafficIntensityActive
    ? Math.max(2, Math.min(3, alternatives + 1))
    : maxExtraMinutes === null
      ? Math.max(4, alternatives + (highSpeedOnly ? 2 : 4))
      : alternatives + 1;
  const alternativeMaxWeightFactor = trafficIntensityActive
    ? Math.min(maxWeightFactor, 1.9)
    : maxWeightFactor;
  const genericAlternativeRequests: Array<Promise<OsrmRoute[]>> = [];

  genericAlternativeRequests.push(
    fetchGraphHopperRoute(coordinates, {
      source: "fastest-alternatives",
      includeCityTrafficDetails,
      alternativeRoutes: pathCount,
      maxWeightFactor: alternativeMaxWeightFactor,
      timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
    }),
  );

  const skipCombinedTrafficPreference =
    avoid.highSpeed &&
    avoid.trafficIntensity &&
    !avoid.cityTraffic &&
    !avoid.bridges &&
    !avoid.tunnels;

  const preferenceModel = activeOptions.length > 0 && !skipCombinedTrafficPreference
    ? await buildRoutePreferenceCustomModel(fastestRoutes, avoid)
    : undefined;
  const preferenceRequests: Array<Promise<OsrmRoute[]>> = [];

  if (preferenceModel) {
    const source = [
      avoid.highSpeed ? "high-speed" : null,
      avoid.trafficIntensity ? "traffic-intensity" : null,
      avoid.cityTraffic ? "city-traffic" : null,
      avoid.bridges ? "bridges" : null,
      avoid.tunnels ? "tunnels" : null,
    ].filter(Boolean).join("-");

    preferenceRequests.push(
      fetchGraphHopperRoute(coordinates, {
        source: `avoid-${source}`,
        customModel: preferenceModel,
        includeCityTrafficDetails: avoid.cityTraffic,
        timeoutMs: avoid.trafficIntensity ? GRAPHHOPPER_TRAFFIC_INTENSITY_TIMEOUT_MS : undefined,
      }),
    );

    if (!avoid.trafficIntensity) {
      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: `avoid-${source}-alternatives`,
          customModel: preferenceModel,
          includeCityTrafficDetails: avoid.cityTraffic,
          alternativeRoutes: highSpeedOnly ? Math.max(5, alternatives + 3) : pathCount,
          maxWeightFactor: highSpeedOnly
            ? Math.max(alternativeMaxWeightFactor, 2.8)
            : alternativeMaxWeightFactor,
          maxShareFactor: highSpeedOnly ? 0.65 : undefined,
          timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
        }),
      );
    }
  }

  if (longHighSpeedSearch && !highSpeedOnly) {
    preferenceRequests.push(
      fetchGraphHopperRoute(coordinates, {
        source: "avoid-high-speed-backbone-alternatives",
        customModel: calmRouteCustomModel,
        includeCityTrafficDetails,
        alternativeRoutes: Math.max(5, alternatives + 3),
        maxWeightFactor: Math.max(alternativeMaxWeightFactor, 2.8),
        maxShareFactor: 0.65,
        timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
      }),
    );
  }

  if (avoid.highSpeed) {
    const balancedModel = mergeCustomModels(
      balancedCalmRouteCustomModel,
      avoid.bridges ? avoidBridgeCustomModel : undefined,
      avoid.tunnels ? avoidTunnelCustomModel : undefined,
    );

    if (balancedModel) {
      const balancedPathCount = maxExtraMinutes === null
        ? Math.max(3, alternatives + 1)
        : Math.max(3, alternatives + 1);
      const balancedRequests = [
        fetchGraphHopperRoute(coordinates, {
          source: "avoid-high-speed-balanced",
          customModel: balancedModel,
          includeCityTrafficDetails,
        }),
      ];
      if (!trafficIntensityActive) {
        balancedRequests.push(
          fetchGraphHopperRoute(coordinates, {
            source: "avoid-high-speed-balanced-alternatives",
            customModel: balancedModel,
            includeCityTrafficDetails,
            alternativeRoutes: balancedPathCount,
            maxWeightFactor: alternativeMaxWeightFactor,
            timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
          }),
        );
      }

      preferenceRequests.push(...balancedRequests);
    }
  }

  const activeCoreOptions = (["highSpeed", "trafficIntensity", "bridges", "tunnels"] as const)
    .filter((option) => avoid[option]);
  if (activeCoreOptions.length > 1) {
    for (const option of activeCoreOptions) {
      const singleAvoid = routeAvoidStateForOption(option);
      const singlePreferenceModel = await buildRoutePreferenceCustomModel(fastestRoutes, singleAvoid);
      if (!singlePreferenceModel) continue;

      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: `avoid-primary-${option}`,
          customModel: singlePreferenceModel,
          includeCityTrafficDetails,
          timeoutMs: option === "trafficIntensity" ? GRAPHHOPPER_TRAFFIC_INTENSITY_TIMEOUT_MS : undefined,
        }),
      );

      if (option !== "trafficIntensity" && !trafficIntensityActive) {
        const singlePathCount = maxExtraMinutes === null
          ? Math.max(3, alternatives + 1)
          : Math.max(3, alternatives + 1);
        preferenceRequests.push(
          fetchGraphHopperRoute(coordinates, {
            source: `avoid-primary-${option}-alternatives`,
            customModel: singlePreferenceModel,
            includeCityTrafficDetails,
            alternativeRoutes: singlePathCount,
            maxWeightFactor: alternativeMaxWeightFactor,
            timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
          }),
        );
      }
    }
  }

  // Plain highSpeed+traffic already gets a high-speed backbone plus a separate
  // traffic candidate above. Only add this combined balance candidate when
  // bridge/tunnel filters also need to travel with the high-speed model.
  if (avoid.highSpeed && avoid.trafficIntensity && (avoid.bridges || avoid.tunnels)) {
    const highSpeedBalanceModel = mergeCustomModels(
      calmRouteCustomModel,
      avoid.bridges ? avoidBridgeCustomModel : undefined,
      avoid.tunnels ? avoidTunnelCustomModel : undefined,
    );

    if (highSpeedBalanceModel) {
      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: "avoid-high-speed-balance",
          customModel: highSpeedBalanceModel,
          includeCityTrafficDetails,
        }),
      );
    }
  }

  const [preferenceResults, genericAlternativeResults] = await Promise.all([
    Promise.allSettled(preferenceRequests),
    Promise.allSettled(genericAlternativeRequests),
  ]);
  const initialProviderRoutes = [
    ...fastestRoutes,
    ...preferenceResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ...genericAlternativeResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  ];
  const highSpeedViaRequests: Array<Promise<OsrmRoute[]>> = [];

  if (longHighSpeedSearch && coordinates.length === 2) {
    const lowSpeedReferenceRoutes = initialProviderRoutes
      .filter((route) => routeHighSpeedExposureForSelection(route) <= ROUTE_HIGH_SPEED_CALM_WINDOW_METERS);
    const viaSourceRoutes = dedupeRoutes(initialProviderRoutes)
      .filter((route) => routeHighSpeedExposureForSelection(route) > ROUTE_HIGH_SPEED_CALM_WINDOW_METERS)
      .sort((a, b) => {
        const durationDiff = compareFastestRoutes(a, b);
        if (durationDiff !== 0) return durationDiff;
        return compareHighSpeedAvoidanceRoutes(a, b);
      });
    const start = coordinates[0];
    const end = coordinates.at(-1);
    if (start && end) {
      const viaPoints = selectHighSpeedViaPoints(viaSourceRoutes, lowSpeedReferenceRoutes);
      highSpeedViaRequests.push(
        ...viaPoints.map((viaPoint, index) => (
          fetchGraphHopperRoute([start, viaPoint, end], {
            source: `avoid-high-speed-via-${index + 1}`,
            customModel: calmRouteCustomModel,
            includeCityTrafficDetails,
            timeoutMs: GRAPHHOPPER_ROUTE_TIMEOUT_MS,
          })
        )),
      );
    }
  }

  const highSpeedViaResults = await Promise.allSettled(highSpeedViaRequests);
  const providerRoutes = [
    ...initialProviderRoutes,
    ...highSpeedViaResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  ];
  const hybridRoutes = buildHybridRoutes(providerRoutes, activeOptions);
  const routes = [
    ...providerRoutes,
    ...hybridRoutes,
  ];

  if (!routes.length) {
    const reason = [...preferenceResults, ...genericAlternativeResults]
      .find((result) => result.status === "rejected")?.reason;
    throw reason instanceof Error ? reason : new Error("route provider failed");
  }

  const presentationRoutes = dedupeRoutesForPresentation(dedupeRoutes(routes), activeOptions);
  const budgetedRoutes = presentationRoutes.filter((route, index) => {
    if (index === 0) return true;
    return isRouteWithinMaxExtra(route, baseline, maxExtraMinutes);
  });
  const fastestBudgetedRoute = [...budgetedRoutes].sort((a, b) => {
    if (a.duration !== b.duration) return a.duration - b.duration;
    return a.distance - b.distance;
  })[0];
  const orderedBudgetedRoutes = fastestBudgetedRoute
    ? [
        fastestBudgetedRoute,
        ...budgetedRoutes.filter((route) => route !== fastestBudgetedRoute),
      ]
    : budgetedRoutes;
  const limit = activeOptions.length > 0
    ? trafficIntensityActive
      ? avoid.highSpeed
        ? Math.max(7, alternatives + 4)
        : Math.max(5, alternatives + 2)
      : maxExtraMinutes === null
        ? Math.max(10, alternatives + 7)
        : Math.max(4, alternatives + 3)
    : 1;
  const returnedRoutes = avoid.highSpeed
    ? selectHighSpeedRoutesForReturn(orderedBudgetedRoutes, limit, activeOptions)
    : orderedBudgetedRoutes.slice(0, limit);
  const settledResults = [...preferenceResults, ...genericAlternativeResults, ...highSpeedViaResults];
  return {
    provider: "graphhopper",
    routes: returnedRoutes,
    telemetry: emptyRouteFetchTelemetry(false, {
      providerRequestCount: 1 + preferenceRequests.length + genericAlternativeRequests.length + highSpeedViaRequests.length,
      graphHopperRequestCount: 1 + preferenceRequests.length + genericAlternativeRequests.length + highSpeedViaRequests.length,
      graphHopperFulfilledCount: 1 + settledResults.filter((result) => result.status === "fulfilled").length,
      graphHopperRejectedCount: settledResults.filter((result) => result.status === "rejected").length,
      graphHopperTimeoutCount: countRejectedTimeouts(settledResults),
      genericRequestCount: genericAlternativeRequests.length,
      preferenceRequestCount: preferenceRequests.length + highSpeedViaRequests.length,
      providerRouteCount: providerRoutes.length,
      hybridRouteCount: hybridRoutes.length,
      routeCountBeforeBudget: routes.length,
      budgetedRouteCount: orderedBudgetedRoutes.length,
      returnedRouteCount: returnedRoutes.length,
    }),
  };
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
  const startedAt = Date.now();
  const logBase = routeLogPayloadBase({
    avoid,
    alternatives,
    coordinateCount: coordinates.length,
    maxExtraMinutes,
    preview,
  });

  try {
    const timeoutMs = routeRequestTimeoutMs(preview, alternatives, avoid);
    const result = await withRouteDeadline((async () => {
      const providerStartedAt = Date.now();
      const routeResult = preview
        ? await fetchProviderRoutes(coordinates, 0, noAvoids, null)
        : alternatives === 0
          ? await fetchProviderRoutes(coordinates, 0, noAvoids, null)
          : await fetchProviderRoutes(coordinates, alternatives, avoid, maxExtraMinutes);
      const providerMs = Date.now() - providerStartedAt;
      const providerRoutes = routeResult.routes;
      const scoringStartedAt = Date.now();
      const scores = preview ? [] : await scoreRouteAlternatives(providerRoutes, avoid);
      const scoringMs = Date.now() - scoringStartedAt;
      const routes: RouteLine[] = providerRoutes.map((route, index) => ({
        id: `route-${index + 1}`,
        source: preview ? "preview" : route.source ?? `candidate-${index + 1}`,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: route.geometry,
        safetyScore: null,
        avoidScores: scores[index]?.avoidScores ?? {
          highSpeed: null,
          trafficIntensity: null,
          cityTraffic: null,
          bridges: null,
          tunnels: null,
        },
        exposure: scores[index]?.exposure ?? {
          highSpeedMeters: null,
          trafficIntensityMeters: null,
          cityTrafficMeters: null,
          disturbances: null,
          liveAccidents: null,
          bridgeMeters: null,
          tunnelMeters: null,
        },
        annotations: scores[index]?.annotations ?? emptyRouteAnnotations(),
      }));

      return {
        response: { routes, avoid, maxExtraMinutes, provider: routeResult.provider },
        providerMs,
        scoringMs,
        telemetry: routeResult.telemetry,
      };
    })(), timeoutMs);

    console.info("route observability", {
      ...logBase,
      status: "ok",
      provider: result.response.provider,
      totalMs: Date.now() - startedAt,
      providerMs: result.providerMs,
      scoringMs: result.scoringMs,
      timeoutMs,
      routesReturned: result.response.routes.length,
      ...result.telemetry,
    });

    return jsonResponse(result.response, { cacheSeconds: 60 });
  } catch (err) {
    console.error("routing failed", err);
    console.warn("route observability", {
      ...logBase,
      status: isRouteTimeoutError(err) ? "timeout" : "error",
      totalMs: Date.now() - startedAt,
      timeout: isRouteTimeoutError(err),
    });
    if (isRouteTimeoutError(err)) {
      return jsonResponse({ error: routeTimeoutMessage() }, { status: 504 });
    }
    return jsonResponse({ error: "routing failed" }, { status: 502 });
  }
}
