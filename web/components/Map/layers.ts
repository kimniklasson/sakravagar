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

const SOURCE_ID = "events";
const HEATMAP_LAYER_ID = "events-heatmap";
const CIRCLE_LAYER_ID = "events-circles";

const ADT_SOURCE_ID = "adt";
const ADT_LAYER_ID = "adt-lines";
const ADT_MIN_ZOOM = 8;

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

// ÅDT-lager: bbox-driven, fyller på via /api/adt vid moveend när zoom ≥ 8.
// Färgar linjer efter trafikflöde (lågt blått → högt rött). Läggs in före
// events-lagret så att olyckspunkter renderas ovanpå vägfärgningen.
export function addAdtLayer(map: MapLibreMap): void {
  if (map.getSource(ADT_SOURCE_ID)) return;

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
      minzoom: ADT_MIN_ZOOM,
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
          ADT_MIN_ZOOM, 0,
          9, 0.7,
        ],
      },
    },
    beforeId,
  );

  // Padda bbox 50% i varje riktning så vi cachar mer än viewporten visar.
  // Då kan användaren panorera/zooma in inom det området utan att vi
  // refetchar — segmentens position och färg förblir stabila.
  const BBOX_PADDING = 0.5;
  type Bbox = { west: number; south: number; east: number; north: number };
  let cachedBbox: Bbox | null = null;
  let inFlight = false;
  let needsRefresh = false;

  const contains = (outer: Bbox, inner: Bbox) =>
    outer.west <= inner.west &&
    outer.east >= inner.east &&
    outer.south <= inner.south &&
    outer.north >= inner.north;

  const refresh = async (): Promise<void> => {
    if (map.getZoom() < ADT_MIN_ZOOM) return;
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

    inFlight = true;
    try {
      const bboxStr = [padded.west, padded.south, padded.east, padded.north]
        .map((n) => n.toFixed(4))
        .join(",");
      const res = await fetch(`/api/adt?bbox=${bboxStr}`);
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
      cachedBbox = padded;
    } finally {
      inFlight = false;
      // Viewport kan ha rört sig under fetchen — kolla om vi behöver hämta igen.
      if (needsRefresh) {
        needsRefresh = false;
        void refresh();
      }
    }
  };

  map.on("moveend", () => { void refresh(); });
  // Trigga vid initialladdning om kartan redan är inzoomad (t.ex. hot-reload).
  void refresh();
}
