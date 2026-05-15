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
const GOOGLE_MAPS_MAX_WAYPOINTS = 9;
const GOOGLE_MAPS_MAX_URL_LENGTH = 2_048;

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
  let waypointCount = waypoints.length;
  while (waypointCount > 0) {
    params.set("waypoints", waypoints.slice(0, waypointCount).map(coordinateParam).join("|"));
    const url = `https://www.google.com/maps/dir/?${params.toString()}`;
    if (url.length <= GOOGLE_MAPS_MAX_URL_LENGTH) return url;
    waypointCount -= 1;
  }
  params.delete("waypoints");
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

  return Array.from({ length: GOOGLE_MAPS_MAX_WAYPOINTS }, (_, index) => (
    (index + 1) / (GOOGLE_MAPS_MAX_WAYPOINTS + 1)
  ))
    .map((fraction) => routeCoordinateAtFraction(coordinates, fraction))
    .filter((coord): coord is [number, number] => Boolean(coord))
    .map(roundRouteCoordinate)
    .filter((coord, index, list) => (
      index === 0 ||
      coord[0] !== list[index - 1]?.[0] ||
      coord[1] !== list[index - 1]?.[1]
    ));
}

function routeCoordinateAtFraction(
  coordinates: [number, number][],
  fraction: number,
): [number, number] | null {
  const totalMeters = routeLineLengthMeters(coordinates);
  if (totalMeters <= 0) return null;
  const targetMeters = totalMeters * fraction;
  let traveledMeters = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    if (!start || !end) continue;
    const segmentMeters = routeCoordinateDistanceMeters(start, end);
    if (segmentMeters <= 0) continue;
    if (traveledMeters + segmentMeters >= targetMeters) {
      const segmentFraction = (targetMeters - traveledMeters) / segmentMeters;
      return [
        start[0] + (end[0] - start[0]) * segmentFraction,
        start[1] + (end[1] - start[1]) * segmentFraction,
      ];
    }
    traveledMeters += segmentMeters;
  }

  return coordinates.at(-2) ?? null;
}

function routeLineLengthMeters(coordinates: [number, number][]): number {
  let meters = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    if (!start || !end) continue;
    meters += routeCoordinateDistanceMeters(start, end);
  }
  return meters;
}

function routeCoordinateDistanceMeters(start: [number, number], end: [number, number]): number {
  const originLatRadians = (((start[1] + end[1]) / 2) * Math.PI) / 180;
  const dx = (end[0] - start[0]) * 111_320 * Math.cos(originLatRadians);
  const dy = (end[1] - start[1]) * 110_540;
  return Math.hypot(dx, dy);
}
