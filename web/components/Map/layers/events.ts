import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import { LIVE_EVENT_THRESHOLD_MS } from "@trafik/shared";
import type { EventPoint } from "@/app/api/events/route";
import {
  bboxContains,
  bboxToParam,
  clipBboxToLayerBounds,
  mapBoundsBbox,
  paddedBbox,
  type Bbox,
} from "./bbox";
import type { LayerLoadingCallback } from "./types";

type HeatmapStop = { density: number; color: string; alpha: number };
type EventsLayerCache = {
  bbox: Bbox | null;
  inFlight: boolean;
  liveCount: number;
  needsRefresh: boolean;
};

const DEFAULT_HEATMAP_STOPS: HeatmapStop[] = [
  { density: 0, color: "#000000", alpha: 0 },
  { density: 0.4, color: "#666666", alpha: 0.25 },
  { density: 0.51, color: "#666666", alpha: 1 },
];

const SOURCE_ID = "events";
export const HEATMAP_LAYER_ID = "events-heatmap";
const CIRCLE_LAYER_ID = "events-circles";
const HIT_TARGET_LAYER_ID = "events-hit-target";
export const LIVE_HALO_LAYER_ID = "events-live-halo";
export const LIVE_CORE_LAYER_ID = "events-live-core";

const SWEDEN_EVENTS_BBOX: Bbox = {
  west: 10.5,
  south: 55,
  east: 24.5,
  north: 69.5,
};
const eventLayerCache = new WeakMap<MapLibreMap, EventsLayerCache>();

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

export async function addEventsLayer(
  map: MapLibreMap,
  opts: { force?: boolean; since?: string | null; onLoadingChange?: LayerLoadingCallback } = {},
): Promise<{ liveCount: number }> {
  const viewport = mapBoundsBbox(map);
  const bbox = viewport ? clipBboxToLayerBounds(paddedBbox(viewport, 0.2)) : null;
  if (!bbox) return { liveCount: 0 };
  let cache = eventLayerCache.get(map);
  if (!cache) {
    cache = { bbox: null, inFlight: false, liveCount: 0, needsRefresh: false };
    eventLayerCache.set(map, cache);
  }

  const sourceExists = Boolean(map.getSource(SOURCE_ID));
  if (!opts.force && !opts.since && sourceExists && cache.bbox && bboxContains(cache.bbox, viewport ?? bbox)) {
    return { liveCount: cache.liveCount };
  }
  if (cache.inFlight) {
    cache.needsRefresh = true;
    opts.onLoadingChange?.(true);
    return { liveCount: cache.liveCount };
  }
  cache.inFlight = true;
  opts.onLoadingChange?.(true);

  const params = new URLSearchParams({ bbox: bboxToParam(bbox) });
  if (opts.since) params.set("since", opts.since);
  let liveCount = cache.liveCount;
  try {
    const url = `/api/events?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("failed to fetch events", await res.text());
      return { liveCount: cache.liveCount };
    }
    const { points } = (await res.json()) as { points: EventPoint[] };

    const liveCutoff = Date.now() - LIVE_EVENT_THRESHOLD_MS;
    liveCount = 0;
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
      cache.bbox = bbox;
      cache.liveCount = liveCount;
      return { liveCount };
    }

    map.addSource(SOURCE_ID, { type: "geojson", data: geojson });
    cache.bbox = bbox;
    cache.liveCount = liveCount;
  } finally {
    cache.inFlight = false;
    if (cache.needsRefresh) {
      cache.needsRefresh = false;
      void addEventsLayer(map, { ...opts, force: true }).finally(() => {
        opts.onLoadingChange?.(false);
      });
    } else {
      opts.onLoadingChange?.(false);
    }
  }

  if (map.getLayer(HEATMAP_LAYER_ID)) {
    return { liveCount };
  }

  // Heatmap - dominerande vid låg/medel zoom. Syns som färgfält över Sverige.
  map.addLayer({
    id: HEATMAP_LAYER_ID,
    type: "heatmap",
    source: SOURCE_ID,
    maxzoom: 13,
    filter: ["!=", ["get", "is_live"], true],
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

  // Enskilda historiska punkter - tonar in vid hög zoom där heatmapen blir glesare.
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

  // Osynligt hit-target för historiska events - alltid aktivt så att
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

export function setEventsLayerVisible(map: MapLibreMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const id of [
    HEATMAP_LAYER_ID,
    CIRCLE_LAYER_ID,
    HIT_TARGET_LAYER_ID,
    LIVE_HALO_LAYER_ID,
    LIVE_CORE_LAYER_ID,
  ]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visibility);
    }
  }
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
  const liveCutoff = Date.now() - LIVE_EVENT_THRESHOLD_MS;
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
