"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./Map.module.css";
import {
  addAdtLayer,
  addDisturbancesLayer,
  addEventsLayer,
  addLargeRoadsLayer,
  addTrafficFlowLayer,
  addPopupHandler,
  addRiskLayer,
  refreshDisturbancesLayer,
  refreshTrafficFlowLayer,
  type LayerController,
} from "./layers";
import type { EventStats } from "@/app/api/events/stats/route";

const SWEDEN_CENTER: [number, number] = [16.5, 62.5];
const SWEDEN_ZOOM = 4.2;

type TimeWindow = "all" | "7d" | "30d" | "6m" | "1y";

const TIME_WINDOW_DAYS: Record<Exclude<TimeWindow, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "6m": 180,
  "1y": 365,
};

function sinceFromWindow(w: TimeWindow): string | null {
  if (w === "all") return null;
  const days = TIME_WINDOW_DAYS[w];
  return new Date(Date.now() - days * 86400_000).toISOString();
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

export default function Map() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [infoOpen, setInfoOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [riskOn, setRiskOn] = useState(true);
  const [adtOn, setAdtOn] = useState(true);
  const [disturbancesOn, setDisturbancesOn] = useState(true);
  const [trafficFlowOn, setTrafficFlowOn] = useState(true);
  const [largeRoadsOn, setLargeRoadsOn] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [adtOpen, setAdtOpen] = useState(false);
  const [disturbancesOpen, setDisturbancesOpen] = useState(false);
  const [trafficFlowOpen, setTrafficFlowOpen] = useState(false);
  const [largeRoadsOpen, setLargeRoadsOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [atUserLocation, setAtUserLocation] = useState(false);
  const [mobileAttributionOpen, setMobileAttributionOpen] = useState(false);
  const layerCtrlRef = useRef<{
    risk?: LayerController;
    adt?: LayerController;
    disturbances?: LayerController;
    trafficFlow?: LayerController;
    largeRoads?: LayerController;
  }>({});
  const timeWindowRef = useRef<TimeWindow>(timeWindow);
  useEffect(() => { timeWindowRef.current = timeWindow; }, [timeWindow]);

  const refreshEventStats = async () => {
    const res = await fetch("/api/events/stats");
    if (!res.ok) {
      console.warn("failed to fetch event stats", await res.text());
      return;
    }
    setEventStats((await res.json()) as EventStats);
  };

  useEffect(() => {
    void refreshEventStats();
    const id = window.setInterval(() => {
      setNow(Date.now());
      void refreshEventStats();
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const updateViewportVars = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const height = vv?.height ?? window.innerHeight;
        const offsetTop = vv?.offsetTop ?? 0;
        const bottomInset = Math.max(0, window.innerHeight - height - offsetTop);

        root.style.setProperty("--app-visual-height", `${height}px`);
        root.style.setProperty("--app-visual-top", `${offsetTop}px`);
        root.style.setProperty("--app-visual-bottom", `${bottomInset}px`);
        mapRef.current?.resize();
      });
    };

    updateViewportVars();
    window.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("scroll", updateViewportVars);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateViewportVars);
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
      attributionControl: { compact: true },
    });

    // dragend räcker som "användar-pan"-signal — zoom (knappar/scroll/pinch)
    // ändrar inte centrum så locate-state ska inte växla av av zoom.
    map.on("dragend", () => setAtUserLocation(false));

    map.on("load", () => {
      layerCtrlRef.current.largeRoads = addLargeRoadsLayer(map);
      layerCtrlRef.current.adt = addAdtLayer(map);
      layerCtrlRef.current.risk = addRiskLayer(map);
      layerCtrlRef.current.largeRoads.setVisible(largeRoadsOn);
      void addEventsLayer(map, { since: sinceFromWindow(timeWindow) })
        .then(({ liveCount }) => {
          setLiveCount(liveCount);
          layerCtrlRef.current.disturbances = addDisturbancesLayer(map);
          layerCtrlRef.current.disturbances.setVisible(disturbancesOn);
          layerCtrlRef.current.trafficFlow = addTrafficFlowLayer(map);
          layerCtrlRef.current.trafficFlow.setVisible(trafficFlowOn);
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
    if (!map || !mapLoadedRef.current) return;
    void addEventsLayer(map, { since: sinceFromWindow(timeWindow) }).then(({ liveCount }) =>
      setLiveCount(liveCount),
    );
  }, [timeWindow]);

  useEffect(() => {
    layerCtrlRef.current.risk?.setVisible(riskOn);
  }, [riskOn]);

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
      void addEventsLayer(map, { since: sinceFromWindow(timeWindowRef.current) }).then(
        ({ liveCount }) => setLiveCount(liveCount),
      );
      void refreshDisturbancesLayer(map);
      void refreshTrafficFlowLayer(map);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setInfoOpen(false);
      setMobileAttributionOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();
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
      {infoOpen && (
        <button
          type="button"
          className={styles.infoModalBackdrop}
          onClick={() => setInfoOpen(false)}
          aria-label="Stäng information"
        />
      )}
      <div className={`${styles.controls} ${infoOpen ? styles.controlsInfoOpen : ""}`}>
        <InfoBox
          open={infoOpen}
          onToggle={() => setInfoOpen((v) => !v)}
          updatedText={liveUpdatedText(eventStats?.latestLastSeen ?? null, now)}
        />
        <LiveBox
          accidentCount={liveCount}
          open={liveOpen}
          onToggle={() => setLiveOpen((v) => !v)}
        />
        <TimeBox
          value={timeWindow}
          onChange={setTimeWindow}
          open={timeOpen}
          onToggleOpen={() => setTimeOpen((v) => !v)}
        />
      </div>
      <div className={styles.rightControls}>
        <div className={styles.zoomGroup}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.zoomPlus}`}
            onClick={handleZoomIn}
            aria-label="Zooma in"
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.zoomMinus}`}
            onClick={handleZoomOut}
            aria-label="Zooma ut"
          >
            <MinusIcon />
          </button>
        </div>
        <button
          type="button"
          className={`${styles.iconBtn} ${atUserLocation ? styles.iconBtnActive : ""}`}
          onClick={handleLocate}
          aria-label="Visa min position"
          aria-pressed={atUserLocation}
        >
          <LocationIcon />
        </button>
        <MobileAttribution
          open={mobileAttributionOpen}
          onToggle={() => setMobileAttributionOpen((v) => !v)}
          onClose={() => setMobileAttributionOpen(false)}
        />
      </div>
      <div className={styles.layerControls}>
        <LayerBox
          label="Risk"
          colors={RISK_SCALE}
          on={riskOn}
          open={riskOpen}
          onToggleLayer={() => setRiskOn((v) => !v)}
          onToggleOpen={() => setRiskOpen((v) => !v)}
          body="Risk-lagret färgar vägsegment efter olyckor per miljon fordon — så att de farligaste vägarna per resa lyser starkast, inte de mest trafikerade. Synligt från stadsnivå och inåt."
          meta={
            eventStats?.periodDays
              ? `Tidsperiod för olyckor: ${eventStats.periodDays} dagar`
              : "Tidsperiod för olyckor: laddar"
          }
        />
        <LayerBox
          label="Flöde"
          colors={FLOW_SCALE}
          on={adtOn}
          open={adtOpen}
          onToggleLayer={() => setAdtOn((v) => !v)}
          onToggleOpen={() => setAdtOpen((v) => !v)}
          body="Flödes-lagret färgar vägsegment efter ÅDT (årsdygnstrafik) enligt NVDB — antalet fordon per dygn. Mörkare = mer trafik. Synligt från stadsnivå och inåt."
        />
        <LayerBox
          label="Störning"
          colors={DISTURBANCE_SCALE}
          on={disturbancesOn}
          open={disturbancesOpen}
          onToggleLayer={() => setDisturbancesOn((v) => !v)}
          onToggleOpen={() => setDisturbancesOpen((v) => !v)}
          body="Aktuella trafikstörningar från Trafikverket: vägarbeten och kö/trafik. Lagret är färsk driftinformation och ingår inte i riskhistoriken."
        />
        <LayerBox
          label="Liveflöde"
          colors={TRAFFIC_FLOW_SCALE}
          on={trafficFlowOn}
          open={trafficFlowOpen}
          onToggleLayer={() => setTrafficFlowOn((v) => !v)}
          onToggleOpen={() => setTrafficFlowOpen((v) => !v)}
          body="Live-mätningar från Trafikverkets TrafficFlow: flöde och snitthastighet per mätplats, snappat till närmaste vägsegment. Täckningen är bäst i Stockholm och Göteborg; i andra områden kan lagret sakna mätplatser även när det finns trafik."
        />
        <LayerBox
          label="Hastighet"
          colors={LARGE_ROADS_SCALE}
          on={largeRoadsOn}
          open={largeRoadsOpen}
          onToggleLayer={() => setLargeRoadsOn((v) => !v)}
          onToggleOpen={() => setLargeRoadsOpen((v) => !v)}
          body="Visar vägar med skyltad hastighet 90 km/h eller högre enligt NVDB:s hastighetsdata från Lastkajen. Vägtyp utan hastighetsvärde visas inte. Synligt från zoomnivå 8 och inåt."
        />
      </div>
    </>
  );
}

function MobileAttribution({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {open && (
        <button
          type="button"
          className={styles.mobileAttributionBackdrop}
          onClick={onClose}
          aria-label="Stäng kartinformation"
        />
      )}
      <button
        type="button"
        className={`${styles.iconBtn} ${styles.mobileAttributionBtn} ${
          open ? styles.iconBtnActive : ""
        }`}
        onClick={onToggle}
        aria-label="Visa kartinformation"
        aria-expanded={open}
      >
        <InfoIcon className={styles.mobileAttributionIcon} />
      </button>
      <div
        className={`${styles.mobileAttributionSheet} ${
          open ? styles.mobileAttributionSheetOpen : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label="Kartinformation"
      >
        <button
          type="button"
          className={styles.mobileAttributionClose}
          onClick={onClose}
          aria-label="Stäng kartinformation"
        >
          <RoadOrXIcon expanded />
        </button>
        <div className={styles.mobileAttributionBody}>
          <p>
            Kartdata från{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>
            ,{" "}
            <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">
              OpenMapTiles
            </a>{" "}
            och{" "}
            <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
              OpenFreeMap
            </a>
            .
          </p>
        </div>
      </div>
    </>
  );
}

type ScaleStop = { color: string; label: string };

const RISK_SCALE: ScaleStop[] = [
  { color: "#FFF382", label: "Mycket låg" },
  { color: "#FFCC68", label: "Låg" },
  { color: "#FFA54E", label: "Måttlig" },
  { color: "#FF7D34", label: "Förhöjd" },
  { color: "#FF561A", label: "Hög" },
  { color: "#FF2F00", label: "Mycket hög" },
];

const FLOW_SCALE: ScaleStop[] = [
  { color: "#F2F8FF", label: "Mycket lågt" },
  { color: "#C2DEFF", label: "Lågt" },
  { color: "#91C4FF", label: "Måttligt" },
  { color: "#61ABFF", label: "Förhöjt" },
  { color: "#3091FF", label: "Högt" },
  { color: "#0077FF", label: "Mycket högt" },
];

const LARGE_ROADS_SCALE: ScaleStop[] = [
  { color: "#999999", label: "90" },
  { color: "#B8B8B8", label: "100" },
  { color: "#D6D6D6", label: "110" },
  { color: "#F2F2F2", label: "120" },
];

const DISTURBANCE_SCALE: ScaleStop[] = [
  { color: "#FFE36A", label: "Vägarbete" },
  { color: "#FF8A4A", label: "Kö/trafik" },
];

const TRAFFIC_FLOW_SCALE: ScaleStop[] = [
  { color: "#72F2D0", label: "Lugnt" },
  { color: "#9FD86B", label: "Rullar" },
  { color: "#FFD166", label: "Tätt" },
  { color: "#FF7A3D", label: "Långsamt" },
];

function LayerBox({
  label,
  colors,
  on,
  open,
  onToggleLayer,
  onToggleOpen,
  body,
  meta,
}: {
  label: string;
  colors: ScaleStop[];
  on: boolean;
  open: boolean;
  onToggleLayer: () => void;
  onToggleOpen: () => void;
  body: string;
  meta?: string;
}) {
  return (
    <div
      className={`${styles.layerBox} ${!on ? styles.layerBoxOff : ""}`}
      onClick={onToggleOpen}
      role="button"
      aria-expanded={open}
    >
      <div className={styles.layerBoxHeader}>
        <InfoIcon className={styles.layerBoxInfoIcon} />
        <span className={styles.layerBoxLabel}>{label}</span>
        <div className={styles.layerBoxFiller} />
        <div className={styles.layerScale} aria-hidden="true">
          {colors.map((s) => (
            <span key={s.color} title={s.label} style={{ background: s.color }} />
          ))}
        </div>
        <button
          type="button"
          className={styles.layerToggleHit}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLayer();
          }}
          aria-label={`Slå ${on ? "av" : "på"} ${label.toLowerCase()}-lagret`}
          aria-pressed={on}
        >
          <span className={styles.layerToggle}>
            <span className={styles.layerToggleKnob} />
          </span>
        </button>
      </div>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <p className={styles.layerBoxBody}>{body}</p>
          {meta && <div className={styles.layerBoxMeta}>{meta}</div>}
        </div>
      </div>
    </div>
  );
}

function InfoBox({
  open,
  onToggle,
  updatedText,
}: {
  open: boolean;
  onToggle: () => void;
  updatedText: string;
}) {
  // Kollapsad: hela boxen är klickbar och öppnar.
  // Öppen: bara X-ikonen stänger (klick på text/länkar i innehållet ska inte stänga).
  const handleBoxClick = open ? undefined : onToggle;
  return (
    <div
      className={`${styles.infoBox} ${open ? styles.infoBoxOpen : ""}`}
      onClick={handleBoxClick}
      role={open ? "dialog" : "button"}
      aria-expanded={open}
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
      <p className={styles.infoBoxIntro}>
        För dig som känner oro i trafiken och vill planera din resa med mer kontroll, lugn och tillit.
      </p>
      <p className={styles.infoBoxUpdated}>{updatedText}</p>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <div className={styles.infoBoxBody}>
            <p>
              Olyckor samlas från Trafikverket på en karta över hela Sverige – historiska som värmekarta, pågående som pulserande punkter. Vägarna färgas efter risk, så att de som är värst per resa lyser starkast, inte de mest trafikerade.
            </p>
            <p>
              Klicka på en väg eller olycka för detaljer, och filtrera på tidsfönster. Tanken är inte att förutsäga vad som händer härnäst, utan att synliggöra mönster — så att du kan välja vägen, tiden eller färdsättet som passar dig bäst.
            </p>
          </div>
          <div className={styles.infoBoxSources}>
            Datakällor:{" "}
            <a href="https://api.trafikinfo.trafikverket.se/" target="_blank" rel="noreferrer">
              Trafikverket Open API
            </a>{" "}
            (olyckor) · NVDB via{" "}
            <a href="https://lastkajen.trafikverket.se/" target="_blank" rel="noreferrer">
              Lastkajen
            </a>{" "}
            (ÅDT). Data är preliminär och bör inte användas som enda underlag för vägval.
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

function LiveBox({
  accidentCount,
  open,
  onToggle,
}: {
  accidentCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  const calm = accidentCount === 0;
  const label = calm
    ? "Inga rapporterade olyckor just nu"
    : `${accidentCount} ${accidentCount === 1 ? "pågående olycka" : "pågående olyckor"}`;
  return (
    <div
      className={`${styles.liveBox} ${calm ? styles.liveBoxCalm : ""}`}
      onClick={onToggle}
      role="button"
      aria-expanded={open}
    >
      <div className={styles.liveBoxHeader}>
        <InfoIcon />
        <span className={styles.liveBoxLabel}>{label}</span>
        {!calm && <span className={styles.liveDot} aria-hidden="true" />}
      </div>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <p className={styles.liveBoxBody}>
            Pågående olyckor är de som rapporterats till Trafikverket de senaste 90 minuterna. De markeras med pulserande vit punkt och uppdateras automatiskt.
          </p>
        </div>
      </div>
    </div>
  );
}

function InfoIcon({ className }: { className?: string } = {}) {
  return (
    <svg
      className={`${styles.infoIcon} ${className ?? ""}`}
      width="10"
      height="10"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8.5 4.5V9.3M8.5 10.9V12.5M16.5 8.5C16.5 12.9183 12.9183 16.5 8.5 16.5C4.08172 16.5 0.5 12.9183 0.5 8.5C0.5 4.08172 4.08172 0.5 8.5 0.5C12.9183 0.5 16.5 4.08172 16.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}

const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  all: "Alla olyckor",
  "7d": "Senaste 7 dagarna",
  "30d": "Senaste 30 dagarna",
  "6m": "Senaste 6 månaderna",
  "1y": "Senaste året",
};

function TimeBox({
  value,
  onChange,
  open,
  onToggleOpen,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
  open: boolean;
  onToggleOpen: () => void;
}) {
  // Hela boxen togglar expand vid klick. Höger-zonen (värde + pil) har
  // stopPropagation så att klick där öppnar native dropdown utan att också
  // expandera/kollapsa boxen — samma mönster som risk/flöde-toggleknappen.
  return (
    <div
      className={styles.timeBox}
      onClick={onToggleOpen}
      role="button"
      aria-expanded={open}
    >
      <div className={styles.timeBoxHeader}>
        <InfoIcon />
        <span className={styles.timeLabel}>Tidsfönster</span>
        <div
          className={styles.timeSelectGroup}
          onClick={(e) => e.stopPropagation()}
        >
          <span className={styles.timeSelectValue}>{TIME_WINDOW_LABELS[value]}</span>
          <DropdownIcon />
          <select
            className={styles.timeSelect}
            value={value}
            onChange={(e) => onChange(e.target.value as TimeWindow)}
            aria-label="Tidsfönster"
          >
            {(Object.entries(TIME_WINDOW_LABELS) as [TimeWindow, string][]).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <p className={styles.timeBoxBody}>
            Tidsfönstret styr vilka olyckor som visas på kartan — både i värmekartan och som enskilda punkter när du zoomar in. Risk-färgningen baseras alltid på all data oavsett val här.
          </p>
        </div>
      </div>
    </div>
  );
}

function DropdownIcon() {
  return (
    <svg
      className={styles.dropdownIcon}
      width="11"
      height="10"
      viewBox="0 0 11 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M0.353516 2L5.35352 7L10.3535 2"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function PlusIcon() {
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

function LocationIcon() {
  return (
    <svg
      className={styles.btnIcon}
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
