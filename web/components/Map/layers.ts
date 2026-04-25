import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";

type EventPoint = {
  id: string;
  lng: number;
  lat: number;
  icon_id: string | null;
  road_number: string | null;
  last_seen: string;
};

type AdtSegment = {
  fid: number;
  adt_total: number;
  adt_tung: number | null;
  matar: number | null;
  geometry: GeoJSON.LineString;
};

type TskSegment = {
  fid: number;
  klass: string;
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

const SOURCE_ID = "events";
const HEATMAP_LAYER_ID = "events-heatmap";
const CIRCLE_LAYER_ID = "events-circles";

const ADT_SOURCE_ID = "adt";
const ADT_LAYER_ID = "adt-lines";
const TSK_SOURCE_ID = "tsk";
const TSK_LAYER_ID = "tsk-lines";
const RISK_SOURCE_ID = "risk";
const RISK_LAYER_ID = "risk-lines";

// Vid zoom 8 är viewporten ~4° bred i Sverige; padded blir den ~6° och en
// sån query timeoutar mot Supabase (för många segment). Zoom 9 är ~2°
// vilket fungerar bra för båda lager.
const NVDB_MIN_ZOOM = 9;

export async function addEventsLayer(map: MapLibreMap): Promise<void> {
  const res = await fetch("/api/events");
  if (!res.ok) {
    console.error("failed to fetch events", await res.text());
    return;
  }
  const { points } = (await res.json()) as { points: EventPoint[] };

  const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        icon_id: p.icon_id,
        road_number: p.road_number,
        last_seen: p.last_seen,
      },
    })),
  };

  const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(geojson);
    return;
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
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0, 0, 0, 0)",
        0.2, "rgba(255, 223, 163, 0.5)",
        0.4, "rgba(247, 168, 85, 0.7)",
        0.6, "rgba(232, 104, 58, 0.85)",
        0.8, "rgba(192, 54, 40, 0.9)",
        1, "rgba(128, 20, 20, 0.95)",
      ],
      "heatmap-opacity": [
        "interpolate", ["linear"], ["zoom"],
        4, 0.9,
        12, 0.6,
        13, 0,
      ],
    },
  });

  // Enskilda punkter — tonar in vid hög zoom där heatmapen blir glesare.
  map.addLayer({
    id: CIRCLE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    minzoom: 10,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 7, 18, 12],
      "circle-color": "#c0543a",
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
}

// Delad bbox-driven loader för NVDB-lagren (ADT, TSK).
//
// - Padder bbox 30% i varje riktning så små panoreringar inte refetchar.
// - Säkerhetsventil mot stora bbox (zoom 7-8 hit p.g.a. resize/hot-reload):
//   skippa fetch om paddad bbox > 8 sq° (timeout-risk på Supabase free tier).
// - `setEnabled(false)` pausar fetch (när lagret är toggled off).
//   Vid `setEnabled(true)` triggas refresh; cachen behålls så ingen onödig
//   fetch sker om viewporten inte hunnit röra sig.
type Bbox = { west: number; south: number; east: number; north: number };
type BboxLoader = { setEnabled: (v: boolean) => void };

function createBboxLoader(
  map: MapLibreMap,
  opts: {
    minZoom: number;
    fetchBbox: (b: Bbox) => Promise<void>;
  },
): BboxLoader {
  const BBOX_PADDING = 0.3;
  const MAX_BBOX_AREA_DEG2 = 8;

  let cachedBbox: Bbox | null = null;
  let inFlight = false;
  let needsRefresh = false;
  let enabled = true;

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

// ÅDT-lager: bbox-driven, fyller på via /api/adt vid moveend när zoom ≥ 9.
// Färgar linjer efter trafikflöde (lågt blått → högt rött). Läggs in före
// events-lagret så att olyckspunkter renderas ovanpå vägfärgningen.
export function addAdtLayer(map: MapLibreMap): LayerController {
  if (map.getSource(ADT_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(ADT_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(HEATMAP_LAYER_ID) ? HEATMAP_LAYER_ID : undefined;
  map.addLayer(
    {
      id: ADT_LAYER_ID,
      type: "line",
      source: ADT_SOURCE_ID,
      minzoom: NVDB_MIN_ZOOM,
      paint: {
        // Trafikflöde: ColorBrewer RdYlBu inverterad. Skala vald så att
        // typiska riksvägar (5–15k) hamnar i gult/orange och E-vägar
        // (>20k) blir röda.
        "line-color": [
          "interpolate", ["linear"], ["get", "adt_total"],
          500, "#2c7bb6",
          2000, "#abd9e9",
          5000, "#ffffbf",
          10000, "#fdae61",
          20000, "#d7191c",
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

  const loader = createBboxLoader(map, {
    minZoom: NVDB_MIN_ZOOM,
    fetchBbox: async (padded) => {
      const res = await fetch(`/api/adt?bbox=${bboxToParam(padded)}`);
      if (!res.ok) {
        console.error("failed to fetch adt", await res.text());
        return;
      }
      const { segments } = (await res.json()) as { segments: AdtSegment[] };
      const fc: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
        type: "FeatureCollection",
        features: segments.map((s) => ({
          type: "Feature",
          geometry: s.geometry,
          properties: {
            fid: s.fid,
            adt_total: s.adt_total,
            adt_tung: s.adt_tung,
            matar: s.matar,
          },
        })),
      };
      const src = map.getSource(ADT_SOURCE_ID) as GeoJSONSource | undefined;
      src?.setData(fc);
    },
  });

  return {
    setVisible: (v) => {
      if (map.getLayer(ADT_LAYER_ID)) {
        map.setLayoutProperty(ADT_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      loader.setEnabled(v);
    },
  };
}

// TSK-lager (TrafikSäkerhetsKlass): bbox-driven, samma fetch-mönster som ADT.
// Färgkategorier från ColorBrewer RdYlGn — grön = säker, röd = farlig.
// Bredare line-width än ADT så att ADT-färgen syns som stripa ovanpå när
// båda lagren är synliga samtidigt.
export function addTskLayer(map: MapLibreMap): LayerController {
  if (map.getSource(TSK_SOURCE_ID)) {
    return { setVisible: () => {} };
  }

  map.addSource(TSK_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(ADT_LAYER_ID)
    ? ADT_LAYER_ID
    : map.getLayer(HEATMAP_LAYER_ID)
      ? HEATMAP_LAYER_ID
      : undefined;
  map.addLayer(
    {
      id: TSK_LAYER_ID,
      type: "line",
      source: TSK_SOURCE_ID,
      minzoom: NVDB_MIN_ZOOM,
      paint: {
        "line-color": [
          "match", ["get", "klass"],
          "Mycket god", "#1a9850",
          "God",        "#a6d96a",
          "Mindre god", "#fdae61",
          "Låg",        "#d7191c",
          "#999999",
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8, 2.5,
          12, 5,
          16, 9,
        ],
        "line-opacity": [
          "interpolate", ["linear"], ["zoom"],
          NVDB_MIN_ZOOM, 0.35,
          NVDB_MIN_ZOOM + 1, 0.65,
        ],
      },
    },
    beforeId,
  );

  const loader = createBboxLoader(map, {
    minZoom: NVDB_MIN_ZOOM,
    fetchBbox: async (padded) => {
      const res = await fetch(`/api/tsk?bbox=${bboxToParam(padded)}`);
      if (!res.ok) {
        console.error("failed to fetch tsk", await res.text());
        return;
      }
      const { segments } = (await res.json()) as { segments: TskSegment[] };
      const fc: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
        type: "FeatureCollection",
        features: segments.map((s) => ({
          type: "Feature",
          geometry: s.geometry,
          properties: {
            fid: s.fid,
            klass: s.klass,
          },
        })),
      };
      const src = map.getSource(TSK_SOURCE_ID) as GeoJSONSource | undefined;
      src?.setData(fc);
    },
  });

  return {
    setVisible: (v) => {
      if (map.getLayer(TSK_LAYER_ID)) {
        map.setLayoutProperty(TSK_LAYER_ID, "visibility", v ? "visible" : "none");
      }
      loader.setEnabled(v);
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

  // Ovanpå TSK, under ADT — så ADT-färgen syns som tunn stripa när alla
  // tre är på, och risk-segmenten är synliga som mellanlager.
  const beforeId = map.getLayer(ADT_LAYER_ID)
    ? ADT_LAYER_ID
    : map.getLayer(HEATMAP_LAYER_ID)
      ? HEATMAP_LAYER_ID
      : undefined;

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
          0, "#1a9850",
          2, "#a6d96a",
          3, "#fdae61",
          4, "#f46d43",
          5, "#d7191c",
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
      loader.setEnabled(v);
    },
  };
}
