import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";

// Hämtar events från vår API-route och lägger till som en källa + lager på kartan.
// Visualiseringstyp är medvetet inte hårdkodad till "heatmap" — ändra `type: "circle"`
// nedan till "heatmap", "fill-extrusion" eller annat när datavolymen ger en bild av
// vilken representation som funkar. Källan (GeoJSON) är densamma för alla varianter.
export async function addEventsLayer(map: MapLibreMap): Promise<void> {
  const res = await fetch("/api/events");
  if (!res.ok) {
    console.error("failed to fetch events", await res.text());
    return;
  }
  const { points } = (await res.json()) as {
    points: {
      id: string;
      lng: number;
      lat: number;
      icon_id: string | null;
      road_number: string | null;
      last_seen: string;
    }[];
  };

  const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        icon_id: p.icon_id,
        road_number: p.road_number,
        last_seen: p.last_seen,
      },
    })),
  };

  const sourceId = "events";
  if (map.getSource(sourceId)) {
    (map.getSource(sourceId) as GeoJSONSource).setData(geojson);
    return;
  }

  map.addSource(sourceId, { type: "geojson", data: geojson });

  // Not: MapLibre-paint stödjer inte CSS custom properties — literal hex krävs.
  // Hålls synkad med --color-severity-high i tokens.css.
  map.addLayer({
    id: "events-circles",
    type: "circle",
    source: sourceId,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 10, 6, 14, 10],
      "circle-color": "#c0543a",
      "circle-opacity": 0.55,
      "circle-stroke-width": 0,
    },
  });
}
