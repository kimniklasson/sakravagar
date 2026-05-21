import { describe, expect, it } from "vitest";
import type { RouteLine } from "@/lib/routeTypes";
import {
  dedupeRouteCoordinates,
  formatRouteDistance,
  formatRouteDuration,
  initialRouteAvoids,
  isFreshRouteCacheEntry,
  rememberRouteCacheEntry,
  routeAlternativeCopy,
  routeCacheKey,
  selectRouteCandidates,
  type RouteAvoidState,
} from "./routeModel";

function avoids(overrides: Partial<RouteAvoidState> = {}): RouteAvoidState {
  return { ...initialRouteAvoids, ...overrides };
}

function route(id: string, overrides: Partial<RouteLine> = {}): RouteLine {
  return {
    id,
    source: id === "fastest" ? "fastest" : "alternative",
    distanceMeters: 10_000,
    durationSeconds: 600,
    geometry: {
      type: "LineString",
      coordinates: [
        [18, 59],
        [18.1, 59.1],
      ],
    },
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
    ...overrides,
  };
}

describe("route cache helpers", () => {
  it("creates stable keys with rounded coordinates and sorted avoid options", () => {
    const key = routeCacheKey({
      coordinates: [
        [18.123456, 59.987654],
        [19.000004, 60.000006],
      ],
      alternatives: 3,
      avoids: avoids({ tunnels: true, highSpeed: true, multilane: true }),
      timeBudget: "unlimited",
    });

    expect(key).toBe("18.12346,59.98765|19.00000,60.00001;alt:3;avoid:highSpeed,multilane,tunnels;budget:unlimited");
  });

  it("uses longer cache TTL for traffic intensity routes", () => {
    const entry = { routes: [], createdAt: 1_000 };

    expect(isFreshRouteCacheEntry(entry, avoids(), 1_000 + 2 * 60 * 1000 + 1)).toBe(false);
    expect(isFreshRouteCacheEntry(entry, avoids({ trafficIntensity: true }), 1_000 + 2 * 60 * 1000 + 1)).toBe(true);
    expect(isFreshRouteCacheEntry(entry, avoids({ trafficIntensity: true }), 1_000 + 5 * 60 * 1000 + 1)).toBe(false);
  });

  it("evicts the oldest route cache entry after the max size", () => {
    const cache = new Map<string, { routes: RouteLine[]; createdAt: number }>();
    for (let index = 0; index < 25; index += 1) {
      rememberRouteCacheEntry(cache, `key-${index}`, { routes: [], createdAt: index });
    }

    expect(cache.size).toBe(24);
    expect(cache.has("key-0")).toBe(false);
    expect(cache.has("key-24")).toBe(true);
  });
});

describe("route geometry helpers", () => {
  it("deduplicates only adjacent duplicate coordinates", () => {
    expect(dedupeRouteCoordinates([
      [18, 59],
      [18, 59],
      [18.1, 59.1],
      [18, 59],
    ])).toEqual([
      [18, 59],
      [18.1, 59.1],
      [18, 59],
    ]);
  });
});

describe("selectRouteCandidates", () => {
  it("returns only the fastest route when no avoid filters are active", () => {
    const result = selectRouteCandidates([
      route("fastest"),
      route("calm"),
    ], avoids(), "unlimited");

    expect(result).toMatchObject({
      routes: [expect.objectContaining({ id: "fastest" })],
      selectedIndex: 0,
      active: false,
      hasComparableScores: false,
      hiddenByBudget: 0,
    });
  });

  it("selects a slower route that avoids high-speed exposure", () => {
    const fastest = route("fastest", {
      avoidScores: { ...route("x").avoidScores, highSpeed: 1 },
      exposure: { ...route("x").exposure, highSpeedMeters: 8_000 },
    });
    const calm = route("calm", {
      durationSeconds: 720,
      distanceMeters: 10_500,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0 },
    });

    const result = selectRouteCandidates([fastest, calm], avoids({ highSpeed: true }), "unlimited");

    expect(result.routes.map((candidate) => candidate.id)).toEqual(["calm", "fastest"]);
    expect(result.selectedIndex).toBe(1);
    expect(result.active).toBe(true);
    expect(result.hasComparableScores).toBe(true);
  });

  it("hides non-baseline routes outside a finite time budget", () => {
    const result = selectRouteCandidates([
      route("fastest", { avoidScores: { ...route("x").avoidScores, trafficIntensity: 1 } }),
      route("too-slow", {
        durationSeconds: 1_800,
        avoidScores: { ...route("x").avoidScores, trafficIntensity: 0 },
      }),
    ], avoids({ trafficIntensity: true }), 10);

    expect(result.routes.map((candidate) => candidate.id)).toEqual(["fastest"]);
    expect(result.hiddenByBudget).toBe(1);
  });
});

describe("routeAlternativeCopy", () => {
  it("labels a route that removes high-speed exposure", () => {
    const fastest = route("fastest", {
      avoidScores: { ...route("x").avoidScores, highSpeed: 1 },
      exposure: { ...route("x").exposure, highSpeedMeters: 5_000 },
    });
    const calm = route("calm", {
      durationSeconds: 720,
      distanceMeters: 10_500,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0 },
    });

    const copy = routeAlternativeCopy(calm, 1, fastest, avoids({ highSpeed: true }), [fastest, calm], false);

    expect(copy.title).toBe("Lägre hastigheter");
    expect(copy.rows).toEqual([
      { kind: "highSpeed", label: "Höga hastigheter", value: "Undviker", tone: "positive" },
    ]);
  });

  it("labels only the quickest presented route as fastest", () => {
    const quickest = route("quickest", {
      source: "fastest-alternatives",
      durationSeconds: 600,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0.8 },
      exposure: { ...route("x").exposure, highSpeedMeters: 5_500 },
    });
    const originalBaseline = route("original-baseline", {
      source: "fastest",
      durationSeconds: 640,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0.7 },
      exposure: { ...route("x").exposure, highSpeedMeters: 4_800 },
    });
    const calm = route("calm", {
      durationSeconds: 820,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0 },
    });
    const routes = [quickest, calm, originalBaseline];

    expect(routeAlternativeCopy(quickest, 0, quickest, avoids({ highSpeed: true }), routes, false).title)
      .toBe("Snabbast");
    expect(routeAlternativeCopy(originalBaseline, 2, quickest, avoids({ highSpeed: true }), routes, false).title)
      .not.toBe("Snabbast");
  });

  it("uses the high-speed title for one best matching route when several avoid it", () => {
    const fastest = route("fastest", {
      avoidScores: { ...route("x").avoidScores, highSpeed: 1 },
      exposure: { ...route("x").exposure, highSpeedMeters: 8_000 },
    });
    const calmFast = route("calm-fast", {
      durationSeconds: 720,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0 },
    });
    const calmSlow = route("calm-slow", {
      durationSeconds: 780,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0 },
    });
    const routes = [calmFast, calmSlow, fastest];

    expect(routeAlternativeCopy(calmFast, 0, fastest, avoids({ highSpeed: true }), routes, false).title)
      .toBe("Lägre hastigheter");
    expect(routeAlternativeCopy(calmSlow, 1, fastest, avoids({ highSpeed: true }), routes, false).title)
      .toBe("Lugnare alternativ");
  });

  it("prioritizes an active filter title over the shortest title", () => {
    const fastest = route("fastest", {
      distanceMeters: 10_000,
      durationSeconds: 600,
      avoidScores: { ...route("x").avoidScores, highSpeed: 1 },
      exposure: { ...route("x").exposure, highSpeedMeters: 6_000 },
    });
    const shortAndCalm = route("short-and-calm", {
      distanceMeters: 9_600,
      durationSeconds: 720,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0 },
    });
    const routes = [shortAndCalm, fastest];

    expect(routeAlternativeCopy(shortAndCalm, 0, fastest, avoids({ highSpeed: true }), routes, false).title)
      .toBe("Lägre hastigheter");
  });

  it("does not use the calm title when a slower route does not improve active filters", () => {
    const fastest = route("fastest", {
      avoidScores: { ...route("x").avoidScores, highSpeed: 0, trafficIntensity: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0, trafficIntensityMeters: 0 },
    });
    const sameExposure = route("same-exposure", {
      durationSeconds: 720,
      distanceMeters: 10_500,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0, trafficIntensity: 0 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0, trafficIntensityMeters: 0 },
    });
    const routes = [fastest, sameExposure];

    expect(routeAlternativeCopy(
      sameExposure,
      1,
      fastest,
      avoids({ highSpeed: true, trafficIntensity: true }),
      routes,
      false,
    ).title).toBe("Alternativ rutt");
  });

  it("uses balanced only when a multi-filter route improves an active filter", () => {
    const fastest = route("fastest", {
      durationSeconds: 600,
      avoidScores: { ...route("x").avoidScores, highSpeed: 1, trafficIntensity: 0.6 },
      exposure: { ...route("x").exposure, highSpeedMeters: 8_000, trafficIntensityMeters: 5_000 },
    });
    const bestCalm = route("best-calm", {
      durationSeconds: 1_400,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0, trafficIntensity: 0.1 },
      exposure: { ...route("x").exposure, highSpeedMeters: 0, trafficIntensityMeters: 500 },
    });
    const balanced = route("balanced", {
      durationSeconds: 900,
      avoidScores: { ...route("x").avoidScores, highSpeed: 0.45, trafficIntensity: 0.6 },
      exposure: { ...route("x").exposure, highSpeedMeters: 4_000, trafficIntensityMeters: 5_000 },
    });
    const noImprovement = route("no-improvement", {
      durationSeconds: 900,
      distanceMeters: 11_000,
      avoidScores: { ...route("x").avoidScores, highSpeed: 1, trafficIntensity: 0.6 },
      exposure: { ...route("x").exposure, highSpeedMeters: 8_000, trafficIntensityMeters: 5_000 },
    });
    const routeAvoids = avoids({ highSpeed: true, trafficIntensity: true });

    expect(routeAlternativeCopy(balanced, 2, fastest, routeAvoids, [fastest, bestCalm, balanced], false).title)
      .toBe("Balanserad");
    expect(routeAlternativeCopy(noImprovement, 2, fastest, routeAvoids, [fastest, bestCalm, noImprovement], false).title)
      .toBe("Alternativ väg");
  });

  it("shows metrics for large roundabouts and multilane filters", () => {
    const fastest = route("fastest", {
      avoidScores: { ...route("x").avoidScores, largeRoundabouts: 0.3, multilane: 0.5 },
      exposure: { ...route("x").exposure, largeRoundaboutMeters: 120, multilaneMeters: 1_200 },
    });
    const calm = route("calm", {
      durationSeconds: 700,
      avoidScores: { ...route("x").avoidScores, largeRoundabouts: 0, multilane: 0.1 },
      exposure: { ...route("x").exposure, largeRoundaboutMeters: 0, multilaneMeters: 300 },
    });

    const copy = routeAlternativeCopy(
      calm,
      1,
      fastest,
      avoids({ largeRoundabouts: true, multilane: true }),
      [fastest, calm],
      false,
    );

    expect(copy.rows).toEqual([
      { kind: "largeRoundabouts", label: "Stora rondeller", value: "Undviker", tone: "positive" },
      { kind: "multilane", label: "Flerfiligt", value: "300 m" },
    ]);
  });

  it("does not call low city traffic avoided when exposure is still visible", () => {
    const fastest = route("fastest", {
      avoidScores: { ...route("x").avoidScores, cityTraffic: 0.02 },
      exposure: { ...route("x").exposure, cityTrafficMeters: 900 },
    });

    const copy = routeAlternativeCopy(
      fastest,
      0,
      fastest,
      avoids({ cityTraffic: true }),
      [fastest],
      false,
    );

    expect(copy.rows).toEqual([
      { kind: "cityTraffic", label: "Stadstrafik", value: "Låg" },
    ]);
  });
});

describe("route formatting", () => {
  it("formats route distances", () => {
    expect(formatRouteDistance(994)).toBe("990 m");
    expect(formatRouteDistance(1_250)).toBe("1,3 km");
    expect(formatRouteDistance(12_500)).toBe("13 km");
  });

  it("formats route durations", () => {
    expect(formatRouteDuration(45)).toBe("1 min");
    expect(formatRouteDuration(3_600)).toBe("1 h");
    expect(formatRouteDuration(4_260)).toBe("1 h 11 min");
  });
});
