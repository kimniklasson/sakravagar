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
  addTskLayer,
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
  const tskCtrl = useRef<LayerController | null>(null);
  const riskCtrl = useRef<LayerController | null>(null);
  const [tskVisible, setTskVisible] = useState(true);
  const [riskVisible, setRiskVisible] = useState(true);
  const [adtVisible, setAdtVisible] = useState(true);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: SWEDEN_CENTER,
      zoom: SWEDEN_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // Render-ordning: TSK underst, Risk i mitten, ADT tunnare ovanpå,
      // events-heatmap/circles överst.
      tskCtrl.current = addTskLayer(map);
      riskCtrl.current = addRiskLayer(map);
      adtCtrl.current = addAdtLayer(map);
      void addEventsLayer(map, { since: sinceFromWindow(timeWindow) });
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

  useEffect(() => { tskCtrl.current?.setVisible(tskVisible); }, [tskVisible]);
  useEffect(() => { riskCtrl.current?.setVisible(riskVisible); }, [riskVisible]);
  useEffect(() => { adtCtrl.current?.setVisible(adtVisible); }, [adtVisible]);

  // Re-fetcha events när tidsfönstret ändras. Skippa första rendret —
  // load-handlern ovan kör redan en fetch med initialt fönster.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    void addEventsLayer(map, { since: sinceFromWindow(timeWindow) });
  }, [timeWindow]);

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
        <div className={styles.controlsTitle}>Lager</div>
        <label className={styles.controlsRow}>
          <input
            type="checkbox"
            checked={tskVisible}
            onChange={(e) => setTskVisible(e.target.checked)}
          />
          <span>Säkerhetsklass (TSK)</span>
        </label>
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
      {(tskVisible || riskVisible || adtVisible) && (
        <div className={styles.legend}>
          <div className={styles.legendTitle}>Förklaring</div>
          {tskVisible && (
            <div className={styles.legendBlock}>
              <div className={styles.legendSubtitle}>Säkerhetsklass</div>
              <div className={styles.legendCategorical}>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatch} style={{ background: "#1a9850" }} />
                  <span>Mycket god</span>
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatch} style={{ background: "#a6d96a" }} />
                  <span>God</span>
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatch} style={{ background: "#fdae61" }} />
                  <span>Mindre god</span>
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.legendSwatch} style={{ background: "#d7191c" }} />
                  <span>Låg</span>
                </span>
              </div>
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
              <li><strong>Säkerhetsklass (TSK)</strong> — Trafikverkets klassning av vägars säkerhetsstandard (Mycket god → Låg).</li>
              <li><strong>Trafikflöde (ÅDT)</strong> — årsdygnstrafik per vägsegment, dvs. genomsnittligt antal fordon per dygn.</li>
              <li><strong>Risk</strong> — olyckor per miljon fordon. <em>Preliminär</em> — kalibreras när historiken växer.</li>
              <li><strong>Olyckor</strong> — pågående och nyligen rapporterade olyckor från Trafikverket. Uppdateras var 30:e minut.</li>
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
              Trafikverket Open API (olyckor) · NVDB via Lastkajen (ÅDT, TSK).
              Data är preliminär och bör inte användas som enda underlag för vägval.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
