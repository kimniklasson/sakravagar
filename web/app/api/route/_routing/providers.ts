import type { GraphHopperCustomModel, GraphHopperResponse, OsrmResponse, OsrmRoute } from "./types";

const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
const OSRM_PROFILE = process.env.OSRM_PROFILE ?? "driving";
const GRAPHHOPPER_BASE_URL = process.env.GRAPHHOPPER_BASE_URL;
const GRAPHHOPPER_TOKEN = process.env.GRAPHHOPPER_TOKEN;
const OSRM_ROUTE_TIMEOUT_MS = 15_000;
export const GRAPHHOPPER_ROUTE_TIMEOUT_MS = 15_000;

function providerErrorMessage(label: string, status: number, body: string): string {
  const detail = body.trim().slice(0, 500);
  return detail ? `${label} failed (${status}): ${detail}` : `${label} failed (${status})`;
}

export function hasGraphHopperConfig(): boolean {
  return Boolean(GRAPHHOPPER_BASE_URL);
}

export async function fetchOsrmRoutes(coordinates: [number, number][], alternatives: number): Promise<OsrmRoute[]> {
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
    throw new Error(providerErrorMessage("route provider", res.status, await res.text()));
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

export async function fetchGraphHopperRoute(
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
    throw new Error(providerErrorMessage("graphhopper route provider", res.status, await res.text()));
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
