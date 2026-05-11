"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { HelpPanel, type HelpSectionId } from "./HelpPanel";
import { LocationIcon, MinusIcon, PlusIcon, RoadOrXIcon } from "./MapIcons";
import { RouteAlternativesTray } from "./RouteAlternativesTray";
import { RouteLoadingIndicator, type RouteLoadingMode } from "./RouteLoadingIndicator";
import { RoutePlannerBox } from "./RoutePlannerBox";
import {
  activeAvoidCount,
  activeRouteTimeBudget,
  closestRouteCoordinateIndex,
  customRouteStopIdPrefix,
  dedupeRouteCoordinates,
  initialRouteAvoids,
  initialRouteStops,
  isCustomRouteStop,
  isFreshRouteCacheEntry,
  rememberRouteCacheEntry,
  routeCacheKey,
  routeGeolocationErrorMessage,
  selectRouteCandidates,
} from "./routeModel";
import type {
  ResolvedRouteStop,
  RouteAvoidOption,
  RouteAvoidState,
  RouteCacheEntry,
  RouteDragPlan,
  RouteProvider,
  RouteStop,
  RouteTimeBudget,
} from "./routeModel";

const SWEDEN_CENTER: [number, number] = [16.5, 62.5];
const SWEDEN_ZOOM = 4.2;
const SHARED_ROUTE_MAX_COORDINATES = 360;
const SHARED_ROUTE_MAX_ANNOTATION_COORDINATES = 80;
const SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS = 80;
const SHARED_ROUTE_MAX_ANNOTATION_POINTS = 160;

const mobileInfoBoxQuery = "(max-width: 767px)";

export type MapProps = {
  sharedRouteSlug?: string;
};

type RouteFeedbackVote = "up" | "down";

type RouteSharePayload = {
  version: 1;
  createdAt: string;
  stops: RouteStop[];
  routeAvoids: RouteAvoidState;
  selectedRoute: RouteLine;
  provider: RouteProvider | null;
  selectedRouteRank: number;
  presentedRouteCount: number;
};

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(mobileInfoBoxQuery).matches;
}

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

function routeStateKey(stops: RouteStop[]): string {
  return stops
    .map((stop) => stop.coordinates?.join(",") ?? stop.label.trim().toLowerCase())
    .join("|");
}

function replaceRouteStopById(
  stops: RouteStop[],
  id: string,
  patch: Partial<Omit<RouteStop, "id">>,
): RouteStop[] {
  return stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop));
}

function routeProviderNotice(provider: RouteProvider | null | undefined, avoids: RouteAvoidState): string | null {
  if (provider === "osrm" && activeAvoidCount(avoids) > 0) {
    return "Reservroutern saknar vägdetaljer, så hastigheter, broar, tunnlar och andra undvik-värden kan bara jämföras begränsat.";
  }
  return null;
}

function roundRouteCoordinate([lng, lat]: [number, number]): [number, number] {
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

function compactRouteCoordinates(
  coordinates: GeoJSON.Position[],
  maxCoordinates: number,
): [number, number][] {
  const valid = coordinates.filter((coord): coord is [number, number] => (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  ));

  if (valid.length <= maxCoordinates) return valid.map(roundRouteCoordinate);
  const sampled: [number, number][] = [];
  const step = (valid.length - 1) / (maxCoordinates - 1);
  for (let index = 0; index < maxCoordinates; index += 1) {
    const coord = valid[Math.round(index * step)];
    if (coord) sampled.push(roundRouteCoordinate(coord));
  }
  return dedupeRouteCoordinates(sampled);
}

function compactLineString(
  geometry: GeoJSON.LineString,
  maxCoordinates: number,
): GeoJSON.LineString {
  return {
    type: "LineString",
    coordinates: compactRouteCoordinates(geometry.coordinates, maxCoordinates),
  };
}

function compactRouteForSnapshot(route: RouteLine): RouteLine {
  return {
    ...route,
    geometry: compactLineString(route.geometry, SHARED_ROUTE_MAX_COORDINATES),
    annotations: {
      highSpeed: (route.annotations.highSpeed ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      trafficIntensity: (route.annotations.trafficIntensity ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      cityTraffic: (route.annotations.cityTraffic ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      bridges: (route.annotations.bridges ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      tunnels: (route.annotations.tunnels ?? [])
        .slice(0, SHARED_ROUTE_MAX_ANNOTATION_SEGMENTS)
        .map((segment) => ({
          ...segment,
          geometry: compactLineString(segment.geometry, SHARED_ROUTE_MAX_ANNOTATION_COORDINATES),
        })),
      disturbances: (route.annotations.disturbances ?? []).slice(0, SHARED_ROUTE_MAX_ANNOTATION_POINTS),
      liveAccidents: (route.annotations.liveAccidents ?? []).slice(0, SHARED_ROUTE_MAX_ANNOTATION_POINTS),
    },
  };
}

function compactStopsForSnapshot(stops: RouteStop[]): RouteStop[] {
  return stops.map((stop) => ({
    ...stop,
    coordinates: stop.coordinates ? roundRouteCoordinate(stop.coordinates) : null,
  }));
}

function coordinateParam([lng, lat]: [number, number]): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function routeGoogleWaypoints(route: RouteLine): [number, number][] {
  const coordinates = route.geometry.coordinates.filter((coord): coord is [number, number] => (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  ));
  if (coordinates.length < 5) return [];

  return [0.25, 0.5, 0.75]
    .map((fraction) => coordinates[Math.round((coordinates.length - 1) * fraction)])
    .filter((coord): coord is [number, number] => Boolean(coord))
    .map(roundRouteCoordinate);
}

function buildGoogleMapsDirectionsUrl(route: RouteLine, stops: RouteStop[]): string | null {
  const routeCoordinates = route.geometry.coordinates.filter((coord): coord is [number, number] => (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === "number" &&
    typeof coord[1] === "number" &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  ));
  const origin = stops[0]?.coordinates ?? routeCoordinates[0];
  const destination = stops.at(-1)?.coordinates ?? routeCoordinates.at(-1);
  if (!origin || !destination) return null;

  const params = new URLSearchParams({
    api: "1",
    origin: coordinateParam(origin),
    destination: coordinateParam(destination),
    travelmode: "driving",
    dir_action: "navigate",
    utm_source: "sakravagar",
    utm_campaign: "route_card",
  });
  const waypoints = routeGoogleWaypoints(route);
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(coordinateParam).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function Map({ sharedRouteSlug }: MapProps) {
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
  const [activeHelpSectionId, setActiveHelpSectionId] = useState<HelpSectionId | null>("accidents");
  const [accidentsOn, setAccidentsOn] = useState(false);
  const [trafficOn, setTrafficOn] = useState(false);
  const [disturbancesOn, setDisturbancesOn] = useState(false);
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
  const [routeProvider, setRouteProvider] = useState<RouteProvider | null>(null);
  const routeStopsRef = useRef<RouteStop[]>(initialRouteStops);
  const routeAvoidsRef = useRef<RouteAvoidState>(initialRouteAvoids);
  const routeDragHandlerRef = useRef<((commit: RouteDragCommit) => void) | null>(null);
  const routeDragPreviewHandlerRef = useRef<((commit: RouteDragCommit) => void) | null>(null);
  const routeDragPreviewLatestRef = useRef<RouteDragCommit | null>(null);
  const routeDragPreviewTimerRef = useRef<number | null>(null);
  const routeDragPreviewAbortRef = useRef<AbortController | null>(null);
  const routeDragPreviewInFlightRef = useRef(false);
  const routeDragPreviewRequestedKeyRef = useRef<string | null>(null);
  const routeControlsRef = useRef<HTMLDivElement | null>(null);
  const routeResponseCacheRef = useRef<globalThis.Map<string, RouteCacheEntry>>(new globalThis.Map());
  const routeLinesRef = useRef<RouteLine[]>([]);
  const selectedRouteIdRef = useRef<string | null>(null);
  const routeProviderRef = useRef<RouteProvider | null>(null);
  const routeShareUrlsRef = useRef<globalThis.Map<string, string>>(new globalThis.Map());
  const routeUserMutationVersionRef = useRef(0);
  const customRouteMarkersRef = useRef<maplibregl.Marker[]>([]);
  const clearRouteStopRef = useRef<(id: string) => void>(() => {});
  const dragRouteStopIdRef = useRef<string | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);
  const routeCompareTimerRef = useRef<number | null>(null);
  const shouldRevealSelectedRouteRef = useRef(false);
  const layerCtrlRef = useRef<{
    adt?: LayerController;
    disturbances?: LayerController;
    trafficFlow?: LayerController;
    largeRoads?: LayerController;
  }>({});
  useEffect(() => { routeStopsRef.current = routeStops; }, [routeStops]);
  useEffect(() => { routeAvoidsRef.current = routeAvoids; }, [routeAvoids]);
  useEffect(() => { routeLinesRef.current = routeLines; }, [routeLines]);
  useEffect(() => { selectedRouteIdRef.current = selectedRouteId; }, [selectedRouteId]);
  useEffect(() => { routeProviderRef.current = routeProvider; }, [routeProvider]);

  const markRouteUserMutation = useCallback(() => {
    routeUserMutationVersionRef.current += 1;
  }, []);

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
    let appliedViewportHeight: number | null = null;
    let appliedViewportWidth: number | null = null;

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
        const viewportChanged =
          appliedViewportHeight !== stableViewportHeight ||
          appliedViewportWidth !== stableViewportWidth;
        appliedViewportHeight = stableViewportHeight;
        appliedViewportWidth = stableViewportWidth;
        if (viewportChanged) mapRef.current?.resize();
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

  useLayoutEffect(() => {
    const element = routeControlsRef.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      document.documentElement.style.setProperty("--route-controls-bottom", `${Math.ceil(rect.bottom)}px`);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    window.addEventListener("resize", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--route-controls-bottom");
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
      layerCtrlRef.current.adt.setVisible(trafficOn);
      layerCtrlRef.current.largeRoads.setVisible(largeRoadsOn);
      void addEventsLayer(map)
        .then(() => {
          void refreshLiveCount();
          setEventsLayerVisible(map, accidentsOn);
          layerCtrlRef.current.disturbances = addDisturbancesLayer(map);
          layerCtrlRef.current.disturbances.setVisible(disturbancesOn);
          layerCtrlRef.current.trafficFlow = addTrafficFlowLayer(map);
          layerCtrlRef.current.trafficFlow.setVisible(trafficOn);
          addRouteLayer(
            map,
            selectRouteById,
            (commit) => routeDragHandlerRef.current?.(commit),
            (commit) => routeDragPreviewHandlerRef.current?.(commit),
          );
          if (routeLinesRef.current.length > 0) {
            setRouteLayerData(
              map,
              routeLinesRef.current,
              selectedRouteIdRef.current,
              routeAvoidsRef.current,
            );
            focusRoute(map, routeLinesRef.current);
          }
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
    const map = mapRef.current;
    if (map && mapLoadedRef.current) setEventsLayerVisible(map, accidentsOn);
  }, [accidentsOn]);

  useEffect(() => {
    layerCtrlRef.current.adt?.setVisible(trafficOn);
    layerCtrlRef.current.trafficFlow?.setVisible(trafficOn);
  }, [trafficOn]);

  useEffect(() => {
    layerCtrlRef.current.disturbances?.setVisible(disturbancesOn);
  }, [disturbancesOn]);

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
    const orderedRoutes = selection.routes;
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
    setRouteProvider(null);
    setRouteError(null);
    setRouteNoticeText(null);
    setRouteCompareLoading(false);
    routeShareUrlsRef.current.clear();
    const map = mapRef.current;
    if (map && mapLoadedRef.current) setRouteLayerData(map, []);
  };
  const routeSnapshotPayload = (route: RouteLine): RouteSharePayload => {
    const routeRank = routeLinesRef.current.findIndex((candidate) => candidate.id === route.id);
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      stops: compactStopsForSnapshot(routeStopsRef.current),
      routeAvoids: { ...routeAvoidsRef.current },
      selectedRoute: compactRouteForSnapshot(route),
      provider: routeProviderRef.current,
      selectedRouteRank: routeRank >= 0 ? routeRank : 0,
      presentedRouteCount: routeLinesRef.current.length,
    };
  };

  const routeById = (routeId: string): RouteLine => {
    const route = routeLinesRef.current.find((candidate) => candidate.id === routeId);
    if (!route) throw new Error("Rutten finns inte längre.");
    return route;
  };

  const createRouteShareUrl = async (routeId: string): Promise<string> => {
    const cached = routeShareUrlsRef.current.get(routeId);
    if (cached) return cached;

    const route = routeById(routeId);
    const res = await fetch("/api/route-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: routeSnapshotPayload(route) }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Kunde inte skapa delningslänk.");
    }

    const { url } = (await res.json()) as { url: string };
    routeShareUrlsRef.current.set(routeId, url);
    return url;
  };

  const handleCopyRouteUrl = async (routeId: string): Promise<void> => {
    const url = await createRouteShareUrl(routeId);
    await writeClipboardText(url);
  };

  const handleOpenRouteInGoogleMaps = (routeId: string) => {
    const route = routeById(routeId);
    const url = buildGoogleMapsDirectionsUrl(route, routeStopsRef.current);
    if (!url) {
      setRouteNoticeText("Kunde inte öppna rutten i Google Maps.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleSubmitRouteFeedback = async (
    routeId: string,
    vote: RouteFeedbackVote,
    comment: string,
  ): Promise<string> => {
    const route = routeById(routeId);
    const routeRank = routeLinesRef.current.findIndex((candidate) => candidate.id === route.id);
    const stops = routeStopsRef.current;
    const res = await fetch("/api/route-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vote,
        comment,
        snapshot: routeSnapshotPayload(route),
        routeMeta: {
          routeId: route.id,
          source: route.source,
          provider: routeProviderRef.current,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          safetyScore: route.safetyScore,
          avoidScores: route.avoidScores,
          exposure: route.exposure,
        },
        searchMeta: {
          routeAvoids: routeAvoidsRef.current,
          stopCount: stops.length,
          viaStopCount: stops.filter(isCustomRouteStop).length,
          selectedRouteRank: routeRank >= 0 ? routeRank : 0,
          presentedRouteCount: routeLinesRef.current.length,
        },
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Kunde inte spara feedback.");
    }

    const { id } = (await res.json()) as { id: string };
    return id;
  };

  const handleUpdateRouteFeedbackComment = async (
    feedbackId: string,
    comment: string,
  ): Promise<void> => {
    const res = await fetch("/api/route-feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: feedbackId, comment }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Kunde inte uppdatera feedback.");
    }
  };

  const handleClearRouteFeedback = async (feedbackId: string): Promise<void> => {
    const res = await fetch(`/api/route-feedback?id=${encodeURIComponent(feedbackId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Kunde inte ta bort feedback.");
    }
  };

  useEffect(() => {
    if (!sharedRouteSlug) return;

    let cancelled = false;
    const mutationVersion = routeUserMutationVersionRef.current;
    const stillCurrent = () => !cancelled && routeUserMutationVersionRef.current === mutationVersion;
    const loadSharedRoute = async () => {
      setRouteLoading(true);
      setRouteError(null);
      setRouteNoticeText("Öppnar delad rutt...");

      try {
        const res = await fetch(`/api/route-shares?slug=${encodeURIComponent(sharedRouteSlug)}`);
        if (!stillCurrent()) return;
        if (res.status === 410) {
          clearRoute();
          setRouteError("Länken har gått ut. Sök rutten igen för att skapa en ny delningslänk.");
          setRouteNoticeText(null);
          return;
        }
        if (res.status === 404) {
          clearRoute();
          setRouteError("Den delade rutten hittades inte.");
          setRouteNoticeText(null);
          return;
        }
        if (!res.ok) throw new Error(await res.text());

        const { payload } = (await res.json()) as { payload: RouteSharePayload };
        if (!stillCurrent()) return;
        const selectedRoute = payload.selectedRoute;
        const stops = payload.stops;
        const routeAvoids = payload.routeAvoids;
        if (!selectedRoute || !Array.isArray(stops) || stops.length < 2) {
          throw new Error("Ogiltig delad rutt.");
        }

        lastRouteKeyRef.current = routeStateKey(stops);
        routeShareUrlsRef.current.set(selectedRoute.id, window.location.href);
        setRouteStops(stops);
        setRouteAvoids(routeAvoids);
        setRouteCandidates([selectedRoute]);
        setRouteLines([selectedRoute]);
        setSelectedRouteId(selectedRoute.id);
        setRouteProvider(payload.provider ?? null);
        setRouteNoticeText(null);
        setRouteError(null);

        const map = mapRef.current;
        if (map && mapLoadedRef.current) {
          setRouteLayerData(map, [selectedRoute], selectedRoute.id, routeAvoids);
          focusRoute(map, [selectedRoute]);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("shared route load failed", err);
        clearRoute();
        setRouteError("Kunde inte öppna den delade rutten.");
        setRouteNoticeText(null);
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    };

    void loadSharedRoute();
    return () => {
      cancelled = true;
    };
  }, [sharedRouteSlug]);

  const setRouteStopLabel = (id: string, label: string) => {
    markRouteUserMutation();
    clearRoute();
    setRouteStops((stops) =>
      replaceRouteStopById(stops, id, { label, coordinates: null, source: "manual" }),
    );
  };
  const clearRouteStop = (id: string) => {
    markRouteUserMutation();
    clearRoute();
    setGeocodeResultsByStop((byStop) => ({ ...byStop, [id]: [] }));
    setRouteStops((stops) => {
      const index = stops.findIndex((stop) => stop.id === id);
      if (index > 0 && index < stops.length - 1) {
        return stops.filter((stop) => stop.id !== id);
      }
      return replaceRouteStopById(stops, id, { label: "", coordinates: null, source: "manual" });
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
    markRouteUserMutation();
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
    markRouteUserMutation();
    clearRoute();
    setRouteStops((stops) =>
      replaceRouteStopById(stops, stopId, {
        label: result.shortLabel,
        coordinates: result.coordinates,
        source: "manual",
      }),
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
    routeShareUrlsRef.current.clear();
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

      const alternatives = opts.alternatives ?? 3;
      const cacheKey = routeCacheKey({
        coordinates: routeCoordinates,
        alternatives,
        avoids,
        timeBudget,
      });
      const cached = routeResponseCacheRef.current.get(cacheKey);
      if (cached) {
        if (isFreshRouteCacheEntry(cached, avoids)) {
          setRouteCandidates(cached.routes);
          setRouteProvider(cached.provider ?? null);
          applyRouteSelection(cached.routes, avoids, timeBudget, { focus: !opts.compare });
          setRouteNoticeText(routeProviderNotice(cached.provider, avoids));
          return;
        }
        routeResponseCacheRef.current.delete(cacheKey);
      }

      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: routeCoordinates,
          alternatives,
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
        provider?: RouteProvider;
      };
      if (!routes.length) throw new Error("Kunde inte hitta en rutt.");

      rememberRouteCacheEntry(routeResponseCacheRef.current, cacheKey, {
        routes,
        provider,
        createdAt: Date.now(),
      });
      setRouteCandidates(routes);
      setRouteProvider(provider ?? null);
      applyRouteSelection(routes, avoids, timeBudget, { focus: !opts.compare });
      setRouteNoticeText(routeProviderNotice(provider, avoids));
    } catch (err) {
      console.warn("route planning failed", err);
      lastRouteKeyRef.current = null;
      setRouteCandidates([]);
      setRouteLines([]);
      setRouteProvider(null);
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

    markRouteUserMutation();
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
  }, [buildRouteDragPlan, cancelRouteDragPreview, markRouteUserMutation, planRouteForStops]);

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
        replaceRouteStopById(stops, id, { label, coordinates, source: "gps" }),
      );
      setRouteError(null);
    } catch (err) {
      console.warn("route reverse geocoding failed", err);
      setRouteStops((stops) =>
        replaceRouteStopById(stops, id, { label: "Din position", coordinates, source: "gps" }),
      );
      setRouteError("Hittade din plats, men kunde inte slå upp adressen.");
    } finally {
      setLoadingRouteStopId(null);
    }
  };
  const handleUsePositionForRouteStop = (id: string) => {
    markRouteUserMutation();
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
          replaceRouteStopById(stops, id, { label: "Din position", coordinates, source: "gps" }),
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
    markRouteUserMutation();
    setRouteAvoids((current) => {
      const next = { ...current, [option]: !current[option] };
      setRouteNoticeText(null);
      routeShareUrlsRef.current.clear();
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
  const handleAccidentsToggle = () => setAccidentsOn((on) => !on);
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

  const routeLoadingActive = routeLoading || routeCompareLoading;
  const routeLoadingMode: RouteLoadingMode =
    routeCompareLoading || activeAvoidCount(routeAvoids) > 0 ? "filtered" : "fastest";

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      <div
        className={`${styles.routeLoadingOverlay} ${
          routeLoadingActive ? styles.routeLoadingOverlayActive : ""
        }`}
        aria-hidden="true"
      >
        <RouteLoadingIndicator active={routeLoadingActive} mode={routeLoadingMode} />
      </div>
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
          ref={routeControlsRef}
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
        onCopyRouteUrl={handleCopyRouteUrl}
        onOpenRouteInGoogleMaps={handleOpenRouteInGoogleMaps}
        onSubmitRouteFeedback={handleSubmitRouteFeedback}
        onUpdateRouteFeedbackComment={handleUpdateRouteFeedbackComment}
        onClearRouteFeedback={handleClearRouteFeedback}
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
            label="Olyckor"
            icon="accidents"
            on={accidentsOn}
            onToggle={handleAccidentsToggle}
            badgeCount={liveCount}
            onBadgeClick={handleFocusLiveEvents}
          />
          <LayerIconButton
            label="Trafikflöde"
            icon="flow"
            on={trafficOn}
            onToggle={() => setTrafficOn((v) => !v)}
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

type LayerIconName = "layers" | "help" | "close" | "accidents" | "flow" | "disturbances" | "speed";

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
