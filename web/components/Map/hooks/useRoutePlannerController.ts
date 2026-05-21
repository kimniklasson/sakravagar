import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { GeocodeResult } from "@/app/api/geocode/route";
import { routePlanningErrorMessage } from "@/lib/routeErrorMessages";
import type { RouteLine } from "@/lib/routeTypes";
import {
  focusRoute,
  refreshRouteTrafficCameraLayer,
  setRouteLayerData,
} from "../layers";
import {
  activeAvoidCount,
  activeRouteTimeBudget,
  initialRouteAvoids,
  initialRouteStops,
  isCustomRouteStop,
  isFreshRouteCacheEntry,
  rememberRouteCacheEntry,
  replaceRouteStopById,
  routeCacheKey,
  routeGeolocationErrorMessage,
  selectRouteCandidates,
  type RouteAvoidOption,
  type RouteAvoidState,
  type RouteCacheEntry,
  type RouteProvider,
  type RouteStop,
  type RouteTimeBudget,
} from "../routeModel";
import {
  buildGoogleMapsDirectionsUrl,
  createRouteSharePayload,
  routeStateKey,
  writeClipboardText,
  type RouteFeedbackVote,
  type RouteSharePayload,
} from "../routeSharing";
import { isMobileViewport } from "../viewport";
import { useCustomRouteStopMarkers } from "./useCustomRouteStopMarkers";
import { useRouteStopSearch } from "./useRouteStopSearch";

type MutableRef<T> = { current: T };
type RouteLoadingMode = "filtered" | "fastest";

type UseRoutePlannerControllerArgs = {
  customStopMarkerClassName?: string;
  initialSharedRoutePayload?: RouteSharePayload | null;
  mapLoadedRef: MutableRef<boolean>;
  mapRef: MutableRef<MapLibreMap | null>;
  sharedRouteSlug?: string;
};

type UseRoutePlannerControllerResult = {
  activeRouteStopId: string | null;
  clearRouteStop: (id: string) => void;
  geocodeResultsByStop: Record<string, GeocodeResult[]>;
  geocodingStopId: string | null;
  handleClearRouteFeedback: (feedbackId: string) => Promise<void>;
  handleCopyRouteUrl: (routeId: string) => Promise<void>;
  handleDragStartStop: (id: string) => void;
  handleDropStop: (id: string) => void;
  handleOpenRouteInGoogleMaps: (routeId: string) => void;
  handleSubmitRouteFeedback: (routeId: string, vote: RouteFeedbackVote) => Promise<string>;
  handleToggleRouteAvoid: (option: RouteAvoidOption) => void;
  handleUsePositionForRouteStop: (id: string) => void;
  isCustomRoute: boolean;
  loadingRouteStopId: string | null;
  previewRouteById: (routeId: string | null) => void;
  routeAvoids: RouteAvoidState;
  routeAvoidsRef: MutableRef<RouteAvoidState>;
  routeCandidates: RouteLine[];
  routeError: string | null;
  routeLines: RouteLine[];
  routeLinesRef: MutableRef<RouteLine[]>;
  routeLoadingActive: boolean;
  routeLoadingMode: RouteLoadingMode;
  routeNoticeText: string | null;
  routeStops: RouteStop[];
  selectGeocodeResult: (stopId: string, result: GeocodeResult) => void;
  selectRouteById: (routeId: string) => void;
  selectedRouteId: string | null;
  selectedRouteIdRef: MutableRef<string | null>;
  setActiveRouteStopId: (id: string | null) => void;
  setRouteStopLabel: (id: string, label: string) => void;
  shouldRevealSelectedRouteRef: MutableRef<boolean>;
};

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

export function useRoutePlannerController({
  customStopMarkerClassName,
  initialSharedRoutePayload = null,
  mapLoadedRef,
  mapRef,
  sharedRouteSlug,
}: UseRoutePlannerControllerArgs): UseRoutePlannerControllerResult {
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

  useEffect(() => {
    routeStopsRef.current = routeStops;
  }, [routeStops]);
  useEffect(() => {
    routeAvoidsRef.current = routeAvoids;
  }, [routeAvoids]);
  useEffect(() => {
    routeLinesRef.current = routeLines;
  }, [routeLines]);
  useEffect(() => {
    selectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId]);
  useEffect(() => {
    routeProviderRef.current = routeProvider;
  }, [routeProvider]);

  useEffect(() => {
    if (!routeNoticeText) return;
    const id = window.setTimeout(() => setRouteNoticeText(null), 5000);
    return () => window.clearTimeout(id);
  }, [routeNoticeText]);

  useEffect(() => () => {
    if (routeCompareTimerRef.current !== null) {
      window.clearTimeout(routeCompareTimerRef.current);
    }
  }, []);

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
        void refreshRouteTrafficCameraLayer(map, selectedRoute);
        focusRoute(map, [selectedRoute, ...current.filter((route) => route.id !== routeId)]);
      }
      setRouteNoticeText(null);
      shouldRevealSelectedRouteRef.current = true;
      setSelectedRouteId(routeId);
      return current;
    });
  }, [mapLoadedRef, mapRef]);

  const previewRouteById = useCallback((routeId: string | null) => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    setRouteLayerData(map, routeLines, routeId ?? selectedRouteId, routeAvoids);
  }, [mapLoadedRef, mapRef, routeAvoids, routeLines, selectedRouteId]);

  const applyRouteSelection = useCallback((
    candidates: RouteLine[],
    avoids: RouteAvoidState,
    timeBudget: RouteTimeBudget,
    opts: { focus?: boolean; showNoBetter?: boolean } = {},
  ) => {
    const selection = selectRouteCandidates(candidates, avoids, timeBudget);
    const selectedRoute = selection.routes[0] ?? null;
    const nextSelectedRouteId = selectedRoute?.id ?? null;
    const orderedRoutes = selection.routes;
    shouldRevealSelectedRouteRef.current = Boolean(nextSelectedRouteId && selection.active && isMobileViewport());
    setSelectedRouteId(nextSelectedRouteId);
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
      setRouteLayerData(map, orderedRoutes, nextSelectedRouteId, avoids);
      void refreshRouteTrafficCameraLayer(map, selectedRoute);
      if (opts.focus) {
        focusRoute(
          map,
          selectedRoute
            ? [selectedRoute, ...orderedRoutes.filter((route) => route.id !== selectedRoute.id)]
            : orderedRoutes,
        );
      }
    }
  }, [mapLoadedRef, mapRef]);

  const clearRoute = useCallback(() => {
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
    if (map && mapLoadedRef.current) {
      setRouteLayerData(map, []);
      void refreshRouteTrafficCameraLayer(map, null);
    }
  }, [mapLoadedRef, mapRef]);

  const routeSnapshotPayload = useCallback((route: RouteLine): RouteSharePayload => {
    return createRouteSharePayload({
      provider: routeProviderRef.current,
      route,
      routeAvoids: routeAvoidsRef.current,
      routeLines: routeLinesRef.current,
      stops: routeStopsRef.current,
    });
  }, []);

  const routeById = useCallback((routeId: string): RouteLine => {
    const route = routeLinesRef.current.find((candidate) => candidate.id === routeId);
    if (!route) throw new Error("Rutten finns inte längre.");
    return route;
  }, []);

  const createRouteShareUrl = useCallback(async (routeId: string): Promise<string> => {
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
  }, [routeById, routeSnapshotPayload]);

  const handleCopyRouteUrl = useCallback(async (routeId: string): Promise<void> => {
    const url = await createRouteShareUrl(routeId);
    await writeClipboardText(url);
  }, [createRouteShareUrl]);

  const handleOpenRouteInGoogleMaps = useCallback((routeId: string) => {
    const route = routeById(routeId);
    const url = buildGoogleMapsDirectionsUrl(route, routeStopsRef.current);
    if (!url) {
      setRouteNoticeText("Kunde inte öppna rutten i Google Maps.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [routeById]);

  const handleSubmitRouteFeedback = useCallback(async (
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
  }, [routeById, routeSnapshotPayload]);

  const handleClearRouteFeedback = useCallback(async (feedbackId: string): Promise<void> => {
    const res = await fetch(`/api/route-feedback?id=${encodeURIComponent(feedbackId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Kunde inte ta bort feedback.");
    }
  }, []);

  const applySharedRoutePayload = useCallback((payload: RouteSharePayload, shareUrl: string | null): void => {
    const selectedRoute = payload.selectedRoute;
    const stops = payload.stops;
    const sharedRouteAvoids = payload.routeAvoids;
    if (!selectedRoute || !Array.isArray(stops) || stops.length < 2) {
      throw new Error("Ogiltig delad rutt.");
    }

    lastRouteKeyRef.current = routeStateKey(stops);
    if (shareUrl) routeShareUrlsRef.current.set(selectedRoute.id, shareUrl);
    setRouteStops(stops);
    setRouteAvoids(sharedRouteAvoids);
    setRouteCandidates([selectedRoute]);
    setRouteLines([selectedRoute]);
    setSelectedRouteId(selectedRoute.id);
    setRouteProvider(payload.provider ?? null);
    setRouteNoticeText(null);
    setRouteError(null);

    const map = mapRef.current;
    if (map && mapLoadedRef.current) {
      setRouteLayerData(map, [selectedRoute], selectedRoute.id, sharedRouteAvoids);
      void refreshRouteTrafficCameraLayer(map, selectedRoute);
      focusRoute(map, [selectedRoute]);
    }
  }, [mapLoadedRef, mapRef]);

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
  }, [applySharedRoutePayload, clearRoute, initialSharedRoutePayload, sharedRouteSlug]);

  const setRouteStopLabel = useCallback((id: string, label: string) => {
    markRouteUserMutation();
    clearRoute();
    setRouteStops((stops) =>
      replaceRouteStopById(stops, id, { label, coordinates: null, source: "manual" }),
    );
  }, [clearRoute, markRouteUserMutation]);

  const clearRouteStop = useCallback((id: string) => {
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
  }, [clearRoute, markRouteUserMutation, setGeocodeResultsByStop]);

  useCustomRouteStopMarkers({
    mapLoadedRef,
    mapRef,
    markerClassName: customStopMarkerClassName,
    onClearStop: clearRouteStop,
    routeStops,
  });

  const reorderRouteStop = useCallback((sourceId: string, targetId: string) => {
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
  }, [clearRoute, markRouteUserMutation]);

  const selectGeocodeResult = useCallback((stopId: string, result: GeocodeResult) => {
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
  }, [clearRoute, markRouteUserMutation, setGeocodeResultsByStop]);

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
      alternatives?: number;
      auto?: boolean;
      avoids?: RouteAvoidState;
      compare?: boolean;
      timeBudget?: RouteTimeBudget;
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
        throw new Error(routePlanningErrorMessage(res.status, body?.error));
      }
      const { routes, provider } = (await res.json()) as {
        provider?: RouteProvider;
        routes: RouteLine[];
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
      if (map && mapLoadedRef.current) {
        setRouteLayerData(map, []);
        void refreshRouteTrafficCameraLayer(map, null);
      }
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
  }, [
    applyRouteSelection,
    geocodeRouteStop,
    mapLoadedRef,
    mapRef,
    routeAvoids,
    setGeocodeResultsByStop,
  ]);

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

  const reverseGeocodeRouteStop = useCallback(async (id: string, coordinates: [number, number]) => {
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
  }, []);

  const handleUsePositionForRouteStop = useCallback((id: string) => {
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
  }, [clearRoute, markRouteUserMutation, reverseGeocodeRouteStop, setGeocodeResultsByStop]);

  const handleToggleRouteAvoid = useCallback((option: RouteAvoidOption) => {
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
  }, [applyRouteSelection, markRouteUserMutation, planRouteForStops, routeCandidates, routeStops]);

  const handleDragStartStop = useCallback((id: string) => {
    dragRouteStopIdRef.current = id;
  }, []);

  const handleDropStop = useCallback((id: string) => {
    const sourceId = dragRouteStopIdRef.current;
    dragRouteStopIdRef.current = null;
    if (sourceId) reorderRouteStop(sourceId, id);
  }, [reorderRouteStop]);

  const routeLoadingActive = routeLoading || routeCompareLoading;
  const routeLoadingMode: RouteLoadingMode =
    routeCompareLoading || activeAvoidCount(routeAvoids) > 0 ? "filtered" : "fastest";

  return {
    activeRouteStopId,
    clearRouteStop,
    geocodeResultsByStop,
    geocodingStopId,
    handleClearRouteFeedback,
    handleCopyRouteUrl,
    handleDragStartStop,
    handleDropStop,
    handleOpenRouteInGoogleMaps,
    handleSubmitRouteFeedback,
    handleToggleRouteAvoid,
    handleUsePositionForRouteStop,
    isCustomRoute: routeStops.some(isCustomRouteStop),
    loadingRouteStopId,
    previewRouteById,
    routeAvoids,
    routeAvoidsRef,
    routeCandidates,
    routeError,
    routeLines,
    routeLinesRef,
    routeLoadingActive,
    routeLoadingMode,
    routeNoticeText,
    routeStops,
    selectGeocodeResult,
    selectRouteById,
    selectedRouteId,
    selectedRouteIdRef,
    setActiveRouteStopId,
    setRouteStopLabel,
    shouldRevealSelectedRouteRef,
  };
}
