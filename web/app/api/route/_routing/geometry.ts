import type { Bbox } from "./types";
import { MAX_SWEDEN_LAT, MAX_SWEDEN_LNG, MIN_SWEDEN_LAT, MIN_SWEDEN_LNG } from "./request";

const TRAFFIC_INTENSITY_ROUTE_MATCH_MAX_POINTS = 520;

type RouteGeometry = {
  geometry: GeoJSON.LineString;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function project([lng, lat]: GeoJSON.Position, originLat: number): [number, number] {
  const x = (lng ?? 0) * 111_320 * Math.cos((originLat * Math.PI) / 180);
  const y = (lat ?? 0) * 110_540;
  return [x, y];
}

export function distancePointToSegmentMeters(
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

export function distancePointToLineMeters(
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

export function distanceBetweenCoordinatesMeters(
  start: GeoJSON.Position,
  end: GeoJSON.Position,
  originLat: number,
): number {
  const [ax, ay] = project(start, originLat);
  const [bx, by] = project(end, originLat);
  return Math.hypot(bx - ax, by - ay);
}

export function sampleLineMax(line: GeoJSON.Position[], maxPoints: number): GeoJSON.Position[] {
  if (line.length <= maxPoints) return line;
  const step = Math.max(1, Math.floor(line.length / maxPoints));
  const sampled = line.filter((_, index) => index % step === 0);
  const last = line.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

export function sampleLine(line: GeoJSON.Position[]): GeoJSON.Position[] {
  return sampleLineMax(line, 24);
}

export function routeMatchLine(route: RouteGeometry): GeoJSON.Position[] {
  return sampleLineMax(route.geometry.coordinates, TRAFFIC_INTENSITY_ROUTE_MATCH_MAX_POINTS);
}

export function routeBbox(routes: RouteGeometry[], padding = 0.025): Bbox | null {
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

export function bboxArea(bbox: Bbox): number {
  return (bbox.maxLng - bbox.minLng) * (bbox.maxLat - bbox.minLat);
}

export function capSamples(samples: GeoJSON.Position[], maxSamples: number): GeoJSON.Position[] {
  if (samples.length <= maxSamples) return samples;
  const step = samples.length / maxSamples;
  const capped: GeoJSON.Position[] = [];
  for (let index = 0; index < maxSamples; index += 1) {
    const sample = samples[Math.floor(index * step)];
    if (sample) capped.push(sample);
  }
  return capped;
}

export function flattenLineString(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): GeoJSON.Position[][] {
  return geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];
}

export function lineLengthMeters(line: GeoJSON.Position[], originLat: number): number {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    if (!start || !end) continue;
    meters += distanceBetweenCoordinatesMeters(start, end, originLat);
  }
  return meters;
}

export function geometryLengthMeters(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  originLat: number,
): number {
  return flattenLineString(geometry).reduce((sum, line) => sum + lineLengthMeters(line, originLat), 0);
}

export function midpoint(line: GeoJSON.Position[]): GeoJSON.Position | null {
  if (!line.length) return null;
  return line[Math.floor(line.length / 2)] ?? null;
}

export function routeOriginLat(route: RouteGeometry): number {
  const coords = route.geometry.coordinates;
  if (!coords.length) return 60;
  return coords.reduce((sum, coord) => sum + (coord[1] ?? 60), 0) / coords.length;
}

export function toLngLat(coord: GeoJSON.Position | undefined): [number, number] | null {
  if (!coord) return null;
  const [lng, lat] = coord;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}
