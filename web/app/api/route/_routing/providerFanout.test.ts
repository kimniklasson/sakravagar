import { describe, expect, it } from "vitest";
import {
  createRouteRequestContext,
  graphHopperMaxWeightFactor,
} from "./providerFanout";
import type { OsrmRoute } from "./types";

function route(duration: number): OsrmRoute {
  return {
    distance: 10_000,
    duration,
    geometry: {
      type: "LineString",
      coordinates: [[18, 59], [18.1, 59.1]],
    },
  };
}

describe("provider fanout helpers", () => {
  it("creates a per-request cache context", () => {
    const context = createRouteRequestContext();

    expect(context.trafficIntensityRowsCache).toBeInstanceOf(Map);
    expect(context.trafficIntensityRowsCache.size).toBe(0);
    expect(context.routeLanePenaltyRowsCache).toBeInstanceOf(Map);
    expect(context.routeLanePenaltyRowsCache.size).toBe(0);
  });

  it("caps GraphHopper alternative-route weight factors from max extra minutes", () => {
    expect(graphHopperMaxWeightFactor(route(600), null)).toBe(4);
    expect(graphHopperMaxWeightFactor(route(600), 1)).toBeCloseTo(1.16);
    expect(graphHopperMaxWeightFactor(route(600), 90)).toBe(2.8);
    expect(graphHopperMaxWeightFactor(route(3600), 5)).toBe(1.15);
  });
});
