import type { RouteAvoidOption, RouteAvoidState } from "@/lib/routeTypes";

export type RouteRequest = {
  coordinates?: unknown;
  alternatives?: unknown;
  avoid?: unknown;
  maxExtraMinutes?: unknown;
  preview?: unknown;
};

export const MIN_SWEDEN_LNG = 9;
export const MAX_SWEDEN_LNG = 25;
export const MIN_SWEDEN_LAT = 54;
export const MAX_SWEDEN_LAT = 70;

export const routeAvoidOptions = [
  "highSpeed",
  "trafficIntensity",
  "cityTraffic",
  "bridges",
  "tunnels",
  "largeRoundabouts",
  "multilane",
] as const;

export const noAvoids: RouteAvoidState = {
  highSpeed: false,
  trafficIntensity: false,
  cityTraffic: false,
  bridges: false,
  tunnels: false,
  largeRoundabouts: false,
  multilane: false,
};

export function isCoordinate(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lng, lat] = value;
  return (
    typeof lng === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= MIN_SWEDEN_LNG &&
    lng <= MAX_SWEDEN_LNG &&
    lat >= MIN_SWEDEN_LAT &&
    lat <= MAX_SWEDEN_LAT
  );
}

export function parseAvoidState(value: unknown): RouteAvoidState {
  if (!value || typeof value !== "object") return noAvoids;
  const input = value as Partial<Record<RouteAvoidOption, unknown>>;
  return {
    highSpeed: input.highSpeed === true,
    trafficIntensity: input.trafficIntensity === true,
    cityTraffic: input.cityTraffic === true,
    bridges: input.bridges === true,
    tunnels: input.tunnels === true,
    largeRoundabouts: input.largeRoundabouts === true,
    multilane: input.multilane === true,
  };
}

export function activeAvoidOptions(avoid: RouteAvoidState): RouteAvoidOption[] {
  return routeAvoidOptions.filter((option) => avoid[option]);
}

export function routeAvoidStateForOption(option: RouteAvoidOption): RouteAvoidState {
  return {
    ...noAvoids,
    [option]: true,
  };
}
