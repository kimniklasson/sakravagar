import type { RouteLine } from "@/lib/routeTypes";
import { jsonResponse } from "../_utils";
import {
  isCoordinate,
  noAvoids,
  parseAvoidState,
  type RouteRequest,
} from "./_routing/request";
import {
  isRouteTimeoutError,
  routeRequestTimeoutMs,
  routeTimeoutMessage,
  withRouteDeadline,
} from "./_routing/timeout";
import { routeLogPayloadBase } from "./_routing/telemetry";
import {
  createRouteRequestContext,
  fetchProviderRoutes,
} from "./_routing/providerFanout";
import {
  emptyRouteAnnotations,
  scoreRouteAlternatives,
} from "./_routing/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: RouteRequest;
  try {
    body = (await req.json()) as RouteRequest;
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.coordinates)) {
    return jsonResponse({ error: "coordinates must be an array" }, { status: 400 });
  }

  const coordinates = body.coordinates;
  if (coordinates.length < 2 || coordinates.length > 10) {
    return jsonResponse({ error: "route requires 2-10 coordinates" }, { status: 400 });
  }
  if (!coordinates.every(isCoordinate)) {
    return jsonResponse({ error: "coordinates outside Sweden bounds" }, { status: 400 });
  }

  const alternatives =
    typeof body.alternatives === "number"
      ? Math.max(0, Math.min(3, Math.floor(body.alternatives)))
      : 2;
  const avoid = parseAvoidState(body.avoid);
  const preview = body.preview === true;
  const maxExtraMinutes =
    typeof body.maxExtraMinutes === "number" && Number.isFinite(body.maxExtraMinutes)
      ? Math.max(0, body.maxExtraMinutes)
      : null;
  const startedAt = Date.now();
  const logBase = routeLogPayloadBase({
    avoid,
    alternatives,
    coordinateCount: coordinates.length,
    maxExtraMinutes,
    preview,
  });

  try {
    const requestContext = createRouteRequestContext();
    const timeoutMs = routeRequestTimeoutMs(preview, alternatives, avoid);
    const result = await withRouteDeadline((async () => {
      const providerStartedAt = Date.now();
      const routeResult = preview
        ? await fetchProviderRoutes(coordinates, 0, noAvoids, null, requestContext)
        : alternatives === 0
          ? await fetchProviderRoutes(coordinates, 0, noAvoids, null, requestContext)
          : await fetchProviderRoutes(coordinates, alternatives, avoid, maxExtraMinutes, requestContext);
      const providerMs = Date.now() - providerStartedAt;
      const providerRoutes = routeResult.routes;
      const scoringStartedAt = Date.now();
      const scores = preview ? [] : await scoreRouteAlternatives(providerRoutes, avoid, requestContext);
      const scoringMs = Date.now() - scoringStartedAt;
      const routes: RouteLine[] = providerRoutes.map((route, index) => ({
        id: `route-${index + 1}`,
        source: preview ? "preview" : route.source ?? `candidate-${index + 1}`,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: route.geometry,
        safetyScore: null,
        avoidScores: scores[index]?.avoidScores ?? {
          highSpeed: null,
          trafficIntensity: null,
          cityTraffic: null,
          bridges: null,
          tunnels: null,
        },
        exposure: scores[index]?.exposure ?? {
          highSpeedMeters: null,
          trafficIntensityMeters: null,
          cityTrafficMeters: null,
          disturbances: null,
          liveAccidents: null,
          bridgeMeters: null,
          tunnelMeters: null,
        },
        annotations: scores[index]?.annotations ?? emptyRouteAnnotations(),
      }));

      return {
        response: { routes, avoid, maxExtraMinutes, provider: routeResult.provider },
        providerMs,
        scoringMs,
        telemetry: routeResult.telemetry,
      };
    })(), timeoutMs);

    console.info("route observability", {
      ...logBase,
      status: "ok",
      provider: result.response.provider,
      totalMs: Date.now() - startedAt,
      providerMs: result.providerMs,
      scoringMs: result.scoringMs,
      timeoutMs,
      routesReturned: result.response.routes.length,
      ...result.telemetry,
    });

    return jsonResponse(result.response);
  } catch (err) {
    console.error("routing failed", err);
    console.warn("route observability", {
      ...logBase,
      status: isRouteTimeoutError(err) ? "timeout" : "error",
      totalMs: Date.now() - startedAt,
      timeout: isRouteTimeoutError(err),
    });
    if (isRouteTimeoutError(err)) {
      return jsonResponse({ error: routeTimeoutMessage() }, { status: 504 });
    }
    return jsonResponse({ error: "routing failed" }, { status: 502 });
  }
}
