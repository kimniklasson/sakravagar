import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { GeocodeResult } from "@/app/api/geocode/route";
import type { RouteStop } from "../routeModel";

export function useRouteStopSearch({
  activeRouteStopId,
  routeStops,
}: {
  activeRouteStopId: string | null;
  routeStops: RouteStop[];
}): {
  geocodeResultsByStop: Record<string, GeocodeResult[]>;
  geocodingStopId: string | null;
  setGeocodeResultsByStop: Dispatch<SetStateAction<Record<string, GeocodeResult[]>>>;
} {
  const [geocodingStopId, setGeocodingStopId] = useState<string | null>(null);
  const [geocodeResultsByStop, setGeocodeResultsByStop] = useState<Record<string, GeocodeResult[]>>({});

  useEffect(() => {
    const activeStop = routeStops.find((stop) => stop.id === activeRouteStopId);
    if (!activeStop || activeStop.coordinates || activeStop.source === "gps") {
      setGeocodingStopId(null);
      return;
    }

    const query = activeStop.label.trim();
    if (query.length < 2) {
      setGeocodeResultsByStop((byStop) => ({ ...byStop, [activeStop.id]: [] }));
      setGeocodingStopId(null);
      return;
    }

    const controller = new AbortController();
    setGeocodingStopId(activeStop.id);
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: query,
        limit: "5",
        t: String(Date.now()),
      });
      void fetch(`/api/geocode?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          return res.json() as Promise<{ results: GeocodeResult[] }>;
        })
        .then(({ results }) => {
          if (results.length > 0) {
            setGeocodeResultsByStop((byStop) => ({ ...byStop, [activeStop.id]: results }));
          } else {
            setGeocodeResultsByStop((byStop) => {
              const previous = byStop[activeStop.id] ?? [];
              return previous.length > 0 ? byStop : { ...byStop, [activeStop.id]: [] };
            });
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn("geocode lookup failed", err);
        })
        .finally(() => {
          if (!controller.signal.aborted) setGeocodingStopId(null);
        });
    }, 260);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeRouteStopId, routeStops]);

  return { geocodeResultsByStop, geocodingStopId, setGeocodeResultsByStop };
}
