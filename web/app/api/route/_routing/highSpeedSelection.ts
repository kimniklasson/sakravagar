import type { RouteAvoidOption } from "@/lib/routeTypes";
import {
  distanceBetweenCoordinatesMeters,
  distancePointToLineMeters,
  routeMatchLine,
  toLngLat,
} from "./geometry";
import {
  routeCumulativeDistances,
  routeGeneratedByForcedCorridor,
  routeHasOutAndBackSpur,
  routeHighSpeedDetailExposureMeters,
  routeSegmentSpeedLimit,
} from "./routeDetails";
import type { OsrmRoute } from "./types";

export const ROUTE_HIGH_SPEED_CALM_WINDOW_METERS = 6_000;
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

export function routeHighSpeedExposureForSelection(route: OsrmRoute): number {
  return routeHighSpeedDetailExposureMeters(route) ?? route.distance;
}

export function compareHighSpeedAvoidanceRoutes(a: OsrmRoute, b: OsrmRoute): number {
  const exposureA = routeHighSpeedExposureForSelection(a);
  const exposureB = routeHighSpeedExposureForSelection(b);
  if (Math.abs(exposureA - exposureB) > 500) return exposureA - exposureB;
  if (Math.abs(a.duration - b.duration) > 30) return a.duration - b.duration;
  return a.distance - b.distance;
}

export function compareFastestRoutes(a: OsrmRoute, b: OsrmRoute): number {
  if (Math.abs(a.duration - b.duration) > 30) return a.duration - b.duration;
  return a.distance - b.distance;
}

function addRouteForReturn(routes: OsrmRoute[], route: OsrmRoute | undefined): boolean {
  if (!route || routes.includes(route)) return false;
  routes.push(route);
  return true;
}

export function selectHighSpeedRoutesForReturn(
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

export function selectHighSpeedViaPoints(
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
