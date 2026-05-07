"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./Map.module.css";
import {
  addAdtLayer,
  addDisturbancesLayer,
  addEventsLayer,
  addRouteLayer,
  fetchLiveEvents,
  focusRoute,
  focusLiveEvents,
  addLargeRoadsLayer,
  addTrafficFlowLayer,
  addPopupHandler,
  addRiskLayer,
  refreshDisturbancesLayer,
  refreshTrafficFlowLayer,
  setEventsLayerVisible,
  setRouteLayerData,
  type LayerController,
  type RouteDragCommit,
} from "./layers";
import type { EventStats } from "@/app/api/events/stats/route";
import type { GeocodeResult } from "@/app/api/geocode/route";
import type { RouteLine } from "@/app/api/route/route";

const SWEDEN_CENTER: [number, number] = [16.5, 62.5];
const SWEDEN_ZOOM = 4.2;

type RouteStopSource = "manual" | "gps";
type RouteAvoidOption = "accidentHistory" | "highSpeed" | "disturbances" | "bridges" | "tunnels";
type RouteAvoidState = Record<RouteAvoidOption, boolean>;
type RouteTimeBudget = number | "unlimited";
type RouteStop = {
  id: string;
  label: string;
  coordinates: [number, number] | null;
  source: RouteStopSource;
};
type ResolvedRouteStop = RouteStop & { coordinates: [number, number] };
type RouteDragPlan = {
  stops: RouteStop[];
  coordinates: [number, number][];
  fallbackCoordinates: [number, number][];
};
type HelpSectionId = "risk" | "adt" | "trafficFlow" | "disturbances" | "largeRoads";
type HelpLegendSwatch = {
  kind: "line" | "dot" | "pulse" | "square" | "triangle";
  color?: string;
};
type HelpLegendItem = {
  label: string;
  swatch: HelpLegendSwatch;
};
type HelpSection = {
  id: HelpSectionId;
  icon: Exclude<LayerIconName, "help" | "close">;
  title: string;
  body: string[];
  legend: HelpLegendItem[];
};

function routeGeolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Platsåtkomst nekades. Tillåt platsdelning i webbläsaren och försök igen.";
    case error.POSITION_UNAVAILABLE:
      return "Kunde inte hämta din plats just nu.";
    case error.TIMEOUT:
      return "Det tog för lång tid att hämta din plats. Försök igen.";
    default:
      return "Kunde inte hämta din plats.";
  }
}

const initialRouteStops: RouteStop[] = [
  { id: "from", label: "", coordinates: null, source: "manual" },
  { id: "to", label: "", coordinates: null, source: "manual" },
];

const initialRouteAvoids: RouteAvoidState = {
  accidentHistory: false,
  highSpeed: false,
  disturbances: false,
  bridges: false,
  tunnels: false,
};

const routeAvoidLabels: Record<RouteAvoidOption, string> = {
  highSpeed: "Höga hastigheter",
  bridges: "Broar",
  tunnels: "Tunnlar",
  disturbances: "Störningar",
  accidentHistory: "Olycksrisk",
};

const routeAvoidTooltips: Record<RouteAvoidOption, string> = {
  highSpeed: "90-120 km/h",
  bridges: "Alla brotyper",
  tunnels: "Alla tunnlar",
  disturbances: "Vägarbeten, köer m.m.",
  accidentHistory: "Historiska olyckor",
};

const routeMetricLabels: Record<RouteAvoidOption, string> = {
  highSpeed: "Höga hastigheter",
  bridges: "Broar",
  tunnels: "Tunnlar",
  disturbances: "Störningar",
  accidentHistory: "Historisk olycksrisk",
};

const activeRouteTimeBudget: RouteTimeBudget = "unlimited";
const mobileInfoBoxQuery = "(max-width: 767px)";
const customRouteStopIdPrefix = "via-";

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(mobileInfoBoxQuery).matches;
}

function isCustomRouteStop(stop: RouteStop): boolean {
  return stop.id.startsWith(customRouteStopIdPrefix);
}

function dedupeRouteCoordinates(coordinates: [number, number][]): [number, number][] {
  return coordinates.filter((coord, index, list) => {
    const prev = list[index - 1];
    return !prev || prev[0] !== coord[0] || prev[1] !== coord[1];
  });
}

function coordinateDistanceSquared(a: [number, number], b: [number, number]): number {
  const lngScale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return ((a[0] - b[0]) * lngScale) ** 2 + (a[1] - b[1]) ** 2;
}

function closestRouteCoordinateIndex(routeCoordinates: [number, number][], coordinate: [number, number]): number {
  if (!routeCoordinates.length) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < routeCoordinates.length; index += 1) {
    const routeCoordinate = routeCoordinates[index];
    if (!routeCoordinate) continue;
    const distance = coordinateDistanceSquared(routeCoordinate, coordinate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

const helpSections: HelpSection[] = [
  {
    id: "risk",
    icon: "accidents",
    title: "Olyckor och risk",
    body: [
      "Risk-lagret färgar vägsegment efter olyckor i relation till trafikmängd. En väg blir alltså inte starkare markerad bara för att många kör där, utan för att olyckorna är många i förhållande till hur trafikerad vägen är.",
      "Här visas också historiska olyckor som ljusa punkter och, om de finns just nu, pågående olyckor som live-markeringar. Informationen ska hjälpa dig se mönster, inte förutsäga exakt vad som kommer hända.",
    ],
    legend: [
      { label: "Lägre risk", swatch: { kind: "line", color: "#FFF382" } },
      { label: "Medelrisk", swatch: { kind: "line", color: "#FFA54E" } },
      { label: "Högre risk", swatch: { kind: "line", color: "#FF2F00" } },
      { label: "Registrerad olycka", swatch: { kind: "dot", color: "#FFFFFF" } },
      { label: "Pågående olycka", swatch: { kind: "pulse", color: "#FFFFFF" } },
    ],
  },
  {
    id: "adt",
    icon: "flow",
    title: "Trafikflöde (snitt)",
    body: [
      "Det här lagret visar genomsnittlig trafikmängd, ÅDT, från NVDB via Lastkajen. ÅDT betyder ungefär hur många fordon som passerar ett vägavsnitt under ett genomsnittligt dygn.",
      "Det är inte live-data, utan en visuell uppskattning av om en väg brukar vara lugnare eller mer trafikerad. Lagret är inte klickbart och används också när olycksrisken normaliseras mot hur många som faktiskt kör på vägen.",
    ],
    legend: [
      { label: "Lägre genomsnittligt flöde", swatch: { kind: "line", color: "#C2DEFF" } },
      { label: "Högre genomsnittligt flöde", swatch: { kind: "line", color: "#0077FF" } },
    ],
  },
  {
    id: "trafficFlow",
    icon: "live",
    title: "Liveflöde (storstad)",
    body: [
      "Liveflödet kommer från Trafikverkets TrafficFlow-data. Det bygger på mätplatser och visar aktuellt flöde och snitthastighet där data finns.",
      "Täckningen är bäst i större trafikområden, särskilt Stockholm och Göteborg. Färgen gäller mätplatsen och närliggande segment, inte nödvändigtvis hela vägen.",
    ],
    legend: [
      { label: "Lugnt", swatch: { kind: "line", color: "#72F2D0" } },
      { label: "Rullar på", swatch: { kind: "line", color: "#9FD86B" } },
      { label: "Tätare trafik", swatch: { kind: "line", color: "#FFD166" } },
      { label: "Långsamt", swatch: { kind: "line", color: "#FF7A3D" } },
    ],
  },
  {
    id: "disturbances",
    icon: "disturbances",
    title: "Trafikstörningar",
    body: [
      "Här visas pågående trafikstörningar från Trafikverket, till exempel vägarbeten, köer eller andra hinder.",
      "De ingår inte i den historiska olycksrisken, men kan påverka ruttförslagen om du väljer att undvika störningar.",
    ],
    legend: [
      { label: "Vägarbete", swatch: { kind: "triangle", color: "#999999" } },
      { label: "Trafikstörning eller kö", swatch: { kind: "triangle", color: "#999999" } },
    ],
  },
  {
    id: "largeRoads",
    icon: "speed",
    title: "Höga hastigheter",
    body: [
      "Lagret visar skyltade hastigheter 80 km/h och högre som diskreta badges. Linjerna lämnas till rutter, risk och trafikflöde, så du kan läsa hastigheten ovanpå en föreslagen rutt utan att kartan blir rörig.",
      "Det betyder inte att vägen är farlig, bara att körmiljön kan kännas mer intensiv. Lägre hastigheter visas inte i det här lagret.",
    ],
    legend: [],
  },
];

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / 60_000));
}

function liveUpdatedText(latestLastSeen: string | null, now: number): string {
  const minutes = minutesSince(latestLastSeen, now);
  if (minutes === null) return "Uppdaterat nyligen";
  if (minutes < 1) return "Uppdaterat nyss";
  return `Uppdaterat ${minutes} min. sedan`;
}

function activeAvoidCount(avoids: RouteAvoidState): number {
  return Object.values(avoids).filter(Boolean).length;
}

function routeScoreValue(route: RouteLine, option: RouteAvoidOption): number | null {
  const score = route.avoidScores?.[option] ?? null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function routeExtraMinutes(route: RouteLine, baseline: RouteLine): number {
  return Math.max(0, (route.durationSeconds - baseline.durationSeconds) / 60);
}

function isRouteWithinBudget(route: RouteLine, baseline: RouteLine, timeBudget: RouteTimeBudget): boolean {
  return timeBudget === "unlimited" || routeExtraMinutes(route, baseline) <= timeBudget;
}

function selectRouteCandidates(
  candidates: RouteLine[],
  avoids: RouteAvoidState,
  timeBudget: RouteTimeBudget,
): {
  routes: RouteLine[];
  selectedIndex: number;
  active: boolean;
  hasComparableScores: boolean;
  hiddenByBudget: number;
} {
  if (!candidates.length) {
    return {
      routes: [],
      selectedIndex: -1,
      active: false,
      hasComparableScores: false,
      hiddenByBudget: 0,
    };
  }

  const activeOptions = (Object.entries(avoids) as [RouteAvoidOption, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([option]) => option);

  if (!activeOptions.length) {
    return {
      routes: candidates.slice(0, 1),
      selectedIndex: 0,
      active: false,
      hasComparableScores: false,
      hiddenByBudget: 0,
    };
  }

  const baseline = candidates[0];
  if (!baseline) {
    return {
      routes: candidates,
      selectedIndex: 0,
      active: true,
      hasComparableScores: false,
      hiddenByBudget: 0,
    };
  }

  const optionMax = new globalThis.Map<RouteAvoidOption, number>();
  for (const option of activeOptions) {
    const max = Math.max(
      ...candidates.map((route) => routeScoreValue(route, option) ?? 0),
      1,
    );
    optionMax.set(option, max);
  }

  let hasComparableScores = false;
  const scored = candidates.map((route, index) => {
    let avoidCost = 0;
    let available = 0;

    for (const option of activeOptions) {
      const value = routeScoreValue(route, option);
      if (value === null) continue;
      available += 1;
      avoidCost += value / Math.max(1, optionMax.get(option) ?? 1);
    }

    if (available > 0) hasComparableScores = true;
    const averageAvoidCost = available > 0 ? avoidCost / available : Number.POSITIVE_INFINITY;
    const withinBudget = isRouteWithinBudget(route, baseline, timeBudget);
    return {
      index,
      route,
      comparable: available > 0,
      withinBudget,
      score: available > 0 && withinBudget ? averageAvoidCost : Number.POSITIVE_INFINITY,
    };
  });

  const budgeted = scored.filter((item) => item.index === 0 || item.withinBudget);
  const hiddenByBudget = scored.length - budgeted.length;

  if (!hasComparableScores) {
    return {
      routes: budgeted.map((item) => item.route),
      selectedIndex: 0,
      active: true,
      hasComparableScores: false,
      hiddenByBudget,
    };
  }

  budgeted.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aExtra = routeExtraMinutes(a.route, baseline);
    const bExtra = routeExtraMinutes(b.route, baseline);
    if (aExtra !== bExtra) return aExtra - bExtra;
    if (a.route.durationSeconds !== b.route.durationSeconds) {
      return a.route.durationSeconds - b.route.durationSeconds;
    }
    return a.index - b.index;
  });

  const selected = budgeted[0];
  if (!selected || !selected.comparable || !selected.withinBudget) {
    return {
      routes: budgeted.map((item) => item.route),
      selectedIndex: 0,
      active: true,
      hasComparableScores,
      hiddenByBudget,
    };
  }

  const rest = budgeted
    .filter((item) => item.index !== selected.index)
    .map((item) => item.route);
  return {
    routes: [selected.route, ...rest],
    selectedIndex: selected.index,
    active: true,
    hasComparableScores,
    hiddenByBudget,
  };
}

export default function Map() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoBoxOpen, setInfoBoxOpen] = useState(false);
  const [infoBoxCompact, setInfoBoxCompact] = useState(isMobileViewport);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [activeHelpSectionId, setActiveHelpSectionId] = useState<HelpSectionId | null>("risk");
  const [accidentsRiskOn, setAccidentsRiskOn] = useState(false);
  const [adtOn, setAdtOn] = useState(false);
  const [disturbancesOn, setDisturbancesOn] = useState(false);
  const [trafficFlowOn, setTrafficFlowOn] = useState(false);
  const [largeRoadsOn, setLargeRoadsOn] = useState(false);
  const [atUserLocation, setAtUserLocation] = useState(false);
  const [routeStops, setRouteStops] = useState<RouteStop[]>(initialRouteStops);
  const [activeRouteStopId, setActiveRouteStopId] = useState<string | null>(null);
  const [loadingRouteStopId, setLoadingRouteStopId] = useState<string | null>(null);
  const [geocodingStopId, setGeocodingStopId] = useState<string | null>(null);
  const [geocodeResultsByStop, setGeocodeResultsByStop] = useState<Record<string, GeocodeResult[]>>({});
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeCompareLoading, setRouteCompareLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeNoticeText, setRouteNoticeText] = useState<string | null>(null);
  const [routeAvoids, setRouteAvoids] = useState<RouteAvoidState>(initialRouteAvoids);
  const [routeCandidates, setRouteCandidates] = useState<RouteLine[]>([]);
  const [routeLines, setRouteLines] = useState<RouteLine[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const routeStopsRef = useRef<RouteStop[]>(initialRouteStops);
  const routeAvoidsRef = useRef<RouteAvoidState>(initialRouteAvoids);
  const routeDragHandlerRef = useRef<((commit: RouteDragCommit) => void) | null>(null);
  const routeDragPreviewHandlerRef = useRef<((commit: RouteDragCommit) => void) | null>(null);
  const routeDragPreviewLatestRef = useRef<RouteDragCommit | null>(null);
  const routeDragPreviewTimerRef = useRef<number | null>(null);
  const routeDragPreviewAbortRef = useRef<AbortController | null>(null);
  const routeDragPreviewInFlightRef = useRef(false);
  const routeDragPreviewRequestedKeyRef = useRef<string | null>(null);
  const routeLinesRef = useRef<RouteLine[]>([]);
  const selectedRouteIdRef = useRef<string | null>(null);
  const customRouteMarkersRef = useRef<maplibregl.Marker[]>([]);
  const clearRouteStopRef = useRef<(id: string) => void>(() => {});
  const dragRouteStopIdRef = useRef<string | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);
  const routeCompareTimerRef = useRef<number | null>(null);
  const shouldRevealSelectedRouteRef = useRef(false);
  const layerCtrlRef = useRef<{
    risk?: LayerController;
    adt?: LayerController;
    disturbances?: LayerController;
    trafficFlow?: LayerController;
    largeRoads?: LayerController;
  }>({});
  useEffect(() => { routeStopsRef.current = routeStops; }, [routeStops]);
  useEffect(() => { routeAvoidsRef.current = routeAvoids; }, [routeAvoids]);
  useEffect(() => { routeLinesRef.current = routeLines; }, [routeLines]);
  useEffect(() => { selectedRouteIdRef.current = selectedRouteId; }, [selectedRouteId]);

  const selectRouteById = useCallback((routeId: string) => {
    setRouteLines((current) => {
      const selectedRoute = current.find((route) => route.id === routeId);
      if (!selectedRoute) return current;
      const currentAvoids = routeAvoidsRef.current;
      const map = mapRef.current;
      if (map && mapLoadedRef.current) {
        setRouteLayerData(map, current, routeId, currentAvoids);
        focusRoute(map, [selectedRoute, ...current.filter((route) => route.id !== routeId)]);
      }
      setRouteNoticeText(null);
      shouldRevealSelectedRouteRef.current = true;
      setSelectedRouteId(routeId);
      return current;
    });
  }, []);

  const previewRouteById = useCallback((routeId: string | null) => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    setRouteLayerData(map, routeLines, routeId ?? selectedRouteId, routeAvoids);
  }, [routeAvoids, routeLines, selectedRouteId]);

  const refreshEventStats = async () => {
    const res = await fetch("/api/events/stats");
    if (!res.ok) {
      console.warn("failed to fetch event stats", await res.text());
      return;
    }
    setEventStats((await res.json()) as EventStats);
  };

  const refreshLiveCount = async () => {
    const liveEvents = await fetchLiveEvents();
    setLiveCount(liveEvents.length);
  };

  useEffect(() => {
    void refreshEventStats();
    void refreshLiveCount();
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refreshEventStats();
      void refreshLiveCount();
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let stableViewportHeight = window.innerHeight;
    let stableViewportWidth = window.innerWidth;

    const textInputFocused = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        Boolean(el instanceof HTMLElement && el.isContentEditable);
    };

    const updateViewportVars = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const focused = textInputFocused();
        const widthChanged = Math.abs(window.innerWidth - stableViewportWidth) > 24;
        if (!focused || widthChanged) {
          stableViewportHeight = window.innerHeight;
          stableViewportWidth = window.innerWidth;
        }

        root.style.setProperty("--app-visual-height", `${stableViewportHeight}px`);
        root.style.setProperty("--app-visual-top", "0px");
        root.style.setProperty("--app-visual-bottom", "0px");
        mapRef.current?.resize();
      });
    };

    updateViewportVars();
    window.addEventListener("resize", updateViewportVars);
    window.addEventListener("focusin", updateViewportVars);
    window.addEventListener("focusout", updateViewportVars);
    window.visualViewport?.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("scroll", updateViewportVars);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateViewportVars);
      window.removeEventListener("focusin", updateViewportVars);
      window.removeEventListener("focusout", updateViewportVars);
      window.visualViewport?.removeEventListener("resize", updateViewportVars);
      window.visualViewport?.removeEventListener("scroll", updateViewportVars);
      root.style.removeProperty("--app-visual-height");
      root.style.removeProperty("--app-visual-top");
      root.style.removeProperty("--app-visual-bottom");
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "/styles/sakravagar_dark.json",
      center: SWEDEN_CENTER,
      zoom: SWEDEN_ZOOM,
      attributionControl: { compact: false },
    });

    // dragend räcker som "användar-pan"-signal — zoom (knappar/scroll/pinch)
    // ändrar inte centrum så locate-state ska inte växla av av zoom.
    map.on("dragend", () => setAtUserLocation(false));
    map.on("moveend", () => {
      if (!mapLoadedRef.current) return;
      void addEventsLayer(map);
    });

    map.on("load", () => {
      layerCtrlRef.current.largeRoads = addLargeRoadsLayer(map);
      layerCtrlRef.current.adt = addAdtLayer(map);
      layerCtrlRef.current.risk = addRiskLayer(map);
      layerCtrlRef.current.risk.setVisible(accidentsRiskOn);
      layerCtrlRef.current.adt.setVisible(adtOn);
      layerCtrlRef.current.largeRoads.setVisible(largeRoadsOn);
      void addEventsLayer(map)
        .then(() => {
          void refreshLiveCount();
          setEventsLayerVisible(map, accidentsRiskOn);
          layerCtrlRef.current.disturbances = addDisturbancesLayer(map);
          layerCtrlRef.current.disturbances.setVisible(disturbancesOn);
          layerCtrlRef.current.trafficFlow = addTrafficFlowLayer(map);
          layerCtrlRef.current.trafficFlow.setVisible(trafficFlowOn);
          addRouteLayer(
            map,
            selectRouteById,
            (commit) => routeDragHandlerRef.current?.(commit),
            (commit) => routeDragPreviewHandlerRef.current?.(commit),
          );
          return Promise.all([
            refreshDisturbancesLayer(map),
            refreshTrafficFlowLayer(map),
          ]);
        })
        .finally(() => {
          addPopupHandler(map);
          mapLoadedRef.current = true;
        });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    layerCtrlRef.current.risk?.setVisible(accidentsRiskOn);
    const map = mapRef.current;
    if (map && mapLoadedRef.current) setEventsLayerVisible(map, accidentsRiskOn);
  }, [accidentsRiskOn]);

  useEffect(() => {
    layerCtrlRef.current.adt?.setVisible(adtOn);
  }, [adtOn]);

  useEffect(() => {
    layerCtrlRef.current.disturbances?.setVisible(disturbancesOn);
  }, [disturbancesOn]);

  useEffect(() => {
    layerCtrlRef.current.trafficFlow?.setVisible(trafficFlowOn);
  }, [trafficFlowOn]);

  useEffect(() => {
    layerCtrlRef.current.largeRoads?.setVisible(largeRoadsOn);
  }, [largeRoadsOn]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      void addEventsLayer(map);
      void refreshDisturbancesLayer(map);
      void refreshTrafficFlowLayer(map);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!routeNoticeText) return;
    const id = window.setTimeout(() => setRouteNoticeText(null), 5000);
    return () => window.clearTimeout(id);
  }, [routeNoticeText]);

  useEffect(() => {
    if (routeLines.length === 0 || infoBoxCompact) return;
    setInfoBoxCompact(true);
    setInfoBoxOpen(false);
  }, [infoBoxCompact, routeLines.length]);

  useEffect(() => () => {
    if (routeCompareTimerRef.current !== null) {
      window.clearTimeout(routeCompareTimerRef.current);
    }
    if (routeDragPreviewTimerRef.current !== null) {
      window.clearTimeout(routeDragPreviewTimerRef.current);
    }
    routeDragPreviewAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const activeStop = routeStops.find((stop) => stop.id === activeRouteStopId);
    if (!activeStop || activeStop.coordinates || activeStop.source === "gps") {
      setGeocodingStopId(null);
      return;
    }

    const query = activeStop.label.trim();
    if (query.length < 2) {
      setGeocodeResultsByStop((byStop) => ({ ...byStop, [activeStop.id]: [] }));
      setGeocodingStopId(null);
      return;
    }

    const controller = new AbortController();
    setGeocodingStopId(activeStop.id);
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: query,
        limit: "5",
        t: String(Date.now()),
      });
      void fetch(`/api/geocode?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          return res.json() as Promise<{ results: GeocodeResult[] }>;
        })
        .then(({ results }) => {
          if (results.length > 0) {
            setGeocodeResultsByStop((byStop) => ({ ...byStop, [activeStop.id]: results }));
          } else {
            setGeocodeResultsByStop((byStop) => {
              const previous = byStop[activeStop.id] ?? [];
              return previous.length > 0 ? byStop : { ...byStop, [activeStop.id]: [] };
            });
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn("geocode lookup failed", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setGeocodingStopId(null);
        });
    }, 260);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeRouteStopId, routeStops]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setInfoOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();
  const applyRouteSelection = useCallback((
    candidates: RouteLine[],
    avoids: RouteAvoidState,
    timeBudget: RouteTimeBudget,
    opts: { focus?: boolean; showNoBetter?: boolean } = {},
  ) => {
    const selection = selectRouteCandidates(candidates, avoids, timeBudget);
    const selectedRoute = selection.routes[0] ?? null;
    const selectedRouteId = selectedRoute?.id ?? null;
    const orderedRoutes = [...selection.routes].sort((a, b) => {
      if (a.durationSeconds !== b.durationSeconds) return a.durationSeconds - b.durationSeconds;
      if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
      return a.id.localeCompare(b.id);
    });
    shouldRevealSelectedRouteRef.current = Boolean(selectedRouteId && selection.active && isMobileViewport());
    setSelectedRouteId(selectedRouteId);
    setRouteLines(orderedRoutes);
    const shouldShowNoBetter = Boolean(opts.showNoBetter && selection.active && selection.selectedIndex === 0);
    const hiddenByBudgetText = selection.hiddenByBudget > 0 && timeBudget !== "unlimited"
      ? `${selection.hiddenByBudget} alternativ doldes eftersom de tar mer än ${timeBudget} min extra.`
      : null;
    setRouteNoticeText(
      hiddenByBudgetText ??
      (shouldShowNoBetter
        ? selection.routes.length < 2
          ? "Hittade inga alternativa rutter att jämföra."
          : "Tyvärr hittades ingen bättre rutt. Snabbaste rutten är fortfarande bästa matchningen."
        : null),
    );

    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      setRouteLayerData(map, orderedRoutes, selectedRouteId, avoids);
      if (opts.focus) {
        focusRoute(
          map,
          selectedRoute
            ? [selectedRoute, ...orderedRoutes.filter((route) => route.id !== selectedRoute.id)]
            : orderedRoutes,
        );
      }
    }
  }, []);
  const clearRoute = () => {
    if (routeCompareTimerRef.current !== null) {
      window.clearTimeout(routeCompareTimerRef.current);
      routeCompareTimerRef.current = null;
    }
    lastRouteKeyRef.current = null;
    setRouteCandidates([]);
    setRouteLines([]);
    setSelectedRouteId(null);
    setRouteError(null);
    setRouteNoticeText(null);
    setRouteCompareLoading(false);
    const map = mapRef.current;
    if (map && mapLoadedRef.current) setRouteLayerData(map, []);
  };
  const setRouteStopLabel = (id: string, label: string) => {
    clearRoute();
    setRouteStops((stops) =>
      stops
        .filter((stop, index) => stop.id === id || index === 0 || index === stops.length - 1)
        .map((stop) =>
        stop.id === id
          ? { ...stop, label, coordinates: null, source: "manual" }
          : stop,
      ),
    );
  };
  const clearRouteStop = (id: string) => {
    clearRoute();
    setGeocodeResultsByStop((byStop) => ({ ...byStop, [id]: [] }));
    setRouteStops((stops) => {
      const index = stops.findIndex((stop) => stop.id === id);
      if (index > 0 && index < stops.length - 1) {
        return stops.filter((stop) => stop.id !== id);
      }
      return stops
        .filter((stop, stopIndex) => stop.id === id || stopIndex === 0 || stopIndex === stops.length - 1)
        .map((stop) =>
          stop.id === id
            ? { ...stop, label: "", coordinates: null, source: "manual" }
            : stop,
        );
    });
  };
  useEffect(() => {
    clearRouteStopRef.current = clearRouteStop;
  });
  useEffect(() => {
    const map = mapRef.current;
    const customStops = routeStops.filter((stop): stop is ResolvedRouteStop => (
      isCustomRouteStop(stop) && stop.coordinates !== null
    ));

    customRouteMarkersRef.current.forEach((marker) => marker.remove());
    customRouteMarkersRef.current = [];

    if (!map || !mapLoadedRef.current || !customStops.length) return;

    const markers = customStops.map((customStop) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = styles.routeCustomStopMarker ?? "";
      button.setAttribute("aria-label", "Ta bort via-punkt");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearRouteStopRef.current(customStop.id);
      });
      button.addEventListener("mousedown", (event) => event.stopPropagation());
      button.addEventListener("touchstart", (event) => event.stopPropagation());

      return new maplibregl.Marker({ element: button, anchor: "center" })
        .setLngLat(customStop.coordinates)
        .addTo(map);
    });

    customRouteMarkersRef.current = markers;

    return () => {
      customRouteMarkersRef.current.forEach((marker) => marker.remove());
      customRouteMarkersRef.current = [];
    };
  }, [routeStops]);
  const reorderRouteStop = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    clearRoute();
    setRouteStops((stops) => {
      const sourceIndex = stops.findIndex((stop) => stop.id === sourceId);
      const targetIndex = stops.findIndex((stop) => stop.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return stops;
      const next = [...stops];
      const [moved] = next.splice(sourceIndex, 1);
      if (!moved) return stops;
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };
  const selectGeocodeResult = (stopId: string, result: GeocodeResult) => {
    clearRoute();
    setRouteStops((stops) =>
      stops
        .filter((stop, index) => stop.id === stopId || index === 0 || index === stops.length - 1)
        .map((stop) =>
        stop.id === stopId
          ? { ...stop, label: result.shortLabel, coordinates: result.coordinates, source: "manual" }
          : stop,
      ),
    );
    setGeocodeResultsByStop((byStop) => ({ ...byStop, [stopId]: [] }));
  };
  const geocodeRouteStop = useCallback(async (stop: RouteStop): Promise<RouteStop> => {
    if (stop.coordinates) return stop;
    const query = stop.label.trim();
    if (query.length < 2) throw new Error("Fyll i både från och till.");

    const params = new URLSearchParams({ q: query, limit: "1" });
    const res = await fetch(`/api/geocode?${params.toString()}`);
    if (!res.ok) throw new Error("Kunde inte tolka adressen.");

    const { results } = (await res.json()) as { results: GeocodeResult[] };
    const match = results[0];
    if (!match) throw new Error(`Hittade ingen träff för "${query}".`);

    return {
      ...stop,
      label: match.shortLabel,
      coordinates: match.coordinates,
      source: "manual",
    };
  }, []);
  const planRouteForStops = useCallback(async (
    stopsToPlan: RouteStop[],
    opts: {
      auto?: boolean;
      compare?: boolean;
      avoids?: RouteAvoidState;
      timeBudget?: RouteTimeBudget;
      alternatives?: number;
      routeCoordinates?: [number, number][];
    } = {},
  ) => {
    const avoids = opts.avoids ?? routeAvoids;
    const timeBudget = opts.timeBudget ?? (activeAvoidCount(avoids) > 0 ? activeRouteTimeBudget : 0);
    const draftKey = stopsToPlan
      .map((stop) => stop.coordinates?.join(",") ?? stop.label.trim().toLowerCase())
      .join("|");

    if (opts.compare) {
      setRouteCompareLoading(true);
    } else {
      setRouteLoading(true);
    }
    setRouteError(null);
    try {
      const resolvedStops = await Promise.all(stopsToPlan.map(geocodeRouteStop));
      const stopCoordinates = resolvedStops
        .map((stop) => stop.coordinates)
        .filter((coord): coord is [number, number] => coord !== null);
      const routeCoordinates = opts.routeCoordinates
        ? dedupeRouteCoordinates(opts.routeCoordinates)
        : stopCoordinates;
      if (stopCoordinates.length !== resolvedStops.length || routeCoordinates.length < 2) {
        throw new Error("Fyll i både från och till.");
      }

      const resolvedKey = resolvedStops
        .map((stop) => stop.coordinates?.join(",") ?? stop.label.trim().toLowerCase())
        .join("|");
      lastRouteKeyRef.current = resolvedKey;

      setRouteStops((current) => {
        if (current.length !== resolvedStops.length) return current;
        const currentKey = current
          .map((stop) => stop.coordinates?.join(",") ?? stop.label.trim().toLowerCase())
          .join("|");
        if (currentKey !== draftKey) return current;
        return resolvedStops;
      });
      setGeocodeResultsByStop({});

      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: routeCoordinates,
          alternatives: opts.alternatives ?? 3,
          avoid: avoids,
          maxExtraMinutes: timeBudget === "unlimited" ? null : timeBudget,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Kunde inte hitta en rutt.");
      }
      const { routes, provider } = (await res.json()) as {
        routes: RouteLine[];
        provider?: "graphhopper" | "osrm";
      };
      if (!routes.length) throw new Error("Kunde inte hitta en rutt.");

      setRouteCandidates(routes);
      applyRouteSelection(routes, avoids, timeBudget, { focus: !opts.compare });
      if (provider === "osrm" && activeAvoidCount(avoids) > 0) {
        setRouteNoticeText("Lokal routing använder OSRM och kan bara jämföra ett fåtal standardalternativ.");
      }
    } catch (err) {
      console.warn("route planning failed", err);
      lastRouteKeyRef.current = null;
      setRouteCandidates([]);
      setRouteLines([]);
      const map = mapRef.current;
      if (map && mapLoadedRef.current) setRouteLayerData(map, []);
      if (!opts.auto || err instanceof Error) {
        setRouteError(err instanceof Error ? err.message : "Kunde inte hitta en rutt.");
      }
    } finally {
      if (opts.compare) {
        setRouteCompareLoading(false);
      } else {
        setRouteLoading(false);
      }
    }
  }, [applyRouteSelection, geocodeRouteStop, routeAvoids]);
  const cancelRouteDragPreview = useCallback(() => {
    routeDragPreviewLatestRef.current = null;
    if (routeDragPreviewTimerRef.current !== null) {
      window.clearTimeout(routeDragPreviewTimerRef.current);
      routeDragPreviewTimerRef.current = null;
    }
    routeDragPreviewAbortRef.current?.abort();
    routeDragPreviewAbortRef.current = null;
    routeDragPreviewInFlightRef.current = false;
    routeDragPreviewRequestedKeyRef.current = null;
  }, []);

  const selectedRouteCoordinates = useCallback((): [number, number][] => {
    const routes = routeLinesRef.current;
    const selected = routes.find((route) => route.id === selectedRouteIdRef.current) ?? routes[0];
    return selected?.geometry.coordinates.filter((coord): coord is [number, number] => (
      Array.isArray(coord) &&
      coord.length >= 2 &&
      typeof coord[0] === "number" &&
      typeof coord[1] === "number" &&
      Number.isFinite(coord[0]) &&
      Number.isFinite(coord[1])
    )) ?? [];
  }, []);

  const buildRouteDragPlan = useCallback((commit: RouteDragCommit): RouteDragPlan | null => {
    const currentStops = routeStopsRef.current;
    const resolvedStops = currentStops.filter((stop): stop is ResolvedRouteStop => stop.coordinates !== null);
    if (resolvedStops.length !== currentStops.length || resolvedStops.length < 2) return null;

    const routeCoordinates = selectedRouteCoordinates();
    let insertIndex = Math.max(1, resolvedStops.length - 1);
    let previousRouteIndex = 0;

    if (routeCoordinates.length > 0) {
      const indexedStops = resolvedStops.map((stop, index) => ({
        index,
        routeIndex: closestRouteCoordinateIndex(routeCoordinates, stop.coordinates),
      }));
      const firstStop = indexedStops[0];
      const previousStop = indexedStops
        .filter((item) => item.index < resolvedStops.length - 1 && item.routeIndex <= commit.segmentIndex)
        .sort((a, b) => b.routeIndex - a.routeIndex)[0] ?? firstStop;

      if (previousStop) {
        insertIndex = Math.min(resolvedStops.length - 1, previousStop.index + 1);
        previousRouteIndex = previousStop.routeIndex;
      }
    }

    const viaStop: RouteStop = {
      id: `${customRouteStopIdPrefix}${Date.now()}`,
      label: "Via vald väg",
      coordinates: commit.lngLat,
      source: "manual",
    };
    const stops = [
      ...resolvedStops.slice(0, insertIndex),
      viaStop,
      ...resolvedStops.slice(insertIndex),
    ];
    const beforeCoordinates = resolvedStops.slice(0, insertIndex).map((stop) => stop.coordinates);
    const afterCoordinates = resolvedStops.slice(insertIndex).map((stop) => stop.coordinates);
    const fallbackCoordinates = dedupeRouteCoordinates([
      ...beforeCoordinates,
      commit.lngLat,
      ...afterCoordinates,
    ]);

    if (fallbackCoordinates.length > 10) return null;

    const availableAnchorCount = Math.max(0, 10 - fallbackCoordinates.length);
    const anchoredSegment = routeCoordinates.length > 0
      ? commit.anchorCoordinates.filter((coord) => {
        const index = closestRouteCoordinateIndex(routeCoordinates, coord);
        return index >= previousRouteIndex && index <= commit.segmentIndex;
      })
      : commit.anchorCoordinates;
    const anchorCoordinates = anchoredSegment.slice(Math.max(0, anchoredSegment.length - availableAnchorCount));
    const coordinates = dedupeRouteCoordinates([
      ...beforeCoordinates,
      ...anchorCoordinates,
      commit.lngLat,
      ...afterCoordinates,
    ]);

    return { stops, coordinates, fallbackCoordinates };
  }, [selectedRouteCoordinates]);

  const routeDragPreviewRequest = useCallback((commit: RouteDragCommit) => {
    const plan = buildRouteDragPlan(commit);
    if (!plan) return null;
    return {
      coordinates: plan.coordinates,
      fallbackCoordinates: plan.fallbackCoordinates,
      key: plan.coordinates.map((coord) => coord.join(",")).join("|"),
    };
  }, [buildRouteDragPlan]);

  const runRouteDragPreview = useCallback(() => {
    if (routeDragPreviewInFlightRef.current) return;

    const latest = routeDragPreviewLatestRef.current;
    if (!latest) return;
    const request = routeDragPreviewRequest(latest);
    if (!request || request.key === routeDragPreviewRequestedKeyRef.current) return;

    routeDragPreviewInFlightRef.current = true;
    routeDragPreviewRequestedKeyRef.current = request.key;
    const controller = new AbortController();
    routeDragPreviewAbortRef.current = controller;

    const fetchPreview = async (coordinates: [number, number][]): Promise<{ routes: RouteLine[] }> => {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          coordinates,
          alternatives: 0,
          preview: true,
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ routes: RouteLine[] }>;
    };

    void fetchPreview(request.coordinates)
      .catch((err) => {
        if (controller.signal.aborted || request.fallbackCoordinates.length === request.coordinates.length) {
          throw err;
        }
        return fetchPreview(request.fallbackCoordinates);
      })
      .then(({ routes }) => {
        if (controller.signal.aborted || !routes[0]) return;
        const previewRoutes = [routes[0]];
        setSelectedRouteId(previewRoutes[0]?.id ?? null);
        setRouteLines(previewRoutes);
        const map = mapRef.current;
        if (map && mapLoadedRef.current) {
          setRouteLayerData(map, previewRoutes, previewRoutes[0]?.id ?? null, routeAvoidsRef.current);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.warn("route drag preview failed", err);
      })
      .finally(() => {
        if (routeDragPreviewAbortRef.current === controller) {
          routeDragPreviewAbortRef.current = null;
        }
        routeDragPreviewInFlightRef.current = false;

        const next = routeDragPreviewLatestRef.current;
        const nextRequest = next ? routeDragPreviewRequest(next) : null;
        if (nextRequest && nextRequest.key !== routeDragPreviewRequestedKeyRef.current) {
          routeDragPreviewTimerRef.current = window.setTimeout(() => {
            routeDragPreviewTimerRef.current = null;
            runRouteDragPreview();
          }, 60);
        }
      });
  }, [routeDragPreviewRequest]);

  const handlePrimaryRoutePreview = useCallback((commit: RouteDragCommit) => {
    routeDragPreviewLatestRef.current = commit;
    if (routeDragPreviewTimerRef.current !== null || routeDragPreviewInFlightRef.current) return;

    routeDragPreviewTimerRef.current = window.setTimeout(() => {
      routeDragPreviewTimerRef.current = null;
      runRouteDragPreview();
    }, 180);
  }, [runRouteDragPreview]);

  const handlePrimaryRouteDrag = useCallback((commit: RouteDragCommit) => {
    cancelRouteDragPreview();
    const plan = buildRouteDragPlan(commit);
    if (!plan) {
      setRouteNoticeText("Du kan lägga till max 8 egna via-punkter.");
      return;
    }

    lastRouteKeyRef.current = null;
    setRouteStops(plan.stops);
    setRouteError(null);
    setRouteNoticeText("Räknar om rutten...");
    void planRouteForStops(plan.stops, {
      compare: true,
      avoids: routeAvoidsRef.current,
      timeBudget: activeRouteTimeBudget,
      alternatives: 0,
      routeCoordinates: plan.coordinates,
    });
  }, [buildRouteDragPlan, cancelRouteDragPreview, planRouteForStops]);

  useEffect(() => {
    routeDragHandlerRef.current = handlePrimaryRouteDrag;
    routeDragPreviewHandlerRef.current = handlePrimaryRoutePreview;
  }, [handlePrimaryRouteDrag, handlePrimaryRoutePreview]);

  useEffect(() => {
    const readyForRoute = routeStops.length >= 2 && routeStops.every((stop) => stop.coordinates !== null);
    if (!readyForRoute || loadingRouteStopId || geocodingStopId || routeLoading || routeCompareLoading) return;

    const routeKey = routeStops
      .map((stop) => stop.coordinates?.join(",") ?? stop.label.trim().toLowerCase())
      .join("|");
    if (routeKey === lastRouteKeyRef.current) return;

    const id = window.setTimeout(() => {
      void planRouteForStops(routeStops, { auto: true });
    }, 650);
    return () => window.clearTimeout(id);
  }, [geocodingStopId, loadingRouteStopId, planRouteForStops, routeCompareLoading, routeLoading, routeStops]);
  const reverseGeocodeRouteStop = async (id: string, coordinates: [number, number]) => {
    const params = new URLSearchParams({
      lng: String(coordinates[0]),
      lat: String(coordinates[1]),
    });
    try {
      const res = await fetch(`/api/geocode?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const { results } = (await res.json()) as { results: GeocodeResult[] };
      const label = results[0]?.shortLabel ?? "Din position";
      setRouteStops((stops) =>
        stops
          .filter((stop, index) => stop.id === id || index === 0 || index === stops.length - 1)
          .map((stop) =>
            stop.id === id
              ? { ...stop, label, coordinates, source: "gps" }
              : stop,
          ),
      );
      setRouteError(null);
    } catch (err) {
      console.warn("route reverse geocoding failed", err);
      setRouteStops((stops) =>
        stops
          .filter((stop, index) => stop.id === id || index === 0 || index === stops.length - 1)
          .map((stop) =>
            stop.id === id
              ? { ...stop, label: "Din position", coordinates, source: "gps" }
              : stop,
          ),
      );
      setRouteError("Hittade din plats, men kunde inte slå upp adressen.");
    } finally {
      setLoadingRouteStopId(null);
    }
  };
  const handleUsePositionForRouteStop = (id: string) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setRouteError("Din webbläsare stödjer inte platsdelning.");
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      window.alert("Platsfunktionen kräver HTTPS. Den fungerar på live-sajten, men inte via lokal http-IP.");
      return;
    }
    setRouteError(null);
    setRouteNoticeText(null);
    setGeocodeResultsByStop((byStop) => ({ ...byStop, [id]: [] }));
    setActiveRouteStopId(id);
    setLoadingRouteStopId(id);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearRoute();
        const coordinates: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setRouteStops((stops) =>
          stops
            .filter((stop, index) => stop.id === id || index === 0 || index === stops.length - 1)
            .map((stop) =>
              stop.id === id
                ? { ...stop, label: "Din position", coordinates, source: "gps" }
                : stop,
            ),
        );
        void reverseGeocodeRouteStop(id, coordinates);
      },
      (err) => {
        console.warn("route geolocation failed", err);
        setRouteError(routeGeolocationErrorMessage(err));
        setLoadingRouteStopId(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
    );
  };
  const handleToggleRouteAvoid = (option: RouteAvoidOption) => {
    setRouteAvoids((current) => {
      const next = { ...current, [option]: !current[option] };
      setRouteNoticeText(null);
      if (routeCompareTimerRef.current !== null) {
        window.clearTimeout(routeCompareTimerRef.current);
      }

      if (routeCandidates.length > 0 && activeAvoidCount(next) > 0) {
        setRouteCompareLoading(true);
        routeCompareTimerRef.current = window.setTimeout(() => {
          routeCompareTimerRef.current = null;
          void planRouteForStops(routeStops, {
            compare: true,
            avoids: next,
            timeBudget: activeRouteTimeBudget,
            alternatives: routeStops.some(isCustomRouteStop) ? 0 : undefined,
          });
        }, 520);
      } else {
        setRouteCompareLoading(false);
        const baselineOnly = routeCandidates[0] ? [routeCandidates[0]] : routeCandidates;
        setRouteCandidates(baselineOnly);
        applyRouteSelection(baselineOnly, next, 0);
      }

      return next;
    });
  };
  const handleAccidentsRiskToggle = () => setAccidentsRiskOn((on) => !on);
  const handleFocusLiveEvents = () => {
    const map = mapRef.current;
    if (!map) return;
    setAtUserLocation(false);
    void focusLiveEvents(map).then(({ liveCount }) => setLiveCount(liveCount));
  };

  const handleLocate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (typeof window !== "undefined" && !window.isSecureContext) {
      window.alert("Platsfunktionen kräver HTTPS. Den fungerar på live-sajten, men inte via lokal http-IP.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 });
        setAtUserLocation(true);
      },
      (err) => {
        // Geolocation kräver explicit tillåtelse från användaren — om hen
        // nekar eller browsern saknar permission API får vi ingen fix.
        console.warn("geolocation failed", err);
      },
    );
  };

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      <div
        className={`${styles.routeLoadingOverlay} ${
          routeLoading || routeCompareLoading ? styles.routeLoadingOverlayActive : ""
        }`}
        aria-hidden="true"
      />
      {infoOpen && (
        <button
          type="button"
          className={styles.infoModalBackdrop}
          onClick={() => setInfoOpen(false)}
          aria-label="Stäng information"
        />
      )}
      <div className={styles.controls}>
        <InfoBox
          open={infoBoxOpen}
          compact={infoBoxCompact}
          onToggle={() => setInfoBoxOpen((v) => !v)}
          updatedText={liveUpdatedText(eventStats?.latestLastSeen ?? null, now)}
        />
        <div
          className={styles.routeControls}
        >
          <RoutePlannerBox
            stops={routeStops}
            activeStopId={activeRouteStopId}
            loadingStopId={loadingRouteStopId}
            geocodingStopId={geocodingStopId}
            geocodeResultsByStop={geocodeResultsByStop}
            routeError={routeError}
            routeNoticeText={routeNoticeText}
            routeAvoids={routeAvoids}
            routeWorking={routeLoading || routeCompareLoading}
            onFocusStop={setActiveRouteStopId}
            onDeactivate={() => setActiveRouteStopId(null)}
            onChangeStop={setRouteStopLabel}
            onClearStop={clearRouteStop}
            onSelectGeocode={selectGeocodeResult}
            onUsePosition={handleUsePositionForRouteStop}
            onToggleAvoid={handleToggleRouteAvoid}
            onDragStartStop={(id) => { dragRouteStopIdRef.current = id; }}
            onDropStop={(id) => {
              const sourceId = dragRouteStopIdRef.current;
              dragRouteStopIdRef.current = null;
              if (sourceId) reorderRouteStop(sourceId, id);
            }}
          />
        </div>
      </div>
      <RouteAlternativesTray
        routes={routeLines}
        baselineRoute={routeCandidates[0] ?? null}
        routeAvoids={routeAvoids}
        selectedRouteId={selectedRouteId}
        isCustomRoute={routeStops.some(isCustomRouteStop)}
        revealSelectedRouteRef={shouldRevealSelectedRouteRef}
        onSelectRoute={selectRouteById}
        onPreviewRoute={previewRouteById}
      />
      <HelpPanel
        open={infoOpen}
        activeSectionId={activeHelpSectionId}
        onSectionChange={setActiveHelpSectionId}
        onClose={() => setInfoOpen(false)}
        updatedText={liveUpdatedText(eventStats?.latestLastSeen ?? null, now)}
        periodDays={eventStats?.periodDays ?? null}
      />
      <div
        className={`${styles.rightControls} ${infoOpen ? styles.rightControlsHelpOpen : ""}`}
      >
        <button
          type="button"
          className={`${styles.iconBtn} ${atUserLocation ? styles.iconBtnActive : ""}`}
          onClick={handleLocate}
          aria-label="Visa min position"
          aria-pressed={atUserLocation}
          data-tooltip="Visa min position"
        >
          <LocationIcon />
        </button>
        <div className={styles.zoomGroup}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.zoomPlus}`}
            onClick={handleZoomIn}
            aria-label="Zooma in"
            data-tooltip="Zooma in"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.zoomMinus}`}
            onClick={handleZoomOut}
            aria-label="Zooma ut"
            data-tooltip="Zooma ut"
          >
            <MinusIcon />
          </button>
        </div>
      </div>
      <div
        className={`${styles.layerControls} ${infoOpen ? styles.layerControlsHelpOpen : ""} ${
          layerMenuOpen ? styles.layerControlsMenuOpen : ""
        }`}
      >
        <LayerIconButton
          label={layerMenuOpen ? "Stäng kartlager" : "Kartlager"}
          icon={layerMenuOpen ? "close" : "layers"}
          on={layerMenuOpen}
          onToggle={() => setLayerMenuOpen((v) => !v)}
          className={styles.layerMenuToggleItem}
        />
        <LayerIconButton
          label={infoOpen ? "Stäng hjälp" : "Hjälp"}
          icon={infoOpen ? "close" : "help"}
          on={infoOpen}
          onToggle={() => {
            setLayerMenuOpen(false);
            setInfoOpen((v) => !v);
          }}
          className={styles.layerHelpItem}
        />
        <div className={styles.layerMenuItems}>
          <LayerIconButton
            label="Olyckor och risk"
            icon="accidents"
            on={accidentsRiskOn}
            onToggle={handleAccidentsRiskToggle}
            badgeCount={liveCount}
            onBadgeClick={handleFocusLiveEvents}
          />
          <LayerIconButton
            label="Trafikflöde"
            icon="flow"
            on={adtOn}
            onToggle={() => setAdtOn((v) => !v)}
          />
          <LayerIconButton
            label="Liveflöde (storstad)"
            icon="live"
            on={trafficFlowOn}
            onToggle={() => setTrafficFlowOn((v) => !v)}
          />
          <LayerIconButton
            label="Trafikstörningar"
            icon="disturbances"
            on={disturbancesOn}
            onToggle={() => setDisturbancesOn((v) => !v)}
          />
          <LayerIconButton
            label="Höga hastigheter"
            icon="speed"
            on={largeRoadsOn}
            onToggle={() => setLargeRoadsOn((v) => !v)}
          />
        </div>
      </div>
    </>
  );
}

function routeExposureValue(route: RouteLine, option: RouteAvoidOption): number | null {
  if (option === "highSpeed") return route.exposure?.highSpeedMeters ?? null;
  if (option === "bridges") return route.exposure?.bridgeMeters ?? null;
  if (option === "tunnels") return route.exposure?.tunnelMeters ?? null;
  return route.exposure?.[option] ?? null;
}

function routeCappedExposureValue(route: RouteLine, option: RouteAvoidOption): number | null {
  const value = routeExposureValue(route, option);
  if (value === null) return null;
  if (option === "highSpeed" || option === "bridges" || option === "tunnels") {
    return Math.min(Math.max(0, value), route.distanceMeters);
  }
  return Math.max(0, value);
}

type RouteAlternativeMetricRow = {
  kind: RouteAvoidOption;
  label: string;
  value: string;
  tone?: "positive" | "muted";
};

type RouteAlternativeCopy = {
  title: string;
  rows: RouteAlternativeMetricRow[];
};

function activeAvoidOptionsForUi(avoids: RouteAvoidState): RouteAvoidOption[] {
  return (Object.keys(routeAvoidLabels) as RouteAvoidOption[]).filter((option) => avoids[option]);
}

function formatRouteExposureDistance(meters: number): string {
  if (meters < 10) return `${Math.max(1, Math.round(meters))} m`;
  return formatRouteDistance(meters);
}

function routeAccidentRiskValue(route: RouteLine, baseline: RouteLine): RouteAlternativeMetricRow {
  const baseRow = { kind: "accidentHistory" as const, label: routeMetricLabels.accidentHistory };
  const eventCount = route.exposure?.accidentHistoryEvents;
  if (eventCount !== null && eventCount !== undefined && eventCount <= 2) {
    return { ...baseRow, value: "Data ofullständig", tone: "muted" };
  }

  const current = routeScoreValue(route, "accidentHistory");
  if (current === null) {
    return { ...baseRow, value: "Saknas", tone: "muted" };
  }
  if (current <= 0) {
    return { ...baseRow, value: "Inga i data", tone: "muted" };
  }

  const base = routeScoreValue(baseline, "accidentHistory");
  if (base === null || base <= 0) {
    return { ...baseRow, value: "Medel" };
  }

  const ratio = current / base;
  if (ratio <= 0.25) return { ...baseRow, value: "Väldigt låg" };
  if (ratio <= 0.6) return { ...baseRow, value: "Låg" };
  return { ...baseRow, value: "Medel" };
}

function routeAlternativeMetricRow(
  route: RouteLine,
  baseline: RouteLine,
  option: RouteAvoidOption,
): RouteAlternativeMetricRow {
  if (option === "accidentHistory") return routeAccidentRiskValue(route, baseline);

  const current = routeCappedExposureValue(route, option);
  const baseRow = { kind: option, label: routeMetricLabels[option] };
  if (current === null) return { ...baseRow, value: "Saknas", tone: "muted" };
  if (current <= 0) return { ...baseRow, value: "Undviker", tone: "positive" };

  if (option === "disturbances") {
    return { ...baseRow, value: `${Math.round(current)} st` };
  }

  return { ...baseRow, value: formatRouteExposureDistance(current) };
}

function routeAlternativeRows(
  route: RouteLine,
  baseline: RouteLine,
  avoids: RouteAvoidState,
): RouteAlternativeMetricRow[] {
  return activeAvoidOptionsForUi(avoids).map((option) => routeAlternativeMetricRow(route, baseline, option));
}

function routeAvoidedMetricCount(route: RouteLine, baseline: RouteLine, avoids: RouteAvoidState): number {
  return routeAlternativeRows(route, baseline, avoids).filter((row) => row.tone === "positive").length;
}

function routeIsBestForOption(route: RouteLine, routes: RouteLine[], option: RouteAvoidOption): boolean {
  const current = option === "accidentHistory"
    ? routeScoreValue(route, option)
    : routeCappedExposureValue(route, option);
  if (current === null) return false;

  const values = routes
    .map((candidate) => (
      option === "accidentHistory"
        ? routeScoreValue(candidate, option)
        : routeCappedExposureValue(candidate, option)
    ))
    .filter((value): value is number => value !== null);
  if (!values.length) return false;
  return current <= Math.min(...values) + 0.001;
}

function routeImprovesOption(route: RouteLine, baseline: RouteLine, option: RouteAvoidOption): boolean {
  const current = option === "accidentHistory"
    ? routeScoreValue(route, option)
    : routeCappedExposureValue(route, option);
  const base = option === "accidentHistory"
    ? routeScoreValue(baseline, option)
    : routeCappedExposureValue(baseline, option);
  if (current === null || base === null) return false;
  if (option === "disturbances") return current < base;
  if (option === "accidentHistory") return base - current > 0.05;
  return base - current > 25;
}

function routeIsFastest(route: RouteLine, baseline: RouteLine): boolean {
  return route.id === baseline.id || route.source === "fastest" || route.durationSeconds <= baseline.durationSeconds + 30;
}

function routeAlternativeTitle(
  route: RouteLine,
  index: number,
  baseline: RouteLine,
  avoids: RouteAvoidState,
  routes: RouteLine[],
  isCustomRoute: boolean,
): string {
  if (isCustomRoute) return "Egen väg";

  const activeOptions = activeAvoidOptionsForUi(avoids);
  if (!activeOptions.length || routeIsFastest(route, baseline)) return "Snabbaste";

  const shortestDistance = Math.min(...routes.map((candidate) => candidate.distanceMeters));
  if (route.distanceMeters <= shortestDistance + 50) return "Kortast";

  const avoidedCount = routeAvoidedMetricCount(route, baseline, avoids);
  if (activeOptions.length > 1 && avoidedCount >= Math.max(2, activeOptions.length - 1)) {
    return "Mest lugn";
  }

  if (avoids.highSpeed && routeIsBestForOption(route, routes, "highSpeed") && routeImprovesOption(route, baseline, "highSpeed")) {
    return "Lägre hastigheter";
  }

  if (avoids.disturbances && routeIsBestForOption(route, routes, "disturbances") && routeImprovesOption(route, baseline, "disturbances")) {
    return "Färre störningar";
  }

  if (avoids.bridges && routeIsBestForOption(route, routes, "bridges") && routeImprovesOption(route, baseline, "bridges")) {
    return routeCappedExposureValue(route, "bridges") === 0 ? "Utan broar" : "Färre broar";
  }

  if (avoids.tunnels && routeIsBestForOption(route, routes, "tunnels") && routeImprovesOption(route, baseline, "tunnels")) {
    return routeCappedExposureValue(route, "tunnels") === 0 ? "Utan tunnlar" : "Färre tunnlar";
  }

  if (avoids.accidentHistory && routeIsBestForOption(route, routes, "accidentHistory") && routeImprovesOption(route, baseline, "accidentHistory")) {
    return "Lägre olycksrisk";
  }

  if (routeExtraMinutes(route, baseline) <= 10 && activeOptions.length > 1) return "Balanserad";
  return index === 1 ? "Alternativ rutt" : "Mindre intensiv";
}

function routeAlternativeCopy(
  route: RouteLine,
  index: number,
  baseline: RouteLine | null,
  avoids: RouteAvoidState,
  routes: RouteLine[],
  isCustomRoute: boolean,
): RouteAlternativeCopy {
  const fallbackBaseline = baseline ?? route;
  return {
    title: routeAlternativeTitle(route, index, fallbackBaseline, avoids, routes, isCustomRoute),
    rows: routeAlternativeRows(route, fallbackBaseline, avoids),
  };
}

function RoutePlannerBox({
  stops,
  activeStopId,
  loadingStopId,
  geocodingStopId,
  geocodeResultsByStop,
  routeError,
  routeNoticeText,
  routeAvoids,
  routeWorking,
  onFocusStop,
  onDeactivate,
  onChangeStop,
  onClearStop,
  onSelectGeocode,
  onUsePosition,
  onToggleAvoid,
  onDragStartStop,
  onDropStop,
}: {
  stops: RouteStop[];
  activeStopId: string | null;
  loadingStopId: string | null;
  geocodingStopId: string | null;
  geocodeResultsByStop: Record<string, GeocodeResult[]>;
  routeError: string | null;
  routeNoticeText: string | null;
  routeAvoids: RouteAvoidState;
  routeWorking: boolean;
  onFocusStop: (id: string) => void;
  onDeactivate: () => void;
  onChangeStop: (id: string, label: string) => void;
  onClearStop: (id: string) => void;
  onSelectGeocode: (id: string, result: GeocodeResult) => void;
  onUsePosition: (id: string) => void;
  onToggleAvoid: (option: RouteAvoidOption) => void;
  onDragStartStop: (id: string) => void;
  onDropStop: (id: string) => void;
}) {
  const visibleStops = stops;
  const activeStop = visibleStops.find((stop) => stop.id === activeStopId) ?? null;
  const showPillSpinner = routeWorking && activeAvoidCount(routeAvoids) > 0;
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState<number | null>(null);

  const activeStopLoading = activeStop
    ? loadingStopId === activeStop.id || geocodingStopId === activeStop.id
    : false;
  const activeSuggestions = activeStop ? geocodeResultsByStop[activeStop.id] ?? [] : [];
  const activeShowsPositionSuggestion = Boolean(
    activeStop && activeStop.id === stops[0]?.id && !activeStop.label,
  );
  const activeSuggestionCount = activeSuggestions.length + (activeShowsPositionSuggestion ? 1 : 0);

  useEffect(() => {
    setActiveSuggestionIndex(null);
  }, [activeStopId, activeStop?.label, activeSuggestionCount]);

  const selectSuggestionByIndex = (
    stopId: string,
    suggestions: GeocodeResult[],
    showPositionSuggestion: boolean,
    index: number,
  ) => {
    if (showPositionSuggestion && index === 0) {
      onUsePosition(stopId);
      return;
    }

    const resultIndex = showPositionSuggestion ? index - 1 : index;
    const result = suggestions[resultIndex];
    if (result) onSelectGeocode(stopId, result);
  };

  const handleSuggestionKeyDown = (
    e: ReactKeyboardEvent<HTMLInputElement>,
    stopId: string,
    suggestions: GeocodeResult[],
    showPositionSuggestion: boolean,
  ) => {
    const count = suggestions.length + (showPositionSuggestion ? 1 : 0);
    if (count === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIndex((current) => {
        if (current === null) return e.key === "ArrowDown" ? 0 : count - 1;
        return e.key === "ArrowDown"
          ? (current + 1) % count
          : (current - 1 + count) % count;
      });
      return;
    }

    if (e.key === "Enter" && activeSuggestionIndex !== null) {
      e.preventDefault();
      selectSuggestionByIndex(stopId, suggestions, showPositionSuggestion, activeSuggestionIndex);
    }
  };

  return (
    <div
      className={styles.routeBox}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        onDeactivate();
      }}
    >
      <div className={styles.routePanel}>
        <div className={styles.routeStops}>
          {visibleStops.map((stop, index) => {
            const isFirst = index === 0;
            const isLast = index === visibleStops.length - 1;
            const isCustomStop = isCustomRouteStop(stop);
            const loading = loadingStopId === stop.id || geocodingStopId === stop.id;
            const placeholder = isFirst ? "Välj startpunkt..." : isLast ? "Välj destination..." : "Via punkt";
            const suggestions = activeStopId === stop.id ? geocodeResultsByStop[stop.id] ?? [] : [];
            const showPositionSuggestion =
              isFirst && activeStop?.id === stop.id && !stop.label;
            const suggestionListId = `route-${stop.id}-suggestions`;
            return (
              <div
                key={stop.id}
                className={styles.routeStopGroup}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDropStop(stop.id)}
              >
                <div
                  className={`${styles.routeInputRow} ${
                    isFirst ? styles.routeInputRowFirst : ""
                  } ${isLast ? styles.routeInputRowLast : ""}`}
                >
                  {loading ? (
                    <span className={styles.routeSpinner} aria-hidden="true" />
                  ) : (
                    <span
                      className={`${styles.routeIcon} ${
                        isFirst ? styles.routePositionInputIcon : styles.routeDestinationInputIcon
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  <input
                    className={styles.routeInput}
                    value={stop.label}
                    onFocus={() => {
                      if (!isCustomStop) onFocusStop(stop.id);
                    }}
                    onChange={(e) => {
                      if (!isCustomStop) onChangeStop(stop.id, e.target.value);
                    }}
                    onKeyDown={(e) =>
                      !isCustomStop && handleSuggestionKeyDown(e, stop.id, suggestions, showPositionSuggestion)
                    }
                    placeholder={placeholder}
                    aria-label={isCustomStop ? "Via vald väg" : placeholder}
                    readOnly={isCustomStop}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls={
                      suggestions.length > 0 || showPositionSuggestion ? suggestionListId : undefined
                    }
                    aria-expanded={suggestions.length > 0 || showPositionSuggestion}
                    aria-activedescendant={
                      activeStopId === stop.id && activeSuggestionIndex !== null
                        ? `route-${stop.id}-suggestion-${activeSuggestionIndex}`
                        : undefined
                    }
                  />
                  {stop.label && (
                    <button
                      type="button"
                      className={styles.routeClearBtn}
                      onClick={() => onClearStop(stop.id)}
                      aria-label={isCustomStop ? "Ta bort via-punkt" : `Rensa ${placeholder.toLowerCase()}`}
                    >
                      <span className={`${styles.routeIcon} ${styles.routeCloseIcon}`} aria-hidden="true" />
                    </button>
                  )}
                  {!isCustomStop && (
                    <button
                      type="button"
                      className={styles.routeDragBtn}
                      draggable
                      onDragStart={() => onDragStartStop(stop.id)}
                      onDragEnd={() => onDragStartStop("")}
                      aria-label={`Flytta ${placeholder.toLowerCase()}`}
                    >
                      <span className={`${styles.routeIcon} ${styles.routeDragIcon}`} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {showPositionSuggestion && (
                  <button
                    id={`route-${stop.id}-suggestion-0`}
                    type="button"
                    className={`${styles.routePositionSuggestion} ${
                      activeSuggestionIndex === 0 ? styles.routeSuggestionActive : ""
                    }`}
                    disabled={activeStopLoading}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveSuggestionIndex(0)}
                    onFocus={() => setActiveSuggestionIndex(0)}
                    onClick={() => onUsePosition(stop.id)}
                  >
                    <LocationIcon className={styles.routePositionIcon} />
                    <span>
                      {activeStopLoading ? "Hämtar plats..." : "Din plats"}
                    </span>
                  </button>
                )}
                {suggestions.length > 0 && (
                  <div id={suggestionListId} className={styles.routeSuggestions}>
                    {suggestions.map((result, suggestionIndex) => {
                      const optionIndex = showPositionSuggestion ? suggestionIndex + 1 : suggestionIndex;
                      return (
                      <button
                        key={result.id}
                        id={`route-${stop.id}-suggestion-${optionIndex}`}
                        type="button"
                        className={`${styles.routeSuggestion} ${
                          activeSuggestionIndex === optionIndex ? styles.routeSuggestionActive : ""
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveSuggestionIndex(optionIndex)}
                        onFocus={() => setActiveSuggestionIndex(optionIndex)}
                        onClick={() => onSelectGeocode(stop.id, result)}
                      >
                        {result.shortLabel}
                      </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        <div className={styles.routeAvoidSection}>
          <div className={styles.routeAvoidHeading}>Undvik om möjligt</div>
          <div className={styles.routeAvoidList}>
            {(Object.keys(routeAvoidLabels) as RouteAvoidOption[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.routeAvoidPill} ${routeAvoids[option] ? styles.routeAvoidPillOn : ""}`}
                onClick={() => onToggleAvoid(option)}
                aria-pressed={routeAvoids[option]}
                aria-describedby={`route-avoid-tooltip-${option}`}
              >
                <span className={styles.routeAvoidCheckbox} aria-hidden="true" />
                <span>{routeAvoidLabels[option]}</span>
                {showPillSpinner && routeAvoids[option] && (
                  <span className={styles.routeAvoidPillSpinner} aria-hidden="true" />
                )}
                <span
                  id={`route-avoid-tooltip-${option}`}
                  className={styles.routeAvoidTooltip}
                  role="tooltip"
                >
                  {routeAvoidTooltips[option]}
                </span>
              </button>
            ))}
          </div>
        </div>
        {routeError && (
          <div className={styles.routeStatus} aria-live="polite">
            {routeError}
          </div>
        )}
        {routeNoticeText && (
          <div className={styles.routeNotice} aria-live="polite">
            <WarningIcon className={styles.routeNoticeIcon} />
            <span>{routeNoticeText}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteAlternativesTray({
  routes,
  baselineRoute,
  routeAvoids,
  selectedRouteId,
  isCustomRoute,
  revealSelectedRouteRef,
  onSelectRoute,
  onPreviewRoute,
}: {
  routes: RouteLine[];
  baselineRoute: RouteLine | null;
  routeAvoids: RouteAvoidState;
  selectedRouteId: string | null;
  isCustomRoute: boolean;
  revealSelectedRouteRef: React.MutableRefObject<boolean>;
  onSelectRoute: (routeId: string) => void;
  onPreviewRoute: (routeId: string | null) => void;
}) {
  const routeAlternativesRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    scrollLeft: number;
    captured: boolean;
  } | null>(null);
  const wasDraggingRef = useRef(false);

  useLayoutEffect(() => {
    if (!selectedRouteId || !revealSelectedRouteRef.current) return;
    revealSelectedRouteRef.current = false;

    const selected = routeAlternativesRef.current?.querySelector<HTMLElement>(
      `[data-route-id="${CSS.escape(selectedRouteId)}"]`,
    );
    selected?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [routes, selectedRouteId, revealSelectedRouteRef]);

  useLayoutEffect(() => {
    const element = routeAlternativesRef.current;
    if (!element) return;

    const update = () => {
      document.documentElement.style.setProperty("--route-results-height", `${element.offsetHeight}px`);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--route-results-height");
    };
  }, [routes]);

  if (routes.length === 0) return null;

  return (
    <div
      ref={routeAlternativesRef}
      className={styles.routeAlternatives}
      aria-live="polite"
      onWheel={(e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        e.currentTarget.scrollLeft += delta;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          scrollLeft: e.currentTarget.scrollLeft,
          captured: false,
        };
        wasDraggingRef.current = false;
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag) return;
        const deltaX = e.clientX - drag.startX;
        if (Math.abs(deltaX) > 8) {
          wasDraggingRef.current = true;
          if (!drag.captured) {
            e.currentTarget.setPointerCapture(drag.pointerId);
            drag.captured = true;
          }
        }
        e.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.captured && e.currentTarget.hasPointerCapture(drag.pointerId)) {
          e.currentTarget.releasePointerCapture(drag.pointerId);
        }
      }}
      onPointerCancel={(e) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.captured && e.currentTarget.hasPointerCapture(drag.pointerId)) {
          e.currentTarget.releasePointerCapture(drag.pointerId);
        }
      }}
    >
      {routes.map((route, index) => {
        const copy = routeAlternativeCopy(route, index, baselineRoute, routeAvoids, routes, isCustomRoute);
        const selected = route.id === selectedRouteId;
        return (
          <button
            key={route.id}
            type="button"
            data-route-id={route.id}
            className={`${styles.routeAlternativeCard} ${selected ? styles.routeAlternativeCardSelected : ""}`}
            style={{ animationDelay: `${index * 70}ms` }}
            onClick={(e) => {
              if (wasDraggingRef.current) {
                e.preventDefault();
                wasDraggingRef.current = false;
                return;
              }
              onSelectRoute(route.id);
            }}
            onMouseEnter={() => onPreviewRoute(route.id)}
            onMouseLeave={() => onPreviewRoute(null)}
            onFocus={() => onPreviewRoute(route.id)}
            onBlur={() => onPreviewRoute(null)}
            aria-pressed={selected}
          >
            <span className={styles.routeAlternativeTop}>
              <span className={styles.routeAlternativeTitle}>{copy.title}</span>
              <span className={styles.routeAlternativeDistance}>
                {formatRouteDistance(route.distanceMeters)}
              </span>
            </span>
            <span className={styles.routeAlternativeTime}>
              {formatRouteDuration(route.durationSeconds)}
            </span>
            {copy.rows.length > 0 && (
              <span className={styles.routeAlternativeMetrics}>
                {copy.rows.map((row) => (
                  <span className={styles.routeAlternativeMetricRow} key={row.label}>
                    <span className={styles.routeAlternativeMetricLabelGroup}>
                      <span
                        className={`${styles.routeAlternativeMetricIcon} ${
                          styles[`routeAlternativeMetricIcon_${row.kind}`]
                        } ${row.tone === "muted" ? styles.routeAlternativeMetricIconMuted : ""}`}
                        aria-hidden="true"
                      />
                      <span className={styles.routeAlternativeMetricLabel}>{row.label}</span>
                    </span>
                    <span
                      className={`${styles.routeAlternativeMetricValue} ${
                        row.tone === "positive" ? styles.routeAlternativeMetricValuePositive : ""
                      } ${row.tone === "muted" ? styles.routeAlternativeMetricValueMuted : ""
                      }`}
                    >
                      {row.value}
                    </span>
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function formatRouteDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace(".", ",")} km`;
}

function formatRouteDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

type LayerIconName = "layers" | "help" | "close" | "accidents" | "flow" | "live" | "disturbances" | "speed";

function LayerIconButton({
  label,
  icon,
  on,
  onToggle,
  badgeCount,
  onBadgeClick,
  className,
}: {
  label: string;
  icon: LayerIconName;
  on: boolean;
  onToggle: () => void;
  badgeCount?: number;
  onBadgeClick?: () => void;
  className?: string;
}) {
  const showBadge = on && typeof badgeCount === "number" && badgeCount > 0;
  const tooltipLabel = label.startsWith("Stäng") ? label : `Visa ${label.toLowerCase()}`;
  return (
    <span className={`${styles.layerIconItem} ${className ?? ""}`}>
      <button
        type="button"
        className={`${styles.layerIconBtn} ${on ? styles.layerIconBtnOn : ""}`}
        onClick={onToggle}
        aria-label={label}
        aria-pressed={on}
        data-label={tooltipLabel}
      >
        <span
          className={`${styles.layerIconGlyph} ${styles[`layerIconGlyph_${icon}`]}`}
          aria-hidden="true"
        />
      </button>
      {showBadge && (
        <button
          type="button"
          className={styles.layerIconBadge}
          onClick={(e) => {
            e.stopPropagation();
            onBadgeClick?.();
          }}
          aria-label="Visa pågående olyckor"
        >
          {Math.min(badgeCount, 99)}
        </button>
      )}
    </span>
  );
}

function HelpPanel({
  open,
  activeSectionId,
  onSectionChange,
  onClose,
  updatedText,
  periodDays,
}: {
  open: boolean;
  activeSectionId: HelpSectionId | null;
  onSectionChange: (id: HelpSectionId | null) => void;
  onClose: () => void;
  updatedText: string;
  periodDays: number | null;
}) {
  const collectionText = periodDays
    ? `Historiska olyckor visas från de senaste ${periodDays.toLocaleString("sv-SE")} dagarna som finns i vår insamling.`
    : "Historiska olyckor visas från den datainsamling som finns tillgänglig just nu.";
  const dataUpdatedText = `Data ${updatedText.charAt(0).toLocaleLowerCase("sv-SE")}${updatedText.slice(1)}`;

  return (
    <aside
      className={`${styles.helpPanel} ${open ? styles.helpPanelOpen : ""}`}
      aria-hidden={!open}
      aria-label="Data och kartlager"
      inert={!open}
    >
      <button
        type="button"
        className={styles.helpPanelClose}
        onClick={onClose}
        aria-label="Stäng hjälp"
      >
        <span className={styles.helpPanelCloseIcon} aria-hidden="true" />
      </button>
      <div className={styles.helpPanelScroll}>
        <div className={styles.helpPanelHeader}>
          <p className={styles.helpPanelEyebrow}>Data och kartlager</p>
          <h2 className={styles.helpPanelTitle}>Få hjälp att förstå hur vi räknar ut och prioriterar våra ruttförslag.</h2>
        </div>
        <div className={styles.helpAccordion}>
          {helpSections.map((section) => {
            const expanded = activeSectionId === section.id;
            const panelId = `help-section-${section.id}`;
            return (
              <section className={styles.helpAccordionSection} key={section.id}>
                <button
                  type="button"
                  className={styles.helpAccordionButton}
                  onClick={() => onSectionChange(expanded ? null : section.id)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                >
                  <span
                    className={`${styles.layerIconGlyph} ${styles.helpSectionIcon} ${styles[`layerIconGlyph_${section.icon}`]}`}
                    aria-hidden="true"
                  />
                  <span className={styles.helpAccordionTitle}>{section.title}</span>
                  <span
                    className={`${styles.helpAccordionIcon} ${
                      expanded ? styles.helpAccordionIconMinus : styles.helpAccordionIconPlus
                    }`}
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={panelId}
                  className={`${styles.helpAccordionExpander} ${expanded ? styles.helpAccordionExpanderOpen : ""}`}
                >
                  <div className={styles.helpAccordionInner}>
                    {section.body.map((paragraph) => (
                      <p className={styles.helpParagraph} key={paragraph}>{paragraph}</p>
                    ))}
                    {section.legend.length > 0 && (
                      <ul className={styles.helpLegend}>
                        {section.legend.map((item) => (
                          <li key={`${section.id}-${item.label}`}>
                            <HelpLegendSwatch swatch={item.swatch} />
                            <span>{item.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
        <div className={styles.helpSources}>
          <p>
            Datakällor:{" "}
            <a href="https://api.trafikinfo.trafikverket.se/" target="_blank" rel="noreferrer">
              Trafikverket Open API
            </a>{" "}
            för olyckor, störningar och liveflöde. NVDB via{" "}
            <a href="https://lastkajen.trafikverket.se/" target="_blank" rel="noreferrer">
              Lastkajen
            </a>{" "}
            för trafikmängd och hastigheter.
          </p>
          <p>
            Olyckor, störningar och liveflöde hämtas från Trafikverket var 30:e minut.
            Kartan uppdaterar synliga lager ungefär varje minut medan sidan är öppen.
            Riskvärden räknas om i databasen ungefär var 15:e minut.
          </p>
          <p>
            {collectionText} Pågående olyckor räknas som live när de har setts inom de senaste 90 minuterna.
            Data är preliminär och bör ses som stöd, inte som enda underlag för vägval.
          </p>
          <p className={styles.helpSourcesUpdated}>{dataUpdatedText}</p>
        </div>
      </div>
    </aside>
  );
}

function HelpLegendSwatch({ swatch }: { swatch: HelpLegendSwatch }) {
  return (
    <span
      className={`${styles.helpLegendSwatch} ${styles[`helpLegendSwatch_${swatch.kind}`]}`}
      style={swatch.color ? { backgroundColor: swatch.color } : undefined}
      aria-hidden="true"
    />
  );
}

function InfoBox({
  open,
  compact,
  onToggle,
  updatedText,
}: {
  open: boolean;
  compact: boolean;
  onToggle: () => void;
  updatedText: string;
}) {
  const compactClosed = compact && !open;
  const handleBoxClick = open ? undefined : onToggle;
  return (
    <div
      className={`${styles.infoBox} ${open ? styles.infoBoxOpen : ""} ${
        compactClosed ? styles.infoBoxCompact : ""
      }`}
      onClick={handleBoxClick}
      role={open ? "dialog" : "button"}
      tabIndex={open ? undefined : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={open}
      aria-label={open ? undefined : "Öppna kort information om tjänsten"}
    >
      <div className={styles.infoBoxHeader}>
        <img
          className={styles.infoBoxLogo}
          src="/logo/sakravagar_logo.svg"
          alt="SäkraVägar"
        />
        <button
          type="button"
          className={styles.infoBoxIconBtn}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={open ? "Stäng" : "Öppna"}
        >
          <RoadOrXIcon expanded={open} />
        </button>
      </div>
      <div
        className={`${styles.infoBoxIntroExpander} ${
          compactClosed ? "" : styles.infoBoxIntroExpanderOpen
        }`}
        aria-hidden={compactClosed}
      >
        <div className={styles.infoBoxIntroInner}>
          <p className={styles.infoBoxIntro}>
            För dig som känner oro i trafiken och vill planera din resa med mer kontroll, lugn och tillit.
          </p>
          <p className={styles.infoBoxUpdated}>{updatedText}</p>
        </div>
      </div>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <div className={styles.infoBoxBody}>
            <p>
              SäkraVägar finns för dig som vill känna mer kontroll innan du sätter dig bakom ratten. Genom att se rutter, trafikläge och vägarnas karaktär i lugn takt kan resan bli lättare att förstå innan den börjar.
            </p>
            <p>
              Målet är inte att lova en helt riskfri väg, utan att ge ett tryggare beslutsstöd: välj det alternativ som känns rimligt för dig, även när det inte alltid är det snabbaste.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoadOrXIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`${styles.roadIcon} ${expanded ? styles.roadIconExpanded : ""}`}
      width="28"
      height="18"
      viewBox="0 0 28 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M0 1H28" stroke="currentColor" strokeWidth="1" />
      <path d="M0 9H28" stroke="currentColor" strokeWidth="1" strokeDasharray="5 4" />
      <path d="M0 17H28" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.warningIcon} ${className ?? ""}`}
      width="14"
      height="14"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8.5 2L15.5 14.5H1.5L8.5 2Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
      <path d="M8.5 6.2V9.6M8.5 11.5V12.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.btnIcon} ${className ?? ""}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M1 8H15M8 15L8 1" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      className={styles.btnIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M1 8H15" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function LocationIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.btnIcon} ${className ?? ""}`}
      width="16"
      height="16"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M9.08308 7.75042L10.3979 15L15.8335 1L1.8335 6.43559L9.08308 7.75042Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}
