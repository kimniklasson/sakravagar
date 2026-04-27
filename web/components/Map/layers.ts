import maplibregl, { type Map as MapLibreMap, type GeoJSONSource } from "maplibre-gl";
import type { SegmentDetail } from "@/app/api/segment/route";
import type { EventPoint } from "@/app/api/events/route";

type AdtSegment = {
  fid: number;
  adt_total: number;
  adt_tung: number | null;
  matar: number | null;
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
const HIT_TARGET_LAYER_ID = "events-hit-target";
const LIVE_HALO_LAYER_ID = "events-live-halo";
const LIVE_CORE_LAYER_ID = "events-live-core";

// Pågående = senast sedd inom 90 min (3 polling-cykler à 30 min). Trafikverket
// droppar olyckor ur feeden när de avslutas, så last_seen slutar uppdateras
// och vi kan klassa dem som historiska.
const LIVE_THRESHOLD_MS = 90 * 60 * 1000;

const ADT_SOURCE_ID = "adt";
const ADT_LAYER_ID = "adt-lines";
const RISK_SOURCE_ID = "risk";
const RISK_LAYER_ID = "risk-lines";

// Vid zoom 8 är viewporten ~4° bred i Sverige; padded blir den ~6° och en
// sån query timeoutar mot Supabase (för många segment). Zoom 9 är ~2°
// vilket fungerar bra för båda lager.
const NVDB_MIN_ZOOM = 9;

export async function addEventsLayer(
  map: MapLibreMap,
  opts: { since?: string | null } = {},
): Promise<{ liveCount: number }> {
  const url = opts.since ? `/api/events?since=${encodeURIComponent(opts.since)}` : "/api/events";
  const res = await fetch(url);
  if (!res.ok) {
    console.error("failed to fetch events", await res.text());
    return { liveCount: 0 };
  }
  const { points } = (await res.json()) as { points: EventPoint[] };

  const liveCutoff = Date.now() - LIVE_THRESHOLD_MS;
  let liveCount = 0;
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
    return { liveCount };
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

  // Enskilda historiska punkter — tonar in vid hög zoom där heatmapen blir glesare.
  // Pågående olyckor renderas separat nedan så de inte kommer hit.
  map.addLayer({
    id: CIRCLE_LAYER_ID,
    type: "circle",
    source: SOURCE_ID,
    minzoom: 10,
    filter: ["!=", ["get", "is_live"], true],
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

  // Osynligt hit-target för historiska events — alltid aktivt så att
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
      "circle-radius": 6,
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
      "circle-color": "#d7191c",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 6, 16, 10],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 1,
    },
  });

  startLivePulse(map);

  return { liveCount };
}

// rAF-loop som pulserar halo-lagret. Klassiskt "radar-ping": radien expanderar
// och opaciteten tonas ut, sen reset. Loopen avbryter sig själv när lagret
// inte längre finns på kartan (efter map.remove()).
function startLivePulse(map: MapLibreMap): void {
  const start = performance.now();
  const PERIOD_MS = 1500;
  const tick = () => {
    if (!map.getLayer(LIVE_HALO_LAYER_ID)) return;
    const phase = ((performance.now() - start) % PERIOD_MS) / PERIOD_MS;
    const radius = 6 + phase * 22;
    const opacity = 0.3 * (1 - phase);
    map.setPaintProperty(LIVE_HALO_LAYER_ID, "circle-radius", radius);
    map.setPaintProperty(LIVE_HALO_LAYER_ID, "circle-opacity", opacity);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Delad bbox-driven loader för NVDB-lagren (ADT).
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

  // Under ADT så ADT-färgen syns som tunn stripa ovanpå risk-segmenten
  // när båda är på.
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

// Click → popup för segment och events.
//
// Prioritetsordning vid klick: events-circles → risk → adt.
// Eventcirklarna ligger överst i render-stacken så ett klick rakt på en
// punkt vinner; klick lite vid sidan om faller igenom till segmentet.
// Osynliga lager filtreras automatiskt bort eftersom queryRenderedFeatures
// bara returnerar visible features.
//
// Event-popup: all data finns redan på feature.properties, ingen fetch behövs.
// Segment-popup: behöver RPC-anrop, så vi visar "Laddar…" först.
//
// Cursor → pointer på hover så användaren ser att lagren är klickbara.
//
// Popupar renderas via setHTML — alla värden från databasen passerar
// escapeHtml() eftersom de kommer från Trafikverkets API och kan innehålla
// godtyckliga strängar.
export function addPopupHandler(map: MapLibreMap): void {
  const segmentLayerIds = [RISK_LAYER_ID, ADT_LAYER_ID];
  // Live-core ovanpå historisk circle, halo skippas (dekorativ — klick går
  // igenom till core eller faller till segment). Hit-target sist: fångar
  // klick på historiska events vid låg zoom där CIRCLE_LAYER_ID inte renderas.
  const eventLayerIds = [LIVE_CORE_LAYER_ID, CIRCLE_LAYER_ID, HIT_TARGET_LAYER_ID];
  const allLayerIds = [...eventLayerIds, ...segmentLayerIds];

  for (const id of allLayerIds) {
    map.on("mouseenter", id, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", id, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: allLayerIds });
    if (!features.length) return;

    // Eventcirkel vinner alltid om en sådan ligger under klick-punkten,
    // sen segment i prioritetsordning Risk → ADT.
    const eventFeature = features.find((f) => eventLayerIds.includes(f.layer.id));
    if (eventFeature) {
      openEventPopup(map, e.lngLat, eventFeature.properties);
      return;
    }

    let segmentFeature: (typeof features)[number] | undefined;
    for (const id of segmentLayerIds) {
      const f = features.find((x) => x.layer.id === id);
      if (f) {
        segmentFeature = f;
        break;
      }
    }
    if (!segmentFeature) return;

    const fid = Number(segmentFeature.properties?.fid);
    if (!Number.isFinite(fid)) return;
    openSegmentPopup(map, e.lngLat, fid);
  });
}

function openEventPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  props: Record<string, unknown> | null,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderEvent(props ?? {}))
    .addTo(map);
  // Hålla popup-referensen "alive" via closure tills användaren stänger den —
  // MapLibre tar hand om resten.
  void popup;
}

function openSegmentPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  fid: number,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderLoading())
    .addTo(map);

  fetch(`/api/segment?fid=${fid}`)
    .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
    .then(({ ok, body }) => {
      if (!ok || !body?.segment) {
        popup.setHTML(renderError(body?.error ?? "okänt fel"));
        return;
      }
      popup.setHTML(renderSegment(body.segment as SegmentDetail));
    })
    .catch((err: unknown) => {
      popup.setHTML(renderError(err instanceof Error ? err.message : String(err)));
    });
}

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default:  return "&#39;";
    }
  });
}

function renderLoading(): string {
  return `<div class="seg-popup-body"><div class="seg-popup-loading">Laddar segment…</div></div>`;
}

function renderError(msg: string): string {
  return `<div class="seg-popup-body"><div class="seg-popup-error">Kunde inte ladda data: ${escapeHtml(msg)}</div></div>`;
}

// Trösklar för "tunt underlag"-hint på risk-procenten. Under 30 dagar är
// uppskattningen för osäker för att tas på allvar; vi visar talet men
// markerar det och lägger en footnote.
const DATA_WINDOW_THIN_DAYS = 30;

function formatDataWindow(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} ${hours === 1 ? "timme" : "timmar"}`;
  }
  if (days < 30) {
    return `${days.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} dagar`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} ${months === 1 ? "månad" : "månader"}`;
  }
  const years = days / 365;
  return `${years.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} år`;
}

function formatRiskPct(pct: number): string {
  // Två signifikanta siffror skalar bra över magnituder:
  // 0,000023 → "0,000023", 0,52 → "0,52", 12 → "12".
  return `${pct.toLocaleString("sv-SE", { maximumSignificantDigits: 2 })} %`;
}

function renderSegment(s: SegmentDetail): string {
  const adt = typeof s.adt_total === "number"
    ? `${s.adt_total.toLocaleString("sv-SE")} fordon/dygn`
    : "okänd";
  const matarSuffix = s.matar ? ` <span class="seg-popup-muted">(mätår ${escapeHtml(s.matar)})</span>` : "";
  const eventsCount = s.events_count ?? 0;
  const langd = typeof s.langd_m === "number" ? Math.round(s.langd_m) : null;
  const days = typeof s.data_window_days === "number" ? s.data_window_days : 0;
  const isThinData = days < DATA_WINDOW_THIN_DAYS;
  const dataWindowText = formatDataWindow(days);
  const riskPct = s.risk_per_passage_pct;

  const riskRow = eventsCount > 0 && typeof riskPct === "number"
    ? `<dt>Risk</dt><dd>≈ ${escapeHtml(formatRiskPct(riskPct))} per passage${isThinData ? ' <span class="seg-popup-warn">*</span>' : ""}</dd>`
    : "";

  // Vägnummer hämtas från events (NVDB själv har inte vägnummer i adt-vyn).
  // Om olika events i samma segment har olika vägnummer (t.ex. avfart/påfart)
  // visar vi alla unika.
  const roadNumbers = Array.from(
    new Set(s.recent_events.map((e) => e.road_number).filter((r): r is string => !!r)),
  );
  const headerRoad = roadNumbers.length
    ? `<div class="seg-popup-road">${escapeHtml(roadNumbers.join(", "))}</div>`
    : "";

  const recent = s.recent_events.slice(0, 3).map((ev) => {
    const date = new Date(ev.first_seen).toLocaleDateString("sv-SE");
    const rn = ev.road_number ? `<span class="seg-popup-road-tag">${escapeHtml(ev.road_number)}</span>` : "";
    const msg = ev.message ? escapeHtml(ev.message).slice(0, 100) : "";
    return `<li><span class="seg-popup-date">${escapeHtml(date)}</span> ${rn}<span class="seg-popup-msg">${msg}</span></li>`;
  }).join("");

  const moreNote = s.recent_events.length > 3
    ? `<div class="seg-popup-more">+${s.recent_events.length - 3} äldre olyckor i segmentet</div>`
    : "";

  const recentBlock = eventsCount > 0
    ? `<div class="seg-popup-section-title">Senaste olyckor</div>
       <ul class="seg-popup-events">${recent}</ul>
       ${moreNote}`
    : `<div class="seg-popup-empty">Inga registrerade olyckor sedan datainsamlingen startade.</div>`;

  const thinDataNote = eventsCount > 0 && isThinData
    ? `<div class="seg-popup-warn-note">* Datafönstret är kort — riskvärdet är preliminärt och kan förändras kraftigt när mer historik samlats in.</div>`
    : "";

  return `
    <div class="seg-popup-body">
      ${headerRoad}
      <dl class="seg-popup-stats">
        <dt>ÅDT</dt><dd>${escapeHtml(adt)}${matarSuffix}</dd>
        <dt>Olyckor</dt><dd>${eventsCount}</dd>
        ${riskRow}
        <dt>Datafönster</dt><dd>${escapeHtml(dataWindowText)}</dd>
      </dl>
      ${recentBlock}
      ${thinDataNote}
      <div class="seg-popup-footer">
        Siffrorna gäller hela vägsegmentet${langd ? ` (~${langd} m)` : ""}, från korsning till korsning enligt NVDB.
      </div>
    </div>
  `;
}

// Event-popup. Datan kommer direkt från feature.properties (MapLibre
// serialiserar properties-objektet) — ingen extra fetch behövs. Eftersom
// MapLibre kan stringifiera nested values läser vi varje fält defensivt.
function renderEvent(props: Record<string, unknown>): string {
  const message = typeof props.message === "string" ? props.message : "";
  const roadNumber = typeof props.road_number === "string" ? props.road_number : "";
  const severity = typeof props.severity === "string" ? props.severity : "";
  const firstSeenRaw = typeof props.first_seen === "string" ? props.first_seen : "";
  const dateText = firstSeenRaw
    ? new Date(firstSeenRaw).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
    : "";

  const headerRoad = roadNumber
    ? `<div class="seg-popup-road">${escapeHtml(roadNumber)}</div>`
    : "";
  const dateLine = dateText
    ? `<div class="seg-popup-date seg-popup-event-date">${escapeHtml(dateText)}</div>`
    : "";
  const severityLine = severity
    ? `<div class="seg-popup-muted seg-popup-event-severity">${escapeHtml(severity)}</div>`
    : "";
  const messageBlock = message
    ? `<div class="seg-popup-event-msg">${escapeHtml(message)}</div>`
    : `<div class="seg-popup-empty">Ingen beskrivning från Trafikverket.</div>`;

  return `
    <div class="seg-popup-body">
      ${headerRoad}
      ${dateLine}
      ${severityLine}
      ${messageBlock}
      <div class="seg-popup-footer">
        Klicka på vägsegmentet för aggregerad statistik. Saknas vägen i ÅDT-datasetet visas ingen färgning.
      </div>
    </div>
  `;
}
