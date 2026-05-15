import type { RouteAvoidOption } from "@/lib/routeTypes";
import {
  distancePointToLineMeters,
  routeMatchLine,
  routeOriginLat,
  sampleLineMax,
} from "./geometry";
import {
  routeAvoidDetailSortCost,
  routeCityTrafficDetailExposureMeters,
  routeEnvironmentDetailExposureMeters,
  routeHighSpeedDetailExposureMeters,
  routeMultilaneDetailExposureMeters,
} from "./routeDetails";
import type { OsrmRoute } from "./types";

const ROUTE_SEMANTIC_DUPLICATE_HIGH_SPEED_DIFF_METERS = 700;
const ROUTE_SEMANTIC_DUPLICATE_ENVIRONMENT_DIFF_METERS = 120;
const ROUTE_SEMANTIC_DUPLICATE_MULTILANE_DIFF_METERS = 700;
const ROUTE_PRESENTATION_DUPLICATE_DISTANCE_METERS = 2_500;
const ROUTE_PRESENTATION_DUPLICATE_SAMPLE_DISTANCE_METERS = 180;
const ROUTE_PRESENTATION_DUPLICATE_SHARE = 0.9;
const ROUTE_PRESENTATION_CONTAINED_MAX_EXTRA_METERS = 22_000;
const ROUTE_PRESENTATION_CONTAINED_SHORTER_SHARE = 0.92;
const ROUTE_PRESENTATION_CONTAINED_LONGER_SHARE = 0.72;

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

export function routesAreNearDuplicates(a: OsrmRoute, b: OsrmRoute): boolean {
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
    ) ||
    exposureDiffAboveThreshold(
      routeMultilaneDetailExposureMeters(a),
      routeMultilaneDetailExposureMeters(b),
      ROUTE_SEMANTIC_DUPLICATE_MULTILANE_DIFF_METERS,
    )
  );
}

export function dedupeRoutes(routes: OsrmRoute[]): OsrmRoute[] {
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

export function dedupeRoutesForPresentation(
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
