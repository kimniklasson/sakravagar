import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { TrafficCameraPoint } from "@/app/api/cameras/route";
import type { RouteLine } from "@/lib/routeTypes";
import {
  bboxToParam,
  clipBboxToLayerBounds,
  createBboxLoader,
  type Bbox,
} from "./bbox";
import {
  LIVE_CORE_LAYER_ID,
  LIVE_HALO_LAYER_ID,
} from "./events";
import type { LayerController, LayerLoadingCallback } from "./types";

export const TRAFFIC_CAMERA_SOURCE_ID = "traffic-cameras";
export const TRAFFIC_CAMERA_LAYER_ID = "traffic-camera-points";
export const TRAFFIC_CAMERA_HIT_LAYER_ID = "traffic-camera-hit-target";
export const ROUTE_TRAFFIC_CAMERA_SOURCE_ID = "route-traffic-cameras";
export const ROUTE_TRAFFIC_CAMERA_LAYER_ID = "route-traffic-camera-points";
export const ROUTE_TRAFFIC_CAMERA_HIT_LAYER_ID = "route-traffic-camera-hit-target";

const TRAFFIC_CAMERA_CLUSTER_SOURCE_ID = "traffic-camera-cluster-features";
const TRAFFIC_CAMERA_CLUSTER_LAYER_ID = "traffic-camera-clusters";
const TRAFFIC_CAMERA_CLUSTER_COUNT_LAYER_ID = "traffic-camera-cluster-count";
const TRAFFIC_CAMERA_MARKER_IMAGE_ID = "traffic-camera-marker";
const TRAFFIC_CAMERA_MIN_ZOOM = 3;
const ROUTE_TRAFFIC_CAMERA_MIN_ZOOM = 4;
const TRAFFIC_CAMERA_CLUSTER_UNTIL_ZOOM = 12;
const SWEDEN_CAMERA_BBOX: Bbox = { west: 9, south: 54, east: 25, north: 70 };
const TRAFFIC_CAMERA_CLUSTER_MIN_POINTS = 2;
const ROUTE_TRAFFIC_CAMERA_MAX_DISTANCE_METERS = 100;
const ROUTE_TRAFFIC_CAMERA_BBOX_PADDING_METERS = 160;
const EARTH_METERS_PER_DEGREE = 111_320;
const TRAFFIC_CAMERA_RENDER_LAYER_IDS = [
  TRAFFIC_CAMERA_CLUSTER_LAYER_ID,
  TRAFFIC_CAMERA_CLUSTER_COUNT_LAYER_ID,
  TRAFFIC_CAMERA_LAYER_ID,
  TRAFFIC_CAMERA_HIT_LAYER_ID,
] as const;
const ROUTE_TRAFFIC_CAMERA_RENDER_LAYER_IDS = [
  ROUTE_TRAFFIC_CAMERA_LAYER_ID,
  ROUTE_TRAFFIC_CAMERA_HIT_LAYER_ID,
] as const;
const TRAFFIC_CAMERA_ALL_LAYER_IDS = [
  ...TRAFFIC_CAMERA_RENDER_LAYER_IDS,
  ...ROUTE_TRAFFIC_CAMERA_RENDER_LAYER_IDS,
] as const;

type TrafficCameraCluster = {
  id: string;
  lng: number;
  lat: number;
  count: number;
  label: string;
};

const cameraCacheByMap = new WeakMap<MapLibreMap, Map<string, TrafficCameraPoint>>();
const cameraFullFetchByMap = new WeakSet<MapLibreMap>();
const cameraVisibleByMap = new WeakMap<MapLibreMap, boolean>();
const cameraClusterMarkersByMap = new WeakMap<MapLibreMap, maplibregl.Marker[]>();
const routeCameraRequestSeqByMap = new WeakMap<MapLibreMap, number>();

function cameraCacheForMap(map: MapLibreMap): Map<string, TrafficCameraPoint> {
  let cache = cameraCacheByMap.get(map);
  if (!cache) {
    cache = new Map();
    cameraCacheByMap.set(map, cache);
  }
  return cache;
}

function bboxEquals(a: Bbox, b: Bbox): boolean {
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north;
}

function setTrafficCameraLayersVisible(map: MapLibreMap, visible: boolean): void {
  for (const id of TRAFFIC_CAMERA_RENDER_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }
}

function clearTrafficCameraClusterMarkers(map: MapLibreMap): void {
  const markers = cameraClusterMarkersByMap.get(map) ?? [];
  for (const marker of markers) marker.remove();
  cameraClusterMarkersByMap.delete(map);
}

function removeTrafficCameraLayerArtifacts(map: MapLibreMap): void {
  clearTrafficCameraClusterMarkers(map);
  for (const id of [...TRAFFIC_CAMERA_ALL_LAYER_IDS].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(ROUTE_TRAFFIC_CAMERA_SOURCE_ID)) map.removeSource(ROUTE_TRAFFIC_CAMERA_SOURCE_ID);
  if (map.getSource(TRAFFIC_CAMERA_CLUSTER_SOURCE_ID)) map.removeSource(TRAFFIC_CAMERA_CLUSTER_SOURCE_ID);
  if (map.getSource(TRAFFIC_CAMERA_SOURCE_ID)) map.removeSource(TRAFFIC_CAMERA_SOURCE_ID);
  cameraCacheForMap(map).clear();
  cameraFullFetchByMap.delete(map);
  cameraVisibleByMap.delete(map);
}

function ensureTrafficCameraMarkerImage(map: MapLibreMap): void {
  if (map.hasImage(TRAFFIC_CAMERA_MARKER_IMAGE_ID)) return;

  const pixelRatio = 2;
  const size = 26;
  const canvas = document.createElement("canvas");
  canvas.width = size * pixelRatio;
  canvas.height = size * pixelRatio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(17, 17, 17, 0.92)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.roundRect(4, 8, 18, 12, 3);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(7, 8);
  ctx.lineTo(9, 5);
  ctx.lineTo(15, 5);
  ctx.lineTo(17, 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(13, 14, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#333333";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(13, 14, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = "#8EE6FF";
  ctx.fill();

  map.addImage(TRAFFIC_CAMERA_MARKER_IMAGE_ID, ctx.getImageData(0, 0, canvas.width, canvas.height), {
    pixelRatio,
  });
}

export function addTrafficCameraLayer(
  map: MapLibreMap,
  opts: { onLoadingChange?: LayerLoadingCallback } = {},
): LayerController {
  if (map.getSource(TRAFFIC_CAMERA_SOURCE_ID)) {
    removeTrafficCameraLayerArtifacts(map);
  }

  map.addSource(TRAFFIC_CAMERA_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource(ROUTE_TRAFFIC_CAMERA_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  ensureTrafficCameraMarkerImage(map);

  const beforeId = map.getLayer(LIVE_HALO_LAYER_ID)
    ? LIVE_HALO_LAYER_ID
      : map.getLayer(LIVE_CORE_LAYER_ID)
        ? LIVE_CORE_LAYER_ID
        : undefined;

  map.addLayer(
    {
      id: TRAFFIC_CAMERA_LAYER_ID,
      type: "symbol",
      source: TRAFFIC_CAMERA_SOURCE_ID,
      minzoom: TRAFFIC_CAMERA_MIN_ZOOM,
      layout: {
        "icon-image": TRAFFIC_CAMERA_MARKER_IMAGE_ID,
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          TRAFFIC_CAMERA_MIN_ZOOM, 0.7,
          8, 0.9,
          12, 1.08,
          16, 1.22,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": [
          "interpolate", ["linear"], ["zoom"],
          TRAFFIC_CAMERA_MIN_ZOOM, 0.75,
          TRAFFIC_CAMERA_MIN_ZOOM + 1, 0.95,
        ],
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: TRAFFIC_CAMERA_HIT_LAYER_ID,
      type: "circle",
      source: TRAFFIC_CAMERA_SOURCE_ID,
      minzoom: TRAFFIC_CAMERA_MIN_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], TRAFFIC_CAMERA_MIN_ZOOM, 12, 12, 18, 16, 24],
        "circle-color": "#000000",
        "circle-opacity": 0,
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: ROUTE_TRAFFIC_CAMERA_LAYER_ID,
      type: "symbol",
      source: ROUTE_TRAFFIC_CAMERA_SOURCE_ID,
      minzoom: ROUTE_TRAFFIC_CAMERA_MIN_ZOOM,
      layout: {
        "icon-image": TRAFFIC_CAMERA_MARKER_IMAGE_ID,
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          ROUTE_TRAFFIC_CAMERA_MIN_ZOOM, 0.82,
          8, 0.98,
          12, 1.12,
          16, 1.26,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 0.98,
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: ROUTE_TRAFFIC_CAMERA_HIT_LAYER_ID,
      type: "circle",
      source: ROUTE_TRAFFIC_CAMERA_SOURCE_ID,
      minzoom: ROUTE_TRAFFIC_CAMERA_MIN_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], ROUTE_TRAFFIC_CAMERA_MIN_ZOOM, 13, 12, 18, 16, 24],
        "circle-color": "#000000",
        "circle-opacity": 0,
      },
    },
    beforeId,
  );

  const loader = createBboxLoader(map, {
    minZoom: 0,
    initialEnabled: false,
    bboxPadding: 0,
    maxBboxAreaDeg2: 5000,
    onLoadingChange: opts.onLoadingChange,
    fetchBbox: async () => {
      if (cameraFullFetchByMap.has(map)) return;
      const result = await refreshTrafficCameraLayer(map, SWEDEN_CAMERA_BBOX);
      if (!result.loaded) return false;
      cameraFullFetchByMap.add(map);
      return true;
    },
  });

  map.on("moveend", () => {
    renderTrafficCameraLayerFromCache(map);
  });

  return {
    setVisible: (v) => {
      cameraVisibleByMap.set(map, v);
      setTrafficCameraLayersVisible(map, v);
      renderTrafficCameraLayerFromCache(map);
      loader.setEnabled(v);
    },
  };
}

function abbreviateCameraCount(count: number): string {
  if (count < 1000) return count.toLocaleString("sv-SE");
  const rounded = Math.round(count / 100) / 10;
  return `${rounded.toLocaleString("sv-SE", { maximumFractionDigits: 1 })}k`;
}

function trafficCameraClusterCellSize(zoom: number): number {
  if (zoom < 6) return 180;
  if (zoom < 8) return 140;
  if (zoom < 10) return 100;
  return 72;
}

function clusterTrafficCameras(
  map: MapLibreMap,
  cameras: TrafficCameraPoint[],
): { clusters: TrafficCameraCluster[]; points: GeoJSON.Feature<GeoJSON.Point>[] } {
  const zoom = map.getZoom();
  if (zoom >= TRAFFIC_CAMERA_CLUSTER_UNTIL_ZOOM) {
    return { clusters: [], points: cameras.map((camera) => trafficCameraFeature(camera)) };
  }

  const cellSize = trafficCameraClusterCellSize(zoom);
  const buckets = new Map<string, TrafficCameraPoint[]>();

  for (const camera of cameras) {
    const point = map.project([camera.lng, camera.lat]);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(camera);
    } else {
      buckets.set(key, [camera]);
    }
  }

  const clusters: TrafficCameraCluster[] = [];
  const points: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (const [key, bucket] of buckets) {
    if (bucket.length < TRAFFIC_CAMERA_CLUSTER_MIN_POINTS) {
      points.push(...bucket.map((camera) => trafficCameraFeature(camera)));
      continue;
    }

    const center = bucket.reduce(
      (acc, camera) => ({
        lng: acc.lng + camera.lng,
        lat: acc.lat + camera.lat,
      }),
      { lng: 0, lat: 0 },
    );
    const pointCount = bucket.length;
    clusters.push({
      id: `${Math.floor(zoom * 10)}:${key}`,
      lng: center.lng / pointCount,
      lat: center.lat / pointCount,
      count: pointCount,
      label: abbreviateCameraCount(pointCount),
    });
  }

  return { clusters, points };
}

function trafficCameraFeature(camera: TrafficCameraPoint): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [camera.lng, camera.lat] },
    properties: {
      cluster: false,
      id: camera.id,
      name: camera.name,
      camera_type: camera.camera_type,
      status: camera.status,
      description: camera.description,
      direction: camera.direction,
      county_no: camera.county_no,
      active: camera.active,
      content_type: camera.content_type,
      icon_id: camera.icon_id,
      photo_url: camera.photo_url,
      photo_time: camera.photo_time,
      has_full_size_photo: camera.has_full_size_photo,
      has_sketch_image: camera.has_sketch_image,
      first_seen: camera.first_seen,
      last_seen: camera.last_seen,
      modified_time: camera.modified_time,
    },
  };
}

function setRouteTrafficCameraSourceData(
  map: MapLibreMap,
  cameras: TrafficCameraPoint[],
): void {
  const source = map.getSource(ROUTE_TRAFFIC_CAMERA_SOURCE_ID) as GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: cameras.map((camera) => trafficCameraFeature(camera)),
  });
  raiseRouteTrafficCameraLayers(map);
}

function raiseRouteTrafficCameraLayers(map: MapLibreMap): void {
  const beforeId = map.getLayer(LIVE_HALO_LAYER_ID)
    ? LIVE_HALO_LAYER_ID
    : map.getLayer(LIVE_CORE_LAYER_ID)
      ? LIVE_CORE_LAYER_ID
      : undefined;

  for (const id of ROUTE_TRAFFIC_CAMERA_RENDER_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id, beforeId);
  }
}

function renderTrafficCameraLayerFromCache(map: MapLibreMap): void {
  const cameras = Array.from(cameraCacheForMap(map).values());
  if (!cameraVisibleByMap.get(map) || map.getZoom() < TRAFFIC_CAMERA_MIN_ZOOM || cameras.length === 0) {
    setTrafficCameraSourceData(map, { clusters: [], points: [] });
    return;
  }

  setTrafficCameraSourceData(map, clusterTrafficCameras(map, cameras));
}

function setTrafficCameraSourceData(
  map: MapLibreMap,
  data: { clusters: TrafficCameraCluster[]; points: GeoJSON.Feature<GeoJSON.Point>[] },
): void {
  const pointGeojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: data.points,
  };

  const pointSource = map.getSource(TRAFFIC_CAMERA_SOURCE_ID) as GeoJSONSource | undefined;
  pointSource?.setData(pointGeojson);
  renderTrafficCameraClusterMarkers(map, data.clusters);
}

function renderTrafficCameraClusterMarkers(
  map: MapLibreMap,
  clusters: TrafficCameraCluster[],
): void {
  clearTrafficCameraClusterMarkers(map);
  if (!cameraVisibleByMap.get(map) || clusters.length === 0) return;

  const markers = clusters.map((cluster) => {
    const size = cluster.count >= 100
      ? 54
      : cluster.count >= 40
        ? 46
        : cluster.count >= 10
          ? 38
          : 32;
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = cluster.label;
    el.setAttribute("aria-label", `${cluster.count} kameror`);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = "999px";
    el.style.border = "0";
    el.style.background = "rgb(85 85 85 / 60%)";
    el.style.backdropFilter = "blur(16px)";
    el.style.setProperty("-webkit-backdrop-filter", "blur(16px)");
    el.style.color = "#ffffff";
    el.style.boxShadow = "none";
    el.style.cursor = "pointer";
    el.style.display = "grid";
    el.style.placeItems = "center";
    el.style.fontFamily = "var(--font-sans)";
    el.style.fontSize = "var(--type-small-size)";
    el.style.fontWeight = "400";
    el.style.lineHeight = "var(--type-small-line)";
    el.style.letterSpacing = "var(--type-small-tracking)";
    el.style.padding = "0";
    el.style.pointerEvents = "auto";
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      map.easeTo({
        center: [cluster.lng, cluster.lat],
        zoom: Math.min(TRAFFIC_CAMERA_CLUSTER_UNTIL_ZOOM, map.getZoom() + 2),
        duration: 520,
        essential: true,
      });
    });
    return new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([cluster.lng, cluster.lat])
      .addTo(map);
  });
  cameraClusterMarkersByMap.set(map, markers);
}

export async function refreshTrafficCameraLayer(
  map: MapLibreMap,
  bboxOverride?: Bbox,
): Promise<{ trafficCameraCount: number; loaded: boolean }> {
  const bbox = bboxOverride ?? SWEDEN_CAMERA_BBOX;
  const fullRefresh = bboxEquals(bbox, SWEDEN_CAMERA_BBOX);
  const result = await fetchTrafficCameraBboxIntoCache(map, bbox, { replaceCache: fullRefresh });
  if (fullRefresh && result.loaded) cameraFullFetchByMap.add(map);
  renderTrafficCameraLayerFromCache(map);
  return { trafficCameraCount: cameraCacheForMap(map).size, loaded: result.loaded };
}

async function fetchTrafficCameraBboxIntoCache(
  map: MapLibreMap,
  bbox: Bbox,
  opts: { replaceCache?: boolean } = {},
): Promise<{ loaded: boolean }> {
  const params = new URLSearchParams({ bbox: bboxToParam(bbox) });
  const res = await fetch(`/api/cameras?${params.toString()}`);
  if (!res.ok) {
    console.warn("failed to fetch traffic cameras", await res.text());
    return { loaded: false };
  }

  const { cameras } = (await res.json()) as { cameras: TrafficCameraPoint[] };
  const cache = cameraCacheForMap(map);
  if (opts.replaceCache) cache.clear();
  for (const camera of cameras) {
    cache.set(camera.id, camera);
  }
  return { loaded: true };
}

export async function refreshRouteTrafficCameraLayer(
  map: MapLibreMap,
  route: RouteLine | null,
): Promise<{ routeTrafficCameraCount: number; loaded: boolean }> {
  const requestSeq = (routeCameraRequestSeqByMap.get(map) ?? 0) + 1;
  routeCameraRequestSeqByMap.set(map, requestSeq);

  const routeCoordinates = route?.geometry.coordinates.filter(isLngLatCoordinate) ?? [];
  if (routeCoordinates.length < 2) {
    setRouteTrafficCameraSourceData(map, []);
    return { routeTrafficCameraCount: 0, loaded: true };
  }

  const bbox = routeCameraFetchBbox(routeCoordinates);
  if (!bbox) {
    setRouteTrafficCameraSourceData(map, []);
    return { routeTrafficCameraCount: 0, loaded: true };
  }

  let loaded = true;
  if (!cameraFullFetchByMap.has(map)) {
    const result = await fetchTrafficCameraBboxIntoCache(map, bbox);
    loaded = result.loaded;
    if (!loaded) {
      if (routeCameraRequestSeqByMap.get(map) === requestSeq) {
        setRouteTrafficCameraSourceData(map, []);
      }
      return { routeTrafficCameraCount: 0, loaded: false };
    }
  }

  if (routeCameraRequestSeqByMap.get(map) !== requestSeq) {
    return { routeTrafficCameraCount: 0, loaded: false };
  }

  const cameras = camerasNearRoute(
    Array.from(cameraCacheForMap(map).values()),
    routeCoordinates,
    ROUTE_TRAFFIC_CAMERA_MAX_DISTANCE_METERS,
  );
  setRouteTrafficCameraSourceData(map, cameras);
  return { routeTrafficCameraCount: cameras.length, loaded };
}

function isLngLatCoordinate(coord: GeoJSON.Position): coord is [number, number] {
  return (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  );
}

function routeCameraFetchBbox(coordinates: [number, number][]): Bbox | null {
  const first = coordinates[0];
  if (!first) return null;

  let west = first[0];
  let east = first[0];
  let south = first[1];
  let north = first[1];
  let latSum = 0;

  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    latSum += lat;
  }

  const originLat = latSum / coordinates.length;
  const latPadding = ROUTE_TRAFFIC_CAMERA_BBOX_PADDING_METERS / EARTH_METERS_PER_DEGREE;
  const lngPadding = ROUTE_TRAFFIC_CAMERA_BBOX_PADDING_METERS / lngMetersPerDegree(originLat);
  return clipBboxToLayerBounds({
    west: west - lngPadding,
    south: south - latPadding,
    east: east + lngPadding,
    north: north + latPadding,
  });
}

function camerasNearRoute(
  cameras: TrafficCameraPoint[],
  coordinates: [number, number][],
  thresholdMeters: number,
): TrafficCameraPoint[] {
  if (coordinates.length < 2) return [];
  const originLat = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const lngScale = lngMetersPerDegree(originLat);
  const thresholdSq = thresholdMeters * thresholdMeters;

  const routePoints = coordinates.map(([lng, lat]) => ({
    x: lng * lngScale,
    y: lat * EARTH_METERS_PER_DEGREE,
  }));

  return cameras.filter((camera) => {
    const point = {
      x: camera.lng * lngScale,
      y: camera.lat * EARTH_METERS_PER_DEGREE,
    };
    for (let index = 1; index < routePoints.length; index += 1) {
      const start = routePoints[index - 1];
      const end = routePoints[index];
      if (!start || !end) continue;
      if (distancePointToSegmentSq(point, start, end) <= thresholdSq) return true;
    }
    return false;
  });
}

function lngMetersPerDegree(lat: number): number {
  const cosine = Math.cos((lat * Math.PI) / 180);
  return Math.max(1, EARTH_METERS_PER_DEGREE * cosine);
}

function distancePointToSegmentSq(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return squaredDistance(point, start);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return squaredDistance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy,
  });
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
