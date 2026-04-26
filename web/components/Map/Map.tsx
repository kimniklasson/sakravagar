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
    </>
  );
}
