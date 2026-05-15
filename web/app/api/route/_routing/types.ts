export type GraphHopperPathDetail = [number, number, string | number | null];

export type OsrmRoute = {
  source?: string;
  distance: number;
  duration: number;
  geometry: GeoJSON.LineString;
  roadEnvironmentDetails?: GraphHopperPathDetail[];
  maxSpeedDetails?: GraphHopperPathDetail[];
  roadClassDetails?: GraphHopperPathDetail[];
};

export type OsrmResponse = {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
};

export type GraphHopperPath = {
  distance: number;
  time: number;
  points: GeoJSON.LineString;
  details?: {
    road_environment?: GraphHopperPathDetail[];
    max_speed?: GraphHopperPathDetail[];
    road_class?: GraphHopperPathDetail[];
  };
};

export type GraphHopperResponse = {
  message?: string;
  paths?: GraphHopperPath[];
};

export type GraphHopperRule = {
  if: string;
  multiply_by: string;
};

export type GraphHopperAreaFeature = {
  type: "Feature";
  id: string;
  properties: Record<string, never>;
  geometry: GeoJSON.Polygon;
};

export type CityTrafficArea = {
  id: string;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type GraphHopperCustomModel = {
  priority?: GraphHopperRule[];
  areas?: {
    type: "FeatureCollection";
    features: GraphHopperAreaFeature[];
  };
};

export type RouteProvider = "graphhopper" | "osrm";

export type RouteFetchResult = {
  provider: RouteProvider;
  routes: OsrmRoute[];
  telemetry: import("./telemetry").RouteFetchTelemetry;
};

export type LargeRoadRow = {
  fid: number;
  speed_limit: number | null;
  length_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

export type AdtRow = {
  fid: number;
  adt_total: number | null;
  adt_tung?: number | null;
  matar?: number | null;
  geometry: GeoJSON.LineString;
};

export type TrafficFlowRow = {
  site_id: number;
  fid: number;
  vehicle_flow_rate: number | null;
  average_vehicle_speed: number | null;
  data_quality: string | null;
  measurement_time: string | null;
  last_seen: string;
  sample_count: number;
  snap_distance_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

export type DisturbanceRow = {
  id: string;
  lng: number;
  lat: number;
  icon_id?: string | null;
  message_type: string | null;
  road_number?: string | null;
  message?: string | null;
  severity?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
};

export type EventRow = {
  id: string;
  lng: number;
  lat: number;
  icon_id?: string | null;
  road_number?: string | null;
  message?: string | null;
  severity?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
};

export type Bbox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type TrafficIntensityRows = {
  adtRows: AdtRow[];
  trafficFlowRows: TrafficFlowRow[];
};

export type RouteLanePenaltyKind = "largeRoundabouts" | "multilane";

export type RouteLanePenaltyRow = {
  kind: RouteLanePenaltyKind;
  fid: number;
  element_id: string | null;
  lane_count: number | null;
  length_m: number | null;
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
};

export type RouteLanePenaltyRows = {
  largeRoundabouts: RouteLanePenaltyRow[];
  multilane: RouteLanePenaltyRow[];
  largeRoundaboutsAvailable: boolean;
  multilaneAvailable: boolean;
};

export type RouteRequestContext = {
  requestId?: string;
  trafficIntensityRowsCache: Map<string, Promise<TrafficIntensityRows>>;
  routeLanePenaltyRowsCache: Map<string, Promise<RouteLanePenaltyRows>>;
};
