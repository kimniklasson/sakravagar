import { describe, expect, it } from "vitest";
import type { RouteLine } from "@/lib/routeTypes";
import type { RouteStop } from "@/lib/routeShareSchema";
import { buildGoogleMapsDirectionsUrl } from "./routeSharing";

function route(coordinates: [number, number][]): RouteLine {
  return {
    id: "route",
    source: "alternative",
    distanceMeters: 11_000,
    durationSeconds: 900,
    geometry: { type: "LineString", coordinates },
    safetyScore: null,
    avoidScores: {
      highSpeed: null,
      trafficIntensity: null,
      cityTraffic: null,
      bridges: null,
      tunnels: null,
      largeRoundabouts: null,
      multilane: null,
    },
    exposure: {
      highSpeedMeters: null,
      trafficIntensityMeters: null,
      cityTrafficMeters: null,
      disturbances: null,
      liveAccidents: null,
      bridgeMeters: null,
      tunnelMeters: null,
      largeRoundaboutMeters: null,
      multilaneMeters: null,
    },
    annotations: {
      highSpeed: [],
      trafficIntensity: [],
      cityTraffic: [],
      bridges: [],
      tunnels: [],
      largeRoundabouts: [],
      multilane: [],
      disturbances: [],
      liveAccidents: [],
    },
  };
}

function stops(): RouteStop[] {
  return [
    { id: "from", label: "Start", coordinates: [18, 59], source: "manual" },
    { id: "to", label: "Mål", coordinates: [18, 59.1], source: "manual" },
  ];
}

describe("buildGoogleMapsDirectionsUrl", () => {
  it("adds nine route-shaped waypoints when the URL stays within Google Maps limits", () => {
    const url = buildGoogleMapsDirectionsUrl(route([
      [18, 59],
      [18, 59.025],
      [18.02, 59.05],
      [18.02, 59.075],
      [18, 59.1],
    ]), stops());

    expect(url).not.toBeNull();
    expect(url?.length).toBeLessThanOrEqual(2048);

    const params = new URL(url ?? "").searchParams;
    const waypoints = params.get("waypoints")?.split("|") ?? [];
    expect(waypoints).toHaveLength(9);
    expect(waypoints[0]).toMatch(/^59\.0/);
    expect(waypoints.at(-1)).toMatch(/^59\.0/);
  });
});
