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
    disturbances: number | null;
  };
  exposure: {
    accidentHistory: number | null;
    highSpeedMeters: number | null;
    disturbances: number | null;
  };
};

type RouteAvoidOption = keyof RouteLine["avoidScores"];

type RouteAvoidState = Record<RouteAvoidOption, boolean>;

type OsrmRoute = {
  source?: string;
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
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
};

type GraphHopperResponse = {
  message?: string;
  paths?: GraphHopperPath[];
};

type RouteRequest = {
  coordinates?: unknown;
  alternatives?: unknown;
  avoid?: unknown;
  maxExtraMinutes?: unknown;
};

type RiskRow = {
  fid: number;
  risk_per_milj_fordon: number;
  geometry: GeoJSON.LineString;
};

type LargeRoadRow = {
  fid: number;
  speed_limit: number | null;
  length_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

type DisturbanceRow = {
  id: string;
  lng: number;
  lat: number;
  message_type: string | null;
};

type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

const calmRouteCustomModel = {
  priority: [
    { if: "road_class == MOTORWAY", multiply_by: "0.15" },
    { if: "road_class == TRUNK", multiply_by: "0.35" },
    { if: "max_speed >= 90", multiply_by: "0.35" },
    { if: "max_speed >= 80", multiply_by: "0.7" },
  ],
};

const routeAvoidOptions = ["accidentHistory", "highSpeed", "disturbances"] as const;

const noAvoids: RouteAvoidState = {
  accidentHistory: false,
  highSpeed: false,
  disturbances: false,
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
    disturbances: input.disturbances === true,
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

function bboxArea(bbox: Bbox): number {
  return (bbox.maxLng - bbox.minLng) * (bbox.maxLat - bbox.minLat);
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

function midpoint(line: GeoJSON.Position[]): GeoJSON.Position | null {
  if (!line.length) return null;
  return line[Math.floor(line.length / 2)] ?? null;
}

function routeOriginLat(route: OsrmRoute): number {
  const coords = route.geometry.coordinates;
  if (!coords.length) return 60;
  return coords.reduce((sum, coord) => sum + (coord[1] ?? 60), 0) / coords.length;
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
    exposure: highSpeedMeters,
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

async function scoreRouteAlternatives(routes: OsrmRoute[]): Promise<Array<Pick<RouteLine, "avoidScores" | "exposure">>> {
  const empty = routes.map(() => ({
    avoidScores: {
      accidentHistory: null,
      highSpeed: null,
      disturbances: null,
    },
    exposure: {
      accidentHistory: null,
      highSpeedMeters: null,
      disturbances: null,
    },
  }));
  if (!supabaseUrl || !supabaseAnon) return empty;

  const bbox = routeBbox(routes);
  if (!bbox || bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) return empty;

  const client = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
  const params = {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  };

  try {
    const activeSince = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const [riskResult, largeRoadsResult, disturbancesResult] = await Promise.all([
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

    return routes.map((route) => {
      const accidentHistory = scoreRisk(route, riskRows);
      const highSpeed = scoreHighSpeed(route, largeRoadRows);
      const disturbances = scoreDisturbances(route, disturbanceRows);
      return {
        avoidScores: {
          accidentHistory: accidentHistory.score,
          highSpeed: highSpeed.score,
          disturbances: disturbances.score,
        },
        exposure: {
          accidentHistory: accidentHistory.exposure,
          highSpeedMeters: highSpeed.exposure,
          disturbances: disturbances.exposure,
        },
      };
    });
  } catch (err) {
    console.warn("route scoring failed", err);
    return empty;
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
    customModel?: typeof calmRouteCustomModel;
    alternativeRoutes?: number;
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
  };

  if (opts.customModel) {
    body["ch.disable"] = true;
    body.custom_model = opts.customModel;
  }

  if (opts.alternativeRoutes && opts.alternativeRoutes > 1) {
    body.algorithm = "alternative_route";
    body["alternative_route.max_paths"] = Math.max(2, Math.min(4, opts.alternativeRoutes));
    body["alternative_route.max_weight_factor"] = 1.45;
    body["alternative_route.max_share_factor"] = 0.65;
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
  }));
}

async function fetchProviderRoutes(
  coordinates: [number, number][],
  alternatives: number,
  avoid: RouteAvoidState,
): Promise<OsrmRoute[]> {
  const activeOptions = activeAvoidOptions(avoid);
  if (!GRAPHHOPPER_BASE_URL) {
    return fetchOsrmRoutes(coordinates, activeOptions.length > 0 ? alternatives : 0);
  }

  const requests: Array<Promise<OsrmRoute[]>> = [
    fetchGraphHopperRoute(coordinates, { source: "fastest" }),
  ];

  if (activeOptions.length > 0) {
    requests.push(
      fetchGraphHopperRoute(coordinates, {
        source: "fastest-alternatives",
        alternativeRoutes: alternatives + 1,
      }),
    );
  }

  if (avoid.highSpeed) {
    requests.push(
      fetchGraphHopperRoute(coordinates, {
        source: "avoid-high-speed",
        customModel: calmRouteCustomModel,
      }),
      fetchGraphHopperRoute(coordinates, {
        source: "avoid-high-speed-alternatives",
        customModel: calmRouteCustomModel,
        alternativeRoutes: alternatives + 1,
      }),
    );
  }

  const results = await Promise.allSettled(requests);
  const routes = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  if (!routes.length) {
    const reason = results.find((result) => result.status === "rejected")?.reason;
    throw reason instanceof Error ? reason : new Error("route provider failed");
  }

  return dedupeRoutes(routes).slice(0, activeOptions.length > 0 ? Math.max(2, alternatives + 1) : 1);
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
  const maxExtraMinutes =
    typeof body.maxExtraMinutes === "number" && Number.isFinite(body.maxExtraMinutes)
      ? Math.max(0, body.maxExtraMinutes)
      : null;

  try {
    const providerRoutes = await fetchProviderRoutes(coordinates, alternatives, avoid);
    const scores = await scoreRouteAlternatives(providerRoutes);
    const routes: RouteLine[] = providerRoutes.map((route, index) => ({
      id: `route-${index + 1}`,
      source: route.source ?? `candidate-${index + 1}`,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
      safetyScore: scores[index]?.avoidScores.accidentHistory ?? null,
      avoidScores: scores[index]?.avoidScores ?? {
        accidentHistory: null,
        highSpeed: null,
        disturbances: null,
      },
      exposure: scores[index]?.exposure ?? {
        accidentHistory: null,
        highSpeedMeters: null,
        disturbances: null,
      },
    }));

    return jsonResponse({ routes, avoid, maxExtraMinutes }, { cacheSeconds: 300 });
  } catch (err) {
    console.error("routing failed", err);
    return jsonResponse({ error: "routing failed" }, { status: 502 });
  }
}
