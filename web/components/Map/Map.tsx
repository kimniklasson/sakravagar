"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./Map.module.css";
import {
  addAdtLayer,
  addEventsLayer,
  addPopupHandler,
  addRiskLayer,
  type LayerController,
} from "./layers";

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

export default function Map() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLoadedRef = useRef(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [infoOpen, setInfoOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [riskOn, setRiskOn] = useState(true);
  const [adtOn, setAdtOn] = useState(true);
  const [riskOpen, setRiskOpen] = useState(false);
  const [adtOpen, setAdtOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [atUserLocation, setAtUserLocation] = useState(false);
  const layerCtrlRef = useRef<{ risk?: LayerController; adt?: LayerController }>({});
  const timeWindowRef = useRef<TimeWindow>(timeWindow);
  useEffect(() => { timeWindowRef.current = timeWindow; }, [timeWindow]);

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
      layerCtrlRef.current.risk = addRiskLayer(map);
      layerCtrlRef.current.adt = addAdtLayer(map);
      void addEventsLayer(map, { since: sinceFromWindow(timeWindow) }).then(({ liveCount }) =>
        setLiveCount(liveCount),
      );
      addPopupHandler(map);
      mapLoadedRef.current = true;
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
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      void addEventsLayer(map, { since: sinceFromWindow(timeWindowRef.current) }).then(
        ({ liveCount }) => setLiveCount(liveCount),
      );
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();
  const handleLocate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
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
      <div className={styles.controls}>
        <InfoBox open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} />
        <LiveBox count={liveCount} open={liveOpen} onToggle={() => setLiveOpen((v) => !v)} />
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
      </div>
      <div className={styles.layerControls}>
        <LayerBox
          label="Risk"
          colors={RISK_SCALE}
          on={riskOn}
          open={riskOpen}
          onToggleLayer={() => setRiskOn((v) => !v)}
          onToggleOpen={() => setRiskOpen((v) => !v)}
          body="Risk-lagret färgar vägsegment efter olyckor per miljon fordon — så att de farligaste vägarna per resa lyser starkast, inte de mest trafikerade. Synligt vid inzoomning från stadsnivå och uppåt."
        />
        <LayerBox
          label="Flöde"
          colors={FLOW_SCALE}
          on={adtOn}
          open={adtOpen}
          onToggleLayer={() => setAdtOn((v) => !v)}
          onToggleOpen={() => setAdtOpen((v) => !v)}
          body="Flödes-lagret färgar vägsegment efter ÅDT (årsdygnstrafik) enligt NVDB — antalet fordon per dygn. Mörkare = mer trafik. Synligt vid inzoomning från stadsnivå och uppåt."
        />
      </div>
    </>
  );
}

type ScaleStop = { color: string; label: string };

const RISK_SCALE: ScaleStop[] = [
  { color: "#1a9850", label: "Mycket låg" },
  { color: "#66bd63", label: "Låg" },
  { color: "#a6d96a", label: "Måttlig" },
  { color: "#fdae61", label: "Förhöjd" },
  { color: "#f46d43", label: "Hög" },
  { color: "#d7191c", label: "Mycket hög" },
];

const FLOW_SCALE: ScaleStop[] = [
  { color: "#2c7bb6", label: "Mycket lågt" },
  { color: "#74add1", label: "Lågt" },
  { color: "#abd9e9", label: "Måttligt" },
  { color: "#fee090", label: "Förhöjt" },
  { color: "#fdae61", label: "Högt" },
  { color: "#d7191c", label: "Mycket högt" },
];

function LayerBox({
  label,
  colors,
  on,
  open,
  onToggleLayer,
  onToggleOpen,
  body,
}: {
  label: string;
  colors: ScaleStop[];
  on: boolean;
  open: boolean;
  onToggleLayer: () => void;
  onToggleOpen: () => void;
  body: string;
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
        </div>
      </div>
    </div>
  );
}

function InfoBox({ open, onToggle }: { open: boolean; onToggle: () => void }) {
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
        <span className={styles.infoBoxLogo}>Säkravägar.se</span>
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
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const calm = count === 0;
  return (
    <div
      className={`${styles.liveBox} ${calm ? styles.liveBoxCalm : ""}`}
      onClick={onToggle}
      role="button"
      aria-expanded={open}
    >
      <div className={styles.liveBoxHeader}>
        <InfoIcon />
        <span className={styles.liveBoxLabel}>
          {calm
            ? "Inga rapporterade olyckor just nu"
            : `${count} pågående ${count === 1 ? "olycka" : "olyckor"}`}
        </span>
        {!calm && <span className={styles.liveDot} aria-hidden="true" />}
      </div>
      <div className={`${styles.expander} ${open ? styles.expanderOpen : ""}`} aria-hidden={!open}>
        <div className={styles.expanderInner}>
          <p className={styles.liveBoxBody}>
            Pågående olyckor är de som rapporterats till Trafikverket de senaste 90 minuterna. De markeras med en röd, pulserande punkt på kartan och uppdateras automatiskt.
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
