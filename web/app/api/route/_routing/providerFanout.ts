import { routeAvoidStateForOption } from "./request";
import {
  countRejectedTimeouts,
  emptyRouteFetchTelemetry,
} from "./telemetry";
import type {
  OsrmRoute,
  RouteFetchResult,
  RouteRequestContext,
} from "./types";
import type { RouteAvoidState } from "@/lib/routeTypes";
import {
  activeAvoidOptions,
} from "./request";
import { logApiWarning } from "../../_utils";
import {
  avoidBridgeCustomModel,
  avoidTunnelCustomModel,
  balancedCalmRouteCustomModel,
  calmRouteCustomModel,
  mergeCustomModels,
} from "./customModels";
import {
  fetchGraphHopperRoute,
  fetchOsrmRoutes,
  GRAPHHOPPER_ROUTE_TIMEOUT_MS,
  hasGraphHopperConfig,
} from "./providers";
import { dedupeRoutes, dedupeRoutesForPresentation } from "./dedupe";
import { buildHybridRoutes } from "./hybrid";
import {
  compareFastestRoutes,
  compareHighSpeedAvoidanceRoutes,
  ROUTE_HIGH_SPEED_CALM_WINDOW_METERS,
  routeHighSpeedExposureForSelection,
  selectHighSpeedRoutesForReturn,
  selectHighSpeedViaPoints,
} from "./highSpeedSelection";
import { buildRoutePreferenceCustomModel } from "./scoring";

const GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS = 7_000;
const GRAPHHOPPER_TRAFFIC_INTENSITY_TIMEOUT_MS = 9_000;

export function createRouteRequestContext(requestId?: string): RouteRequestContext {
  return {
    requestId,
    trafficIntensityRowsCache: new Map(),
    routeLanePenaltyRowsCache: new Map(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function routeExtraMinutes(route: OsrmRoute, baseline: OsrmRoute): number {
  return Math.max(0, (route.duration - baseline.duration) / 60);
}

function isRouteWithinMaxExtra(
  route: OsrmRoute,
  baseline: OsrmRoute,
  maxExtraMinutes: number | null,
): boolean {
  return maxExtraMinutes === null || routeExtraMinutes(route, baseline) <= maxExtraMinutes;
}

export function graphHopperMaxWeightFactor(
  baseline: OsrmRoute,
  maxExtraMinutes: number | null,
): number {
  if (maxExtraMinutes === null) return 4.0;
  const baselineMinutes = Math.max(10, baseline.duration / 60);
  return clamp(1 + (maxExtraMinutes / baselineMinutes) * 1.6, 1.15, 2.8);
}

export async function fetchProviderRoutes(
  coordinates: [number, number][],
  alternatives: number,
  avoid: RouteAvoidState,
  maxExtraMinutes: number | null,
  context?: RouteRequestContext,
): Promise<RouteFetchResult> {
  const activeOptions = activeAvoidOptions(avoid);
  if (!hasGraphHopperConfig()) {
    const routes = await fetchOsrmRoutes(coordinates, activeOptions.length > 0 ? alternatives : 0);
    return {
      provider: "osrm",
      routes,
      telemetry: emptyRouteFetchTelemetry(true, {
        providerRequestCount: 1,
        providerRouteCount: routes.length,
        routeCountBeforeBudget: routes.length,
        budgetedRouteCount: routes.length,
        returnedRouteCount: routes.length,
      }),
    };
  }

  let fastestRoutes: OsrmRoute[];
  try {
    fastestRoutes = await fetchGraphHopperRoute(coordinates, {
      source: "fastest",
      includeCityTrafficDetails: avoid.cityTraffic,
    });
  } catch (err) {
    if (!avoid.cityTraffic) throw err;
    logApiWarning("graphhopper city traffic details unavailable for fastest route", err, {
      requestId: context?.requestId,
    });
    fastestRoutes = await fetchGraphHopperRoute(coordinates, { source: "fastest" });
  }
  const baseline = fastestRoutes[0];
  if (!baseline) {
    return {
      provider: "graphhopper",
      routes: fastestRoutes,
      telemetry: emptyRouteFetchTelemetry(false, {
        providerRequestCount: 1,
        graphHopperRequestCount: 1,
        graphHopperFulfilledCount: 1,
        providerRouteCount: fastestRoutes.length,
        routeCountBeforeBudget: fastestRoutes.length,
        budgetedRouteCount: fastestRoutes.length,
        returnedRouteCount: fastestRoutes.length,
      }),
    };
  }
  const maxWeightFactor = graphHopperMaxWeightFactor(baseline, maxExtraMinutes);
  if (activeOptions.length === 0) {
    const noFilterRequests = alternatives > 0
      ? [
          fetchGraphHopperRoute(coordinates, {
            source: "fastest-alternatives",
            alternativeRoutes: Math.max(3, alternatives + 2),
            maxWeightFactor: Math.max(1.8, maxWeightFactor),
          }),
        ]
      : [];
    const noFilterResults = await Promise.allSettled(noFilterRequests);
    const noFilterRoutes = dedupeRoutes([
      ...fastestRoutes,
      ...noFilterResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ]).sort((a, b) => {
      if (a.duration !== b.duration) return a.duration - b.duration;
      return a.distance - b.distance;
    });

    return {
      provider: "graphhopper",
      routes: noFilterRoutes.slice(0, 1),
      telemetry: emptyRouteFetchTelemetry(false, {
        providerRequestCount: 1 + noFilterRequests.length,
        graphHopperRequestCount: 1 + noFilterRequests.length,
        graphHopperFulfilledCount: 1 + noFilterResults.filter((result) => result.status === "fulfilled").length,
        graphHopperRejectedCount: noFilterResults.filter((result) => result.status === "rejected").length,
        graphHopperTimeoutCount: countRejectedTimeouts(noFilterResults),
        genericRequestCount: noFilterRequests.length,
        providerRouteCount: noFilterRoutes.length,
        routeCountBeforeBudget: noFilterRoutes.length,
        budgetedRouteCount: noFilterRoutes.length,
        returnedRouteCount: Math.min(1, noFilterRoutes.length),
      }),
    };
  }

  const trafficIntensityActive = avoid.trafficIntensity;
  const includeCityTrafficDetails = avoid.cityTraffic;
  const highSpeedOnly =
    avoid.highSpeed &&
    !avoid.trafficIntensity &&
    !avoid.cityTraffic &&
    !avoid.bridges &&
    !avoid.tunnels &&
    !avoid.largeRoundabouts &&
    !avoid.multilane;
  const longHighSpeedSearch = avoid.highSpeed && baseline.distance >= 60_000;
  const pathCount = trafficIntensityActive
    ? Math.max(2, Math.min(3, alternatives + 1))
    : maxExtraMinutes === null
      ? Math.max(4, alternatives + (highSpeedOnly ? 2 : 4))
      : alternatives + 1;
  const alternativeMaxWeightFactor = trafficIntensityActive
    ? Math.min(maxWeightFactor, 1.9)
    : maxWeightFactor;
  const genericAlternativeRequests: Array<Promise<OsrmRoute[]>> = [];

  genericAlternativeRequests.push(
    fetchGraphHopperRoute(coordinates, {
      source: "fastest-alternatives",
      includeCityTrafficDetails,
      alternativeRoutes: pathCount,
      maxWeightFactor: alternativeMaxWeightFactor,
      timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
    }),
  );

  const skipCombinedTrafficPreference =
    avoid.highSpeed &&
    avoid.trafficIntensity &&
    !avoid.cityTraffic &&
    !avoid.bridges &&
    !avoid.tunnels &&
    !avoid.largeRoundabouts &&
    !avoid.multilane;

  const preferenceModel = activeOptions.length > 0 && !skipCombinedTrafficPreference
    ? await buildRoutePreferenceCustomModel(fastestRoutes, avoid, context)
    : undefined;
  const preferenceRequests: Array<Promise<OsrmRoute[]>> = [];

  if (preferenceModel) {
    const source = [
      avoid.highSpeed ? "high-speed" : null,
      avoid.trafficIntensity ? "traffic-intensity" : null,
      avoid.cityTraffic ? "city-traffic" : null,
      avoid.bridges ? "bridges" : null,
      avoid.tunnels ? "tunnels" : null,
      avoid.largeRoundabouts ? "large-roundabouts" : null,
      avoid.multilane ? "multilane" : null,
    ].filter(Boolean).join("-");

    preferenceRequests.push(
      fetchGraphHopperRoute(coordinates, {
        source: `avoid-${source}`,
        customModel: preferenceModel,
        includeCityTrafficDetails: avoid.cityTraffic,
        timeoutMs: avoid.trafficIntensity ? GRAPHHOPPER_TRAFFIC_INTENSITY_TIMEOUT_MS : undefined,
      }),
    );

    if (!avoid.trafficIntensity) {
      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: `avoid-${source}-alternatives`,
          customModel: preferenceModel,
          includeCityTrafficDetails: avoid.cityTraffic,
          alternativeRoutes: highSpeedOnly ? Math.max(5, alternatives + 3) : pathCount,
          maxWeightFactor: highSpeedOnly
            ? Math.max(alternativeMaxWeightFactor, 2.8)
            : alternativeMaxWeightFactor,
          maxShareFactor: highSpeedOnly ? 0.65 : undefined,
          timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
        }),
      );
    }
  }

  if (longHighSpeedSearch && !highSpeedOnly) {
    preferenceRequests.push(
      fetchGraphHopperRoute(coordinates, {
        source: "avoid-high-speed-backbone-alternatives",
        customModel: calmRouteCustomModel,
        includeCityTrafficDetails,
        alternativeRoutes: Math.max(5, alternatives + 3),
        maxWeightFactor: Math.max(alternativeMaxWeightFactor, 2.8),
        maxShareFactor: 0.65,
        timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
      }),
    );
  }

  if (avoid.highSpeed) {
    const balancedModel = mergeCustomModels(
      balancedCalmRouteCustomModel,
      avoid.bridges ? avoidBridgeCustomModel : undefined,
      avoid.tunnels ? avoidTunnelCustomModel : undefined,
    );

    if (balancedModel) {
      const balancedPathCount = maxExtraMinutes === null
        ? Math.max(3, alternatives + 1)
        : Math.max(3, alternatives + 1);
      const balancedRequests = [
        fetchGraphHopperRoute(coordinates, {
          source: "avoid-high-speed-balanced",
          customModel: balancedModel,
          includeCityTrafficDetails,
        }),
      ];
      if (!trafficIntensityActive) {
        balancedRequests.push(
          fetchGraphHopperRoute(coordinates, {
            source: "avoid-high-speed-balanced-alternatives",
            customModel: balancedModel,
            includeCityTrafficDetails,
            alternativeRoutes: balancedPathCount,
            maxWeightFactor: alternativeMaxWeightFactor,
            timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
          }),
        );
      }

      preferenceRequests.push(...balancedRequests);
    }
  }

  const activeCoreOptions = ([
    "highSpeed",
    "trafficIntensity",
    "bridges",
    "tunnels",
    "largeRoundabouts",
    "multilane",
  ] as const)
    .filter((option) => avoid[option]);
  if (activeCoreOptions.length > 1) {
    for (const option of activeCoreOptions) {
      const singleAvoid = routeAvoidStateForOption(option);
      const singlePreferenceModel = await buildRoutePreferenceCustomModel(fastestRoutes, singleAvoid, context);
      if (!singlePreferenceModel) continue;

      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: `avoid-primary-${option}`,
          customModel: singlePreferenceModel,
          includeCityTrafficDetails,
          timeoutMs: option === "trafficIntensity" ? GRAPHHOPPER_TRAFFIC_INTENSITY_TIMEOUT_MS : undefined,
        }),
      );

      if (option !== "trafficIntensity" && !trafficIntensityActive) {
        const singlePathCount = maxExtraMinutes === null
          ? Math.max(3, alternatives + 1)
          : Math.max(3, alternatives + 1);
        preferenceRequests.push(
          fetchGraphHopperRoute(coordinates, {
            source: `avoid-primary-${option}-alternatives`,
            customModel: singlePreferenceModel,
            includeCityTrafficDetails,
            alternativeRoutes: singlePathCount,
            maxWeightFactor: alternativeMaxWeightFactor,
            timeoutMs: GRAPHHOPPER_ALTERNATIVE_TIMEOUT_MS,
          }),
        );
      }
    }
  }

  // Plain highSpeed+traffic already gets a high-speed backbone plus a separate
  // traffic candidate above. Only add this combined balance candidate when
  // bridge/tunnel filters also need to travel with the high-speed model.
  if (avoid.highSpeed && avoid.trafficIntensity && (avoid.bridges || avoid.tunnels)) {
    const highSpeedBalanceModel = mergeCustomModels(
      calmRouteCustomModel,
      avoid.bridges ? avoidBridgeCustomModel : undefined,
      avoid.tunnels ? avoidTunnelCustomModel : undefined,
    );

    if (highSpeedBalanceModel) {
      preferenceRequests.push(
        fetchGraphHopperRoute(coordinates, {
          source: "avoid-high-speed-balance",
          customModel: highSpeedBalanceModel,
          includeCityTrafficDetails,
        }),
      );
    }
  }

  const [preferenceResults, genericAlternativeResults] = await Promise.all([
    Promise.allSettled(preferenceRequests),
    Promise.allSettled(genericAlternativeRequests),
  ]);
  const initialProviderRoutes = [
    ...fastestRoutes,
    ...preferenceResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
    ...genericAlternativeResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  ];
  const highSpeedViaRequests: Array<Promise<OsrmRoute[]>> = [];

  if (longHighSpeedSearch && coordinates.length === 2) {
    const lowSpeedReferenceRoutes = initialProviderRoutes
      .filter((route) => routeHighSpeedExposureForSelection(route) <= ROUTE_HIGH_SPEED_CALM_WINDOW_METERS);
    const viaSourceRoutes = dedupeRoutes(initialProviderRoutes)
      .filter((route) => routeHighSpeedExposureForSelection(route) > ROUTE_HIGH_SPEED_CALM_WINDOW_METERS)
      .sort((a, b) => {
        const durationDiff = compareFastestRoutes(a, b);
        if (durationDiff !== 0) return durationDiff;
        return compareHighSpeedAvoidanceRoutes(a, b);
      });
    const start = coordinates[0];
    const end = coordinates.at(-1);
    if (start && end) {
      const viaPoints = selectHighSpeedViaPoints(viaSourceRoutes, lowSpeedReferenceRoutes);
      highSpeedViaRequests.push(
        ...viaPoints.map((viaPoint, index) => (
          fetchGraphHopperRoute([start, viaPoint, end], {
            source: `avoid-high-speed-via-${index + 1}`,
            customModel: calmRouteCustomModel,
            includeCityTrafficDetails,
            timeoutMs: GRAPHHOPPER_ROUTE_TIMEOUT_MS,
          })
        )),
      );
    }
  }

  const highSpeedViaResults = await Promise.allSettled(highSpeedViaRequests);
  const providerRoutes = [
    ...initialProviderRoutes,
    ...highSpeedViaResults.flatMap((result) => result.status === "fulfilled" ? result.value : []),
  ];
  const hybridRoutes = buildHybridRoutes(providerRoutes, activeOptions);
  const routes = [
    ...providerRoutes,
    ...hybridRoutes,
  ];

  if (!routes.length) {
    const reason = [...preferenceResults, ...genericAlternativeResults]
      .find((result) => result.status === "rejected")?.reason;
    throw reason instanceof Error ? reason : new Error("route provider failed");
  }

  const presentationRoutes = dedupeRoutesForPresentation(dedupeRoutes(routes), activeOptions);
  const budgetedRoutes = presentationRoutes.filter((route, index) => {
    if (index === 0) return true;
    return isRouteWithinMaxExtra(route, baseline, maxExtraMinutes);
  });
  const fastestBudgetedRoute = [...budgetedRoutes].sort((a, b) => {
    if (a.duration !== b.duration) return a.duration - b.duration;
    return a.distance - b.distance;
  })[0];
  const orderedBudgetedRoutes = fastestBudgetedRoute
    ? [
        fastestBudgetedRoute,
        ...budgetedRoutes.filter((route) => route !== fastestBudgetedRoute),
      ]
    : budgetedRoutes;
  const limit = activeOptions.length > 0
    ? trafficIntensityActive
      ? avoid.highSpeed
        ? Math.max(7, alternatives + 4)
        : Math.max(5, alternatives + 2)
      : maxExtraMinutes === null
        ? Math.max(10, alternatives + 7)
        : Math.max(4, alternatives + 3)
    : 1;
  const returnedRoutes = avoid.highSpeed
    ? selectHighSpeedRoutesForReturn(orderedBudgetedRoutes, limit, activeOptions)
    : orderedBudgetedRoutes.slice(0, limit);
  const settledResults = [...preferenceResults, ...genericAlternativeResults, ...highSpeedViaResults];
  return {
    provider: "graphhopper",
    routes: returnedRoutes,
    telemetry: emptyRouteFetchTelemetry(false, {
      providerRequestCount: 1 + preferenceRequests.length + genericAlternativeRequests.length + highSpeedViaRequests.length,
      graphHopperRequestCount: 1 + preferenceRequests.length + genericAlternativeRequests.length + highSpeedViaRequests.length,
      graphHopperFulfilledCount: 1 + settledResults.filter((result) => result.status === "fulfilled").length,
      graphHopperRejectedCount: settledResults.filter((result) => result.status === "rejected").length,
      graphHopperTimeoutCount: countRejectedTimeouts(settledResults),
      genericRequestCount: genericAlternativeRequests.length,
      preferenceRequestCount: preferenceRequests.length + highSpeedViaRequests.length,
      providerRouteCount: providerRoutes.length,
      hybridRouteCount: hybridRoutes.length,
      routeCountBeforeBudget: routes.length,
      budgetedRouteCount: orderedBudgetedRoutes.length,
      returnedRouteCount: returnedRoutes.length,
    }),
  };
}
