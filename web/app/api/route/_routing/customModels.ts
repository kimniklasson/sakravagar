import { routeBbox } from "./geometry";
import type {
  Bbox,
  CityTrafficArea,
  GraphHopperAreaFeature,
  GraphHopperCustomModel,
  GraphHopperRule,
  OsrmRoute,
} from "./types";

export const calmRouteCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_class == MOTORWAY", multiply_by: "0.03" },
    { if: "road_class == TRUNK", multiply_by: "0.08" },
    { if: "max_speed >= 100", multiply_by: "0.02" },
    { if: "max_speed >= 90", multiply_by: "0.04" },
  ],
};

export const balancedCalmRouteCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_class == MOTORWAY", multiply_by: "0.16" },
    { if: "road_class == TRUNK", multiply_by: "0.24" },
    { if: "max_speed >= 100", multiply_by: "0.1" },
    { if: "max_speed >= 90", multiply_by: "0.2" },
  ],
};

export const avoidBridgeCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_environment == BRIDGE", multiply_by: "0.12" },
  ],
};

export const avoidTunnelCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_environment == TUNNEL", multiply_by: "0.03" },
  ],
};

const CITY_TRAFFIC_AREA_BBOX_PADDING = 0.18;
export const CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD = 0.62;

export const CITY_TRAFFIC_AREAS: CityTrafficArea[] = [
  { id: "city_stockholm", minLng: 17.65, minLat: 59.12, maxLng: 18.45, maxLat: 59.55 },
  { id: "city_goteborg", minLng: 11.62, minLat: 57.52, maxLng: 12.25, maxLat: 57.90 },
  { id: "city_malmo_lund", minLng: 12.70, minLat: 55.42, maxLng: 13.35, maxLat: 55.85 },
  { id: "city_uppsala", minLng: 17.45, minLat: 59.75, maxLng: 17.95, maxLat: 60.02 },
  { id: "city_vasteras", minLng: 16.30, minLat: 59.48, maxLng: 16.78, maxLat: 59.75 },
  { id: "city_orebro", minLng: 14.88, minLat: 59.10, maxLng: 15.40, maxLat: 59.38 },
  { id: "city_linkoping", minLng: 15.35, minLat: 58.30, maxLng: 15.85, maxLat: 58.55 },
  { id: "city_norrkoping", minLng: 15.92, minLat: 58.50, maxLng: 16.35, maxLat: 58.72 },
  { id: "city_jonkoping", minLng: 13.95, minLat: 57.62, maxLng: 14.35, maxLat: 57.90 },
  { id: "city_helsingborg", minLng: 12.55, minLat: 55.98, maxLng: 12.88, maxLat: 56.18 },
  { id: "city_boras", minLng: 12.72, minLat: 57.60, maxLng: 13.08, maxLat: 57.85 },
  { id: "city_umea", minLng: 20.05, minLat: 63.68, maxLng: 20.45, maxLat: 63.95 },
  { id: "city_gavle", minLng: 16.95, minLat: 60.55, maxLng: 17.35, maxLat: 60.82 },
  { id: "city_eskilstuna", minLng: 16.32, minLat: 59.23, maxLng: 16.65, maxLat: 59.45 },
  { id: "city_karlstad", minLng: 13.32, minLat: 59.25, maxLng: 13.70, maxLat: 59.50 },
  { id: "city_halmstad", minLng: 12.75, minLat: 56.60, maxLng: 13.05, maxLat: 56.78 },
  { id: "city_vaxjo", minLng: 14.65, minLat: 56.80, maxLng: 14.98, maxLat: 57.00 },
  { id: "city_sundsvall", minLng: 17.10, minLat: 62.28, maxLng: 17.48, maxLat: 62.52 },
  { id: "city_lulea", minLng: 22.00, minLat: 65.50, maxLng: 22.35, maxLat: 65.72 },
  { id: "city_trollhattan_vanersborg", minLng: 12.15, minLat: 58.20, maxLng: 12.45, maxLat: 58.42 },
  { id: "city_skovde", minLng: 13.75, minLat: 58.30, maxLng: 14.05, maxLat: 58.50 },
  { id: "city_kalmar", minLng: 16.18, minLat: 56.60, maxLng: 16.45, maxLat: 56.75 },
  { id: "city_kristianstad", minLng: 14.05, minLat: 55.95, maxLng: 14.35, maxLat: 56.12 },
  { id: "city_falun_borlange", minLng: 15.25, minLat: 60.35, maxLng: 15.75, maxLat: 60.65 },
];

function degreesLat(meters: number): number {
  return meters / 110_540;
}

function degreesLng(meters: number, lat: number): number {
  const latFactor = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return meters / (111_320 * latFactor);
}

function boxPolygon(minLng: number, minLat: number, maxLng: number, maxLat: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]],
  };
}

function bboxOverlapsArea(bbox: Bbox, area: CityTrafficArea): boolean {
  return (
    bbox.minLng <= area.maxLng &&
    bbox.maxLng >= area.minLng &&
    bbox.minLat <= area.maxLat &&
    bbox.maxLat >= area.minLat
  );
}

function cityTrafficAreasForRoutes(routes: OsrmRoute[]): CityTrafficArea[] {
  const bbox = routeBbox(routes, CITY_TRAFFIC_AREA_BBOX_PADDING);
  if (!bbox) return [];
  return CITY_TRAFFIC_AREAS.filter((area) => bboxOverlapsArea(bbox, area));
}

function cityTrafficAreaFeature(area: CityTrafficArea): GraphHopperAreaFeature {
  return {
    type: "Feature",
    id: area.id,
    properties: {},
    geometry: boxPolygon(area.minLng, area.minLat, area.maxLng, area.maxLat),
  };
}

export function buildCityTrafficCustomModel(routes: OsrmRoute[]): GraphHopperCustomModel | undefined {
  const features = cityTrafficAreasForRoutes(routes).map(cityTrafficAreaFeature);
  if (!features.length) return undefined;

  const priority = features.flatMap((feature): GraphHopperRule[] => [
    { if: `in_${feature.id} && road_class == MOTORWAY`, multiply_by: "0.58" },
    { if: `in_${feature.id} && road_class == TRUNK`, multiply_by: "0.62" },
    { if: `in_${feature.id} && road_class == PRIMARY`, multiply_by: "0.72" },
    { if: `in_${feature.id} && road_class == SECONDARY`, multiply_by: "0.88" },
    { if: `in_${feature.id} && max_speed >= 80`, multiply_by: "0.82" },
    { if: `in_${feature.id} && max_speed >= 60`, multiply_by: "0.9" },
  ]);

  return {
    priority,
    areas: {
      type: "FeatureCollection",
      features,
    },
  };
}

export function linePenaltyArea(
  id: string,
  line: GeoJSON.Position[],
  paddingMeters: number,
): GraphHopperAreaFeature | null {
  const coords: Array<[number, number]> = [];
  for (const coord of line) {
    const [lng, lat] = coord;
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    coords.push([lng, lat]);
  }
  if (!coords.length) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let latSum = 0;

  for (const [lng, lat] of coords) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
    latSum += lat;
  }

  const centerLat = latSum / coords.length;
  const lngPad = degreesLng(paddingMeters, centerLat);
  const latPad = degreesLat(paddingMeters);
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: boxPolygon(minLng - lngPad, minLat - latPad, maxLng + lngPad, maxLat + latPad),
  };
}

export function mergeCustomModels(
  ...models: Array<GraphHopperCustomModel | null | undefined>
): GraphHopperCustomModel | undefined {
  const priority = models.flatMap((model) => model?.priority ?? []);
  const features = models.flatMap((model) => model?.areas?.features ?? []);
  if (!priority.length && !features.length) return undefined;

  return {
    ...(priority.length ? { priority } : {}),
    ...(features.length
      ? {
          areas: {
            type: "FeatureCollection" as const,
            features,
          },
        }
      : {}),
  };
}
