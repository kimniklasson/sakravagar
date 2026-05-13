import type { RouteAvoidState } from "@/lib/routeTypes";
import { activeAvoidOptions } from "./request";
import { isRouteTimeoutError } from "./timeout";

export type RouteFetchTelemetry = {
  providerRequestCount: number;
  graphHopperRequestCount: number;
  graphHopperFulfilledCount: number;
  graphHopperRejectedCount: number;
  graphHopperTimeoutCount: number;
  genericRequestCount: number;
  preferenceRequestCount: number;
  providerRouteCount: number;
  hybridRouteCount: number;
  routeCountBeforeBudget: number;
  budgetedRouteCount: number;
  returnedRouteCount: number;
  fallback: boolean;
};

export function emptyRouteFetchTelemetry(
  fallback: boolean,
  overrides: Partial<RouteFetchTelemetry> = {},
): RouteFetchTelemetry {
  return {
    providerRequestCount: 0,
    graphHopperRequestCount: 0,
    graphHopperFulfilledCount: 0,
    graphHopperRejectedCount: 0,
    graphHopperTimeoutCount: 0,
    genericRequestCount: 0,
    preferenceRequestCount: 0,
    providerRouteCount: 0,
    hybridRouteCount: 0,
    routeCountBeforeBudget: 0,
    budgetedRouteCount: 0,
    returnedRouteCount: 0,
    fallback,
    ...overrides,
  };
}

export function countRejectedTimeouts(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((result) => result.status === "rejected" && isRouteTimeoutError(result.reason)).length;
}

export function routeLogPayloadBase({
  avoid,
  alternatives,
  coordinateCount,
  maxExtraMinutes,
  preview,
}: {
  avoid: RouteAvoidState;
  alternatives: number;
  coordinateCount: number;
  maxExtraMinutes: number | null;
  preview: boolean;
}) {
  const activeAvoids = activeAvoidOptions(avoid);
  return {
    activeAvoids: activeAvoids.length ? activeAvoids.join(",") : "none",
    alternatives,
    coordinateCount,
    maxExtraMinutes: maxExtraMinutes ?? "unlimited",
    preview,
  };
}
