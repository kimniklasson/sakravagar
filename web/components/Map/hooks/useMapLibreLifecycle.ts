import { useEffect, useRef, type RefObject } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { RouteLine } from "@/lib/routeTypes";
import type { RouteAvoidState } from "../routeModel";
import {
  addAdtLayer,
  addDisturbancesLayer,
  addEventsLayer,
  addRouteLayer,
  addLargeRoadsLayer,
  addTrafficFlowLayer,
  addPopupHandler,
  focusRoute,
  refreshDisturbancesLayer,
  refreshTrafficFlowLayer,
  setEventsLayerVisible,
  setRouteLayerData,
  type LayerController,
} from "../layers";

const SWEDEN_CENTER: [number, number] = [16.5, 62.5];
const SWEDEN_ZOOM = 4.2;

type MutableRef<T> = { current: T };
type LayerControllers = {
  adt?: LayerController;
  disturbances?: LayerController;
  trafficFlow?: LayerController;
  largeRoads?: LayerController;
};

export function useMapLibreLifecycle({
  accidentsOn,
  containerRef,
  disturbancesOn,
  largeRoadsOn,
  mapLoadedRef,
  mapRef,
  refreshLiveCount,
  routeAvoidsRef,
  routeLinesRef,
  selectedRouteIdRef,
  selectRouteById,
  setAtUserLocation,
  trafficOn,
}: {
  accidentsOn: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  disturbancesOn: boolean;
  largeRoadsOn: boolean;
  mapLoadedRef: MutableRef<boolean>;
  mapRef: MutableRef<MapLibreMap | null>;
  refreshLiveCount: () => Promise<void>;
  routeAvoidsRef: MutableRef<RouteAvoidState>;
  routeLinesRef: MutableRef<RouteLine[]>;
  selectedRouteIdRef: MutableRef<string | null>;
  selectRouteById: (routeId: string) => void;
  setAtUserLocation: (value: boolean) => void;
  trafficOn: boolean;
}): void {
  const layerCtrlRef = useRef<LayerControllers>({});
  const accidentsOnRef = useRef(accidentsOn);
  const disturbancesOnRef = useRef(disturbancesOn);
  const largeRoadsOnRef = useRef(largeRoadsOn);
  const trafficOnRef = useRef(trafficOn);

  useEffect(() => { accidentsOnRef.current = accidentsOn; }, [accidentsOn]);
  useEffect(() => { disturbancesOnRef.current = disturbancesOn; }, [disturbancesOn]);
  useEffect(() => { largeRoadsOnRef.current = largeRoadsOn; }, [largeRoadsOn]);
  useEffect(() => { trafficOnRef.current = trafficOn; }, [trafficOn]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "/styles/sakravagar_dark.json",
      center: SWEDEN_CENTER,
      zoom: SWEDEN_ZOOM,
      attributionControl: { compact: false },
    });

    // dragend räcker som "användar-pan"-signal - zoom (knappar/scroll/pinch)
    // ändrar inte centrum så locate-state ska inte växla av av zoom.
    map.on("dragend", () => setAtUserLocation(false));
    map.on("moveend", () => {
      if (!mapLoadedRef.current) return;
      void addEventsLayer(map);
    });

    map.on("load", () => {
      layerCtrlRef.current.largeRoads = addLargeRoadsLayer(map);
      layerCtrlRef.current.adt = addAdtLayer(map);
      layerCtrlRef.current.adt.setVisible(trafficOnRef.current);
      layerCtrlRef.current.largeRoads.setVisible(largeRoadsOnRef.current);
      void addEventsLayer(map)
        .then(() => {
          void refreshLiveCount();
          setEventsLayerVisible(map, accidentsOnRef.current);
          layerCtrlRef.current.disturbances = addDisturbancesLayer(map);
          layerCtrlRef.current.disturbances.setVisible(disturbancesOnRef.current);
          layerCtrlRef.current.trafficFlow = addTrafficFlowLayer(map);
          layerCtrlRef.current.trafficFlow.setVisible(trafficOnRef.current);
          addRouteLayer(map, selectRouteById);
          if (routeLinesRef.current.length > 0) {
            setRouteLayerData(
              map,
              routeLinesRef.current,
              selectedRouteIdRef.current,
              routeAvoidsRef.current,
            );
            focusRoute(map, routeLinesRef.current);
          }
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
  }, [
    containerRef,
    mapLoadedRef,
    mapRef,
    refreshLiveCount,
    routeAvoidsRef,
    routeLinesRef,
    selectRouteById,
    selectedRouteIdRef,
    setAtUserLocation,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapLoadedRef.current) setEventsLayerVisible(map, accidentsOn);
  }, [accidentsOn, mapLoadedRef, mapRef]);

  useEffect(() => {
    layerCtrlRef.current.adt?.setVisible(trafficOn);
    layerCtrlRef.current.trafficFlow?.setVisible(trafficOn);
  }, [trafficOn]);

  useEffect(() => {
    layerCtrlRef.current.disturbances?.setVisible(disturbancesOn);
  }, [disturbancesOn]);

  useEffect(() => {
    layerCtrlRef.current.largeRoads?.setVisible(largeRoadsOn);
  }, [largeRoadsOn]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || !mapLoadedRef.current) return;
      void addEventsLayer(map, { force: true });
      void refreshDisturbancesLayer(map);
      void refreshTrafficFlowLayer(map);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [mapLoadedRef, mapRef]);
}
