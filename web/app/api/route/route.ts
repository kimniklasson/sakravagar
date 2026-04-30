import { jsonResponse } from "../_utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org";
const OSRM_PROFILE = process.env.OSRM_PROFILE ?? "driving";

const MIN_SWEDEN_LNG = 9;
const MAX_SWEDEN_LNG = 25;
const MIN_SWEDEN_LAT = 54;
const MAX_SWEDEN_LAT = 70;

export type RouteLine = {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
  safetyScore: number | null;
};

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
};

type OsrmResponse = {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
};

type RouteRequest = {
  coordinates?: unknown;
  alternatives?: unknown;
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

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.error("route provider failed", await res.text());
      return jsonResponse({ error: "route provider failed" }, { status: 502 });
    }

    const osrm = (await res.json()) as OsrmResponse;
    if (osrm.code !== "Ok" || !osrm.routes?.length) {
      return jsonResponse(
        { error: osrm.message ?? "route not found" },
        { status: osrm.code === "NoRoute" ? 404 : 502 },
      );
    }

    const routes: RouteLine[] = osrm.routes.map((route, index) => ({
      id: `route-${index + 1}`,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
      safetyScore: null,
    }));

    return jsonResponse({ routes }, { cacheSeconds: 300 });
  } catch (err) {
    console.error("routing failed", err);
    return jsonResponse({ error: "routing failed" }, { status: 502 });
  }
}
