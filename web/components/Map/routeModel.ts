import type { RouteLine } from "@/app/api/route/route";

export type RouteStopSource = "manual" | "gps";
export type RouteAvoidOption = "accidentHistory" | "highSpeed" | "trafficIntensity" | "disturbances" | "bridges" | "tunnels";
export type RouteAvoidState = Record<RouteAvoidOption, boolean>;
export type RouteTimeBudget = number | "unlimited";
export type RouteProvider = "graphhopper" | "osrm";

export type RouteStop = {
  id: string;
  label: string;
  coordinates: [number, number] | null;
  source: RouteStopSource;
};

export type ResolvedRouteStop = RouteStop & { coordinates: [number, number] };

export type RouteDragPlan = {
  stops: RouteStop[];
  coordinates: [number, number][];
  fallbackCoordinates: [number, number][];
};

export type RouteCacheEntry = {
  routes: RouteLine[];
  provider?: RouteProvider;
  createdAt: number;
};

type ScoredRouteCandidate = {
  index: number;
  route: RouteLine;
  comparable: boolean;
  withinBudget: boolean;
  score: number;
  optionCosts: Map<RouteAvoidOption, number>;
};

export type RouteAlternativeMetricRow = {
  kind: RouteAvoidOption;
  label: string;
  value: string;
  tone?: "positive" | "muted";
};

export type RouteAlternativeCopy = {
  title: string;
  rows: RouteAlternativeMetricRow[];
};

export const initialRouteStops: RouteStop[] = [
  { id: "from", label: "", coordinates: null, source: "manual" },
  { id: "to", label: "", coordinates: null, source: "manual" },
];

export const initialRouteAvoids: RouteAvoidState = {
  accidentHistory: false,
  highSpeed: false,
  trafficIntensity: false,
  disturbances: false,
  bridges: false,
  tunnels: false,
};

export const routeAvoidLabels: Record<RouteAvoidOption, string> = {
  highSpeed: "Höga hastigheter",
  trafficIntensity: "Trafikintensiva vägar",
  bridges: "Broar",
  tunnels: "Tunnlar",
  disturbances: "Störningar",
  accidentHistory: "Olycksrisk",
};

export const routeAvoidTooltips: Record<RouteAvoidOption, string> = {
  highSpeed: "90-120 km/h",
  trafficIntensity: "Vägar som brukar ha mycket trafik",
  bridges: "Alla brotyper",
  tunnels: "Alla tunnlar",
  disturbances: "Vägarbeten, köer m.m.",
  accidentHistory: "Historiska olyckor",
};

const routeMetricLabels: Record<RouteAvoidOption, string> = {
  highSpeed: "Höga hastigheter",
  trafficIntensity: "Trafikintensiva vägar",
  bridges: "Broar",
  tunnels: "Tunnlar",
  disturbances: "Störningar",
  accidentHistory: "Historisk olycksrisk",
};

export const activeRouteTimeBudget: RouteTimeBudget = "unlimited";

const routeAvoidOptionWeights: Record<RouteAvoidOption, number> = {
  highSpeed: 5,
  trafficIntensity: 4,
  bridges: 1.6,
  tunnels: 1.6,
  disturbances: 0.25,
  accidentHistory: 0.2,
};
const routeAvoidSortTieEpsilon = 0.005;
const routeExtraMinuteScoreDivisor = 240;
const routeDurationTieSeconds = 30;
const routeDistanceTieMeters = 50;
const routeHighSpeedAvoidedMeters = 50;
const routeHighSpeedNearAvoidedMeters = 6_000;
const routeCacheMaxEntries = 24;
const routeStaticCacheTtlMs = 60 * 60 * 1000;
const routeAccidentHistoryCacheTtlMs = 15 * 60 * 1000;
const routeTrafficIntensityCacheTtlMs = 5 * 60 * 1000;
const routeDisturbanceCacheTtlMs = 2 * 60 * 1000;
export const customRouteStopIdPrefix = "via-";

export function routeGeolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Platsåtkomst nekades. Tillåt platsdelning i webbläsaren och försök igen.";
    case error.POSITION_UNAVAILABLE:
      return "Kunde inte hämta din plats just nu.";
    case error.TIMEOUT:
      return "Det tog för lång tid att hämta din plats. Försök igen.";
    default:
      return "Kunde inte hämta din plats.";
  }
}

function normalizedRouteCoordinateKey([lng, lat]: [number, number]): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

function routeAvoidCacheKey(avoid: RouteAvoidState): string {
  return (Object.keys(initialRouteAvoids) as RouteAvoidOption[])
    .filter((option) => avoid[option])
    .sort()
    .join(",") || "none";
}

export function routeCacheKey({
  coordinates,
  alternatives,
  avoids,
  timeBudget,
}: {
  coordinates: [number, number][];
  alternatives: number;
  avoids: RouteAvoidState;
  timeBudget: RouteTimeBudget;
}): string {
  return [
    coordinates.map(normalizedRouteCoordinateKey).join("|"),
    `alt:${alternatives}`,
    `avoid:${routeAvoidCacheKey(avoids)}`,
    `budget:${timeBudget}`,
  ].join(";");
}

function routeCacheTtlMs(avoid: RouteAvoidState): number {
  if (avoid.disturbances) return routeDisturbanceCacheTtlMs;
  if (avoid.trafficIntensity) return routeTrafficIntensityCacheTtlMs;
  if (avoid.accidentHistory) return routeAccidentHistoryCacheTtlMs;
  return routeStaticCacheTtlMs;
}

export function isFreshRouteCacheEntry(entry: RouteCacheEntry, avoid: RouteAvoidState, nowMs = Date.now()): boolean {
  return nowMs - entry.createdAt <= routeCacheTtlMs(avoid);
}

export function rememberRouteCacheEntry(
  cache: Map<string, RouteCacheEntry>,
  key: string,
  entry: RouteCacheEntry,
) {
  cache.set(key, entry);
  if (cache.size <= routeCacheMaxEntries) return;

  const oldestKey = [...cache.entries()]
    .sort((a, b) => a[1].createdAt - b[1].createdAt)[0]?.[0];
  if (oldestKey) cache.delete(oldestKey);
}

export function isCustomRouteStop(stop: RouteStop): boolean {
  return stop.id.startsWith(customRouteStopIdPrefix);
}

export function dedupeRouteCoordinates(coordinates: [number, number][]): [number, number][] {
  return coordinates.filter((coord, index, list) => {
    const prev = list[index - 1];
    return !prev || prev[0] !== coord[0] || prev[1] !== coord[1];
  });
}

function coordinateDistanceSquared(a: [number, number], b: [number, number]): number {
  const lngScale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return ((a[0] - b[0]) * lngScale) ** 2 + (a[1] - b[1]) ** 2;
}

export function closestRouteCoordinateIndex(routeCoordinates: [number, number][], coordinate: [number, number]): number {
  if (!routeCoordinates.length) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < routeCoordinates.length; index += 1) {
    const routeCoordinate = routeCoordinates[index];
    if (!routeCoordinate) continue;
    const distance = coordinateDistanceSquared(routeCoordinate, coordinate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function activeAvoidCount(avoids: RouteAvoidState): number {
  return Object.values(avoids).filter(Boolean).length;
}

function routeScoreValue(route: RouteLine, option: RouteAvoidOption): number | null {
  const score = route.avoidScores?.[option] ?? null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function routeExtraMinutes(route: RouteLine, baseline: RouteLine): number {
  return Math.max(0, (route.durationSeconds - baseline.durationSeconds) / 60);
}

function isRouteWithinBudget(route: RouteLine, baseline: RouteLine, timeBudget: RouteTimeBudget): boolean {
  return timeBudget === "unlimited" || routeExtraMinutes(route, baseline) <= timeBudget;
}

function routeHighSpeedPriorityTier(route: RouteLine): number {
  const highSpeedMeters = routeCappedExposureValue(route, "highSpeed");
  if (highSpeedMeters === null) return 2;
  if (highSpeedMeters <= routeHighSpeedAvoidedMeters) return 0;
  if (highSpeedMeters <= routeHighSpeedNearAvoidedMeters) return 1;
  return 2;
}

export function selectRouteCandidates(
  candidates: RouteLine[],
  avoids: RouteAvoidState,
  timeBudget: RouteTimeBudget,
): {
  routes: RouteLine[];
  selectedIndex: number;
  active: boolean;
  hasComparableScores: boolean;
  hiddenByBudget: number;
} {
  if (!candidates.length) {
    return {
      routes: [],
      selectedIndex: -1,
      active: false,
      hasComparableScores: false,
      hiddenByBudget: 0,
    };
  }

  const activeOptions = (Object.entries(avoids) as [RouteAvoidOption, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([option]) => option);

  if (!activeOptions.length) {
    return {
      routes: candidates.slice(0, 1),
      selectedIndex: 0,
      active: false,
      hasComparableScores: false,
      hiddenByBudget: 0,
    };
  }

  const baseline = candidates[0];
  if (!baseline) {
    return {
      routes: candidates,
      selectedIndex: 0,
      active: true,
      hasComparableScores: false,
      hiddenByBudget: 0,
    };
  }

  const optionMax = new Map<RouteAvoidOption, number>();
  for (const option of activeOptions) {
    const max = Math.max(
      ...candidates.map((route) => routeScoreValue(route, option) ?? 0),
      1,
    );
    optionMax.set(option, max);
  }

  let hasComparableScores = false;
  const scored: ScoredRouteCandidate[] = candidates.map((route, index) => {
    let avoidCost = 0;
    let available = 0;
    let weightTotal = 0;
    const optionCosts = new Map<RouteAvoidOption, number>();

    for (const option of activeOptions) {
      const value = routeScoreValue(route, option);
      if (value === null) continue;
      available += 1;
      const weight = routeAvoidOptionWeights[option];
      const normalized = value / Math.max(1, optionMax.get(option) ?? 1);
      optionCosts.set(option, normalized);
      avoidCost += normalized * weight;
      weightTotal += weight;
    }

    if (available > 0) hasComparableScores = true;
    const weightedAvoidCost = weightTotal > 0 ? avoidCost / weightTotal : Number.POSITIVE_INFINITY;
    const withinBudget = isRouteWithinBudget(route, baseline, timeBudget);
    const extraTimeCost = routeExtraMinutes(route, baseline) / routeExtraMinuteScoreDivisor;
    return {
      index,
      route,
      comparable: available > 0,
      withinBudget,
      score: available > 0 && withinBudget ? weightedAvoidCost + extraTimeCost : Number.POSITIVE_INFINITY,
      optionCosts,
    };
  });

  const budgeted = scored.filter((item) => item.index === 0 || item.withinBudget);
  const hiddenByBudget = scored.length - budgeted.length;

  if (!hasComparableScores) {
    return {
      routes: budgeted.map((item) => item.route),
      selectedIndex: 0,
      active: true,
      hasComparableScores: false,
      hiddenByBudget,
    };
  }

  const dominantRoutes = budgeted.filter((candidate) => candidate.index === 0 || !budgeted.some((other) => {
    if (other.index === candidate.index) return false;
    if (!other.comparable || !candidate.comparable) return false;
    if (!other.withinBudget || !candidate.withinBudget) return false;
    if (avoids.highSpeed) {
      const candidateHighSpeedTier = routeHighSpeedPriorityTier(candidate.route);
      const otherHighSpeedTier = routeHighSpeedPriorityTier(other.route);
      if (otherHighSpeedTier > candidateHighSpeedTier) return false;
      if (candidateHighSpeedTier <= 1 && otherHighSpeedTier <= 1) return false;
    }
    if (other.route.durationSeconds > candidate.route.durationSeconds + routeDurationTieSeconds) return false;

    let betterAvoidMatch = false;
    for (const option of activeOptions) {
      const otherCost = other.optionCosts.get(option);
      const candidateCost = candidate.optionCosts.get(option);
      if (otherCost === undefined || candidateCost === undefined) return false;
      if (otherCost > candidateCost + routeAvoidSortTieEpsilon) return false;
      if (otherCost + routeAvoidSortTieEpsilon < candidateCost) betterAvoidMatch = true;
    }

    return betterAvoidMatch;
  }));

  dominantRoutes.sort((a, b) => {
    if (avoids.highSpeed) {
      const highSpeedTierA = routeHighSpeedPriorityTier(a.route);
      const highSpeedTierB = routeHighSpeedPriorityTier(b.route);
      if (highSpeedTierA !== highSpeedTierB) return highSpeedTierA - highSpeedTierB;
    }
    if (Math.abs(a.score - b.score) > routeAvoidSortTieEpsilon) return a.score - b.score;
    if (Math.abs(a.route.durationSeconds - b.route.durationSeconds) > routeDurationTieSeconds) {
      return a.route.durationSeconds - b.route.durationSeconds;
    }
    if (Math.abs(a.route.distanceMeters - b.route.distanceMeters) > routeDistanceTieMeters) {
      return a.route.distanceMeters - b.route.distanceMeters;
    }
    return a.index - b.index;
  });

  const selected = dominantRoutes[0];
  if (!selected || !selected.comparable || !selected.withinBudget) {
    return {
      routes: dominantRoutes.map((item) => item.route),
      selectedIndex: 0,
      active: true,
      hasComparableScores,
      hiddenByBudget,
    };
  }

  const rest = dominantRoutes
    .filter((item) => item.index !== selected.index)
    .map((item) => item.route);
  return {
    routes: [selected.route, ...rest],
    selectedIndex: selected.index,
    active: true,
    hasComparableScores,
    hiddenByBudget,
  };
}

function routeExposureValue(route: RouteLine, option: RouteAvoidOption): number | null {
  if (option === "highSpeed") return route.exposure?.highSpeedMeters ?? null;
  if (option === "trafficIntensity") return route.exposure?.trafficIntensityMeters ?? null;
  if (option === "bridges") return route.exposure?.bridgeMeters ?? null;
  if (option === "tunnels") return route.exposure?.tunnelMeters ?? null;
  return route.exposure?.[option] ?? null;
}

function routeCappedExposureValue(route: RouteLine, option: RouteAvoidOption): number | null {
  const value = routeExposureValue(route, option);
  if (value === null) return null;
  if (option === "highSpeed" || option === "trafficIntensity" || option === "bridges" || option === "tunnels") {
    return Math.min(Math.max(0, value), route.distanceMeters);
  }
  return Math.max(0, value);
}

function activeAvoidOptionsForUi(avoids: RouteAvoidState): RouteAvoidOption[] {
  return (Object.keys(routeAvoidLabels) as RouteAvoidOption[]).filter((option) => avoids[option]);
}

function formatRouteExposureDistance(meters: number): string {
  if (meters < 10) return `${Math.max(1, Math.round(meters))} m`;
  return formatRouteDistance(meters);
}

function routeAccidentRiskValue(route: RouteLine, baseline: RouteLine): RouteAlternativeMetricRow {
  const baseRow = { kind: "accidentHistory" as const, label: routeMetricLabels.accidentHistory };
  const eventCount = route.exposure?.accidentHistoryEvents;
  if (eventCount !== null && eventCount !== undefined && eventCount <= 2) {
    return { ...baseRow, value: "Data ofullständig", tone: "muted" };
  }

  const current = routeScoreValue(route, "accidentHistory");
  if (current === null) {
    return { ...baseRow, value: "Saknas", tone: "muted" };
  }
  if (current <= 0) {
    return { ...baseRow, value: "Inga i data", tone: "muted" };
  }

  const base = routeScoreValue(baseline, "accidentHistory");
  if (base === null || base <= 0) {
    return { ...baseRow, value: "Medel" };
  }

  const ratio = current / base;
  if (ratio <= 0.25) return { ...baseRow, value: "Väldigt låg" };
  if (ratio <= 0.6) return { ...baseRow, value: "Låg" };
  return { ...baseRow, value: "Medel" };
}

function routeAlternativeMetricRow(
  route: RouteLine,
  baseline: RouteLine,
  option: RouteAvoidOption,
): RouteAlternativeMetricRow {
  if (option === "accidentHistory") return routeAccidentRiskValue(route, baseline);

  const current = routeCappedExposureValue(route, option);
  const baseRow = { kind: option, label: routeMetricLabels[option] };
  if (current === null) return { ...baseRow, value: "Saknas", tone: "muted" };
  if (current <= 0) return { ...baseRow, value: "Undviker", tone: "positive" };

  if (option === "disturbances") {
    return { ...baseRow, value: `${Math.round(current)} st` };
  }

  if (option === "trafficIntensity") {
    const score = routeScoreValue(route, "trafficIntensity");
    if (current <= 50 || (score !== null && score < 0.08)) {
      return { ...baseRow, value: "Undviker", tone: "positive" };
    }
    if (score === null) return { ...baseRow, value: formatRouteExposureDistance(current) };
    if (score >= 0.58) return { ...baseRow, value: "Hög" };
    if (score >= 0.32) return { ...baseRow, value: "Måttlig" };
    return { ...baseRow, value: "Låg" };
  }

  return { ...baseRow, value: formatRouteExposureDistance(current) };
}

function routeAlternativeRows(
  route: RouteLine,
  baseline: RouteLine,
  avoids: RouteAvoidState,
): RouteAlternativeMetricRow[] {
  return activeAvoidOptionsForUi(avoids).map((option) => routeAlternativeMetricRow(route, baseline, option));
}

function routeAvoidedMetricCount(route: RouteLine, baseline: RouteLine, avoids: RouteAvoidState): number {
  return routeAlternativeRows(route, baseline, avoids).filter((row) => row.tone === "positive").length;
}

function routeIsBestForOption(route: RouteLine, routes: RouteLine[], option: RouteAvoidOption): boolean {
  const current = option === "accidentHistory" || option === "trafficIntensity"
    ? routeScoreValue(route, option)
    : routeCappedExposureValue(route, option);
  if (current === null) return false;

  const values = routes
    .map((candidate) => (
      option === "accidentHistory" || option === "trafficIntensity"
        ? routeScoreValue(candidate, option)
        : routeCappedExposureValue(candidate, option)
    ))
    .filter((value): value is number => value !== null);
  if (!values.length) return false;
  return current <= Math.min(...values) + 0.001;
}

function routeImprovesOption(route: RouteLine, baseline: RouteLine, option: RouteAvoidOption): boolean {
  const current = option === "accidentHistory" || option === "trafficIntensity"
    ? routeScoreValue(route, option)
    : routeCappedExposureValue(route, option);
  const base = option === "accidentHistory" || option === "trafficIntensity"
    ? routeScoreValue(baseline, option)
    : routeCappedExposureValue(baseline, option);
  if (current === null || base === null) return false;
  if (option === "disturbances") return current < base;
  if (option === "accidentHistory") return base - current > 0.05;
  if (option === "trafficIntensity") return base - current > 0.025;
  return base - current > 25;
}

function routeIsFastest(route: RouteLine, baseline: RouteLine): boolean {
  return route.id === baseline.id || route.source === "fastest" || route.durationSeconds <= baseline.durationSeconds + 30;
}

function routeAlternativeTitle(
  route: RouteLine,
  index: number,
  baseline: RouteLine,
  avoids: RouteAvoidState,
  routes: RouteLine[],
  isCustomRoute: boolean,
): string {
  if (isCustomRoute) return "Egen väg";

  const activeOptions = activeAvoidOptionsForUi(avoids);
  if (!activeOptions.length || routeIsFastest(route, baseline)) return "Snabbaste";

  const shortestDistance = Math.min(...routes.map((candidate) => candidate.distanceMeters));
  if (route.distanceMeters <= shortestDistance + 50) return "Kortast";

  const avoidedCount = routeAvoidedMetricCount(route, baseline, avoids);
  if (activeOptions.length > 1 && avoidedCount >= Math.max(2, activeOptions.length - 1)) {
    return "Mest lugn";
  }

  if (avoids.highSpeed && routeIsBestForOption(route, routes, "highSpeed") && routeImprovesOption(route, baseline, "highSpeed")) {
    return "Lägre hastigheter";
  }

  if (avoids.trafficIntensity && routeIsBestForOption(route, routes, "trafficIntensity") && routeImprovesOption(route, baseline, "trafficIntensity")) {
    return routeCappedExposureValue(route, "trafficIntensity") === 0 ? "Mindre trafik" : "Lugnare trafik";
  }

  if (avoids.disturbances && routeIsBestForOption(route, routes, "disturbances") && routeImprovesOption(route, baseline, "disturbances")) {
    return "Färre störningar";
  }

  if (avoids.bridges && routeIsBestForOption(route, routes, "bridges") && routeImprovesOption(route, baseline, "bridges")) {
    return routeCappedExposureValue(route, "bridges") === 0 ? "Utan broar" : "Färre broar";
  }

  if (avoids.tunnels && routeIsBestForOption(route, routes, "tunnels") && routeImprovesOption(route, baseline, "tunnels")) {
    return routeCappedExposureValue(route, "tunnels") === 0 ? "Utan tunnlar" : "Färre tunnlar";
  }

  if (avoids.accidentHistory && routeIsBestForOption(route, routes, "accidentHistory") && routeImprovesOption(route, baseline, "accidentHistory")) {
    return "Lägre olycksrisk";
  }

  if (routeExtraMinutes(route, baseline) <= 10 && activeOptions.length > 1) return "Balanserad";
  return index === 1 ? "Alternativ rutt" : "Mindre intensiv";
}

export function routeAlternativeCopy(
  route: RouteLine,
  index: number,
  baseline: RouteLine | null,
  avoids: RouteAvoidState,
  routes: RouteLine[],
  isCustomRoute: boolean,
): RouteAlternativeCopy {
  const fallbackBaseline = baseline ?? route;
  return {
    title: routeAlternativeTitle(route, index, fallbackBaseline, avoids, routes, isCustomRoute),
    rows: routeAlternativeRows(route, fallbackBaseline, avoids),
  };
}

export function formatRouteDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace(".", ",")} km`;
}

export function formatRouteDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}
