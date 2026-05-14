import type { RouteLine } from "@/lib/routeTypes";
import type {
  RouteProvider,
  RouteSharePayload,
  RouteStop,
} from "@/lib/routeShareSchema";
export type { RouteFeedbackVote, RouteSharePayload } from "@/lib/routeShareSchema";
import {
  dedupeRouteCoordinates,
  type RouteAvoidState,
} from "./routeModel";

const SHARED_ROUTE_MAX_COORDINATES = 360;
const SHARED_ROUTE_MAX_ANNOTATION_COORDINATES = 80;
const SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS = 80;
const SHARED_ROUTE_MAX_ANNOTATION_POINTS = 160;

export function routeStateKey(stops: RouteStop[]): string {
  return stops
    .map((stop) => stop.coordinates?.join(",") ?? stop.label.trim().toLowerCase())
    .join("|");
}

export function createRouteSharePayload({
  provider,
  route,
  routeAvoids,
  routeLines,
  stops,
}: {
  provider: RouteProvider | null;
  route: RouteLine;
  routeAvoids: RouteAvoidState;
  routeLines: RouteLine[];
  stops: RouteStop[];
}): RouteSharePayload {
  const routeRank = routeLines.findIndex((candidate) => candidate.id === route.id);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    stops: compactStopsForSnapshot(stops),
    routeAvoids: { ...routeAvoids },
    selectedRoute: compactRouteForSnapshot(route),
    provider,
    selectedRouteRank: routeRank >= 0 ? routeRank : 0,
    presentedRouteCount: routeLines.length,
  };
}

export function buildGoogleMapsDirectionsUrl(route: RouteLine, stops: RouteStop[]): string | null {
  const routeCoordinates = route.geometry.coordinates.filter((coord): coord is [number, number] => (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  ));
  const origin = stops[0]?.coordinates ?? routeCoordinates[0];
  const destination = stops.at(-1)?.coordinates ?? routeCoordinates.at(-1);
  if (!origin || !destination) return null;

  const params = new URLSearchParams({
    api: "1",
    origin: coordinateParam(origin),
    destination: coordinateParam(destination),
    travelmode: "driving",
    dir_action: "navigate",
    utm_source: "sakravagar",
    utm_campaign: "route_card",
  });
  const waypoints = routeGoogleWaypoints(route);
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(coordinateParam).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function roundRouteCoordinate([lng, lat]: [number, number]): [number, number] {
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function compactRouteCoordinates(
  coordinates: GeoJSON.Position[],
  maxCoordinates: number,
): [number, number][] {
  const valid = coordinates.filter((coord): coord is [number, number] => (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  ));

  if (valid.length <= maxCoordinates) return valid.map(roundRouteCoordinate);
  const sampled: [number, number][] = [];
  const step = (valid.length - 1) / (maxCoordinates - 1);
  for (let index = 0; index < maxCoordinates; index += 1) {
    const coord = valid[Math.round(index * step)];
    if (coord) sampled.push(roundRouteCoordinate(coord));
  }
  return dedupeRouteCoordinates(sampled);
}

function compactLineString(
  geometry: GeoJSON.LineString,
  maxCoordinates: number,
): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: compactRouteCoordinates(geometry.coordinates, maxCoordinates),
  };
}

function compactRouteForSnapshot(route: RouteLine): RouteLine {
  return {
    ...route,
    geometry: compactLineString(route.geometry, SHARED_ROUTE_MAX_COORDINATES),
    annotations: {
      highSpeed: (route.annotations.highSpeed ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      trafficIntensity: (route.annotations.trafficIntensity ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      cityTraffic: (route.annotations.cityTraffic ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      bridges: (route.annotations.bridges ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      tunnels: (route.annotations.tunnels ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      largeRoundabouts: (route.annotations.largeRoundabouts ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      multilane: (route.annotations.multilane ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      disturbances: (route.annotations.disturbances ?? []).slice(0, SHARED_ROUTE_MAX_ANNOTATION_POINTS),
      liveAccidents: (route.annotations.liveAccidents ?? []).slice(0, SHARED_ROUTE_MAX_ANNOTATION_POINTS),
    },
  };
}

function compactStopsForSnapshot(stops: RouteStop[]): RouteStop[] {
  return stops.map((stop) => ({
    ...stop,
    coordinates: stop.coordinates ? roundRouteCoordinate(stop.coordinates) : null,
  }));
}

function coordinateParam([lng, lat]: [number, number]): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function routeGoogleWaypoints(route: RouteLine): [number, number][] {
  const coordinates = route.geometry.coordinates.filter((coord): coord is [number, number] => (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  ));
  if (coordinates.length < 5) return [];

  return [0.25, 0.5, 0.75]
    .map((fraction) => coordinates[Math.round((coordinates.length - 1) * fraction)])
    .filter((coord): coord is [number, number] => Boolean(coord))
    .map(roundRouteCoordinate);
}
