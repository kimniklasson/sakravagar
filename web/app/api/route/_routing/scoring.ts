import {
  categoryFromDisturbanceMessageType,
  LIVE_EVENT_THRESHOLD_MS,
} from "@trafik/shared";
import { createServerSupabaseClient } from "@/lib/supabaseServer";
import type {
  RouteAnnotationPoint,
  RouteAnnotationSegment,
  RouteAnnotationSegmentKind,
  RouteAnnotations,
  RouteAvoidState,
  RouteLine,
} from "@/lib/routeTypes";
import { isMissingPostgrestFunctionError } from "../../_utils";
import {
  capSamples,
  distanceBetweenCoordinatesMeters,
  distancePointToLineMeters,
  distancePointToSegmentMeters,
  flattenLineString,
  geometryLengthMeters,
  midpoint,
  bboxArea,
  routeBbox,
  routeMatchLine,
  routeOriginLat,
  sampleLine,
  toLngLat,
} from "./geometry";
import type {
  AdtRow,
  Bbox,
  DisturbanceRow,
  EventRow,
  GraphHopperAreaFeature,
  GraphHopperCustomModel,
  GraphHopperRule,
  LargeRoadRow,
  OsrmRoute,
  RouteRequestContext,
  TrafficFlowRow,
  TrafficIntensityRows,
} from "./types";
import {
  avoidBridgeCustomModel,
  avoidTunnelCustomModel,
  buildCityTrafficCustomModel,
  calmRouteCustomModel,
  CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD,
  linePenaltyArea,
  mergeCustomModels,
} from "./customModels";
import {
  cityTrafficFactorForSegment,
  speedLimitFromDetail,
} from "./routeDetails";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TRAFFIC_INTENSITY_ADT_RPC_LIMIT = 1200;
const TRAFFIC_INTENSITY_ADT_PENALTY_CANDIDATE_LIMIT = 180;
const TRAFFIC_INTENSITY_FLOW_PENALTY_CANDIDATE_LIMIT = 80;
const TRAFFIC_INTENSITY_ADT_PENALTY_MAX_AREAS = 20;
const TRAFFIC_INTENSITY_FLOW_PENALTY_MAX_AREAS = 8;
const TRAFFIC_INTENSITY_PENALTY_PADDING_METERS = 120;
const TRAFFIC_INTENSITY_ANNOTATION_MAX_SAMPLES = 1400;
const PENALTY_ZONE_BBOX_PADDING = 0.08;
const PENALTY_ZONE_MAX_BBOX_AREA = 80;
const TRAFFIC_FLOW_ACTIVE_WINDOW_MS = 45 * 60 * 1000;

const emptyTrafficIntensityRows: TrafficIntensityRows = { adtRows: [], trafficFlowRows: [] };

export function emptyRouteAnnotations(): RouteAnnotations {
  return {
    highSpeed: [],
    trafficIntensity: [],
    cityTraffic: [],
    bridges: [],
    tunnels: [],
    disturbances: [],
    liveAccidents: [],
  };
}

function routeSegmentAnnotationsFromMask(
  route: OsrmRoute,
  kind: RouteAnnotationSegmentKind,
  includeSegment: (segmentIndex: number) => boolean,
): RouteAnnotationSegment[] {
  const coords = route.geometry.coordinates;
  const segments: RouteAnnotationSegment[] = [];
  let current: [number, number][] = [];

  const flush = () => {
    if (current.length >= 2) {
      segments.push({
        kind,
        geometry: { type: "LineString", coordinates: current },
      });
    }
    current = [];
  };

  for (let index = 0; index < coords.length - 1; index += 1) {
    const start = toLngLat(coords[index]);
    const end = toLngLat(coords[index + 1]);
    if (!start || !end || !includeSegment(index)) {
      flush();
      continue;
    }
    if (!current.length) current.push(start);
    current.push(end);
  }
  flush();
  return segments;
}

function roadEnvironmentSegments(
  route: OsrmRoute,
  environment: "BRIDGE" | "TUNNEL",
  kind: RouteAnnotationSegmentKind,
): RouteAnnotationSegment[] {
  const details = route.roadEnvironmentDetails;
  if (!details) return [];

  const included = new Set<number>();
  const coords = route.geometry.coordinates;
  for (const [fromIndex, toIndex, value] of details) {
    if (typeof value !== "string" || value.toUpperCase() !== environment) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));
    for (let index = from + 1; index <= to; index += 1) {
      included.add(index - 1);
    }
  }

  return routeSegmentAnnotationsFromMask(route, kind, (segmentIndex) => included.has(segmentIndex));
}

type RouteMetric = {
  score: number | null;
  exposure: number | null;
};

function highSpeedMetricFromDetails(route: OsrmRoute): RouteMetric | null {
  const details = route.maxSpeedDetails;
  if (!details) return null;

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return { score: 0, exposure: 0 };

  const originLat = routeOriginLat(route);
  let score = 0;
  let meters = 0;

  for (const [fromIndex, toIndex, value] of details) {
    const speed = speedLimitFromDetail(value);
    if (speed === null || speed < 90) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));

    for (let index = from + 1; index <= to; index += 1) {
      const start = coords[index - 1];
      const end = coords[index];
      if (!start || !end) continue;
      const segmentMeters = distanceBetweenCoordinatesMeters(start, end, originLat);
      meters += segmentMeters;
      score += (segmentMeters / 1000) * (1 + (speed - 90) / 20);
    }
  }

  return {
    score: score / Math.max(1, route.distance / 1000),
    exposure: Math.min(meters, route.distance),
  };
}

function highSpeedSegmentsFromDetails(route: OsrmRoute): RouteAnnotationSegment[] | null {
  const details = route.maxSpeedDetails;
  if (!details) return null;

  const coords = route.geometry.coordinates;
  const included = new Set<number>();
  for (const [fromIndex, toIndex, value] of details) {
    const speed = speedLimitFromDetail(value);
    if (speed === null || speed < 90) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));
    for (let index = from + 1; index <= to; index += 1) {
      included.add(index - 1);
    }
  }

  return routeSegmentAnnotationsFromMask(route, "highSpeed", (segmentIndex) => included.has(segmentIndex));
}

function highSpeedSegments(route: OsrmRoute, rows: LargeRoadRow[]): RouteAnnotationSegment[] {
  const detailSegments = highSpeedSegmentsFromDetails(route);
  if (detailSegments) return detailSegments;
  if (!rows.length || route.geometry.coordinates.length < 2) return [];

  const samples: GeoJSON.Position[] = [];
  for (const row of rows) {
    if ((row.speed_limit ?? 0) < 90) continue;
    for (const segment of flattenLineString(row.geometry)) {
      const mid = midpoint(segment);
      if (mid) samples.push(mid);
      samples.push(...sampleLine(segment));
    }
  }
  if (!samples.length) return [];

  const originLat = routeOriginLat(route);
  return routeSegmentAnnotationsFromMask(route, "highSpeed", (segmentIndex) => {
    const start = route.geometry.coordinates[segmentIndex];
    const end = route.geometry.coordinates[segmentIndex + 1];
    if (!start || !end) return false;
    return samples.some((sample) => distancePointToSegmentMeters(sample, start, end, originLat) <= 130);
  });
}

export function scoreCityTraffic(route: OsrmRoute): RouteMetric {
  if (!route.roadClassDetails) return { score: null, exposure: null };

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return { score: 0, exposure: 0 };

  const originLat = routeOriginLat(route);
  let weightedMeters = 0;
  let exposureMeters = 0;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const start = coords[index];
    const end = coords[index + 1];
    if (!start || !end) continue;
    const factor = cityTrafficFactorForSegment(route, index);
    if (factor <= 0) continue;
    const meters = distanceBetweenCoordinatesMeters(start, end, originLat);
    weightedMeters += meters * factor;
    if (factor >= CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD) exposureMeters += meters;
  }

  return {
    score: Math.min(1, weightedMeters / Math.max(1, route.distance)),
    exposure: Math.min(exposureMeters, route.distance),
  };
}

function cityTrafficSegments(route: OsrmRoute): RouteAnnotationSegment[] {
  if (!route.roadClassDetails) return [];
  return routeSegmentAnnotationsFromMask(
    route,
    "cityTraffic",
    (segmentIndex) => cityTrafficFactorForSegment(route, segmentIndex) >= CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD,
  );
}

function disturbancePoints(route: OsrmRoute, rows: DisturbanceRow[]): RouteAnnotationPoint[] {
  if (!rows.length) return [];
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  return rows.flatMap((row) => (
    distancePointToLineMeters([row.lng, row.lat], line, originLat) <= 450
      ? [{
          kind: "disturbances" as const,
          coordinates: [row.lng, row.lat] as [number, number],
          category: categoryFromDisturbanceMessageType(row.message_type),
        }]
      : []
  ));
}

function liveAccidentPoints(route: OsrmRoute, rows: EventRow[]): RouteAnnotationPoint[] {
  if (!rows.length) return [];
  const line = route.geometry.coordinates;
  const originLat = routeOriginLat(route);
  return rows.flatMap((row) => (
    distancePointToLineMeters([row.lng, row.lat], line, originLat) <= 120
      ? [{
          kind: "liveAccidents" as const,
          coordinates: [row.lng, row.lat] as [number, number],
        }]
      : []
  ));
}

function scoreHighSpeed(route: OsrmRoute, rows: LargeRoadRow[]): RouteMetric {
  const detailMetric = highSpeedMetricFromDetails(route);
  if (detailMetric) return detailMetric;

  if (!rows.length) return { score: null, exposure: null };
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
    exposure: Math.min(highSpeedMeters, route.distance),
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

export function adtIntensityScore(adtTotal: number | null): number {
  const adt = Math.max(0, adtTotal ?? 0);
  if (adt < 2_000) return 0;
  if (adt < 5_000) return 0.12;
  if (adt < 10_000) return 0.28;
  if (adt < 20_000) return 0.55;
  if (adt < 40_000) return 0.78;
  if (adt < 60_000) return 0.92;
  return 1;
}

function adtPenaltyMultiplier(row: AdtRow): string {
  const score = adtIntensityScore(row.adt_total);
  if (score >= 0.92) return "0.22";
  if (score >= 0.78) return "0.32";
  if (score >= 0.55) return "0.45";
  return "0.65";
}

function trafficFlowCategory(row: TrafficFlowRow): "calm" | "moving" | "busy" | "slow" {
  const flow = row.vehicle_flow_rate ?? 0;
  const speed = row.average_vehicle_speed;
  if ((typeof speed === "number" && speed < 25) || flow >= 2500) return "slow";
  if ((typeof speed === "number" && speed < 45) || flow >= 1600) return "busy";
  if (flow >= 800) return "moving";
  return "calm";
}

export function trafficFlowIntensityScore(row: TrafficFlowRow): number {
  switch (trafficFlowCategory(row)) {
    case "slow":
      return 0.82;
    case "busy":
      return 0.62;
    case "moving":
      return 0.28;
    case "calm":
      return 0.08;
  }
}

function trafficFlowPenaltyMultiplier(row: TrafficFlowRow): string {
  switch (trafficFlowCategory(row)) {
    case "slow":
      return "0.28";
    case "busy":
      return "0.42";
    case "moving":
      return "0.68";
    case "calm":
      return "0.9";
  }
}

function adtRowNearLine(line: GeoJSON.Position[], row: AdtRow, originLat: number): boolean {
  const mid = midpoint(row.geometry.coordinates);
  const samples = mid ? [...sampleLine(row.geometry.coordinates), mid] : sampleLine(row.geometry.coordinates);
  return samples.some((point) => distancePointToLineMeters(point, line, originLat) <= 95);
}

function trafficFlowRowNearLine(line: GeoJSON.Position[], row: TrafficFlowRow, originLat: number): boolean {
  return flattenLineString(row.geometry).some((segment) => {
    const mid = midpoint(segment);
    const samples = mid ? [...sampleLine(segment), mid] : sampleLine(segment);
    return samples.some((point) => distancePointToLineMeters(point, line, originLat) <= 130);
  });
}

export function scoreTrafficIntensity(
  route: OsrmRoute,
  adtRows: AdtRow[],
  trafficFlowRows: TrafficFlowRow[],
): RouteMetric {
  if (!adtRows.length && !trafficFlowRows.length) return { score: null, exposure: null };

  const originLat = routeOriginLat(route);
  const line = routeMatchLine(route);
  let coveredMeters = 0;
  let weightedMeters = 0;
  let intensiveMeters = 0;

  for (const row of adtRows) {
    if (!adtRowNearLine(line, row, originLat)) continue;
    const meters = Math.max(35, geometryLengthMeters(row.geometry, originLat));
    const intensity = adtIntensityScore(row.adt_total);
    coveredMeters += meters;
    weightedMeters += meters * intensity;
    if (intensity >= 0.55) intensiveMeters += meters;
  }

  for (const row of trafficFlowRows) {
    if (!trafficFlowRowNearLine(line, row, originLat)) continue;
    const meters = Math.max(60, geometryLengthMeters(row.geometry, originLat));
    const intensity = trafficFlowIntensityScore(row);
    coveredMeters += meters;
    weightedMeters += meters * intensity * 0.55;
    if (intensity >= 0.62) intensiveMeters += meters;
  }

  if (coveredMeters <= 0) return { score: null, exposure: null };

  const averageIntensity = weightedMeters / Math.max(1, coveredMeters);
  const intensiveShare = Math.min(1, intensiveMeters / Math.max(1, route.distance));
  return {
    score: Math.min(1, averageIntensity * 0.75 + intensiveShare * 0.35),
    exposure: Math.min(intensiveMeters, route.distance),
  };
}

function trafficIntensitySegments(
  route: OsrmRoute,
  adtRows: AdtRow[],
  trafficFlowRows: TrafficFlowRow[],
): RouteAnnotationSegment[] {
  if ((!adtRows.length && !trafficFlowRows.length) || route.geometry.coordinates.length < 2) return [];

  const originLat = routeOriginLat(route);
  const samples: GeoJSON.Position[] = [];
  for (const row of adtRows) {
    if (adtIntensityScore(row.adt_total) < 0.55) continue;
    const mid = midpoint(row.geometry.coordinates);
    if (mid) samples.push(mid);
    samples.push(...sampleLine(row.geometry.coordinates));
  }
  for (const row of trafficFlowRows) {
    if (trafficFlowIntensityScore(row) < 0.62) continue;
    for (const segment of flattenLineString(row.geometry)) {
      const mid = midpoint(segment);
      if (mid) samples.push(mid);
      samples.push(...sampleLine(segment));
    }
  }
  if (!samples.length) return [];

  const annotationSamples = capSamples(samples, TRAFFIC_INTENSITY_ANNOTATION_MAX_SAMPLES);
  return routeSegmentAnnotationsFromMask(route, "trafficIntensity", (segmentIndex) => {
    const start = route.geometry.coordinates[segmentIndex];
    const end = route.geometry.coordinates[segmentIndex + 1];
    if (!start || !end) return false;
    return annotationSamples.some((sample) => distancePointToSegmentMeters(sample, start, end, originLat) <= 130);
  });
}

function roadEnvironmentExposure(route: OsrmRoute, environment: "BRIDGE" | "TUNNEL"): RouteMetric {
  const details = route.roadEnvironmentDetails;
  if (!details) return { score: null, exposure: null };

  const coords = route.geometry.coordinates;
  if (coords.length < 2) return { score: 0, exposure: 0 };

  const originLat = routeOriginLat(route);
  let meters = 0;

  for (const [fromIndex, toIndex, value] of details) {
    if (typeof value !== "string" || value.toUpperCase() !== environment) continue;
    const from = Math.max(0, Math.min(coords.length - 1, Math.floor(fromIndex)));
    const to = Math.max(from, Math.min(coords.length - 1, Math.floor(toIndex)));

    for (let index = from + 1; index <= to; index += 1) {
      const start = coords[index - 1];
      const end = coords[index];
      if (!start || !end) continue;
      meters += distanceBetweenCoordinatesMeters(start, end, originLat);
    }
  }

  return {
    score: meters / Math.max(1, route.distance / 1000),
    exposure: meters,
  };
}

async function fetchPenaltyZoneRows(
  routes: OsrmRoute[],
  avoid: RouteAvoidState,
  context?: RouteRequestContext,
): Promise<TrafficIntensityRows> {
  if (!avoid.trafficIntensity) return emptyTrafficIntensityRows;

  const bbox = routeBbox(routes, PENALTY_ZONE_BBOX_PADDING);
  if (!bbox || bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) return emptyTrafficIntensityRows;
  if (bboxArea(bbox) > PENALTY_ZONE_MAX_BBOX_AREA) return emptyTrafficIntensityRows;

  return fetchTrafficIntensityRowsForBbox(bbox, context);
}

function trafficIntensityRowsCacheKey(bbox: Bbox): string {
  return [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat].map((n) => n.toFixed(5)).join(",");
}

async function fetchTrafficIntensityRowsForBbox(
  bbox: Bbox,
  context?: RouteRequestContext,
): Promise<TrafficIntensityRows> {
  if (!supabaseUrl || !supabaseAnon) return emptyTrafficIntensityRows;
  if (bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) return emptyTrafficIntensityRows;
  if (bboxArea(bbox) > PENALTY_ZONE_MAX_BBOX_AREA) return emptyTrafficIntensityRows;

  const key = trafficIntensityRowsCacheKey(bbox);
  const cached = context?.trafficIntensityRowsCache.get(key);
  if (cached) return cached;

  const client = createServerSupabaseClient(supabaseUrl, supabaseAnon);
  const params = {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  };

  const promise = (async (): Promise<TrafficIntensityRows> => {
    const trafficFlowActiveSince = new Date(Date.now() - TRAFFIC_FLOW_ACTIVE_WINDOW_MS).toISOString();
    const [adtResult, trafficFlowResult] = await Promise.all([
      client.rpc("adt_in_bbox", params).limit(TRAFFIC_INTENSITY_ADT_RPC_LIMIT),
      bboxArea(bbox) <= 30
        ? client.rpc("traffic_flow_segments_in_bbox", {
            ...params,
            active_since: trafficFlowActiveSince,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    return {
      adtRows: adtResult.error ? [] : (adtResult.data ?? []) as unknown as AdtRow[],
      trafficFlowRows: trafficFlowResult.error ? [] : (trafficFlowResult.data ?? []) as unknown as TrafficFlowRow[],
    };
  })().catch((err) => {
    console.warn("route penalty zone lookup failed", err);
    return emptyTrafficIntensityRows;
  });

  context?.trafficIntensityRowsCache.set(key, promise);
  return promise;
}

export function buildPenaltyZoneCustomModel(
  rows: {
    adtRows: AdtRow[];
    trafficFlowRows: TrafficFlowRow[];
  },
  avoid: RouteAvoidState,
  baselineRoutes: OsrmRoute[],
): GraphHopperCustomModel | undefined {
  const features: GraphHopperAreaFeature[] = [];
  const priority: GraphHopperRule[] = [];
  const baselineRoute = baselineRoutes[0];
  const baselineOriginLat = baselineRoute ? routeOriginLat(baselineRoute) : 60;
  const baselineLine = baselineRoute ? routeMatchLine(baselineRoute) : [];

  if (avoid.trafficIntensity) {
    const adtRows = [...rows.adtRows]
      .filter((row) => adtIntensityScore(row.adt_total) >= 0.55)
      .filter((row) => !baselineRoute || adtRowNearLine(baselineLine, row, baselineOriginLat))
      .sort((a, b) => adtIntensityScore(b.adt_total) - adtIntensityScore(a.adt_total))
      .slice(0, TRAFFIC_INTENSITY_ADT_PENALTY_CANDIDATE_LIMIT)
      .slice(0, TRAFFIC_INTENSITY_ADT_PENALTY_MAX_AREAS);

    for (const row of adtRows) {
      const feature = linePenaltyArea(
        `traffic_intensity_adt_${row.fid}`,
        row.geometry.coordinates,
        TRAFFIC_INTENSITY_PENALTY_PADDING_METERS,
      );
      if (!feature) continue;
      features.push(feature);
      priority.push({
        if: `in_${feature.id}`,
        multiply_by: adtPenaltyMultiplier(row),
      });
    }

    const trafficFlowRows = [...rows.trafficFlowRows]
      .filter((row) => trafficFlowIntensityScore(row) >= 0.62)
      .filter((row) => !baselineRoute || trafficFlowRowNearLine(baselineLine, row, baselineOriginLat))
      .sort((a, b) => trafficFlowIntensityScore(b) - trafficFlowIntensityScore(a))
      .slice(0, TRAFFIC_INTENSITY_FLOW_PENALTY_CANDIDATE_LIMIT)
      .slice(0, TRAFFIC_INTENSITY_FLOW_PENALTY_MAX_AREAS);

    for (const [index, row] of trafficFlowRows.entries()) {
      const line = flattenLineString(row.geometry)[0];
      if (!line) continue;
      const feature = linePenaltyArea(
        `traffic_intensity_flow_${index + 1}_${row.site_id}_${row.fid}`,
        line,
        TRAFFIC_INTENSITY_PENALTY_PADDING_METERS,
      );
      if (!feature) continue;
      features.push(feature);
      priority.push({
        if: `in_${feature.id}`,
        multiply_by: trafficFlowPenaltyMultiplier(row),
      });
    }
  }

  return mergeCustomModels({
    priority,
    areas: features.length
      ? {
          type: "FeatureCollection",
          features,
        }
      : undefined,
  });
}

export async function buildRoutePreferenceCustomModel(
  baselineRoutes: OsrmRoute[],
  avoid: RouteAvoidState,
  context?: RouteRequestContext,
): Promise<GraphHopperCustomModel | undefined> {
  const penaltyRows = await fetchPenaltyZoneRows(baselineRoutes, avoid, context);
  const penaltyModel = buildPenaltyZoneCustomModel(penaltyRows, avoid, baselineRoutes);
  return mergeCustomModels(
    avoid.highSpeed ? calmRouteCustomModel : undefined,
    avoid.bridges ? avoidBridgeCustomModel : undefined,
    avoid.tunnels ? avoidTunnelCustomModel : undefined,
    avoid.cityTraffic ? buildCityTrafficCustomModel(baselineRoutes) : undefined,
    penaltyModel,
  );
}

export type RouteScoreResult = Pick<RouteLine, "avoidScores" | "exposure" | "annotations">;

export async function scoreRouteAlternatives(
  routes: OsrmRoute[],
  avoid: RouteAvoidState,
  context?: RouteRequestContext,
): Promise<RouteScoreResult[]> {
  const baseScores = routes.map((route) => {
    const bridges = roadEnvironmentExposure(route, "BRIDGE");
    const tunnels = roadEnvironmentExposure(route, "TUNNEL");
    const cityTraffic = scoreCityTraffic(route);
    const annotations = emptyRouteAnnotations();
    annotations.cityTraffic = avoid.cityTraffic ? cityTrafficSegments(route) : [];
    annotations.bridges = roadEnvironmentSegments(route, "BRIDGE", "bridges");
    annotations.tunnels = roadEnvironmentSegments(route, "TUNNEL", "tunnels");
    return {
      avoidScores: {
        highSpeed: null,
        trafficIntensity: null,
        cityTraffic: cityTraffic.score,
        bridges: bridges.score,
        tunnels: tunnels.score,
      },
      exposure: {
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        cityTrafficMeters: cityTraffic.exposure,
        disturbances: null,
        liveAccidents: null,
        bridgeMeters: bridges.exposure,
        tunnelMeters: tunnels.exposure,
      },
      annotations,
    };
  });

  if (!supabaseUrl || !supabaseAnon) return baseScores;

  const bbox = routeBbox(routes);
  if (!bbox || bbox.minLng >= bbox.maxLng || bbox.minLat >= bbox.maxLat) return baseScores;

  const fallbackScores = routes.map((route, index) => {
    const base = baseScores[index];
    return base ?? {
      avoidScores: {
        highSpeed: null,
        trafficIntensity: null,
        cityTraffic: null,
        bridges: null,
        tunnels: null,
      },
      exposure: {
        highSpeedMeters: null,
        trafficIntensityMeters: null,
        cityTrafficMeters: null,
        disturbances: null,
        liveAccidents: null,
        bridgeMeters: null,
        tunnelMeters: null,
      },
      annotations: emptyRouteAnnotations(),
    };
  });

  const client = createServerSupabaseClient(supabaseUrl, supabaseAnon);
  const params = {
    min_lng: bbox.minLng,
    min_lat: bbox.minLat,
    max_lng: bbox.maxLng,
    max_lat: bbox.maxLat,
  };

  try {
    const activeSince = new Date(Date.now() - LIVE_EVENT_THRESHOLD_MS).toISOString();
    const eventsRequest = bboxArea(bbox) <= 80
      ? (async () => {
          const result = await client.rpc("events_in_bbox", {
            ...params,
            p_since: undefined,
            p_live_since: activeSince,
          });
          if (!result.error || !isMissingPostgrestFunctionError(result.error, "events_in_bbox")) {
            return result;
          }
          return client
            .from("events_public")
            .select("id, lng, lat")
            .gte("last_seen", activeSince)
            .gte("lng", bbox.minLng)
            .lte("lng", bbox.maxLng)
            .gte("lat", bbox.minLat)
            .lte("lat", bbox.maxLat)
            .limit(500);
        })()
      : Promise.resolve({ data: [], error: null });
    const disturbancesRequest = (async () => {
      const result = await client
        .rpc("disturbances_in_bbox", {
          ...params,
          p_active_since: activeSince,
        })
        .limit(500);
      if (!result.error || !isMissingPostgrestFunctionError(result.error, "disturbances_in_bbox")) {
        return result;
      }
      return client
        .from("disturbances_public")
        .select("id, lng, lat, message_type")
        .gte("last_seen", activeSince)
        .gte("lng", bbox.minLng)
        .lte("lng", bbox.maxLng)
        .gte("lat", bbox.minLat)
        .lte("lat", bbox.maxLat)
        .limit(500);
    })();
    const trafficIntensityRowsRequest = avoid.trafficIntensity
      ? fetchTrafficIntensityRowsForBbox(bbox, context)
      : Promise.resolve(emptyTrafficIntensityRows);
    const [largeRoadsResult, disturbancesResult, eventsResult, trafficIntensityRows] = await Promise.all([
      bboxArea(bbox) <= 40
        ? client.rpc("large_roads_in_bbox", params)
        : Promise.resolve({ data: [], error: null }),
      disturbancesRequest,
      eventsRequest,
      trafficIntensityRowsRequest,
    ]);

    const largeRoadRows = largeRoadsResult.error
      ? []
      : ((largeRoadsResult.data ?? []) as LargeRoadRow[]).filter(
          (row) => row.speed_limit !== null && row.speed_limit >= 90,
        );
    const disturbanceRows = disturbancesResult.error
      ? []
      : (disturbancesResult.data ?? []) as DisturbanceRow[];
    const eventRows = eventsResult.error
      ? []
      : (eventsResult.data ?? []) as EventRow[];
    const { adtRows, trafficFlowRows } = trafficIntensityRows;

    return routes.map((route) => {
      const highSpeed = scoreHighSpeed(route, largeRoadRows);
      const trafficIntensity = avoid.trafficIntensity
        ? scoreTrafficIntensity(route, adtRows, trafficFlowRows)
        : { score: null, exposure: null };
      const cityTraffic = scoreCityTraffic(route);
      const disturbances = scoreDisturbances(route, disturbanceRows);
      const bridges = roadEnvironmentExposure(route, "BRIDGE");
      const tunnels = roadEnvironmentExposure(route, "TUNNEL");
      const accidentPoints = liveAccidentPoints(route, eventRows);
      const annotations = emptyRouteAnnotations();
      annotations.highSpeed = highSpeedSegments(route, largeRoadRows);
      annotations.trafficIntensity = avoid.trafficIntensity
        ? trafficIntensitySegments(route, adtRows, trafficFlowRows)
        : [];
      annotations.cityTraffic = avoid.cityTraffic ? cityTrafficSegments(route) : [];
      annotations.bridges = roadEnvironmentSegments(route, "BRIDGE", "bridges");
      annotations.tunnels = roadEnvironmentSegments(route, "TUNNEL", "tunnels");
      annotations.disturbances = disturbancePoints(route, disturbanceRows);
      annotations.liveAccidents = accidentPoints;
      return {
        avoidScores: {
          highSpeed: highSpeed.score,
          trafficIntensity: trafficIntensity.score,
          cityTraffic: cityTraffic.score,
          bridges: bridges.score,
          tunnels: tunnels.score,
        },
        exposure: {
          highSpeedMeters: highSpeed.exposure,
          trafficIntensityMeters: trafficIntensity.exposure,
          cityTrafficMeters: cityTraffic.exposure,
          disturbances: disturbances.exposure,
          liveAccidents: accidentPoints.length,
          bridgeMeters: bridges.exposure,
          tunnelMeters: tunnels.exposure,
        },
        annotations,
      };
    });
  } catch (err) {
    console.warn("route scoring failed", err);
    return fallbackScores;
  }
}
