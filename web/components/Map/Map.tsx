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
  const adtCtrl = useRef<LayerController | null>(null);
  const riskCtrl = useRef<LayerController | null>(null);
  const [riskVisible, setRiskVisible] = useState(true);
  const [adtVisible, setAdtVisible] = useState(true);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [aboutOpen, setAboutOpen] = useState(false);
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
      // Render-ordning: Risk underst, ADT tunnare ovanpå,
      // events-heatmap/circles överst.
      riskCtrl.current = addRiskLayer(map);
      adtCtrl.current = addAdtLayer(map);
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

  useEffect(() => { riskCtrl.current?.setVisible(riskVisible); }, [riskVisible]);
  useEffect(() => { adtCtrl.current?.setVisible(adtVisible); }, [adtVisible]);

  // Re-fetcha events när tidsfönstret ändras. Skippa första rendret —
  // load-handlern ovan kör redan en fetch med initialt fönster.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    void addEventsLayer(map, { since: sinceFromWindow(timeWindow) }).then(({ liveCount }) =>
      setLiveCount(liveCount),
    );
  }, [timeWindow]);

  // Auto-refresh av events var 60:e sekund så pågående olyckor uppdateras
  // utan reload. Använder ref för timeWindow så intervallet alltid läser
  // senaste valet utan att behöva återskapas vid varje filter-ändring.
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

  // Stäng om-modalen med Escape.
  useEffect(() => {
    if (!aboutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aboutOpen]);

  return (
    <>
      <div ref={containerRef} className={styles.map} />
      <div className={styles.controls}>
        {liveCount > 0 && (
          <div
            className={styles.controlsLivePill}
            title="Olyckor som syns i Trafikverkets feed just nu (rapporterade senaste 90 min)"
          >
            <span className={styles.controlsLiveDot} aria-hidden="true" />
            <span>
              {liveCount} pågående {liveCount === 1 ? "olycka" : "olyckor"}
            </span>
          </div>
        )}
        <div className={styles.controlsTitle}>Lager</div>
        <label className={styles.controlsRow}>
          <input
            type="checkbox"
            checked={riskVisible}
            onChange={(e) => setRiskVisible(e.target.checked)}
          />
          <span>Risk (olyckor / M fordon)</span>
        </label>
        <label className={styles.controlsRow}>
          <input
            type="checkbox"
            checked={adtVisible}
            onChange={(e) => setAdtVisible(e.target.checked)}
          />
          <span>Trafikflöde (ÅDT)</span>
        </label>
        <div className={styles.controlsHint}>Zooma in (≥9) för att se lagren</div>
        <div className={styles.controlsDivider} />
        <div className={styles.controlsTitle}>Tidsfönster</div>
        <select
          className={styles.controlsSelect}
          value={timeWindow}
          onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
        >
          <option value="all">Alla olyckor</option>
          <option value="7d">Senaste 7 dagarna</option>
          <option value="30d">Senaste 30 dagarna</option>
          <option value="6m">Senaste 6 månaderna</option>
          <option value="1y">Senaste året</option>
        </select>
        <div className={styles.controlsDivider} />
        <button
          type="button"
          className={styles.controlsAboutLink}
          onClick={() => setAboutOpen(true)}
        >
          Om tjänsten
        </button>
      </div>
      {(riskVisible || adtVisible || liveCount > 0) && (
        <div className={styles.legend}>
          <div className={styles.legendTitle}>Förklaring</div>
          {liveCount > 0 && (
            <div className={styles.legendBlock}>
              <div className={styles.legendSubtitle}>Pågående olyckor</div>
              <div className={styles.legendItem}>
                <span className={styles.legendLiveDot} aria-hidden="true" />
                <span>Rapporterade just nu</span>
              </div>
              <div className={styles.legendNote}>Synliga vid alla zoom-nivåer</div>
            </div>
          )}
          {riskVisible && (
            <div className={styles.legendBlock}>
              <div className={styles.legendSubtitle}>Olyckor / M fordon</div>
              <div
                className={styles.legendGradient}
                style={{
                  background:
                    "linear-gradient(to right, #1a9850 0%, #a6d96a 40%, #fdae61 60%, #f46d43 80%, #d7191c 100%)",
                }}
              />
              <div className={styles.legendGradientLabels}>
                <span>låg</span>
                <span>hög</span>
              </div>
              <div className={styles.legendNote}>Preliminär — kalibreras när data mognat</div>
            </div>
          )}
          {adtVisible && (
            <div className={styles.legendBlock}>
              <div className={styles.legendSubtitle}>Trafikflöde (ÅDT)</div>
              <div
                className={styles.legendGradient}
                style={{
                  background:
                    "linear-gradient(to right, #2c7bb6 0%, #abd9e9 7.69%, #ffffbf 23.08%, #fdae61 48.72%, #d7191c 100%)",
                }}
              />
              <div className={styles.legendGradientLabels}>
                <span>500</span>
                <span>20 000+</span>
              </div>
              <div className={styles.legendNote}>fordon/dygn</div>
            </div>
          )}
        </div>
      )}
      {aboutOpen && (
        <div
          className={styles.aboutBackdrop}
          onClick={() => setAboutOpen(false)}
          role="presentation"
        >
          <div
            className={styles.aboutModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <button
              type="button"
              className={styles.aboutClose}
              onClick={() => setAboutOpen(false)}
              aria-label="Stäng"
            >
              ×
            </button>
            <h2 id="about-title" className={styles.aboutTitle}>Om Säkravägar.se</h2>
            <p>
              Karta över trafiksäkerhet i Sverige. Kombinerar Trafikverkets aktuella olyckor
              med vägdata från NVDB för att visa vilka sträckor som är säkrast respektive
              farligast att köra på.
            </p>
            <h3 className={styles.aboutSubtitle}>Lager</h3>
            <ul className={styles.aboutList}>
              <li><strong>Trafikflöde (ÅDT)</strong> — årsdygnstrafik per vägsegment, dvs. genomsnittligt antal fordon per dygn. Korta segment vid trafikplatser och avfarter saknar ibland mätning från Trafikverket och visas då som ofärgade glapp.</li>
              <li><strong>Risk</strong> — olyckor per miljon fordon. <em>Preliminär</em> — kalibreras när historiken växer.</li>
              <li><strong>Olyckor</strong> — pågående och nyligen rapporterade olyckor från Trafikverket. Pågående markeras med pulserande röd punkt och uppdateras var 60:e sekund i kartan.</li>
            </ul>
            <h3 className={styles.aboutSubtitle}>Tips</h3>
            <ul className={styles.aboutList}>
              <li>Klicka på en väg eller olyckspunkt för detaljer.</li>
              <li>Toggla av/på lager för att jämföra dem.</li>
              <li>Tidsfilter under lager-toggles begränsar vilka olyckor som visas.</li>
              <li>Zooma in till nivå 9 eller mer för att se vägfärgning.</li>
            </ul>
            <h3 className={styles.aboutSubtitle}>Datakällor</h3>
            <p className={styles.aboutMuted}>
              Trafikverket Open API (olyckor) · NVDB via Lastkajen (ÅDT).
              Data är preliminär och bör inte användas som enda underlag för vägval.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
