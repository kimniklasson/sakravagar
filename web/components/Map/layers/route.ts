import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { RouteLine } from "@/lib/routeTypes";
import {
  LIVE_CORE_LAYER_ID,
  LIVE_HALO_LAYER_ID,
} from "./events";
import { raiseLargeRoadBadges } from "./largeRoads";
import type {
  LayerController,
  RouteAnnotationVisibility,
  RouteClickHandler,
} from "./types";

const ROUTE_SOURCE_ID = "route";
const ROUTE_ALT_LAYER_ID = "route-alt-lines";
const ROUTE_ALT_CASING_LAYER_ID = "route-alt-casing";
const ROUTE_ALT_HIT_LAYER_ID = "route-alt-hit";
const ROUTE_PRIMARY_LAYER_ID = "route-primary-line";
const ROUTE_PRIMARY_CASING_LAYER_ID = "route-primary-casing";
const ROUTE_PRIMARY_HIT_LAYER_ID = "route-primary-hit";
const ROUTE_ENDPOINT_SOURCE_ID = "route-endpoints";
const ROUTE_ENDPOINT_LAYER_ID = "route-endpoint-symbols";
const ROUTE_START_IMAGE_ID = "route-start-marker";
const ROUTE_END_IMAGE_ID = "route-end-marker";
const ROUTE_ANNOTATION_LINE_SOURCE_ID = "route-annotation-lines";
const ROUTE_ANNOTATION_POINT_SOURCE_ID = "route-annotation-points";
const ROUTE_HIGH_SPEED_LAYER_ID = "route-high-speed-lines";
const ROUTE_TRAFFIC_INTENSITY_LAYER_ID = "route-traffic-intensity-lines";
const ROUTE_CITY_TRAFFIC_LAYER_ID = "route-city-traffic-lines";
const ROUTE_BRIDGE_LAYER_ID = "route-bridge-lines";
const ROUTE_TUNNEL_LAYER_ID = "route-tunnel-lines";
const ROUTE_LARGE_ROUNDABOUT_LAYER_ID = "route-large-roundabout-lines";
const ROUTE_MULTILANE_LAYER_ID = "route-multilane-lines";
const ROUTE_DISTURBANCE_LAYER_ID = "route-disturbance-points";
const ROUTE_ACCIDENT_LAYER_ID = "route-accident-points";
const ROUTE_DISTURBANCE_TRIANGLE_IMAGE_ID = "route-disturbance-triangle";
const ROUTE_ANNOTATION_COLORS = {
  highSpeed: "#FF8C8C",
  trafficIntensity: "#4DA3FF",
  cityTraffic: "#FFD166",
  bridges: "#F23FC8",
  tunnels: "#FF2F00",
  largeRoundabouts: "#B98CFF",
  multilane: "#42D9C8",
  disturbances: "#F27A3F",
  liveAccidents: "#FF2F00",
};

function ensureRouteAnnotationImages(map: MapLibreMap): void {
  if (map.hasImage(ROUTE_DISTURBANCE_TRIANGLE_IMAGE_ID)) return;

  const pixelRatio = 2;
  const size = 18;
  const canvas = document.createElement("canvas");
  canvas.width = size * pixelRatio;
  canvas.height = size * pixelRatio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.scale(pixelRatio, pixelRatio);
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 3, size - 3);
  ctx.lineTo(3, size - 3);
  ctx.closePath();
  ctx.fillStyle = ROUTE_ANNOTATION_COLORS.disturbances;
  ctx.fill();
  ctx.strokeStyle = "rgba(17, 17, 17, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  map.addImage(
    ROUTE_DISTURBANCE_TRIANGLE_IMAGE_ID,
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    { pixelRatio },
  );
}

function ensureRouteEndpointImages(map: MapLibreMap): void {
  const pixelRatio = 2;

  if (!map.hasImage(ROUTE_START_IMAGE_ID)) {
    const size = 20;
    const canvas = document.createElement("canvas");
    canvas.width = size * pixelRatio;
    canvas.height = size * pixelRatio;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.scale(pixelRatio, pixelRatio);
      ctx.strokeStyle = "rgba(17, 17, 17, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, 7.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, 7.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(size / 2, 4.5);
      ctx.lineTo(size - 4.5, size / 2);
      ctx.lineTo(size / 2, size - 4.5);
      ctx.lineTo(4.5, size / 2);
      ctx.closePath();
      ctx.fill();

      map.addImage(ROUTE_START_IMAGE_ID, ctx.getImageData(0, 0, canvas.width, canvas.height), {
        pixelRatio,
      });
    }
  }

  if (!map.hasImage(ROUTE_END_IMAGE_ID)) {
    const width = 24;
    const height = 48;
    const canvas = document.createElement("canvas");
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.scale(pixelRatio, pixelRatio);
      ctx.fillStyle = "#95FF97";
      ctx.strokeStyle = "rgba(17, 17, 17, 0.85)";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";

      const pin = new Path2D(
        "M12 0C16.9706 0 21 4.02944 21 9C21 13.9706 12 24 12 24C12 24 3 13.9706 3 9C3 4.02944 7.02944 0 12 0ZM12 4.5C9.51472 4.5 7.5 6.51472 7.5 9C7.5 11.4853 9.51472 13.5 12 13.5C14.4853 13.5 16.5 11.4853 16.5 9C16.5 6.51472 14.4853 4.5 12 4.5Z",
      );
      ctx.stroke(pin);
      ctx.fill(pin, "evenodd");

      map.addImage(ROUTE_END_IMAGE_ID, ctx.getImageData(0, 0, canvas.width, canvas.height), {
        pixelRatio,
      });
    }
  }
}

export function addRouteLayer(
  map: MapLibreMap,
  onRouteClick?: RouteClickHandler,
): LayerController {
  if (map.getSource(ROUTE_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(ROUTE_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(ROUTE_ENDPOINT_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(ROUTE_ANNOTATION_LINE_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(ROUTE_ANNOTATION_POINT_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  ensureRouteAnnotationImages(map);
  ensureRouteEndpointImages(map);

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
        "line-color": "#666666",
        "line-opacity": 1,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 12, 4, 16, 7],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_ALT_HIT_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["!=", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(255, 255, 255, 0)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 14, 12, 20, 16, 28],
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
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 12, 6, 16, 9],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_HIGH_SPEED_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "highSpeed"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.highSpeed,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 12, 6, 16, 9],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_TRAFFIC_INTENSITY_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "trafficIntensity"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.trafficIntensity,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 12, 2.5, 16, 3.5],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_CITY_TRAFFIC_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "cityTraffic"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.cityTraffic,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.8, 12, 3.2, 16, 4.4],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_BRIDGE_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "bridges"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.bridges,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 12, 6.5, 16, 9.5],
        "line-dasharray": [0.16, 0.34],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_TUNNEL_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "tunnels"],
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.tunnels,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 12, 6.5, 16, 9.5],
        "line-dasharray": [0.2, 0.3],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_LARGE_ROUNDABOUT_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "largeRoundabouts"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.largeRoundabouts,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.4, 12, 4.8, 16, 7.2],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_MULTILANE_LAYER_ID,
      type: "line",
      source: ROUTE_ANNOTATION_LINE_SOURCE_ID,
      filter: ["==", ["get", "kind"], "multilane"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_ANNOTATION_COLORS.multilane,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 12, 4, 16, 6],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_DISTURBANCE_LAYER_ID,
      type: "symbol",
      source: ROUTE_ANNOTATION_POINT_SOURCE_ID,
      filter: ["==", ["get", "kind"], "disturbances"],
      layout: {
        "icon-image": ROUTE_DISTURBANCE_TRIANGLE_IMAGE_ID,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.55, 12, 0.85, 16, 1.1],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_ACCIDENT_LAYER_ID,
      type: "circle",
      source: ROUTE_ANNOTATION_POINT_SOURCE_ID,
      filter: ["==", ["get", "kind"], "liveAccidents"],
      paint: {
        "circle-color": ROUTE_ANNOTATION_COLORS.liveAccidents,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 12, 4, 16, 6],
        "circle-stroke-color": "rgba(17, 17, 17, 0.9)",
        "circle-stroke-width": 1.5,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_PRIMARY_HIT_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      filter: ["==", ["get", "selected"], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(255, 255, 255, 0)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 16, 12, 24, 16, 34],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ROUTE_ENDPOINT_LAYER_ID,
      type: "symbol",
      source: ROUTE_ENDPOINT_SOURCE_ID,
      layout: {
        "icon-image": [
          "match",
          ["get", "kind"],
          "end", ROUTE_END_IMAGE_ID,
          ROUTE_START_IMAGE_ID,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    beforeId,
  );

  raiseLargeRoadBadges(map);

  if (onRouteClick) {
    map.on("click", ROUTE_ALT_HIT_LAYER_ID, (event) => {
      const routeId = event.features?.[0]?.properties?.id;
      if (typeof routeId === "string" && routeId.length > 0) onRouteClick(routeId);
    });
    map.on("mouseenter", ROUTE_ALT_HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", ROUTE_ALT_HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  return {
    setVisible: (v) => {
      for (const id of [
        ROUTE_ALT_CASING_LAYER_ID,
        ROUTE_ALT_LAYER_ID,
        ROUTE_ALT_HIT_LAYER_ID,
        ROUTE_PRIMARY_CASING_LAYER_ID,
        ROUTE_PRIMARY_LAYER_ID,
        ROUTE_TRAFFIC_INTENSITY_LAYER_ID,
        ROUTE_CITY_TRAFFIC_LAYER_ID,
        ROUTE_HIGH_SPEED_LAYER_ID,
        ROUTE_BRIDGE_LAYER_ID,
        ROUTE_TUNNEL_LAYER_ID,
        ROUTE_LARGE_ROUNDABOUT_LAYER_ID,
        ROUTE_MULTILANE_LAYER_ID,
        ROUTE_DISTURBANCE_LAYER_ID,
        ROUTE_ACCIDENT_LAYER_ID,
        ROUTE_PRIMARY_HIT_LAYER_ID,
        ROUTE_ENDPOINT_LAYER_ID,
      ]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
        }
      }
    },
  };
}

export function setRouteLayerData(
  map: MapLibreMap,
  routes: RouteLine[],
  selectedRouteId = routes[0]?.id ?? null,
  visibleAnnotations: RouteAnnotationVisibility = {},
): void {
  if (!map.getSource(ROUTE_SOURCE_ID)) addRouteLayer(map);
  const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  const endpointSource = map.getSource(ROUTE_ENDPOINT_SOURCE_ID) as GeoJSONSource | undefined;
  const annotationLineSource = map.getSource(ROUTE_ANNOTATION_LINE_SOURCE_ID) as GeoJSONSource | undefined;
  const annotationPointSource = map.getSource(ROUTE_ANNOTATION_POINT_SOURCE_ID) as GeoJSONSource | undefined;

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = routes.map((route) => ({
    type: "Feature",
    geometry: route.geometry,
    properties: {
      id: route.id,
      selected: route.id === selectedRouteId,
      distance_meters: route.distanceMeters,
      duration_seconds: route.durationSeconds,
      safety_score: route.safetyScore,
    },
  }));
  source.setData({ type: "FeatureCollection", features });

  const selectedRoute = routes.find((route) => route.id === selectedRouteId);
  const selectedCoordinates = selectedRoute?.geometry.coordinates.filter(
    (coord): coord is [number, number] =>
      Array.isArray(coord) &&
      coord.length >= 2 &&
      typeof coord[0] === "number" &&
      typeof coord[1] === "number",
  ) ?? [];
  const startCoordinate = selectedCoordinates[0];
  const endCoordinate = selectedCoordinates.at(-1);
  const lineAnnotations = selectedRoute?.annotations
    ? [
        ...(visibleAnnotations.highSpeed ? selectedRoute.annotations.highSpeed ?? [] : []),
        ...(visibleAnnotations.trafficIntensity ? selectedRoute.annotations.trafficIntensity ?? [] : []),
        ...(visibleAnnotations.cityTraffic ? selectedRoute.annotations.cityTraffic ?? [] : []),
        ...(visibleAnnotations.bridges ? selectedRoute.annotations.bridges ?? [] : []),
        ...(visibleAnnotations.tunnels ? selectedRoute.annotations.tunnels ?? [] : []),
        ...(visibleAnnotations.largeRoundabouts ? selectedRoute.annotations.largeRoundabouts ?? [] : []),
        ...(visibleAnnotations.multilane ? selectedRoute.annotations.multilane ?? [] : []),
      ]
    : [];
  const pointAnnotations = selectedRoute?.annotations
    ? [
        ...(selectedRoute.annotations.disturbances ?? []),
        ...(selectedRoute.annotations.liveAccidents ?? []),
      ]
    : [];

  endpointSource?.setData({
    type: "FeatureCollection",
    features: startCoordinate && endCoordinate
      ? [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: startCoordinate },
            properties: { kind: "start" },
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: endCoordinate },
            properties: { kind: "end" },
          },
        ]
      : [],
  });
  annotationLineSource?.setData({
    type: "FeatureCollection",
    features: lineAnnotations.map((annotation): GeoJSON.Feature<GeoJSON.LineString> => ({
      type: "Feature",
      geometry: annotation.geometry,
      properties: { kind: annotation.kind },
    })),
  });
  annotationPointSource?.setData({
    type: "FeatureCollection",
    features: pointAnnotations.map((annotation): GeoJSON.Feature<GeoJSON.Point> => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: annotation.coordinates },
      properties: {
        kind: annotation.kind,
        category: annotation.category ?? null,
      },
    })),
  });
  raiseLargeRoadBadges(map);
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
