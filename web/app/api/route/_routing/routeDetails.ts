import type { RouteAvoidOption } from "@/lib/routeTypes";
import { CITY_TRAFFIC_AREAS, CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD } from "./customModels";
import { distanceBetweenCoordinatesMeters, routeOriginLat } from "./geometry";
import type { CityTrafficArea, OsrmRoute } from "./types";

export type RouteDetailProperty = "maxSpeedDetails" | "roadEnvironmentDetails" | "roadClassDetails";

const ROUTE_GENERATED_SPUR_MAX_SAMPLES = 180;
const ROUTE_GENERATED_SPUR_MIN_LOOP_METERS = 1_200;
const ROUTE_GENERATED_SPUR_MAX_LOOP_METERS = 24_000;
const ROUTE_GENERATED_SPUR_MAX_REJOIN_METERS = 300;
const ROUTE_GENERATED_SPUR_MIN_RATIO = 7;
const ROUTE_GENERATED_SPUR_ENDPOINT_BUFFER_METERS = 1_200;

export function routeCumulativeDistances(route: OsrmRoute): number[] {
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

export function routeGeneratedByForcedCorridor(route: OsrmRoute): boolean {
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

export function routeHasOutAndBackSpur(route: OsrmRoute): boolean {
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

export function routeDetailValueForSegment(
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

export function speedLimitFromDetail(value: string | number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const speed = Number(match[0]);
  return Number.isFinite(speed) ? speed : null;
}

export function routeSegmentSpeedLimit(route: OsrmRoute, segmentIndex: number): number | null {
  const details = route.maxSpeedDetails;
  if (!details) return null;

  for (const [fromIndex, toIndex, value] of details) {
    if (segmentIndex >= Math.floor(fromIndex) && segmentIndex < Math.ceil(toIndex)) {
      return speedLimitFromDetail(value);
    }
  }

  return null;
}

export function routeDetailExposureMeters(
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

export function routeHighSpeedDetailExposureMeters(route: OsrmRoute): number | null {
  return routeDetailExposureMeters(route, "maxSpeedDetails", (value) => {
    const speed = speedLimitFromDetail(value);
    return speed !== null && speed >= 90;
  });
}

export function routeEnvironmentDetailExposureMeters(
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

export function cityTrafficFactorForSegment(route: OsrmRoute, segmentIndex: number): number {
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

export function routeCityTrafficDetailExposureMeters(route: OsrmRoute): number | null {
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

export function routeAvoidDetailSortCost(route: OsrmRoute, activeOptions: RouteAvoidOption[]): number {
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
