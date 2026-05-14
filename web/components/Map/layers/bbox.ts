import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerLoadingCallback } from "./types";

export type Bbox = { west: number; south: number; east: number; north: number };
export type BboxLoader = { setEnabled: (v: boolean) => void };

const SWEDEN_LAYER_BBOX: Bbox = {
  west: 9,
  south: 54,
  east: 25,
  north: 70,
};

export function bboxArea(b: Bbox): number {
  return Math.max(0, b.east - b.west) * Math.max(0, b.north - b.south);
}

function finiteBbox(b: Bbox): boolean {
  return (
    Number.isFinite(b.west) &&
    Number.isFinite(b.south) &&
    Number.isFinite(b.east) &&
    Number.isFinite(b.north) &&
    b.west < b.east &&
    b.south < b.north
  );
}

export function clipBboxToLayerBounds(b: Bbox): Bbox | null {
  if (!finiteBbox(b)) return null;
  const clipped: Bbox = {
    west: Math.max(SWEDEN_LAYER_BBOX.west, b.west),
    south: Math.max(SWEDEN_LAYER_BBOX.south, b.south),
    east: Math.min(SWEDEN_LAYER_BBOX.east, b.east),
    north: Math.min(SWEDEN_LAYER_BBOX.north, b.north),
  };
  return finiteBbox(clipped) ? clipped : null;
}

export function paddedBbox(b: Bbox, padding: number): Bbox {
  const padW = (b.east - b.west) * padding;
  const padH = (b.north - b.south) * padding;
  return {
    west: b.west - padW,
    south: b.south - padH,
    east: b.east + padW,
    north: b.north + padH,
  };
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer.west <= inner.west &&
    outer.east >= inner.east &&
    outer.south <= inner.south &&
    outer.north >= inner.north
  );
}

// Gemensam viewport-loader för tyngre bbox-lager:
// - Lyssnar på moveend.
// - Padder bbox 30% i varje riktning så små panoreringar inte refetchar.
// - Säkerhetsventil mot stora bbox (zoom 7-8 hit p.g.a. resize/hot-reload).
// - setEnabled(false) pausar fetch när lagret är toggled off.
export function createBboxLoader(
  map: MapLibreMap,
  opts: {
    minZoom: number;
    initialEnabled?: boolean;
    bboxPadding?: number;
    maxBboxAreaDeg2?: number;
    fetchBbox: (b: Bbox) => Promise<void>;
    onLoadingChange?: LayerLoadingCallback;
  },
): BboxLoader {
  const BBOX_PADDING = opts.bboxPadding ?? 0.3;
  const MAX_BBOX_AREA_DEG2 = opts.maxBboxAreaDeg2 ?? 8;

  let cachedBbox: Bbox | null = null;
  let inFlight = false;
  let needsRefresh = false;
  let enabled = opts.initialEnabled ?? true;
  let loading = false;

  const setLoading = (v: boolean) => {
    if (loading === v) return;
    loading = v;
    opts.onLoadingChange?.(v);
  };

  const refresh = async (): Promise<void> => {
    if (!enabled) return;
    if (map.getZoom() < opts.minZoom) return;
    if (inFlight) {
      needsRefresh = true;
      setLoading(true);
      return;
    }
    const viewport = mapBoundsBbox(map);
    if (!viewport) return;
    if (cachedBbox && bboxContains(cachedBbox, viewport)) return;

    const padded = clipBboxToLayerBounds(paddedBbox(viewport, BBOX_PADDING));
    if (!padded || bboxArea(padded) > MAX_BBOX_AREA_DEG2) return;

    inFlight = true;
    setLoading(true);
    try {
      await opts.fetchBbox(padded);
      cachedBbox = padded;
    } finally {
      inFlight = false;
      if (needsRefresh) {
        needsRefresh = false;
        void refresh().finally(() => {
          if (!inFlight && !needsRefresh) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    }
  };

  map.on("moveend", () => { void refresh(); });
  void refresh();

  return {
    setEnabled: (v: boolean) => {
      if (enabled === v) return;
      enabled = v;
      if (v) {
        void refresh();
      } else {
        setLoading(false);
      }
    },
  };
}

export function bboxToParam(b: Bbox): string {
  return [b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(",");
}

export function mapBoundsBbox(map: MapLibreMap, padding = 0): Bbox | null {
  const b = map.getBounds();
  const viewport: Bbox = {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  };
  const padded = padding > 0 ? paddedBbox(viewport, padding) : viewport;
  return clipBboxToLayerBounds(padded);
}
