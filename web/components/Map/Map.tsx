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

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      addRiskLayer(map);
      addAdtLayer(map);
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
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      void addEventsLayer(map, { since: sinceFromWindow(timeWindowRef.current) }).then(
        ({ liveCount }) => setLiveCount(liveCount),
      );
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      <div className={styles.controls}>
        <InfoBox open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} />
        <LiveBox count={liveCount} open={liveOpen} onToggle={() => setLiveOpen((v) => !v)} />
        <TimeBox value={timeWindow} onChange={setTimeWindow} />
      </div>
    </>
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
        {calm ? (
          <>
            <InfoIcon />
            <span className={styles.liveBoxLabel}>Inga rapporterade olyckor just nu</span>
          </>
        ) : (
          <>
            <span className={styles.liveBoxLabel}>
              {count} pågående {count === 1 ? "olycka" : "olyckor"}
            </span>
            <span className={styles.liveDot} aria-hidden="true" />
          </>
        )}
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

function InfoIcon() {
  return (
    <svg
      className={styles.infoIcon}
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8 0.5C12.1421 0.5 15.5 3.85786 15.5 8C15.5 12.1421 12.1421 15.5 8 15.5C3.85786 15.5 0.5 12.1421 0.5 8C0.5 3.85786 3.85786 0.5 8 0.5ZM7.5 12H8.5V10.4004H7.5V12ZM7.5 8.7998H8.5V4H7.5V8.7998Z"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function TimeBox({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (v: TimeWindow) => void;
}) {
  return (
    <div className={styles.timeBox}>
      <span className={styles.timeLabel}>Tidsfönster</span>
      <div className={styles.timeSelectGroup}>
        <select
          className={styles.timeSelect}
          value={value}
          onChange={(e) => onChange(e.target.value as TimeWindow)}
          aria-label="Tidsfönster"
        >
          <option value="all">Alla olyckor</option>
          <option value="7d">Senaste 7 dagarna</option>
          <option value="30d">Senaste 30 dagarna</option>
          <option value="6m">Senaste 6 månaderna</option>
          <option value="1y">Senaste året</option>
        </select>
        <DropdownIcon />
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
