import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import {
  bboxArea,
  bboxToParam,
  clipBboxToLayerBounds,
  mapBoundsBbox,
  paddedBbox,
  type Bbox,
} from "./bbox";
import { HEATMAP_LAYER_ID } from "./events";
import { RISK_LAYER_ID } from "./risk";
import type { LayerController, LayerLoadingCallback } from "./types";

type AdtSegment = {
  fid: number;
  adt_total: number;
  adt_tung: number | null;
  matar: number | null;
  geometry: GeoJSON.LineString;
};

type AdtTile = Bbox & { key: string; centerLng: number; centerLat: number };

// Vid zoom 8 är viewporten ~4° bred i Sverige; padded blir den ~6° och en
// sån query timeoutar mot Supabase för de tyngre analyslagren (för många
// segment). Zoom 9 är ~2° vilket fungerar bra för Risk/ÅDT.
const NVDB_MIN_ZOOM = 9;
const ADT_SOURCE_ID = "adt";
const ADT_LAYER_ID = "adt-lines";
const ADT_TILE_DEG = 0.6;
const ADT_TILE_PADDING = 0.2;
const ADT_MAX_CONCURRENT_TILES = 8;
const ADT_MAX_VIEWPORT_AREA_DEG2 = 8;

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

// ÅDT-lager: tile-cacheat via /api/adt vid moveend när zoom ≥ 9.
// Färgar linjer efter trafikflöde (ljusblåvitt → blått). Läggs under risk
// och events så att det läses som underlagsdata, inte slutsatsen.
export function addAdtLayer(
  map: MapLibreMap,
  opts: { onLoadingChange?: LayerLoadingCallback } = {},
): LayerController {
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
  const featureCache = new Map<number, GeoJSON.Feature<GeoJSON.LineString>>();
  const fetchedTiles = new Set<string>();
  const queuedTiles = new Set<string>();
  const inFlightTiles = new Set<string>();
  const tileQueue: AdtTile[] = [];
  let activeTileFetches = 0;
  let enabled = false;
  let loading = false;

  const setLoading = (v: boolean) => {
    if (loading === v) return;
    loading = v;
    opts.onLoadingChange?.(v);
  };

  const syncLoading = () => {
    setLoading(enabled && (activeTileFetches > 0 || tileQueue.length > 0));
  };

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
    if (!enabled) {
      syncLoading();
      return;
    }
    while (activeTileFetches < ADT_MAX_CONCURRENT_TILES && tileQueue.length > 0) {
      const tile = tileQueue.shift();
      if (!tile) return;
      queuedTiles.delete(tile.key);
      if (fetchedTiles.has(tile.key) || inFlightTiles.has(tile.key)) continue;

      activeTileFetches++;
      inFlightTiles.add(tile.key);
      syncLoading();
      void fetchTile(tile).finally(() => {
        activeTileFetches--;
        inFlightTiles.delete(tile.key);
        pumpTiles();
        syncLoading();
      });
    }
    syncLoading();
  };

  const refreshTiles = () => {
    if (!enabled) return;
    if (map.getZoom() < NVDB_MIN_ZOOM) return;

    const viewport = mapBoundsBbox(map);
    if (!viewport) return;
    const padded = clipBboxToLayerBounds(paddedBbox(viewport, ADT_TILE_PADDING));
    if (!padded || bboxArea(padded) > ADT_MAX_VIEWPORT_AREA_DEG2) return;

    const center = map.getCenter();
    const nextTiles = adtTilesForBbox(padded, center).filter(
      (tile) => !fetchedTiles.has(tile.key) &&
        !queuedTiles.has(tile.key) &&
        !inFlightTiles.has(tile.key),
    );
    for (const tile of nextTiles) queuedTiles.add(tile.key);
    tileQueue.unshift(...nextTiles);
    pumpTiles();
    syncLoading();
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
      enabled = v;
      if (v) {
        refreshTiles();
      } else {
        syncLoading();
      }
    },
  };
}
