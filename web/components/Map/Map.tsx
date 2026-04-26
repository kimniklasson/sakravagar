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

export default function Map() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const adtCtrl = useRef<LayerController | null>(null);
  const tskCtrl = useRef<LayerController | null>(null);
  const riskCtrl = useRef<LayerController | null>(null);
  const [tskVisible, setTskVisible] = useState(true);
  const [riskVisible, setRiskVisible] = useState(true);
  const [adtVisible, setAdtVisible] = useState(true);

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
      void addEventsLayer(map);
      addPopupHandler(map);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => { tskCtrl.current?.setVisible(tskVisible); }, [tskVisible]);
  useEffect(() => { riskCtrl.current?.setVisible(riskVisible); }, [riskVisible]);
  useEffect(() => { adtCtrl.current?.setVisible(adtVisible); }, [adtVisible]);

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
    </>
  );
}
