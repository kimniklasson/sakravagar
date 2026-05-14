import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { DisturbancePoint } from "@/app/api/disturbances/route";
import type { TrafficFlowSegment } from "@/app/api/traffic-flow/route";
import {
  bboxArea,
  bboxToParam,
  clipBboxToLayerBounds,
  createBboxLoader,
  mapBoundsBbox,
  type Bbox,
} from "./bbox";
import {
  LIVE_CORE_LAYER_ID,
  LIVE_HALO_LAYER_ID,
} from "./events";
import type { LayerController, LayerLoadingCallback } from "./types";

const DISTURBANCE_SOURCE_ID = "disturbances";
const DISTURBANCE_LAYER_ID = "disturbances-points";
const DISTURBANCE_HIT_LAYER_ID = "disturbances-hit-target";
const DISTURBANCE_MARKER_IMAGE_ID = "disturbance-triangle";
const DISTURBANCE_COLOR = "#999999";
const DISTURBANCE_MIN_ZOOM = 9;

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

function ensureDisturbanceMarkerImages(map: MapLibreMap): void {
  const pixelRatio = 2;
  const size = 22;
  const strokeWidth = 2;

  const addMarker = (id: string) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement("canvas");
    canvas.width = size * pixelRatio;
    canvas.height = size * pixelRatio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(pixelRatio, pixelRatio);
    ctx.beginPath();
    ctx.moveTo(size / 2, 3);
    ctx.lineTo(size - 4, size - 4);
    ctx.lineTo(4, size - 4);
    ctx.closePath();
    ctx.fillStyle = DISTURBANCE_COLOR;
    ctx.fill();
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = "round";
    ctx.stroke();
    map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio });
  };

  addMarker(DISTURBANCE_MARKER_IMAGE_ID);
}

export function addDisturbancesLayer(
  map: MapLibreMap,
  opts: { onLoadingChange?: LayerLoadingCallback } = {},
): LayerController {
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
      minzoom: DISTURBANCE_MIN_ZOOM,
      layout: {
        "icon-image": DISTURBANCE_MARKER_IMAGE_ID,
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          DISTURBANCE_MIN_ZOOM, 0.85,
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
      minzoom: DISTURBANCE_MIN_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], DISTURBANCE_MIN_ZOOM, 12, 12, 18, 16, 24],
        "circle-color": "#000000",
        "circle-opacity": 0,
      },
    },
    beforeId,
  );

  const loader = createBboxLoader(map, {
    minZoom: DISTURBANCE_MIN_ZOOM,
    initialEnabled: false,
    bboxPadding: 0.2,
    maxBboxAreaDeg2: 5000,
    onLoadingChange: opts.onLoadingChange,
    fetchBbox: async (bbox) => {
      await refreshDisturbancesLayer(map, bbox);
    },
  });

  return {
    setVisible: (v) => {
      if (map.getLayer(DISTURBANCE_LAYER_ID)) {
        map.setLayoutProperty(DISTURBANCE_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (map.getLayer(DISTURBANCE_HIT_LAYER_ID)) {
        map.setLayoutProperty(DISTURBANCE_HIT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      loader.setEnabled(v);
    },
  };
}

export async function refreshDisturbancesLayer(
  map: MapLibreMap,
  bboxOverride?: Bbox,
): Promise<{ disturbanceCount: number }> {
  const bbox = bboxOverride ?? mapBoundsBbox(map, 0.2);
  if (!bbox) {
    const src = map.getSource(DISTURBANCE_SOURCE_ID) as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
    return { disturbanceCount: 0 };
  }

  const params = new URLSearchParams({ bbox: bboxToParam(bbox) });
  const res = await fetch(`/api/disturbances?${params.toString()}`);
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

export function addTrafficFlowLayer(
  map: MapLibreMap,
  opts: { onLoadingChange?: LayerLoadingCallback } = {},
): LayerController {
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
    initialEnabled: false,
    bboxPadding: 0.5,
    maxBboxAreaDeg2: 30,
    onLoadingChange: opts.onLoadingChange,
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
  const targetBbox = bbox ? clipBboxToLayerBounds(bbox) : mapBoundsBbox(map);
  if (!targetBbox || bboxArea(targetBbox) > 30) {
    const src = map.getSource(TRAFFIC_FLOW_SOURCE_ID) as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
    return { trafficFlowCount: 0 };
  }
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
