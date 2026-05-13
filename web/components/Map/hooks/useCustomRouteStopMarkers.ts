import { useEffect, useRef } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import {
  isCustomRouteStop,
  type ResolvedRouteStop,
  type RouteStop,
} from "../routeModel";

type MutableRef<T> = { current: T };

export function useCustomRouteStopMarkers({
  mapLoadedRef,
  mapRef,
  markerClassName,
  onClearStop,
  routeStops,
}: {
  mapLoadedRef: MutableRef<boolean>;
  mapRef: MutableRef<MapLibreMap | null>;
  markerClassName?: string;
  onClearStop: (id: string) => void;
  routeStops: RouteStop[];
}): void {
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const onClearStopRef = useRef(onClearStop);

  useEffect(() => {
    onClearStopRef.current = onClearStop;
  }, [onClearStop]);

  useEffect(() => {
    const map = mapRef.current;
    const customStops = routeStops.filter((stop): stop is ResolvedRouteStop => (
      isCustomRouteStop(stop) && stop.coordinates !== null
    ));

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (!map || !mapLoadedRef.current || !customStops.length) return;

    const markers = customStops.map((customStop) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = markerClassName ?? "";
      button.setAttribute("aria-label", "Ta bort via-punkt");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClearStopRef.current(customStop.id);
      });
      button.addEventListener("mousedown", (event) => event.stopPropagation());
      button.addEventListener("touchstart", (event) => event.stopPropagation());

      return new maplibregl.Marker({ element: button, anchor: "center" })
        .setLngLat(customStop.coordinates)
        .addTo(map);
    });

    markersRef.current = markers;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [mapLoadedRef, mapRef, markerClassName, routeStops]);
}
