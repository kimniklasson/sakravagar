"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./Map.module.css";
import {
  focusRoute,
  focusLiveEvents,
  setRouteLayerData,
} from "./layers";
import type { GeocodeResult } from "@/app/api/geocode/route";
import type { RouteLine } from "@/lib/routeTypes";
import { HelpPanel, type HelpSectionId } from "./HelpPanel";
import { useCustomRouteStopMarkers } from "./hooks/useCustomRouteStopMarkers";
import { useLiveEventSummary } from "./hooks/useLiveEventSummary";
import { useMapLibreLifecycle, type MapLayerLoadingState } from "./hooks/useMapLibreLifecycle";
import { useRouteControlsBottom } from "./hooks/useRouteControlsBottom";
import { useRouteStopSearch } from "./hooks/useRouteStopSearch";
import { useViewportCssVars } from "./hooks/useViewportCssVars";
import { LocationIcon, MinusIcon, PlusIcon, RoadOrXIcon } from "./MapIcons";
import { RouteAlternativesTray } from "./RouteAlternativesTray";
import { RouteLoadingIndicator, type RouteLoadingMode } from "./RouteLoadingIndicator";
import { RoutePlannerBox } from "./RoutePlannerBox";
import {
  activeAvoidCount,
  activeRouteTimeBudget,
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
  RouteAvoidOption,
  RouteAvoidState,
  RouteCacheEntry,
  RouteProvider,
  RouteStop,
  RouteTimeBudget,
} from "./routeModel";
import {
  buildGoogleMapsDirectionsUrl,
  createRouteSharePayload,
  routeStateKey,
  writeClipboardText,
  type RouteFeedbackVote,
  type RouteSharePayload,
} from "./routeSharing";

const mobileInfoBoxQuery = "(max-width: 767px)";
const initialLayerLoading: MapLayerLoadingState = {
  accidents: false,
  traffic: false,
  disturbances: false,
  largeRoads: false,
};
const LAYER_MIN_ZOOM = {
  traffic: 9,
  disturbances: 9,
  largeRoads: 8,
} as const;
const LAYER_ZOOM_DURATION_MS = 520;

export type MapProps = {
  sharedRouteSlug?: string;
  initialSharedRoutePayload?: RouteSharePayload | null;
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

function routeHasNullActiveAvoidScore(route: RouteLine, avoids: RouteAvoidState): boolean {
  return (Object.keys(avoids) as RouteAvoidOption[]).some(
    (option) => avoids[option] && route.avoidScores[option] === null,
  );
}

function trackRouteResult(
  routes: RouteLine[],
  provider: RouteProvider | null | undefined,
  avoids: RouteAvoidState,
  source: "cache" | "network",
): void {
  track("route_result", {
    provider: provider ?? "unknown",
    avoidsActive: activeAvoidCount(avoids),
    alternativeCount: routes.length,
    hasNullScores: routes.some((route) => routeHasNullActiveAvoidScore(route, avoids)),
    source,
  });
}

export default function Map({ sharedRouteSlug, initialSharedRoutePayload = null }: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoBoxOpen, setInfoBoxOpen] = useState(false);
  const [infoBoxCompact, setInfoBoxCompact] = useState(isMobileViewport);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const { eventStats, liveCount, now, refreshLiveCount, setLiveCount } = useLiveEventSummary();
  const [activeHelpSectionId, setActiveHelpSectionId] = useState<HelpSectionId | null>("routeHighSpeed");
  const [accidentsOn, setAccidentsOn] = useState(false);
  const [trafficOn, setTrafficOn] = useState(false);
  const [disturbancesOn, setDisturbancesOn] = useState(false);
  const [largeRoadsOn, setLargeRoadsOn] = useState(false);
  const [layerLoading, setLayerLoading] = useState<MapLayerLoadingState>(initialLayerLoading);
  const [atUserLocation, setAtUserLocation] = useState(false);
  const [routeStops, setRouteStops] = useState<RouteStop[]>(initialRouteStops);
  const [activeRouteStopId, setActiveRouteStopId] = useState<string | null>(null);
  const [loadingRouteStopId, setLoadingRouteStopId] = useState<string | null>(null);
  const {
    geocodeResultsByStop,
    geocodingStopId,
    setGeocodeResultsByStop,
  } = useRouteStopSearch({ activeRouteStopId, routeStops });
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
  const routeControlsRef = useRef<HTMLDivElement | null>(null);
  const routeResponseCacheRef = useRef<globalThis.Map<string, RouteCacheEntry>>(new globalThis.Map());
  const routeLinesRef = useRef<RouteLine[]>([]);
  const selectedRouteIdRef = useRef<string | null>(null);
  const routeProviderRef = useRef<RouteProvider | null>(null);
  const routeShareUrlsRef = useRef<globalThis.Map<string, string>>(new globalThis.Map());
  const routeUserMutationVersionRef = useRef(0);
  const dragRouteStopIdRef = useRef<string | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);
  const routeCompareTimerRef = useRef<number | null>(null);
  const shouldRevealSelectedRouteRef = useRef(false);
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
  const handleLayerLoadingChange = useCallback((state: MapLayerLoadingState) => {
    setLayerLoading(state);
  }, []);
  const zoomToLayerMinZoom = useCallback((minZoom: number) => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || map.getZoom() >= minZoom) return;
    map.easeTo({ zoom: minZoom, duration: LAYER_ZOOM_DURATION_MS });
  }, []);
  const handleTrafficToggle = useCallback(() => {
    setTrafficOn((current) => {
      const next = !current;
      if (next) zoomToLayerMinZoom(LAYER_MIN_ZOOM.traffic);
      return next;
    });
  }, [zoomToLayerMinZoom]);
  const handleDisturbancesToggle = useCallback(() => {
    setDisturbancesOn((current) => {
      const next = !current;
      if (next) zoomToLayerMinZoom(LAYER_MIN_ZOOM.disturbances);
      return next;
    });
  }, [zoomToLayerMinZoom]);
  const handleLargeRoadsToggle = useCallback(() => {
    setLargeRoadsOn((current) => {
      const next = !current;
      if (next) zoomToLayerMinZoom(LAYER_MIN_ZOOM.largeRoads);
      return next;
    });
  }, [zoomToLayerMinZoom]);

  useViewportCssVars(mapRef);
  useRouteControlsBottom(routeControlsRef);
  useMapLibreLifecycle({
    accidentsOn,
    containerRef,
    disturbancesOn,
    largeRoadsOn,
    mapLoadedRef,
    mapRef,
    refreshLiveCount,
    setLayerLoading: handleLayerLoadingChange,
    routeAvoidsRef,
    routeLinesRef,
    selectedRouteIdRef,
    selectRouteById,
    setAtUserLocation,
    trafficOn,
  });

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
  }, []);

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
    return createRouteSharePayload({
      provider: routeProviderRef.current,
      route,
      routeAvoids: routeAvoidsRef.current,
      routeLines: routeLinesRef.current,
      stops: routeStopsRef.current,
    });
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
  ): Promise<string> => {
    const route = routeById(routeId);
    const routeRank = routeLinesRef.current.findIndex((candidate) => candidate.id === route.id);
    const stops = routeStopsRef.current;
    const res = await fetch("/api/route-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vote,
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

  const handleClearRouteFeedback = async (feedbackId: string): Promise<void> => {
    const res = await fetch(`/api/route-feedback?id=${encodeURIComponent(feedbackId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Kunde inte ta bort feedback.");
    }
  };

  const applySharedRoutePayload = (payload: RouteSharePayload, shareUrl: string | null): void => {
    const selectedRoute = payload.selectedRoute;
    const stops = payload.stops;
    const routeAvoids = payload.routeAvoids;
    if (!selectedRoute || !Array.isArray(stops) || stops.length < 2) {
      throw new Error("Ogiltig delad rutt.");
    }

    lastRouteKeyRef.current = routeStateKey(stops);
    if (shareUrl) routeShareUrlsRef.current.set(selectedRoute.id, shareUrl);
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
        let payload = initialSharedRoutePayload;
        if (!payload) {
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

          ({ payload } = (await res.json()) as { payload: RouteSharePayload });
        }
        if (!stillCurrent()) return;
        applySharedRoutePayload(payload, window.location.href);
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
  }, [initialSharedRoutePayload, sharedRouteSlug]);

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
  useCustomRouteStopMarkers({
    mapLoadedRef,
    mapRef,
    markerClassName: styles.routeCustomStopMarker,
    onClearStop: clearRouteStop,
    routeStops,
  });
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
      if (stopCoordinates.length !== resolvedStops.length || stopCoordinates.length < 2) {
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
        coordinates: stopCoordinates,
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
          trackRouteResult(cached.routes, cached.provider, avoids, "cache");
          return;
        }
        routeResponseCacheRef.current.delete(cacheKey);
      }

      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: stopCoordinates,
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
      trackRouteResult(routes, provider, avoids, "network");
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
  }, [applyRouteSelection, geocodeRouteStop, routeAvoids, setGeocodeResultsByStop]);
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
            loading={accidentsOn && layerLoading.accidents}
          />
          <LayerIconButton
            label="Trafikflöde"
            icon="flow"
            on={trafficOn}
            onToggle={handleTrafficToggle}
            loading={trafficOn && layerLoading.traffic}
          />
          <LayerIconButton
            label="Trafikstörningar"
            icon="disturbances"
            on={disturbancesOn}
            onToggle={handleDisturbancesToggle}
            loading={disturbancesOn && layerLoading.disturbances}
          />
          <LayerIconButton
            label="Höga hastigheter"
            icon="speed"
            on={largeRoadsOn}
            onToggle={handleLargeRoadsToggle}
            loading={largeRoadsOn && layerLoading.largeRoads}
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
  loading = false,
  className,
}: {
  label: string;
  icon: LayerIconName;
  on: boolean;
  onToggle: () => void;
  badgeCount?: number;
  onBadgeClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const showBadge = on && typeof badgeCount === "number" && badgeCount > 0;
  const tooltipLabel = label.startsWith("Stäng") ? label : `Visa ${label.toLowerCase()}`;
  const buttonLabel = loading ? `${label} laddas` : label;
  return (
    <span className={`${styles.layerIconItem} ${className ?? ""}`}>
      <button
        type="button"
        className={`${styles.layerIconBtn} ${on ? styles.layerIconBtnOn : ""} ${
          loading ? styles.layerIconBtnLoading : ""
        }`}
        onClick={onToggle}
        aria-label={buttonLabel}
        aria-busy={loading || undefined}
        aria-pressed={on}
        data-label={loading ? `Laddar ${label.toLowerCase()}` : tooltipLabel}
      >
        <span className={styles.layerIconVisual} aria-hidden="true">
          <span
            className={`${styles.layerIconGlyph} ${styles[`layerIconGlyph_${icon}`]}`}
          />
          <span className={styles.layerIconSpinner} />
        </span>
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
