import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { SegmentDetail } from "@/app/api/segment/route";

const RISK_LAYER_ID = "risk-lines";
const RISK_HIT_LAYER_ID = "risk-lines-hit";
const DISTURBANCE_LAYER_ID = "disturbances-points";
const DISTURBANCE_HIT_LAYER_ID = "disturbances-hit-target";
const TRAFFIC_FLOW_LAYER_ID = "traffic-flow-lines";
const TRAFFIC_FLOW_HIT_LAYER_ID = "traffic-flow-hit-target";
const CIRCLE_LAYER_ID = "events-circles";
const HIT_TARGET_LAYER_ID = "events-hit-target";
const LIVE_CORE_LAYER_ID = "events-live-core";

// Click -> popup för olyckor och aktuella live-lager.
//
// Prioritetsordning vid klick: olyckor -> störningar -> trafikläge.
// Eventcirklarna ligger överst i render-stacken så ett klick rakt på en
// punkt vinner; klick lite vid sidan om faller igenom till segmentet.
// Osynliga lager filtreras automatiskt bort eftersom queryRenderedFeatures
// bara returnerar visible features.
//
// Event-popup: all data finns redan på feature.properties, ingen fetch behövs.
// Cursor -> pointer på hover så användaren ser att lagren är klickbara.
//
// Popupar renderas via setHTML - alla värden från databasen passerar
// escapeHtml() eftersom de kommer från Trafikverkets API och kan innehålla
// godtyckliga strängar.
export function addPopupHandler(map: MapLibreMap): void {
  // ADT-linjer är medvetet inte klickbara: segmentpopupen gav för exakt
  // signal för ett lager som främst ska läsas som blå trafikintensitet.
  // Risklagrets popupväg är kvar vilande tills riskfärgningen aktiveras igen.
  const segmentLayerIds = [RISK_HIT_LAYER_ID, RISK_LAYER_ID].filter((id) => map.getLayer(id));
  const disturbanceLayerIds = [DISTURBANCE_LAYER_ID, DISTURBANCE_HIT_LAYER_ID];
  const trafficFlowLayerIds = [TRAFFIC_FLOW_LAYER_ID, TRAFFIC_FLOW_HIT_LAYER_ID];
  // Live-core ovanpå historisk circle, halo skippas (dekorativ - klick går
  // igenom till core eller faller till segment). Hit-target sist: fångar
  // klick på historiska events vid låg zoom där CIRCLE_LAYER_ID inte renderas.
  const eventLayerIds = [LIVE_CORE_LAYER_ID, CIRCLE_LAYER_ID, HIT_TARGET_LAYER_ID];
  const allLayerIds = [...eventLayerIds, ...disturbanceLayerIds, ...trafficFlowLayerIds, ...segmentLayerIds];

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

    // Olyckor vinner alltid, därefter färska störningar och trafikläge.
    const eventFeature = features.find((f) => eventLayerIds.includes(f.layer.id));
    if (eventFeature) {
      openEventPopup(map, e.lngLat, eventFeature.properties);
      return;
    }

    const disturbanceFeature = features.find((f) => disturbanceLayerIds.includes(f.layer.id));
    if (disturbanceFeature) {
      openDisturbancePopup(map, e.lngLat, disturbanceFeature.properties);
      return;
    }

    const trafficFlowFeature = features.find((f) => trafficFlowLayerIds.includes(f.layer.id));
    if (trafficFlowFeature) {
      openTrafficFlowPopup(map, e.lngLat, trafficFlowFeature.properties);
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

function openTrafficFlowPopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  props: Record<string, unknown> | null,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup event-popup traffic-flow-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderTrafficFlow(props ?? {}))
    .addTo(map);
  void popup;
}

function openDisturbancePopup(
  map: MapLibreMap,
  lngLat: maplibregl.LngLat,
  props: Record<string, unknown> | null,
): void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "seg-popup event-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderDisturbance(props ?? {}))
    .addTo(map);
  void popup;
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
    className: "seg-popup event-popup",
  })
    .setLngLat(lngLat)
    .setHTML(renderEvent(props ?? {}))
    .addTo(map);
  // Hålla popup-referensen "alive" via closure tills användaren stänger den.
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
  return `<div class="seg-popup-body"><div class="seg-popup-loading">Laddar segment...</div></div>`;
}

function renderError(msg: string): string {
  return `<div class="seg-popup-body"><div class="seg-popup-error">Kunde inte ladda data: ${escapeHtml(msg)}</div></div>`;
}

// Segmentpopupen är också vilande tillsammans med risklagret. Trösklarna för
// "tunt underlag" ligger kvar för framtida återaktivering.
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
  // 0,000023 -> "0,000023", 0,52 -> "0,52", 12 -> "12".
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
    ? `<div class="seg-popup-warn-note">* Datafönstret är kort - riskvärdet är preliminärt och kan förändras kraftigt när mer historik samlats in.</div>`
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
// serialiserar properties-objektet) - ingen extra fetch behövs. Eftersom
// MapLibre kan stringifiera nested values läser vi varje fält defensivt.
function formatPopupTimestamp(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const dateText = date.toLocaleDateString("sv-SE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeText = date.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dateText}, ${timeText}`;
}

function booleanProperty(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizedPopupMessage(message: string): string {
  return message.trim();
}

function renderImpactBadge(label: string, tone: "high" | "medium" | "low" | "neutral"): string {
  return `<div class="event-popup-badge event-popup-badge-${tone}">${escapeHtml(label)}</div>`;
}

function disturbanceImpactBadge(severity: string, fallback: string): string {
  const normalized = severity.trim().toLocaleLowerCase("sv-SE");
  if (normalized.includes("mycket") || normalized.includes("very") || normalized.includes("major")) {
    return renderImpactBadge("MYCKET STOR PÅVERKAN", "high");
  }
  if (normalized.includes("stor") || normalized.includes("large")) {
    return renderImpactBadge("STOR PÅVERKAN", "medium");
  }
  if (normalized.includes("liten") || normalized.includes("minor") || normalized.includes("small")) {
    return renderImpactBadge("LITEN PÅVERKAN", "low");
  }
  const label = severity.trim() || fallback.trim() || "TRAFIKSTÖRNING";
  return renderImpactBadge(label.toLocaleUpperCase("sv-SE"), "neutral");
}

function renderEvent(props: Record<string, unknown>): string {
  const message = typeof props.message === "string" ? props.message : "";
  const roadNumber = typeof props.road_number === "string" ? props.road_number : "";
  const lastSeenRaw = typeof props.last_seen === "string" ? props.last_seen : "";
  const firstSeenRaw = typeof props.first_seen === "string" ? props.first_seen : "";
  const dateText = formatPopupTimestamp(lastSeenRaw || firstSeenRaw);
  const isLive = booleanProperty(props.is_live);
  const badge = renderImpactBadge(isLive ? "LIVE-OLYCKA" : "HISTORISK OLYCKA", isLive ? "neutral" : "low");

  const headerRoad = roadNumber
    ? `<div class="event-popup-title">${escapeHtml(roadNumber)}</div>`
    : `<div class="event-popup-title">Olycka</div>`;
  const updatedLine = dateText
    ? `<div class="event-popup-updated">Uppdaterad ${escapeHtml(dateText)}</div>`
    : "";
  const messageText = normalizedPopupMessage(message);
  const messageBlock = messageText
    ? `<div class="event-popup-message">${escapeHtml(messageText)}</div>`
    : `<div class="seg-popup-empty">Ingen beskrivning från Trafikverket.</div>`;

  return `
    <div class="seg-popup-body">
      ${badge}
      ${headerRoad}
      ${messageBlock}
      ${updatedLine}
    </div>
  `;
}

function renderDisturbance(props: Record<string, unknown>): string {
  const message = typeof props.message === "string" ? props.message : "";
  const roadNumber = typeof props.road_number === "string" ? props.road_number : "";
  const severity = typeof props.severity === "string" ? props.severity : "";
  const lastSeenRaw = typeof props.last_seen === "string" ? props.last_seen : "";
  const dateText = formatPopupTimestamp(lastSeenRaw);
  const badge = disturbanceImpactBadge(severity, "Trafikstörning");

  const headerRoad = roadNumber
    ? `<div class="event-popup-title">${escapeHtml(roadNumber)}</div>`
    : `<div class="event-popup-title">Trafikstörning</div>`;
  const updatedLine = dateText
    ? `<div class="event-popup-updated">Uppdaterad ${escapeHtml(dateText)}</div>`
    : "";
  const messageText = normalizedPopupMessage(message);
  const messageBlock = messageText
    ? `<div class="event-popup-message">${escapeHtml(messageText)}</div>`
    : `<div class="seg-popup-empty">Ingen närmare beskrivning från Trafikverket.</div>`;

  return `
    <div class="seg-popup-body">
      ${badge}
      ${headerRoad}
      ${messageBlock}
      ${updatedLine}
    </div>
  `;
}

function trafficFlowCategoryLabel(category: string): string {
  switch (category) {
    case "calm": return "Lugnt";
    case "moving": return "Rullar";
    case "busy": return "Tät trafik";
    case "slow": return "Långsamt";
    default: return "Trafikläge";
  }
}

function trafficFlowBadgeTone(category: string): "high" | "neutral" {
  return category === "slow" ? "high" : "neutral";
}

function renderTrafficFlow(props: Record<string, unknown>): string {
  const flow = typeof props.vehicle_flow_rate === "number"
    ? `${Math.round(props.vehicle_flow_rate).toLocaleString("sv-SE")} fordon/timme`
    : "Okänt flöde";
  const speed = typeof props.average_vehicle_speed === "number"
    ? `Snitthastighet ${props.average_vehicle_speed.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km/h`
    : "Snitthastighet okänd";
  const category = typeof props.category === "string" ? props.category : "";
  const measurementRaw = typeof props.measurement_time === "string" ? props.measurement_time : "";
  const lastSeenRaw = typeof props.last_seen === "string" ? props.last_seen : "";
  const dateText = formatPopupTimestamp(measurementRaw || lastSeenRaw);
  const badge = renderImpactBadge(trafficFlowCategoryLabel(category).toLocaleUpperCase("sv-SE"), trafficFlowBadgeTone(category));
  const updatedLine = dateText
    ? `<div class="event-popup-updated">Uppdaterad ${escapeHtml(dateText)}</div>`
    : "";

  return `
    <div class="seg-popup-body">
      ${badge}
      <div class="event-popup-title">${escapeHtml(flow)}</div>
      <div class="event-popup-message">${escapeHtml(speed)}</div>
      ${updatedLine}
    </div>
  `;
}
