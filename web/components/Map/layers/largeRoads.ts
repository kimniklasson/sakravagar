import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type { LargeRoadSegment } from "@/app/api/large-roads/route";
import {
  bboxArea,
  bboxToParam,
  clipBboxToLayerBounds,
  mapBoundsBbox,
  paddedBbox,
  type Bbox,
} from "./bbox";
import type { LayerController } from "./types";

const LARGE_ROADS_BADGE_SOURCE_ID = "large-roads-speed-badges";
export const LARGE_ROADS_BADGE_LAYER_ID = "large-roads-speed-badge-symbols";

// Hastighetslagret är betydligt glesare än Risk/ÅDT och behöver vara synligt
// tidigare för att fungera som orienteringslager när kartan är utzoomad.
const LARGE_ROADS_MIN_ZOOM = 8;
const LARGE_ROADS_TILE_DEG = 0.75;
const LARGE_ROADS_TILE_PADDING = 0.45;
const LARGE_ROADS_MAX_CONCURRENT_TILES = 6;
const LARGE_ROADS_MAX_VIEWPORT_AREA_DEG2 = 20;
const LARGE_ROADS_BADGE_MIN_LINE_PX = 72;
const LARGE_ROADS_SPEED_RUN_MIN_LENGTH_M = 500;
const LARGE_ROADS_SPEED_CONNECT_DISTANCE_M = 120;
const SPEED_BADGE_IMAGE_PREFIX = "speed-badge-";
const SPEED_ROAD_COLORS = {
  80: "#7A7A7A",
  90: "#999999",
  100: "#B8B8B8",
  110: "#D6D6D6",
  120: "#F2F2F2",
};

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

function speedRoadColor(speedLimit: number | null | undefined): string {
  if (!speedLimit) return SPEED_ROAD_COLORS[90];
  if (speedLimit >= 120) return SPEED_ROAD_COLORS[120];
  if (speedLimit >= 110) return SPEED_ROAD_COLORS[110];
  if (speedLimit >= 100) return SPEED_ROAD_COLORS[100];
  if (speedLimit >= 90) return SPEED_ROAD_COLORS[90];
  if (speedLimit >= 80) return SPEED_ROAD_COLORS[80];
  return SPEED_ROAD_COLORS[90];
}

export function raiseLargeRoadBadges(map: MapLibreMap): void {
  if (map.getLayer(LARGE_ROADS_BADGE_LAYER_ID)) {
    map.moveLayer(LARGE_ROADS_BADGE_LAYER_ID);
  }
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

function toCoordinate2D(position: GeoJSON.Position | undefined): Coordinate2D | null {
  const lng = position?.[0];
  const lat = position?.[1];
  return typeof lng === "number" && typeof lat === "number" ? [lng, lat] : null;
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

// Trygghetsfiltret "Höga hastigheter".
// Bbox-drivet NVDB-lager från Lastkajen: bara skyltad hastighet 80+.
// Vägtyp-rader utan hastighetsvärde filtreras bort i API:t eftersom de kan
// representera större vägar som ändå är 80-vägar i verkligheten.
export function addLargeRoadsLayer(map: MapLibreMap): LayerController {
  if (map.getSource(LARGE_ROADS_BADGE_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(LARGE_ROADS_BADGE_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
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

  const updateSource = () => {
    const entries = Array.from(featureCache.entries());
    visibleFeatureKeys = visibleLargeRoadKeys(entries);
    updateBadgeSource();
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

    const viewport = mapBoundsBbox(map);
    if (!viewport) return;
    const padded = clipBboxToLayerBounds(paddedBbox(viewport, LARGE_ROADS_TILE_PADDING));
    if (!padded || bboxArea(padded) > LARGE_ROADS_MAX_VIEWPORT_AREA_DEG2) return;

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
      if (map.getLayer(LARGE_ROADS_BADGE_LAYER_ID)) {
        map.setLayoutProperty(LARGE_ROADS_BADGE_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      if (enabled === v) return;
      enabled = v;
      if (v) {
        raiseLargeRoadBadges(map);
        refreshTiles();
      }
    },
  };
}
