"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./Map.module.css";
import { focusLiveEvents } from "./layers";
import { HelpPanel, type HelpSectionId } from "./HelpPanel";
import { InfoBox } from "./InfoBox";
import { useLiveEventSummary } from "./hooks/useLiveEventSummary";
import { useMapLibreLifecycle, type MapLayerLoadingState } from "./hooks/useMapLibreLifecycle";
import { useRoutePlannerController } from "./hooks/useRoutePlannerController";
import { useRouteControlsBottom } from "./hooks/useRouteControlsBottom";
import { useViewportCssVars } from "./hooks/useViewportCssVars";
import { LayerIconButton } from "./LayerIconButton";
import { LocationIcon, MinusIcon, PlusIcon } from "./MapIcons";
import { RouteAlternativesTray } from "./RouteAlternativesTray";
import { RouteLoadingIndicator } from "./RouteLoadingIndicator";
import { RoutePlannerBox } from "./RoutePlannerBox";
import type { RouteSharePayload } from "./routeSharing";

const initialLayerLoading: MapLayerLoadingState = {
  accidents: false,
  traffic: false,
  cameras: false,
  disturbances: false,
  largeRoads: false,
};
const LAYER_MIN_ZOOM = {
  traffic: 9,
  cameras: 3,
  disturbances: 9,
  largeRoads: 8,
} as const;
const LAYER_ZOOM_DURATION_MS = 520;

export type MapProps = {
  sharedRouteSlug?: string;
  initialSharedRoutePayload?: RouteSharePayload | null;
};

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

export default function Map({ sharedRouteSlug, initialSharedRoutePayload = null }: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const userLocationMarkerRef = useRef<Marker | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoBoxOpen, setInfoBoxOpen] = useState(false);
  const [infoBoxCompact, setInfoBoxCompact] = useState(false);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const { eventStats, liveCount, now, refreshLiveCount, setLiveCount } = useLiveEventSummary();
  const [activeHelpSectionId, setActiveHelpSectionId] = useState<HelpSectionId | null>("routeHighSpeed");
  const [accidentsOn, setAccidentsOn] = useState(false);
  const [trafficOn, setTrafficOn] = useState(false);
  const [camerasOn, setCamerasOn] = useState(false);
  const [disturbancesOn, setDisturbancesOn] = useState(false);
  const [largeRoadsOn, setLargeRoadsOn] = useState(false);
  const [layerLoading, setLayerLoading] = useState<MapLayerLoadingState>(initialLayerLoading);
  const [atUserLocation, setAtUserLocation] = useState(false);
  const routeControlsRef = useRef<HTMLDivElement | null>(null);
  const {
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
    isCustomRoute,
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
  } = useRoutePlannerController({
    customStopMarkerClassName: styles.routeCustomStopMarker,
    initialSharedRoutePayload,
    mapLoadedRef,
    mapRef,
    sharedRouteSlug,
  });
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
  const handleCamerasToggle = useCallback(() => {
    setCamerasOn((current) => {
      const next = !current;
      if (next) zoomToLayerMinZoom(LAYER_MIN_ZOOM.cameras);
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
    camerasOn,
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
    if ((!routeLoadingActive && routeLines.length === 0) || infoBoxCompact) return;
    setInfoBoxCompact(true);
    setInfoBoxOpen(false);
  }, [infoBoxCompact, routeLines.length, routeLoadingActive]);

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
  const setUserLocationMarker = useCallback((coordinates: [number, number]) => {
    const map = mapRef.current;
    if (!map) return;

    if (!userLocationMarkerRef.current) {
      const markerElement = document.createElement("div");
      markerElement.className = styles.userLocationMarker!;
      markerElement.setAttribute("aria-label", "Din position");
      userLocationMarkerRef.current = new maplibregl.Marker({
        anchor: "center",
        element: markerElement,
      }).setLngLat(coordinates).addTo(map);
      return;
    }

    userLocationMarkerRef.current.setLngLat(coordinates);
  }, []);

  useEffect(() => () => {
    userLocationMarkerRef.current?.remove();
    userLocationMarkerRef.current = null;
  }, []);

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
        const coordinates: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLocationMarker(coordinates);
        map.flyTo({ center: coordinates, zoom: 14 });
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
            onDragStartStop={handleDragStartStop}
            onDropStop={handleDropStop}
          />
        </div>
      </div>
      <RouteAlternativesTray
        routes={routeLines}
        baselineRoute={routeCandidates[0] ?? null}
        routeAvoids={routeAvoids}
        selectedRouteId={selectedRouteId}
        isCustomRoute={isCustomRoute}
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
            label="Kameror"
            icon="camera"
            on={camerasOn}
            onToggle={handleCamerasToggle}
            loading={camerasOn && layerLoading.cameras}
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
