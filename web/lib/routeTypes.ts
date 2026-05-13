import type { DisturbanceCategory } from "@trafik/shared";

export type RouteAnnotationSegmentKind = "highSpeed" | "trafficIntensity" | "cityTraffic" | "bridges" | "tunnels";
export type RouteAnnotationPointKind = "disturbances" | "liveAccidents";

export type RouteAnnotationSegment = {
  kind: RouteAnnotationSegmentKind;
  geometry: GeoJSON.LineString;
};

export type RouteAnnotationPoint = {
  kind: RouteAnnotationPointKind;
  coordinates: [number, number];
  category?: DisturbanceCategory;
};

export type RouteAnnotations = {
  highSpeed: RouteAnnotationSegment[];
  trafficIntensity: RouteAnnotationSegment[];
  cityTraffic: RouteAnnotationSegment[];
  bridges: RouteAnnotationSegment[];
  tunnels: RouteAnnotationSegment[];
  disturbances: RouteAnnotationPoint[];
  liveAccidents: RouteAnnotationPoint[];
};

export type RouteLine = {
  id: string;
  source: string;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
  safetyScore: number | null;
  avoidScores: {
    highSpeed: number | null;
    trafficIntensity: number | null;
    cityTraffic: number | null;
    bridges: number | null;
    tunnels: number | null;
  };
  exposure: {
    highSpeedMeters: number | null;
    trafficIntensityMeters: number | null;
    cityTrafficMeters: number | null;
    disturbances: number | null;
    liveAccidents: number | null;
    bridgeMeters: number | null;
    tunnelMeters: number | null;
  };
  annotations: RouteAnnotations;
};

export type RouteAvoidOption = keyof RouteLine["avoidScores"];
export type RouteAvoidState = Record<RouteAvoidOption, boolean>;
