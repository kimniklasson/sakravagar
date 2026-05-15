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

export const avoidMultilaneRoadClassCustomModel: GraphHopperCustomModel = {
  priority: [
    { if: "road_class == MOTORWAY", multiply_by: "0.12" },
  ],
};

const CITY_TRAFFIC_AREA_BBOX_PADDING = 0.18;
export const CITY_TRAFFIC_SEGMENT_EXPOSURE_THRESHOLD = 0.55;

export const CITY_TRAFFIC_AREAS: CityTrafficArea[] = [
  { id: "city_stockholm", minLng: 17.78, minLat: 59.20, maxLng: 18.20, maxLat: 59.43 },
  { id: "city_goteborg", minLng: 11.82, minLat: 57.62, maxLng: 12.08, maxLat: 57.79 },
  { id: "city_malmo", minLng: 12.92, minLat: 55.53, maxLng: 13.08, maxLat: 55.65 },
  { id: "city_lund", minLng: 13.13, minLat: 55.66, maxLng: 13.28, maxLat: 55.75 },
  { id: "city_uppsala", minLng: 17.55, minLat: 59.79, maxLng: 17.75, maxLat: 59.92 },
  { id: "city_vasteras", minLng: 16.42, minLat: 59.55, maxLng: 16.66, maxLat: 59.66 },
  { id: "city_orebro", minLng: 15.05, minLat: 59.20, maxLng: 15.27, maxLat: 59.33 },
  { id: "city_linkoping", minLng: 15.50, minLat: 58.35, maxLng: 15.75, maxLat: 58.45 },
  { id: "city_norrkoping", minLng: 16.05, minLat: 58.55, maxLng: 16.26, maxLat: 58.65 },
  { id: "city_jonkoping", minLng: 14.05, minLat: 57.72, maxLng: 14.25, maxLat: 57.84 },
  { id: "city_helsingborg", minLng: 12.62, minLat: 56.00, maxLng: 12.78, maxLat: 56.10 },
  { id: "city_boras", minLng: 12.82, minLat: 57.66, maxLng: 13.02, maxLat: 57.77 },
  { id: "city_umea", minLng: 20.15, minLat: 63.77, maxLng: 20.38, maxLat: 63.86 },
  { id: "city_gavle", minLng: 17.05, minLat: 60.62, maxLng: 17.25, maxLat: 60.72 },
  { id: "city_eskilstuna", minLng: 16.42, minLat: 59.31, maxLng: 16.58, maxLat: 59.40 },
  { id: "city_karlstad", minLng: 13.42, minLat: 59.34, maxLng: 13.62, maxLat: 59.43 },
  { id: "city_halmstad", minLng: 12.80, minLat: 56.64, maxLng: 12.95, maxLat: 56.72 },
  { id: "city_vaxjo", minLng: 14.73, minLat: 56.83, maxLng: 14.90, maxLat: 56.93 },
  { id: "city_sundsvall", minLng: 17.20, minLat: 62.36, maxLng: 17.38, maxLat: 62.44 },
  { id: "city_lulea", minLng: 22.05, minLat: 65.55, maxLng: 22.22, maxLat: 65.64 },
  { id: "city_trollhattan", minLng: 12.20, minLat: 58.24, maxLng: 12.36, maxLat: 58.34 },
  { id: "city_vanersborg", minLng: 12.25, minLat: 58.35, maxLng: 12.38, maxLat: 58.41 },
  { id: "city_skovde", minLng: 13.80, minLat: 58.36, maxLng: 14.00, maxLat: 58.46 },
  { id: "city_kalmar", minLng: 16.26, minLat: 56.64, maxLng: 16.40, maxLat: 56.70 },
  { id: "city_kristianstad", minLng: 14.10, minLat: 56.00, maxLng: 14.23, maxLat: 56.08 },
  { id: "city_falun", minLng: 15.56, minLat: 60.56, maxLng: 15.70, maxLat: 60.66 },
  { id: "city_borlange", minLng: 15.35, minLat: 60.43, maxLng: 15.50, maxLat: 60.52 },
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
    { if: `in_${feature.id} && road_class == MOTORWAY`, multiply_by: "0.68" },
    { if: `in_${feature.id} && road_class == TRUNK`, multiply_by: "0.70" },
    { if: `in_${feature.id} && road_class == PRIMARY`, multiply_by: "0.70" },
    { if: `in_${feature.id} && road_class == SECONDARY`, multiply_by: "0.74" },
    { if: `in_${feature.id} && road_class == TERTIARY`, multiply_by: "0.78" },
    { if: `in_${feature.id} && road_class == RESIDENTIAL`, multiply_by: "0.82" },
    { if: `in_${feature.id} && road_class == UNCLASSIFIED`, multiply_by: "0.84" },
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
