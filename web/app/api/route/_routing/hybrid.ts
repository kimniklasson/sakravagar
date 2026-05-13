import type { RouteAvoidOption } from "@/lib/routeTypes";
import {
  distanceBetweenCoordinatesMeters,
  distancePointToLineMeters,
  lineLengthMeters,
  routeMatchLine,
  routeOriginLat,
} from "./geometry";
import { dedupeRoutes, routesAreNearDuplicates } from "./dedupe";
import {
  routeAvoidDetailSortCost,
  routeCumulativeDistances,
  routeDetailValueForSegment,
  type RouteDetailProperty,
} from "./routeDetails";
import type { GraphHopperPathDetail, OsrmRoute } from "./types";

const HYBRID_ROUTE_MAX_JOIN_METERS = 6;
const HYBRID_ROUTE_REJOIN_AFTER_SEPARATION_METERS = 320;
const HYBRID_ROUTE_MIN_LEG_METERS = 1_500;
const HYBRID_ROUTE_MAX_SOURCE_ROUTES = 12;
const HYBRID_ROUTE_MAX_SAMPLES_PER_ROUTE = 90;
const HYBRID_ROUTE_MAX_CANDIDATES = 8;
const HYBRID_ROUTE_MAX_DISTANCE_FACTOR = 1.18;
const HYBRID_ROUTE_MAX_REFERENCE_DISTANCE_METERS = 100_000;
const HYBRID_ROUTE_CONNECTOR_SPEED_MPS = 10;

type HybridSegmentSource = {
  route: OsrmRoute;
  segmentIndex: number;
} | null;

type HybridJoin = {
  prefixIndex: number;
  suffixIndex: number;
  distanceMeters: number;
};

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

export function buildHybridRoutes(routes: OsrmRoute[], activeOptions: RouteAvoidOption[]): OsrmRoute[] {
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
