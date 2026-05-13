import {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import {
  bboxToParam,
  createBboxLoader,
} from "./bbox";
import { HEATMAP_LAYER_ID } from "./events";
import type { LayerController } from "./types";

type RiskSegment = {
  fid: number;
  adt_total: number;
  events_count: number;
  risk_per_milj_fordon: number;
  geometry: GeoJSON.LineString;
};

// Vid zoom 8 är viewporten ~4° bred i Sverige; padded blir den ~6° och en
// sån query timeoutar mot Supabase för de tyngre analyslagren (för många
// segment). Zoom 9 är ~2° vilket fungerar bra för Risk/ÅDT.
const NVDB_MIN_ZOOM = 9;
const RISK_SOURCE_ID = "risk";
export const RISK_LAYER_ID = "risk-lines";
const RISK_HIT_LAYER_ID = "risk-lines-hit";

// Risk-lager: dormant product surface. Risk-MV och segmentdata finns kvar för
// senare datamognad, men riskrelaterade cronjobb är pausade i prod sedan
// 2026-05-13 och lagret ska inte visas i UI utan nytt produktbeslut.
// Om lagret aktiveras igen ska segment-popupen nedan aktiveras via risklagrets
// hit-target, inte via ÅDT-lagret.
/**
 * @deprecated Dormant by design — see docs/decisions.md 2026-05-11 and 2026-05-13.
 */
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
