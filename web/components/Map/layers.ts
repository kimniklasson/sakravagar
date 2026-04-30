import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { SegmentDetail } from "@/app/api/segment/route";
import type { EventPoint } from "@/app/api/events/route";
import type { DisturbancePoint } from "@/app/api/disturbances/route";
import type { LargeRoadSegment } from "@/app/api/large-roads/route";
import type { RouteLine } from "@/app/api/route/route";
import type { TrafficFlowSegment } from "@/app/api/traffic-flow/route";

type AdtSegment = {
  fid: number;
  adt_total: number;
  adt_tung: number | null;
  matar: number | null;
  geometry: GeoJSON.LineString;
};

type RiskSegment = {
  fid: number;
  adt_total: number;
  events_count: number;
  risk_per_milj_fordon: number;
  geometry: GeoJSON.LineString;
};

export type LayerController = { setVisible: (v: boolean) => void };
type HeatmapStop = { density: number; color: string; alpha: number };
type Bbox = { west: number; south: number; east: number; north: number };

const DEFAULT_HEATMAP_STOPS: HeatmapStop[] = [
  { density: 0, color: "#000000", alpha: 0 },
  { density: 0.4, color: "#666666", alpha: 0.25 },
  { density: 0.51, color: "#666666", alpha: 1 },
];

const SOURCE_ID = "events";
const HEATMAP_LAYER_ID = "events-heatmap";
const CIRCLE_LAYER_ID = "events-circles";
const HIT_TARGET_LAYER_ID = "events-hit-target";
const LIVE_HALO_LAYER_ID = "events-live-halo";
const LIVE_CORE_LAYER_ID = "events-live-core";

// Pågående = senast sedd inom 90 min (3 polling-cykler à 30 min). Trafikverket
// droppar olyckor ur feeden när de avslutas, så last_seen slutar uppdateras
// och vi kan klassa dem som historiska.
const LIVE_THRESHOLD_MS = 90 * 60 * 1000;
const SWEDEN_EVENTS_BBOX: Bbox = {
  west: 10.5,
  south: 55,
  east: 24.5,
  north: 69.5,
};

const ADT_SOURCE_ID = "adt";
const ADT_LAYER_ID = "adt-lines";
const ADT_HIT_LAYER_ID = "adt-lines-hit";
const RISK_SOURCE_ID = "risk";
const RISK_LAYER_ID = "risk-lines";
const RISK_HIT_LAYER_ID = "risk-lines-hit";
const LARGE_ROADS_SOURCE_ID = "large-roads";
const LARGE_ROADS_BADGE_SOURCE_ID = "large-roads-speed-badges";
const LARGE_ROADS_LAYER_ID = "large-roads-lines";
const LARGE_ROADS_BADGE_LAYER_ID = "large-roads-speed-badge-symbols";
const DISTURBANCE_SOURCE_ID = "disturbances";
const DISTURBANCE_LAYER_ID = "disturbances-points";
const DISTURBANCE_HIT_LAYER_ID = "disturbances-hit-target";
const DISTURBANCE_ROADWORK_IMAGE_ID = "disturbance-roadwork-triangle";
const DISTURBANCE_TRAFFIC_IMAGE_ID = "disturbance-traffic-square";
const DISTURBANCE_COLORS = {
  roadwork: "#FFE36A",
  traffic: "#FF8A4A",
};
const TRAFFIC_FLOW_SOURCE_ID = "traffic-flow";
const TRAFFIC_FLOW_LAYER_ID = "traffic-flow-lines";
const TRAFFIC_FLOW_HIT_LAYER_ID = "traffic-flow-hit-target";
const TRAFFIC_FLOW_COLORS = {
  calm: "#72F2D0",
  moving: "#9FD86B",
  busy: "#FFD166",
  slow: "#FF7A3D",
};
const TRAFFIC_FLOW_MIN_ZOOM = 7;
const ROUTE_SOURCE_ID = "route";
const ROUTE_ALT_LAYER_ID = "route-alt-lines";
const ROUTE_ALT_CASING_LAYER_ID = "route-alt-casing";
const ROUTE_PRIMARY_LAYER_ID = "route-primary-line";
const ROUTE_PRIMARY_CASING_LAYER_ID = "route-primary-casing";

// Vid zoom 8 är viewporten ~4° bred i Sverige; padded blir den ~6° och en
// sån query timeoutar mot Supabase för de tyngre analyslagren (för många
// segment). Zoom 9 är ~2° vilket fungerar bra för Risk/ÅDT.
const NVDB_MIN_ZOOM = 9;
const ADT_TILE_DEG = 0.6;
const ADT_TILE_PADDING = 0.2;
const ADT_MAX_CONCURRENT_TILES = 8;

// Hastighetslagret är betydligt glesare än Risk/ÅDT och behöver vara synligt
// tidigare för att fungera som orienteringslager när kartan är utzoomad.
const LARGE_ROADS_MIN_ZOOM = 8;
const LARGE_ROADS_TILE_DEG = 0.75;
const LARGE_ROADS_TILE_PADDING = 0.45;
const LARGE_ROADS_MAX_CONCURRENT_TILES = 6;
const LARGE_ROADS_BADGE_MIN_LINE_PX = 72;
const LARGE_ROADS_SPEED_RUN_MIN_LENGTH_M = 500;
const LARGE_ROADS_SPEED_CONNECT_DISTANCE_M = 120;
const SPEED_BADGE_IMAGE_PREFIX = "speed-badge-";
const SPEED_ROAD_COLORS = {
  90: "#999999",
  100: "#B8B8B8",
  110: "#D6D6D6",
  120: "#F2F2F2",
};

function heatmapColorExpression(stops: HeatmapStop[]): ExpressionSpecification {
  const sorted = [...stops].sort((a, b) => a.density - b.density);
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    ...sorted.flatMap((s) => [
      Math.max(0, Math.min(1, s.density)),
      hexToRgba(s.color, s.alpha),
    ]),
  ] as ExpressionSpecification;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function speedRoadColor(speedLimit: number | null | undefined): string {
  if (!speedLimit) return SPEED_ROAD_COLORS[90];
  if (speedLimit >= 120) return SPEED_ROAD_COLORS[120];
  if (speedLimit >= 110) return SPEED_ROAD_COLORS[110];
  if (speedLimit >= 100) return SPEED_ROAD_COLORS[100];
  return SPEED_ROAD_COLORS[90];
}

function ensureDisturbanceMarkerImages(map: MapLibreMap): void {
  const pixelRatio = 2;
  const size = 22;
  const strokeWidth = 2;

  const addMarker = (
    id: string,
    fill: string,
    drawPath: (ctx: CanvasRenderingContext2D) => void,
  ) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement("canvas");
    canvas.width = size * pixelRatio;
    canvas.height = size * pixelRatio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(pixelRatio, pixelRatio);
    drawPath(ctx);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    ctx.stroke();
    map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
  };

  addMarker(DISTURBANCE_ROADWORK_IMAGE_ID, DISTURBANCE_COLORS.roadwork, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(size / 2, 3);
    ctx.lineTo(size - 4, size - 4);
    ctx.lineTo(4, size - 4);
    ctx.closePath();
  });

  addMarker(DISTURBANCE_TRAFFIC_IMAGE_ID, DISTURBANCE_COLORS.traffic, (ctx) => {
    const side = 14;
    const x = (size - side) / 2;
    const y = (size - side) / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, side, side, 2);
  });
}

function ensureSpeedBadgeImage(
  map: MapLibreMap,
  speedLimit: number | null,
): string | null {
  if (!speedLimit) return null;
  const borderColor = speedRoadColor(speedLimit);
  const id = `${SPEED_BADGE_IMAGE_PREFIX}${speedLimit}-${borderColor.replace("#", "")}`;
  if (map.hasImage(id)) return id;

  const label = String(speedLimit);
  const pixelRatio = 2;
  const fontSize = 12;
  const fontWeight = 700;
  const borderWidth = 2;
  const padX = 7;
  const padY = 4;
  const canvas = document.createElement("canvas");
  const measureCtx = canvas.getContext("2d");
  if (!measureCtx) return null;

  measureCtx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  const textWidth = Math.ceil(measureCtx.measureText(label).width);
  const width = textWidth + padX * 2;
  const height = fontSize + padY * 2;

  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = "#222222";
  ctx.beginPath();
  ctx.roundRect(borderWidth / 2, borderWidth / 2, width - borderWidth, height - borderWidth, height / 2);
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, height / 2 + 0.5);

  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
  return id;
}

export async function addEventsLayer(
  map: MapLibreMap,
  opts: { since?: string | null } = {},
): Promise<{ liveCount: number }> {
  const params = new URLSearchParams({ bbox: bboxToParam(mapBoundsBbox(map, 0.2)) });
  if (opts.since) params.set("since", opts.since);
  const url = `/api/events?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("failed to fetch events", await res.text());
    return { liveCount: 0 };
  }
  const { points } = (await res.json()) as { points: EventPoint[] };

  const liveCutoff = Date.now() - LIVE_THRESHOLD_MS;
  let liveCount = 0;
  const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: points.map((p) => {
      const isLive = Date.parse(p.last_seen) >= liveCutoff;
      if (isLive) liveCount++;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          icon_id: p.icon_id,
          road_number: p.road_number,
          message: p.message,
          severity: p.severity,
          first_seen: p.first_seen,
          last_seen: p.last_seen,
          is_live: isLive,
        },
      };
    }),
  };

  const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(geojson);
    return { liveCount };
  }

  map.addSource(SOURCE_ID, { type: "geojson", data: geojson });

  // Heatmap — dominerande vid låg/medel zoom. Syns som färgfält över Sverige.
  map.addLayer({
    id: HEATMAP_LAYER_ID,
    type: "heatmap",
    source: SOURCE_ID,
    maxzoom: 13,
    paint: {
      "heatmap-weight": 1,
      "heatmap-intensity": [
        "interpolate", ["linear"], ["zoom"],
        4, 1,
        11, 2.5,
      ],
      "heatmap-radius": [
        "interpolate", ["linear"], ["zoom"],
        4, 12,
        8, 20,
        11, 30,
      ],
      "heatmap-color": heatmapColorExpression(DEFAULT_HEATMAP_STOPS),
      "heatmap-opacity": [
        "interpolate", ["linear"], ["zoom"],
        4, 0.9,
        12, 0.6,
        13, 0,
      ],
    },
  });

  // Enskilda historiska punkter — tonar in vid hög zoom där heatmapen blir glesare.
  // Pågående olyckor renderas separat nedan så de inte kommer hit.
  map.addLayer({
    id: CIRCLE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    minzoom: 10,
    filter: ["!=", ["get", "is_live"], true],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 7, 18, 12],
      "circle-color": "#ffffff",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-opacity": [
        "interpolate", ["linear"], ["zoom"],
        10, 0,
        12, 0.7,
        14, 0.9,
      ],
    },
  });

  // Osynligt hit-target för historiska events — alltid aktivt så att
  // queryRenderedFeatures hittar dem vid alla zoom-nivåer (även när
  // CIRCLE_LAYER_ID inte renderas pga minzoom). Lite större radie ger
  // bättre klick-yta. Heatmappen är inte klickbar (density-rendering),
  // så utan detta lager går historiska events inte att klicka utzoomat.
  map.addLayer({
    id: HIT_TARGET_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["!=", ["get", "is_live"], true],
    paint: {
      "circle-radius": 10,
      "circle-color": "#000000",
      "circle-opacity": 0,
    },
  });

  // Pågående olyckor: pulserande halo (animeras nedan via rAF) + statisk
  // kärna ovanpå. Synliga vid alla zoom-nivåer eftersom realtid är poängen.
  map.addLayer({
    id: LIVE_HALO_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["get", "is_live"], true],
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": 5,
      "circle-opacity": 0.3,
      "circle-stroke-width": 0,
      "circle-pitch-alignment": "map",
    },
  });

  map.addLayer({
    id: LIVE_CORE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    filter: ["==", ["get", "is_live"], true],
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": 5,
      "circle-stroke-width": 0,
      "circle-opacity": 1,
    },
  });

  startLivePulse(map);

  return { liveCount };
}

export async function fetchLiveEvents(): Promise<EventPoint[]> {
  const params = new URLSearchParams({
    bbox: bboxToParam(SWEDEN_EVENTS_BBOX),
    live: "1",
  });
  const res = await fetch(`/api/events?${params.toString()}`);
  if (!res.ok) {
    console.error("failed to fetch live events", await res.text());
    return [];
  }

  const { points } = (await res.json()) as { points: EventPoint[] };
  const liveCutoff = Date.now() - LIVE_THRESHOLD_MS;
  return points.filter((p) => Date.parse(p.last_seen) >= liveCutoff);
}

export async function focusLiveEvents(map: MapLibreMap): Promise<{ liveCount: number }> {
  const liveEvents = await fetchLiveEvents();
  const coordinates = liveEvents.map((p) => [p.lng, p.lat] as [number, number]);
  if (coordinates.length === 0) return { liveCount: 0 };

  if (coordinates.length === 1) {
    map.flyTo({
      center: coordinates[0],
      zoom: 10,
      duration: 900,
      essential: true,
    });
    return { liveCount: liveEvents.length };
  }

  const bounds = coordinates.reduce(
    (acc, coord) => acc.extend(coord),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  const samePoint = bounds.getWest() === bounds.getEast() && bounds.getSouth() === bounds.getNorth();
  if (samePoint) {
    map.flyTo({
      center: coordinates[0],
      zoom: 10,
      duration: 900,
      essential: true,
    });
    return { liveCount: liveEvents.length };
  }

  const narrow = typeof window !== "undefined" && window.innerWidth < 720;
  map.fitBounds(bounds, {
    padding: narrow
      ? { top: 96, right: 24, bottom: 140, left: 24 }
      : { top: 80, right: 360, bottom: 80, left: 360 },
    maxZoom: 10,
    duration: 900,
    essential: true,
  });

  return { liveCount: liveEvents.length };
}

export function addRouteLayer(map: MapLibreMap): LayerController {
  if (map.getSource(ROUTE_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(ROUTE_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(LIVE_HALO_LAYER_ID)
    ? LIVE_HALO_LAYER_ID
    : map.getLayer(LIVE_CORE_LAYER_ID)
      ? LIVE_CORE_LAYER_ID
      : undefined;

  map.addLayer(
    {
      id: ROUTE_ALT_CASING_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["!=", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(17, 17, 17, 0.9)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 7, 16, 11],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_ALT_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["!=", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.45,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 12, 4, 16, 7],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_PRIMARY_CASING_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(17, 17, 17, 0.95)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 6, 12, 9, 16, 13],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_PRIMARY_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#72F2D0",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 12, 6, 16, 9],
      },
    },
    beforeId,
  );

  return {
    setVisible: (v) => {
      for (const id of [
        ROUTE_ALT_CASING_LAYER_ID,
        ROUTE_ALT_LAYER_ID,
        ROUTE_PRIMARY_CASING_LAYER_ID,
        ROUTE_PRIMARY_LAYER_ID,
      ]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
        }
      }
    },
  };
}

export function setRouteLayerData(map: MapLibreMap, routes: RouteLine[]): void {
  if (!map.getSource(ROUTE_SOURCE_ID)) addRouteLayer(map);
  const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = routes.map((route, index) => ({
    type: "Feature",
    geometry: route.geometry,
    properties: {
      id: route.id,
      selected: index === 0,
      distance_meters: route.distanceMeters,
      duration_seconds: route.durationSeconds,
      safety_score: route.safetyScore,
    },
  }));
  source.setData({ type: "FeatureCollection", features });
}

export function focusRoute(map: MapLibreMap, routes: RouteLine[]): void {
  const first = routes[0];
  if (!first) return;

  const coordinates = first.geometry.coordinates.filter(
    (coord): coord is [number, number] =>
      Array.isArray(coord) &&
      coord.length >= 2 &&
      typeof coord[0] === "number" &&
      typeof coord[1] === "number",
  );
  if (!coordinates.length) return;

  const bounds = coordinates.reduce(
    (acc, coord) => acc.extend(coord),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  const narrow = typeof window !== "undefined" && window.innerWidth < 720;
  map.fitBounds(bounds, {
    padding: narrow
      ? { top: 220, right: 24, bottom: 140, left: 24 }
      : { top: 80, right: 360, bottom: 80, left: 360 },
    maxZoom: 14,
    duration: 900,
    essential: true,
  });
}

export function addDisturbancesLayer(map: MapLibreMap): LayerController {
  if (map.getSource(DISTURBANCE_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(DISTURBANCE_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  ensureDisturbanceMarkerImages(map);

  const beforeId = map.getLayer(LIVE_HALO_LAYER_ID)
    ? LIVE_HALO_LAYER_ID
    : map.getLayer(LIVE_CORE_LAYER_ID)
      ? LIVE_CORE_LAYER_ID
      : undefined;

  map.addLayer(
    {
      id: DISTURBANCE_LAYER_ID,
      type: "symbol",
      source: DISTURBANCE_SOURCE_ID,
      layout: {
        "icon-image": [
          "match", ["get", "category"],
          "roadwork", DISTURBANCE_ROADWORK_IMAGE_ID,
          "traffic", DISTURBANCE_TRAFFIC_IMAGE_ID,
          DISTURBANCE_TRAFFIC_IMAGE_ID,
        ],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          4, 0.85,
          10, 1,
          14, 1.18,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 0.95,
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: DISTURBANCE_HIT_LAYER_ID,
      type: "circle",
      source: DISTURBANCE_SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 12, 12, 18, 16, 24],
        "circle-color": "#000000",
        "circle-opacity": 0,
      },
    },
    beforeId,
  );

  return {
    setVisible: (v) => {
      if (map.getLayer(DISTURBANCE_LAYER_ID)) {
        map.setLayoutProperty(DISTURBANCE_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (map.getLayer(DISTURBANCE_HIT_LAYER_ID)) {
        map.setLayoutProperty(DISTURBANCE_HIT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
    },
  };
}

export async function refreshDisturbancesLayer(map: MapLibreMap): Promise<{ disturbanceCount: number }> {
  const res = await fetch("/api/disturbances");
  if (!res.ok) {
    console.error("failed to fetch disturbances", await res.text());
    return { disturbanceCount: 0 };
  }

  const { points } = (await res.json()) as { points: DisturbancePoint[] };
  const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        icon_id: p.icon_id,
        message_type: p.message_type,
        category: p.category,
        road_number: p.road_number,
        message: p.message,
        severity: p.severity,
        first_seen: p.first_seen,
        last_seen: p.last_seen,
      },
    })),
  };

  const src = map.getSource(DISTURBANCE_SOURCE_ID) as GeoJSONSource | undefined;
  src?.setData(geojson);
  return { disturbanceCount: points.length };
}

export function addTrafficFlowLayer(map: MapLibreMap): LayerController {
  if (map.getSource(TRAFFIC_FLOW_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(TRAFFIC_FLOW_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(DISTURBANCE_LAYER_ID)
    ? DISTURBANCE_LAYER_ID
    : map.getLayer(LIVE_HALO_LAYER_ID)
      ? LIVE_HALO_LAYER_ID
      : map.getLayer(LIVE_CORE_LAYER_ID)
        ? LIVE_CORE_LAYER_ID
        : undefined;

  map.addLayer(
    {
      id: TRAFFIC_FLOW_LAYER_ID,
      type: "line",
      source: TRAFFIC_FLOW_SOURCE_ID,
      minzoom: TRAFFIC_FLOW_MIN_ZOOM,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": [
          "match", ["get", "category"],
          "calm", TRAFFIC_FLOW_COLORS.calm,
          "moving", TRAFFIC_FLOW_COLORS.moving,
          "busy", TRAFFIC_FLOW_COLORS.busy,
          "slow", TRAFFIC_FLOW_COLORS.slow,
          TRAFFIC_FLOW_COLORS.moving,
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          7, [
            "interpolate", ["linear"], ["get", "vehicle_flow_rate"],
            0, 1.5,
            800, 2.5,
            1600, 3.5,
            2500, 4.5,
          ],
          12, [
            "interpolate", ["linear"], ["get", "vehicle_flow_rate"],
            0, 3,
            800, 5.5,
            1600, 8,
            2500, 10,
          ],
        ],
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          TRAFFIC_FLOW_MIN_ZOOM, 0.45,
          TRAFFIC_FLOW_MIN_ZOOM + 1, 0.85,
        ],
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: TRAFFIC_FLOW_HIT_LAYER_ID,
      type: "line",
      source: TRAFFIC_FLOW_SOURCE_ID,
      minzoom: TRAFFIC_FLOW_MIN_ZOOM,
      paint: {
        "line-color": "#000000",
        "line-opacity": 0,
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 18, 12, 26, 16, 34],
      },
    },
    beforeId,
  );

  const loader = createBboxLoader(map, {
    minZoom: TRAFFIC_FLOW_MIN_ZOOM,
    bboxPadding: 0.5,
    maxBboxAreaDeg2: 30,
    fetchBbox: async (padded) => {
      await refreshTrafficFlowLayer(map, padded);
    },
  });

  return {
    setVisible: (v) => {
      if (map.getLayer(TRAFFIC_FLOW_LAYER_ID)) {
        map.setLayoutProperty(TRAFFIC_FLOW_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (map.getLayer(TRAFFIC_FLOW_HIT_LAYER_ID)) {
        map.setLayoutProperty(TRAFFIC_FLOW_HIT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      loader.setEnabled(v);
    },
  };
}

export async function refreshTrafficFlowLayer(
  map: MapLibreMap,
  bbox?: Bbox,
): Promise<{ trafficFlowCount: number }> {
  if (!bbox && map.getZoom() < TRAFFIC_FLOW_MIN_ZOOM) {
    return { trafficFlowCount: 0 };
  }
  const targetBbox = bbox ?? (() => {
    const b = map.getBounds();
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  })();
  const res = await fetch(`/api/traffic-flow?bbox=${bboxToParam(targetBbox)}`);
  if (!res.ok) {
    console.warn("failed to fetch traffic flow", await res.text());
    return { trafficFlowCount: 0 };
  }

  const { segments } = (await res.json()) as { segments: TrafficFlowSegment[] };
  const geojson: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString> = {
    type: "FeatureCollection",
    features: segments.map((s) => ({
      type: "Feature",
      geometry: s.geometry,
      properties: {
        site_id: s.site_id,
        fid: s.fid,
        vehicle_flow_rate: s.vehicle_flow_rate,
        average_vehicle_speed: s.average_vehicle_speed,
        data_quality: s.data_quality,
        measurement_time: s.measurement_time,
        last_seen: s.last_seen,
        category: s.category,
        sample_count: s.sample_count,
        snap_distance_m: s.snap_distance_m,
      },
    })),
  };

  const src = map.getSource(TRAFFIC_FLOW_SOURCE_ID) as GeoJSONSource | undefined;
  src?.setData(geojson);
  return { trafficFlowCount: segments.length };
}

// rAF-loop som pulserar halo-lagret. Klassiskt "radar-ping": radien expanderar
// och opaciteten tonas ut, sen reset. Loopen avbryter sig själv när lagret
// inte längre finns på kartan (efter map.remove()).
function startLivePulse(map: MapLibreMap): void {
  const start = performance.now();
  const PERIOD_MS = 1600;
  const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
  const tick = () => {
    if (!map.getLayer(LIVE_HALO_LAYER_ID)) return;
    const phase = ((performance.now() - start) % PERIOD_MS) / PERIOD_MS;
    const rising = phase <= 0.5;
    const halfProgress = rising ? phase / 0.5 : (phase - 0.5) / 0.5;
    const eased = easeInOut(halfProgress);
    const pulse = rising ? eased : 1 - eased;
    const radius = 5 + pulse * 7;
    const opacity = 0.3 * pulse;
    map.setPaintProperty(LIVE_HALO_LAYER_ID, "circle-radius", radius);
    map.setPaintProperty(LIVE_HALO_LAYER_ID, "circle-opacity", opacity);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Delad bbox-driven loader för NVDB-lagren (ADT).
//
// - Padder bbox 30% i varje riktning så små panoreringar inte refetchar.
// - Säkerhetsventil mot stora bbox (zoom 7-8 hit p.g.a. resize/hot-reload):
//   skippa fetch om paddad bbox > 8 sq° (timeout-risk på Supabase free tier).
// - `setEnabled(false)` pausar fetch (när lagret är toggled off).
//   Vid `setEnabled(true)` triggas refresh; cachen behålls så ingen onödig
//   fetch sker om viewporten inte hunnit röra sig.
type BboxLoader = { setEnabled: (v: boolean) => void };
type AdtTile = Bbox & { key: string; centerLng: number; centerLat: number };
type LargeRoadTile = Bbox & { key: string; centerLng: number; centerLat: number };
type Coordinate2D = [number, number];
type SpeedBadgeCandidate = {
  feature: GeoJSON.Feature<GeoJSON.Point>;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};
type LargeRoadFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
type SpeedRunPart = {
  index: number;
  key: string;
  speedLimit: number;
  lengthM: number;
  endpoints: Coordinate2D[];
};

function toCoordinate2D(position: GeoJSON.Position | undefined): Coordinate2D | null {
  const lng = position?.[0];
  const lat = position?.[1];
  return typeof lng === "number" && typeof lat === "number" ? [lng, lat] : null;
}

function createBboxLoader(
  map: MapLibreMap,
  opts: {
    minZoom: number;
    initialEnabled?: boolean;
    bboxPadding?: number;
    maxBboxAreaDeg2?: number;
    fetchBbox: (b: Bbox) => Promise<void>;
  },
): BboxLoader {
  const BBOX_PADDING = opts.bboxPadding ?? 0.3;
  const MAX_BBOX_AREA_DEG2 = opts.maxBboxAreaDeg2 ?? 8;

  let cachedBbox: Bbox | null = null;
  let inFlight = false;
  let needsRefresh = false;
  let enabled = opts.initialEnabled ?? true;

  const contains = (outer: Bbox, inner: Bbox) =>
    outer.west <= inner.west &&
    outer.east >= inner.east &&
    outer.south <= inner.south &&
    outer.north >= inner.north;

  const refresh = async (): Promise<void> => {
    if (!enabled) return;
    if (map.getZoom() < opts.minZoom) return;
    if (inFlight) {
      needsRefresh = true;
      return;
    }
    const b = map.getBounds();
    const viewport: Bbox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    if (cachedBbox && contains(cachedBbox, viewport)) return;

    const padW = (viewport.east - viewport.west) * BBOX_PADDING;
    const padH = (viewport.north - viewport.south) * BBOX_PADDING;
    const padded: Bbox = {
      west: viewport.west - padW,
      south: viewport.south - padH,
      east: viewport.east + padW,
      north: viewport.north + padH,
    };
    const area = (padded.east - padded.west) * (padded.north - padded.south);
    if (area > MAX_BBOX_AREA_DEG2) return;

    inFlight = true;
    try {
      await opts.fetchBbox(padded);
      cachedBbox = padded;
    } finally {
      inFlight = false;
      if (needsRefresh) {
        needsRefresh = false;
        void refresh();
      }
    }
  };

  map.on("moveend", () => { void refresh(); });
  void refresh();

  return {
    setEnabled: (v: boolean) => {
      if (enabled === v) return;
      enabled = v;
      if (v) void refresh();
    },
  };
}

function bboxToParam(b: Bbox): string {
  return [b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(",");
}

function mapBoundsBbox(map: MapLibreMap, padding = 0): Bbox {
  const b = map.getBounds();
  const viewport: Bbox = {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  };
  const padW = (viewport.east - viewport.west) * padding;
  const padH = (viewport.north - viewport.south) * padding;
  return {
    west: Math.max(-180, viewport.west - padW),
    south: Math.max(-90, viewport.south - padH),
    east: Math.min(180, viewport.east + padW),
    north: Math.min(90, viewport.north + padH),
  };
}

function adtTilesForBbox(b: Bbox, center: { lng: number; lat: number }): AdtTile[] {
  const minX = Math.floor(b.west / ADT_TILE_DEG);
  const maxX = Math.floor(b.east / ADT_TILE_DEG);
  const minY = Math.floor(b.south / ADT_TILE_DEG);
  const maxY = Math.floor(b.north / ADT_TILE_DEG);
  const tiles: AdtTile[] = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const west = x * ADT_TILE_DEG;
      const south = y * ADT_TILE_DEG;
      const east = west + ADT_TILE_DEG;
      const north = south + ADT_TILE_DEG;
      tiles.push({
        key: `${x}:${y}`,
        west,
        south,
        east,
        north,
        centerLng: west + ADT_TILE_DEG / 2,
        centerLat: south + ADT_TILE_DEG / 2,
      });
    }
  }

  return tiles.sort((a, bTile) => {
    const da = (a.centerLng - center.lng) ** 2 + (a.centerLat - center.lat) ** 2;
    const db = (bTile.centerLng - center.lng) ** 2 + (bTile.centerLat - center.lat) ** 2;
    return da - db;
  });
}

function largeRoadTilesForBbox(b: Bbox, center: { lng: number; lat: number }): LargeRoadTile[] {
  const minX = Math.floor(b.west / LARGE_ROADS_TILE_DEG);
  const maxX = Math.floor(b.east / LARGE_ROADS_TILE_DEG);
  const minY = Math.floor(b.south / LARGE_ROADS_TILE_DEG);
  const maxY = Math.floor(b.north / LARGE_ROADS_TILE_DEG);
  const tiles: LargeRoadTile[] = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const west = x * LARGE_ROADS_TILE_DEG;
      const south = y * LARGE_ROADS_TILE_DEG;
      const east = west + LARGE_ROADS_TILE_DEG;
      const north = south + LARGE_ROADS_TILE_DEG;
      tiles.push({
        key: `${x}:${y}`,
        west,
        south,
        east,
        north,
        centerLng: west + LARGE_ROADS_TILE_DEG / 2,
        centerLat: south + LARGE_ROADS_TILE_DEG / 2,
      });
    }
  }

  return tiles.sort((a, bTile) => {
    const da = (a.centerLng - center.lng) ** 2 + (a.centerLat - center.lat) ** 2;
    const db = (bTile.centerLng - center.lng) ** 2 + (bTile.centerLat - center.lat) ** 2;
    return da - db;
  });
}

function geometryMidpoint(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): [number, number] | null {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const segments: { a: Coordinate2D; b: Coordinate2D; length: number }[] = [];
  let totalLength = 0;

  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = toCoordinate2D(line[i - 1]);
      const b = toCoordinate2D(line[i]);
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) continue;
      segments.push({ a, b, length });
      totalLength += length;
    }
  }

  if (segments.length === 0) {
    return toCoordinate2D(lines[0]?.[0]);
  }

  let traveled = 0;
  const target = totalLength / 2;
  for (const segment of segments) {
    if (traveled + segment.length >= target) {
      const t = (target - traveled) / segment.length;
      return [
        segment.a[0] + (segment.b[0] - segment.a[0]) * t,
        segment.a[1] + (segment.b[1] - segment.a[1]) * t,
      ];
    }
    traveled += segment.length;
  }

  const last = segments.at(-1)?.b;
  if (!last) return null;
  return [last[0], last[1]];
}

function projectedGeometryLength(
  map: MapLibreMap,
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
): number {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  let length = 0;

  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = toCoordinate2D(line[i - 1]);
      const b = toCoordinate2D(line[i]);
      if (!a || !b) continue;
      const pa = map.project(a);
      const pb = map.project(b);
      length += Math.hypot(pb.x - pa.x, pb.y - pa.y);
    }
  }

  return length;
}

function distanceMeters(a: Coordinate2D, b: Coordinate2D): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.cos(lat) * 111_320;
  return Math.hypot((b[0] - a[0]) * metersPerDegLng, (b[1] - a[1]) * metersPerDegLat);
}

function geometryEndpoints(geometry: GeoJSON.LineString | GeoJSON.MultiLineString): Coordinate2D[] {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const endpoints: Coordinate2D[] = [];
  for (const line of lines) {
    const first = toCoordinate2D(line[0]);
    const last = toCoordinate2D(line.at(-1));
    if (first) endpoints.push(first);
    if (last && (!first || last[0] !== first[0] || last[1] !== first[1])) endpoints.push(last);
  }
  return endpoints;
}

function visibleLargeRoadKeys(entries: Array<[string, LargeRoadFeature]>): Set<string> {
  const visible = new Set<string>();
  const speedParts: SpeedRunPart[] = [];

  for (const [key, feature] of entries) {
    if (feature.properties?.class !== "high_speed") {
      visible.add(key);
      continue;
    }

    const speedLimit = Number(feature.properties.speed_limit);
    const lengthM = Number(feature.properties.length_m);
    const endpoints = geometryEndpoints(feature.geometry);
    if (!Number.isFinite(speedLimit) || !Number.isFinite(lengthM) || endpoints.length === 0) {
      continue;
    }

    speedParts.push({
      index: speedParts.length,
      key,
      speedLimit,
      lengthM,
      endpoints,
    });
  }

  const parent = speedParts.map((part) => part.index);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) {
      const next = parent[root];
      if (next === undefined) break;
      root = next;
    }
    while (parent[i] !== i) {
      const next = parent[i];
      if (next === undefined) break;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const bucketSizeDeg = 0.002;
  const buckets = new Map<string, Array<{ partIndex: number; point: Coordinate2D }>>();
  const bucketKey = (point: Coordinate2D) =>
    `${Math.floor(point[0] / bucketSizeDeg)}:${Math.floor(point[1] / bucketSizeDeg)}`;

  for (const part of speedParts) {
    for (const point of part.endpoints) {
      const x = Math.floor(point[0] / bucketSizeDeg);
      const y = Math.floor(point[1] / bucketSizeDeg);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(`${x + dx}:${y + dy}`);
          if (!bucket) continue;
          for (const other of bucket) {
            const otherPart = speedParts[other.partIndex];
            if (!otherPart) continue;
            if (otherPart.speedLimit !== part.speedLimit) continue;
            if (distanceMeters(point, other.point) <= LARGE_ROADS_SPEED_CONNECT_DISTANCE_M) {
              union(part.index, other.partIndex);
            }
          }
        }
      }

      const key = bucketKey(point);
      const bucket = buckets.get(key) ?? [];
      bucket.push({ partIndex: part.index, point });
      buckets.set(key, bucket);
    }
  }

  const runLengths = new Map<number, number>();
  for (const part of speedParts) {
    const root = find(part.index);
    runLengths.set(root, (runLengths.get(root) ?? 0) + part.lengthM);
  }

  for (const part of speedParts) {
    const root = find(part.index);
    if ((runLengths.get(root) ?? 0) >= LARGE_ROADS_SPEED_RUN_MIN_LENGTH_M) {
      visible.add(part.key);
    }
  }

  return visible;
}

// ÅDT-lager: tile-cacheat via /api/adt vid moveend när zoom ≥ 9.
// Färgar linjer efter trafikflöde (ljusblåvitt → blått). Läggs under risk
// och events så att det läses som underlagsdata, inte slutsatsen.
export function addAdtLayer(map: MapLibreMap): LayerController {
  if (map.getSource(ADT_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(ADT_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(ADT_LAYER_ID)
    ? ADT_LAYER_ID
    : map.getLayer(RISK_LAYER_ID)
    ? RISK_LAYER_ID
    : map.getLayer(HEATMAP_LAYER_ID)
      ? HEATMAP_LAYER_ID
      : undefined;
  map.addLayer(
    {
      id: ADT_LAYER_ID,
      type: "line",
      source: ADT_SOURCE_ID,
      minzoom: NVDB_MIN_ZOOM,
      paint: {
        // Trafikflöde: bas #F2F8FF med #0077FF som overlay i 20%-steg.
        // Skalan hålls blå så den inte läses som samma "fara"-språk som risk.
        "line-color": [
          "interpolate", ["linear"], ["get", "adt_total"],
          0, "#F2F8FF",
          500, "#C2DEFF",
          2000, "#91C4FF",
          5000, "#61ABFF",
          10000, "#3091FF",
          20000, "#0077FF",
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8, 1,
          12, 2.5,
          16, 5,
        ],
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          NVDB_MIN_ZOOM, 0.3,
          NVDB_MIN_ZOOM + 1, 0.7,
        ],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ADT_HIT_LAYER_ID,
      type: "line",
      source: ADT_SOURCE_ID,
      minzoom: NVDB_MIN_ZOOM,
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          9, 18,
          12, 24,
          16, 32,
        ],
      },
    },
    beforeId,
  );

  const featureCache = new Map<number, GeoJSON.Feature<GeoJSON.LineString>>();
  const fetchedTiles = new Set<string>();
  const queuedTiles = new Set<string>();
  const inFlightTiles = new Set<string>();
  const tileQueue: AdtTile[] = [];
  let activeTileFetches = 0;
  let enabled = true;

  const updateSource = () => {
    const fc: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
      type: "FeatureCollection",
      features: Array.from(featureCache.values()),
    };
    const src = map.getSource(ADT_SOURCE_ID) as GeoJSONSource | undefined;
    src?.setData(fc);
  };

  const fetchTile = async (tile: AdtTile) => {
    const res = await fetch(`/api/adt?bbox=${bboxToParam(tile)}`);
    if (!res.ok) {
      console.error("failed to fetch adt", await res.text());
      return;
    }
    const { segments } = (await res.json()) as { segments: AdtSegment[] };
    for (const s of segments) {
      featureCache.set(s.fid, {
        type: "Feature",
        geometry: s.geometry,
        properties: {
          fid: s.fid,
          adt_total: s.adt_total,
          adt_tung: s.adt_tung,
          matar: s.matar,
        },
      });
    }
    fetchedTiles.add(tile.key);
    updateSource();
  };

  const pumpTiles = () => {
    if (!enabled) return;
    while (activeTileFetches < ADT_MAX_CONCURRENT_TILES && tileQueue.length > 0) {
      const tile = tileQueue.shift();
      if (!tile) return;
      queuedTiles.delete(tile.key);
      if (fetchedTiles.has(tile.key) || inFlightTiles.has(tile.key)) continue;

      activeTileFetches++;
      inFlightTiles.add(tile.key);
      void fetchTile(tile).finally(() => {
        activeTileFetches--;
        inFlightTiles.delete(tile.key);
        pumpTiles();
      });
    }
  };

  const refreshTiles = () => {
    if (!enabled) return;
    if (map.getZoom() < NVDB_MIN_ZOOM) return;

    const b = map.getBounds();
    const viewport: Bbox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    const padW = (viewport.east - viewport.west) * ADT_TILE_PADDING;
    const padH = (viewport.north - viewport.south) * ADT_TILE_PADDING;
    const padded: Bbox = {
      west: viewport.west - padW,
      south: viewport.south - padH,
      east: viewport.east + padW,
      north: viewport.north + padH,
    };
    const center = map.getCenter();
    const nextTiles = adtTilesForBbox(padded, center).filter(
      (tile) => !fetchedTiles.has(tile.key) &&
        !queuedTiles.has(tile.key) &&
        !inFlightTiles.has(tile.key),
    );
    for (const tile of nextTiles) queuedTiles.add(tile.key);
    tileQueue.unshift(...nextTiles);
    pumpTiles();
  };

  map.on("moveend", refreshTiles);
  map.on("zoomend", refreshTiles);
  map.on("idle", refreshTiles);
  window.setTimeout(refreshTiles, 0);

  return {
    setVisible: (v) => {
      if (map.getLayer(ADT_LAYER_ID)) {
        map.setLayoutProperty(ADT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (map.getLayer(ADT_HIT_LAYER_ID)) {
        map.setLayoutProperty(ADT_HIT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      enabled = v;
      if (v) refreshTiles();
    },
  };
}

// Trygghetsfiltret "Hastighet".
// Bbox-drivet NVDB-lager från Lastkajen: bara skyltad hastighet 90+.
// Vägtyp-rader utan hastighetsvärde filtreras bort i API:t eftersom de kan
// representera större vägar som ändå är 80-vägar i verkligheten.
export function addLargeRoadsLayer(map: MapLibreMap): LayerController {
  if (map.getSource(LARGE_ROADS_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(LARGE_ROADS_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(LARGE_ROADS_BADGE_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(RISK_LAYER_ID)
    ? RISK_LAYER_ID
    : map.getLayer(HEATMAP_LAYER_ID)
      ? HEATMAP_LAYER_ID
      : undefined;

  map.addLayer(
    {
      id: LARGE_ROADS_LAYER_ID,
      type: "line",
      source: LARGE_ROADS_SOURCE_ID,
      minzoom: LARGE_ROADS_MIN_ZOOM,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        visibility: "visible",
        "line-sort-key": ["get", "rank"],
      },
      paint: {
        "line-color": [
          "step", ["to-number", ["get", "speed_limit"]],
          SPEED_ROAD_COLORS[90],
          100, SPEED_ROAD_COLORS[100],
          110, SPEED_ROAD_COLORS[110],
          120, SPEED_ROAD_COLORS[120],
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          LARGE_ROADS_MIN_ZOOM, 1.5,
          12, 4,
          16, 8,
        ],
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          LARGE_ROADS_MIN_ZOOM, 0.35,
          LARGE_ROADS_MIN_ZOOM + 1, 0.75,
        ],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: LARGE_ROADS_BADGE_LAYER_ID,
      type: "symbol",
      source: LARGE_ROADS_BADGE_SOURCE_ID,
      minzoom: LARGE_ROADS_MIN_ZOOM,
      layout: {
        "icon-image": ["get", "speed_badge"],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          LARGE_ROADS_MIN_ZOOM, 0.9,
          12, 1,
        ],
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "icon-padding": 12,
        visibility: "visible",
      },
      paint: {
        "icon-opacity": [
          "interpolate", ["linear"], ["zoom"],
          LARGE_ROADS_MIN_ZOOM, 0.85,
          LARGE_ROADS_MIN_ZOOM + 1, 1,
        ],
      },
    },
    beforeId,
  );

  const featureCache = new Map<string, LargeRoadFeature>();
  const badgeCache = new Map<string, SpeedBadgeCandidate>();
  const fetchedTiles = new Set<string>();
  const queuedTiles = new Set<string>();
  const inFlightTiles = new Set<string>();
  const tileQueue: LargeRoadTile[] = [];
  let activeTileFetches = 0;
  let enabled = false;
  let visibleFeatureKeys = new Set<string>();

  const updateSource = () => {
    const entries = Array.from(featureCache.entries());
    visibleFeatureKeys = visibleLargeRoadKeys(entries);
    const fc: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString> = {
      type: "FeatureCollection",
      features: entries.flatMap(([key, feature]) => visibleFeatureKeys.has(key) ? [feature] : []),
    };
    const src = map.getSource(LARGE_ROADS_SOURCE_ID) as GeoJSONSource | undefined;
    src?.setData(fc);
    updateBadgeSource();
  };

  const updateBadgeSource = () => {
    const cellSize = map.getZoom() < 10 ? 130 : 96;
    const usedCells = new Set<string>();
    const badges = Array.from(badgeCache.entries()).flatMap(([featureKey, candidate]) => {
      if (!visibleFeatureKeys.has(featureKey)) return [];
      if (projectedGeometryLength(map, candidate.geometry) < LARGE_ROADS_BADGE_MIN_LINE_PX) {
        return [];
      }
      const { feature } = candidate;
      const lng = feature.geometry.coordinates[0];
      const lat = feature.geometry.coordinates[1];
      if (typeof lng !== "number" || typeof lat !== "number") return [];
      const point = map.project([lng, lat]);
      const cellKey = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
      if (usedCells.has(cellKey)) return [];
      usedCells.add(cellKey);
      return [feature];
    });

    const fc: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: badges,
    };
    const src = map.getSource(LARGE_ROADS_BADGE_SOURCE_ID) as GeoJSONSource | undefined;
    src?.setData(fc);
  };

  const positionBadgeLayer = () => {
    if (!map.getLayer(LARGE_ROADS_BADGE_LAYER_ID)) return;
    const beforeBadgeLayer = map.getLayer(CIRCLE_LAYER_ID) ? CIRCLE_LAYER_ID : undefined;
    map.moveLayer(LARGE_ROADS_BADGE_LAYER_ID, beforeBadgeLayer);
  };

  const fetchTile = async (tile: LargeRoadTile) => {
    const res = await fetch(`/api/large-roads?bbox=${bboxToParam(tile)}`);
      if (!res.ok) {
        console.error("failed to fetch large roads", await res.text());
        return;
      }
      const { segments } = (await res.json()) as { segments: LargeRoadSegment[] };
      for (const s of segments) {
        const speedBadge = ensureSpeedBadgeImage(map, s.speed_limit);
        const featureKey = `${s.class}:${s.fid}`;
        featureCache.set(featureKey, {
          type: "Feature",
          geometry: s.geometry,
          properties: {
            fid: s.fid,
            element_id: s.element_id,
            class: s.class,
            rank: s.rank,
            speed_limit: s.speed_limit,
            speed_badge: speedBadge,
            road_type: s.road_type,
            length_m: s.length_m,
          },
        });
        const midpoint = speedBadge ? geometryMidpoint(s.geometry) : null;
        if (midpoint) {
          badgeCache.set(featureKey, {
            feature: {
              type: "Feature",
              geometry: { type: "Point", coordinates: midpoint },
              properties: {
                fid: s.fid,
                speed_limit: s.speed_limit,
                speed_badge: speedBadge,
              },
            },
            geometry: s.geometry,
          });
        }
      }
    fetchedTiles.add(tile.key);
    updateSource();
  };

  const pumpTiles = () => {
    if (!enabled) return;
    while (activeTileFetches < LARGE_ROADS_MAX_CONCURRENT_TILES && tileQueue.length > 0) {
      const tile = tileQueue.shift();
      if (!tile) return;
      queuedTiles.delete(tile.key);
      if (fetchedTiles.has(tile.key) || inFlightTiles.has(tile.key)) continue;

      activeTileFetches++;
      inFlightTiles.add(tile.key);
      void fetchTile(tile).finally(() => {
        activeTileFetches--;
        inFlightTiles.delete(tile.key);
        pumpTiles();
      });
    }
  };

  const refreshTiles = () => {
    if (!enabled) return;
    if (map.getZoom() < LARGE_ROADS_MIN_ZOOM) return;
    updateBadgeSource();

    const b = map.getBounds();
    const viewport: Bbox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
    const padW = (viewport.east - viewport.west) * LARGE_ROADS_TILE_PADDING;
    const padH = (viewport.north - viewport.south) * LARGE_ROADS_TILE_PADDING;
    const padded: Bbox = {
      west: viewport.west - padW,
      south: viewport.south - padH,
      east: viewport.east + padW,
      north: viewport.north + padH,
    };
    const center = map.getCenter();

    const nextTiles: LargeRoadTile[] = [];
    for (const tile of largeRoadTilesForBbox(padded, center)) {
      if (fetchedTiles.has(tile.key) || queuedTiles.has(tile.key) || inFlightTiles.has(tile.key)) {
        continue;
      }
      queuedTiles.add(tile.key);
      nextTiles.push(tile);
    }
    tileQueue.unshift(...nextTiles);
    pumpTiles();
  };

  map.on("moveend", refreshTiles);
  map.on("zoomend", updateBadgeSource);

  return {
    setVisible: (v) => {
      if (map.getLayer(LARGE_ROADS_LAYER_ID)) {
        map.setLayoutProperty(LARGE_ROADS_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (map.getLayer(LARGE_ROADS_BADGE_LAYER_ID)) {
        map.setLayoutProperty(LARGE_ROADS_BADGE_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (enabled === v) return;
      enabled = v;
      if (v) {
        positionBadgeLayer();
        refreshTiles();
      }
    },
  };
}

// Risk-lager: olyckor per miljon fordon per nvdb-segment, från
// materialiserad vy `risk_per_segment`. RPC:n returnerar bara segment där
// events_count > 0 — tomma sträckor ritas inte alls.
//
// Färgskalan är preliminär: vi har bara 1-2 dagar data så värdena är
// mycket högre än de blir när historiken växt (1 olycka på 1 dag på en
// väg med ÅDT 200 → ~1.4M per miljon fordon, vilket är absurt men tekniskt
// rätt för det smala datafönstret). Brytpunkterna nedan kommer behöva
// kalibreras om när vi har 6+ månader data; tills dess är det viktigaste
// att SE något hända i kartan, inte exakt magnitude.
export function addRiskLayer(map: MapLibreMap): LayerController {
  if (map.getSource(RISK_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(RISK_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Risk är slutsatsen, så den läggs ovanpå flöde men under events.
  const beforeId = map.getLayer(HEATMAP_LAYER_ID) ? HEATMAP_LAYER_ID : undefined;

  map.addLayer(
    {
      id: RISK_LAYER_ID,
      type: "line",
      source: RISK_SOURCE_ID,
      minzoom: NVDB_MIN_ZOOM,
      paint: {
        // log10(risk) för att hantera den enorma spridningen vid låg datavolym.
        // log10(1) = 0, log10(1000) = 3, log10(1e6) = 6.
        "line-color": [
          "interpolate", ["linear"],
          ["log10", ["max", 1, ["get", "risk_per_milj_fordon"]]],
          0, "#FFF382",
          1, "#FFCC68",
          2, "#FFA54E",
          3, "#FF7D34",
          4, "#FF561A",
          5, "#FF2F00",
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8, 2,
          12, 4,
          16, 7,
        ],
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          NVDB_MIN_ZOOM, 0.45,
          NVDB_MIN_ZOOM + 1, 0.85,
        ],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: RISK_HIT_LAYER_ID,
      type: "line",
      source: RISK_SOURCE_ID,
      minzoom: NVDB_MIN_ZOOM,
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          9, 20,
          12, 28,
          16, 36,
        ],
      },
    },
    beforeId,
  );

  const loader = createBboxLoader(map, {
    minZoom: NVDB_MIN_ZOOM,
    fetchBbox: async (padded) => {
      const res = await fetch(`/api/risk?bbox=${bboxToParam(padded)}`);
      if (!res.ok) {
        console.error("failed to fetch risk", await res.text());
        return;
      }
      const { segments } = (await res.json()) as { segments: RiskSegment[] };
      const fc: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
        type: "FeatureCollection",
        features: segments.map((s) => ({
          type: "Feature",
          geometry: s.geometry,
          properties: {
            fid: s.fid,
            adt_total: s.adt_total,
            events_count: s.events_count,
            risk_per_milj_fordon: s.risk_per_milj_fordon,
          },
        })),
      };
      const src = map.getSource(RISK_SOURCE_ID) as GeoJSONSource | undefined;
      src?.setData(fc);
    },
  });

  return {
    setVisible: (v) => {
      if (map.getLayer(RISK_LAYER_ID)) {
        map.setLayoutProperty(RISK_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (map.getLayer(RISK_HIT_LAYER_ID)) {
        map.setLayoutProperty(RISK_HIT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      loader.setEnabled(v);
    },
  };
}

// Click → popup för segment, olyckor och aktuella live-lager.
//
// Prioritetsordning vid klick: olyckor → störningar → trafikläge → risk → adt.
// Eventcirklarna ligger överst i render-stacken så ett klick rakt på en
// punkt vinner; klick lite vid sidan om faller igenom till segmentet.
// Osynliga lager filtreras automatiskt bort eftersom queryRenderedFeatures
// bara returnerar visible features.
//
// Event-popup: all data finns redan på feature.properties, ingen fetch behövs.
// Segment-popup: behöver RPC-anrop, så vi visar "Laddar…" först.
//
// Cursor → pointer på hover så användaren ser att lagren är klickbara.
//
// Popupar renderas via setHTML — alla värden från databasen passerar
// escapeHtml() eftersom de kommer från Trafikverkets API och kan innehålla
// godtyckliga strängar.
export function addPopupHandler(map: MapLibreMap): void {
  const segmentLayerIds = [RISK_HIT_LAYER_ID, RISK_LAYER_ID, ADT_HIT_LAYER_ID, ADT_LAYER_ID];
  const disturbanceLayerIds = [DISTURBANCE_LAYER_ID, DISTURBANCE_HIT_LAYER_ID];
  const trafficFlowLayerIds = [TRAFFIC_FLOW_LAYER_ID, TRAFFIC_FLOW_HIT_LAYER_ID];
  // Live-core ovanpå historisk circle, halo skippas (dekorativ — klick går
  // igenom till core eller faller till segment). Hit-target sist: fångar
  // klick på historiska events vid låg zoom där CIRCLE_LAYER_ID inte renderas.
  const eventLayerIds = [LIVE_CORE_LAYER_ID, CIRCLE_LAYER_ID, HIT_TARGET_LAYER_ID];
  const allLayerIds = [...eventLayerIds, ...disturbanceLayerIds, ...trafficFlowLayerIds, ...segmentLayerIds];

  for (const id of allLayerIds) {
    map.on("mouseenter", id, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", id, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: allLayerIds });
    if (!features.length) return;

    // Olyckor vinner alltid, därefter färska störningar, sedan segment i
    // prioritetsordning Risk → ADT.
    const eventFeature = features.find((f) => eventLayerIds.includes(f.layer.id));
    if (eventFeature) {
      openEventPopup(map, e.lngLat, eventFeature.properties);
      return;
    }

    const disturbanceFeature = features.find((f) => disturbanceLayerIds.includes(f.layer.id));
    if (disturbanceFeature) {
      openDisturbancePopup(map, e.lngLat, disturbanceFeature.properties);
      return;
    }

    const trafficFlowFeature = features.find((f) => trafficFlowLayerIds.includes(f.layer.id));
    if (trafficFlowFeature) {
      openTrafficFlowPopup(map, e.lngLat, trafficFlowFeature.properties);
      return;
    }

    let segmentFeature: (typeof features)[number] | undefined;
    for (const id of segmentLayerIds) {
      const f = features.find((x) => x.layer.id === id);
      if (f) {
        segmentFeature = f;
        break;
      }
    }
    if (!segmentFeature) return;

    const fid = Number(segmentFeature.properties?.fid);
    if (!Number.isFinite(fid)) return;
    openSegmentPopup(map, e.lngLat, fid);
  });
}

function openTrafficFlowPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  props: Record<string, unknown> | null,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderTrafficFlow(props ?? {}))
    .addTo(map);
  void popup;
}

function openDisturbancePopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  props: Record<string, unknown> | null,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderDisturbance(props ?? {}))
    .addTo(map);
  void popup;
}

function openEventPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  props: Record<string, unknown> | null,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderEvent(props ?? {}))
    .addTo(map);
  // Hålla popup-referensen "alive" via closure tills användaren stänger den —
  // MapLibre tar hand om resten.
  void popup;
}

function openSegmentPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  fid: number,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderLoading())
    .addTo(map);

  fetch(`/api/segment?fid=${fid}`)
    .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
    .then(({ ok, body }) => {
      if (!ok || !body?.segment) {
        popup.setHTML(renderError(body?.error ?? "okänt fel"));
        return;
      }
      popup.setHTML(renderSegment(body.segment as SegmentDetail));
    })
    .catch((err: unknown) => {
      popup.setHTML(renderError(err instanceof Error ? err.message : String(err)));
    });
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}

function renderLoading(): string {
  return `<div class="seg-popup-body"><div class="seg-popup-loading">Laddar segment…</div></div>`;
}

function renderError(msg: string): string {
  return `<div class="seg-popup-body"><div class="seg-popup-error">Kunde inte ladda data: ${escapeHtml(msg)}</div></div>`;
}

// Trösklar för "tunt underlag"-hint på risk-procenten. Under 30 dagar är
// uppskattningen för osäker för att tas på allvar; vi visar talet men
// markerar det och lägger en footnote.
const DATA_WINDOW_THIN_DAYS = 30;

function formatDataWindow(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} ${hours === 1 ? "timme" : "timmar"}`;
  }
  if (days < 30) {
    return `${days.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} dagar`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} ${months === 1 ? "månad" : "månader"}`;
  }
  const years = days / 365;
  return `${years.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} år`;
}

function formatRiskPct(pct: number): string {
  // Två signifikanta siffror skalar bra över magnituder:
  // 0,000023 → "0,000023", 0,52 → "0,52", 12 → "12".
  return `${pct.toLocaleString("sv-SE", { maximumSignificantDigits: 2 })} %`;
}

function renderSegment(s: SegmentDetail): string {
  const adt = typeof s.adt_total === "number"
    ? `${s.adt_total.toLocaleString("sv-SE")} fordon/dygn`
    : "okänd";
  const matarSuffix = s.matar ? ` <span class="seg-popup-muted">(mätår ${escapeHtml(s.matar)})</span>` : "";
  const eventsCount = s.events_count ?? 0;
  const langd = typeof s.langd_m === "number" ? Math.round(s.langd_m) : null;
  const days = typeof s.data_window_days === "number" ? s.data_window_days : 0;
  const isThinData = days < DATA_WINDOW_THIN_DAYS;
  const dataWindowText = formatDataWindow(days);
  const riskPct = s.risk_per_passage_pct;

  const riskRow = eventsCount > 0 && typeof riskPct === "number"
    ? `<dt>Risk</dt><dd>≈ ${escapeHtml(formatRiskPct(riskPct))} per passage${isThinData ? ' <span class="seg-popup-warn">*</span>' : ""}</dd>`
    : "";

  // Vägnummer hämtas från events (NVDB själv har inte vägnummer i adt-vyn).
  // Om olika events i samma segment har olika vägnummer (t.ex. avfart/påfart)
  // visar vi alla unika.
  const roadNumbers = Array.from(
    new Set(s.recent_events.map((e) => e.road_number).filter((r): r is string => !!r)),
  );
  const headerRoad = roadNumbers.length
    ? `<div class="seg-popup-road">${escapeHtml(roadNumbers.join(", "))}</div>`
    : "";

  const recent = s.recent_events.slice(0, 3).map((ev) => {
    const date = new Date(ev.first_seen).toLocaleDateString("sv-SE");
    const rn = ev.road_number ? `<span class="seg-popup-road-tag">${escapeHtml(ev.road_number)}</span>` : "";
    const msg = ev.message ? escapeHtml(ev.message).slice(0, 100) : "";
    return `<li><span class="seg-popup-date">${escapeHtml(date)}</span> ${rn}<span class="seg-popup-msg">${msg}</span></li>`;
  }).join("");

  const moreNote = s.recent_events.length > 3
    ? `<div class="seg-popup-more">+${s.recent_events.length - 3} äldre olyckor i segmentet</div>`
    : "";

  const recentBlock = eventsCount > 0
    ? `<div class="seg-popup-section-title">Senaste olyckor</div>
       <ul class="seg-popup-events">${recent}</ul>
       ${moreNote}`
    : `<div class="seg-popup-empty">Inga registrerade olyckor sedan datainsamlingen startade.</div>`;

  const thinDataNote = eventsCount > 0 && isThinData
    ? `<div class="seg-popup-warn-note">* Datafönstret är kort — riskvärdet är preliminärt och kan förändras kraftigt när mer historik samlats in.</div>`
    : "";

  return `
    <div class="seg-popup-body">
      ${headerRoad}
      <dl class="seg-popup-stats">
        <dt>ÅDT</dt><dd>${escapeHtml(adt)}${matarSuffix}</dd>
        <dt>Olyckor</dt><dd>${eventsCount}</dd>
        ${riskRow}
        <dt>Datafönster</dt><dd>${escapeHtml(dataWindowText)}</dd>
      </dl>
      ${recentBlock}
      ${thinDataNote}
      <div class="seg-popup-footer">
        Siffrorna gäller hela vägsegmentet${langd ? ` (~${langd} m)` : ""}, från korsning till korsning enligt NVDB.
      </div>
    </div>
  `;
}

// Event-popup. Datan kommer direkt från feature.properties (MapLibre
// serialiserar properties-objektet) — ingen extra fetch behövs. Eftersom
// MapLibre kan stringifiera nested values läser vi varje fält defensivt.
function renderEvent(props: Record<string, unknown>): string {
  const message = typeof props.message === "string" ? props.message : "";
  const roadNumber = typeof props.road_number === "string" ? props.road_number : "";
  const severity = typeof props.severity === "string" ? props.severity : "";
  const firstSeenRaw = typeof props.first_seen === "string" ? props.first_seen : "";
  const dateText = firstSeenRaw
    ? new Date(firstSeenRaw).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
    : "";

  const headerRoad = roadNumber
    ? `<div class="seg-popup-road">${escapeHtml(roadNumber)}</div>`
    : "";
  const dateLine = dateText
    ? `<div class="seg-popup-date seg-popup-event-date">${escapeHtml(dateText)}</div>`
    : "";
  const severityLine = severity
    ? `<div class="seg-popup-muted seg-popup-event-severity">${escapeHtml(severity)}</div>`
    : "";
  const messageBlock = message
    ? `<div class="seg-popup-event-msg">${escapeHtml(message)}</div>`
    : `<div class="seg-popup-empty">Ingen beskrivning från Trafikverket.</div>`;

  return `
    <div class="seg-popup-body">
      ${headerRoad}
      ${dateLine}
      ${severityLine}
      ${messageBlock}
      <div class="seg-popup-footer">
        Klicka på vägsegmentet för aggregerad statistik. Saknas vägen i ÅDT-datasetet visas ingen färgning.
      </div>
    </div>
  `;
}

function renderDisturbance(props: Record<string, unknown>): string {
  const message = typeof props.message === "string" ? props.message : "";
  const messageType = typeof props.message_type === "string" ? props.message_type : "";
  const roadNumber = typeof props.road_number === "string" ? props.road_number : "";
  const severity = typeof props.severity === "string" ? props.severity : "";
  const lastSeenRaw = typeof props.last_seen === "string" ? props.last_seen : "";
  const dateText = lastSeenRaw
    ? new Date(lastSeenRaw).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
    : "";

  const headerRoad = roadNumber
    ? `<div class="seg-popup-road">${escapeHtml(roadNumber)}</div>`
    : "";
  const typeLine = messageType
    ? `<div class="seg-popup-muted seg-popup-event-severity">${escapeHtml(messageType)}</div>`
    : "";
  const dateLine = dateText
    ? `<div class="seg-popup-date seg-popup-event-date">Uppdaterad ${escapeHtml(dateText)}</div>`
    : "";
  const severityLine = severity
    ? `<div class="seg-popup-muted seg-popup-event-severity">${escapeHtml(severity)}</div>`
    : "";
  const messageBlock = message
    ? `<div class="seg-popup-event-msg">${escapeHtml(message)}</div>`
    : `<div class="seg-popup-empty">Ingen beskrivning från Trafikverket.</div>`;

  return `
    <div class="seg-popup-body">
      ${headerRoad}
      ${typeLine}
      ${dateLine}
      ${severityLine}
      ${messageBlock}
      <div class="seg-popup-footer">
        Aktuell trafikstörning från Trafikverket. Den ingår inte i riskhistoriken.
      </div>
    </div>
  `;
}

function trafficFlowCategoryLabel(category: string): string {
  switch (category) {
    case "calm": return "Lugnt";
    case "moving": return "Rullar";
    case "busy": return "Tät trafik";
    case "slow": return "Långsamt";
    default: return "Trafikläge";
  }
}

function renderTrafficFlow(props: Record<string, unknown>): string {
  const siteId = typeof props.site_id === "number" || typeof props.site_id === "string"
    ? String(props.site_id)
    : "";
  const flow = typeof props.vehicle_flow_rate === "number"
    ? `${Math.round(props.vehicle_flow_rate).toLocaleString("sv-SE")} fordon/timme`
    : "okänt";
  const speed = typeof props.average_vehicle_speed === "number"
    ? `${props.average_vehicle_speed.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km/h`
    : "okänd";
  const quality = typeof props.data_quality === "string" ? props.data_quality : "";
  const category = typeof props.category === "string" ? props.category : "";
  const samples = typeof props.sample_count === "number" ? props.sample_count : null;
  const snapDistance = typeof props.snap_distance_m === "number" ? Math.round(props.snap_distance_m) : null;
  const measurementRaw = typeof props.measurement_time === "string" ? props.measurement_time : "";
  const dateText = measurementRaw
    ? new Date(measurementRaw).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
    : "";

  const header = `<div class="seg-popup-road">${escapeHtml(trafficFlowCategoryLabel(category))}</div>`;
  const dateLine = dateText
    ? `<div class="seg-popup-date seg-popup-event-date">Mätt ${escapeHtml(dateText)}</div>`
    : "";
  const qualityLine = quality
    ? `<div class="seg-popup-muted seg-popup-event-severity">Datakvalitet: ${escapeHtml(quality)}</div>`
    : "";
  const samplesLine = samples && samples > 1
    ? `<dt>Mätpunkter</dt><dd>${samples.toLocaleString("sv-SE")} körfält/sensorer</dd>`
    : "";
  const snapLine = snapDistance !== null
    ? `<dt>Snappning</dt><dd>${snapDistance.toLocaleString("sv-SE")} m från mätplats</dd>`
    : "";

  return `
    <div class="seg-popup-body">
      ${header}
      ${dateLine}
      ${qualityLine}
      <dl class="seg-popup-stats">
        <dt>Flöde nu</dt><dd>${escapeHtml(flow)}</dd>
        <dt>Snitthastighet</dt><dd>${escapeHtml(speed)}</dd>
        ${samplesLine}
        ${snapLine}
      </dl>
      <div class="seg-popup-footer">
        Trafikverkets TrafficFlow-data från mätplats${siteId ? ` ${escapeHtml(siteId)}` : ""}, visad på närmaste NVDB-segment. Färgen gäller mätplatsen, inte hela vägen.
      </div>
    </div>
  `;
}
