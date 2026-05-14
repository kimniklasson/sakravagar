import { describe, expect, it } from "vitest";
import {
  activeAvoidOptions,
  isCoordinate,
  noAvoids,
  parseAvoidState,
  routeAvoidStateForOption,
} from "./request";

describe("route request helpers", () => {
  it("validates finite coordinates inside Sweden route bounds", () => {
    expect(isCoordinate([18, 59])).toBe(true);
    expect(isCoordinate([8.99, 59])).toBe(false);
    expect(isCoordinate([18, 70.01])).toBe(false);
    expect(isCoordinate([18, Number.NaN])).toBe(false);
    expect(isCoordinate([18])).toBe(false);
  });

  it("normalizes avoid state from unknown payloads", () => {
    expect(parseAvoidState(null)).toEqual(noAvoids);
    expect(parseAvoidState({ highSpeed: true, cityTraffic: true, bridges: "yes" })).toEqual({
      highSpeed: true,
      trafficIntensity: false,
      cityTraffic: true,
      bridges: false,
      tunnels: false,
      largeRoundabouts: false,
      multilane: false,
    });
    expect(parseAvoidState({ largeRoundabouts: true, multilane: 1 })).toEqual({
      ...noAvoids,
      largeRoundabouts: true,
    });
  });

  it("returns active avoid options in canonical order", () => {
    expect(activeAvoidOptions({
      ...noAvoids,
      tunnels: true,
      highSpeed: true,
      trafficIntensity: true,
    })).toEqual(["highSpeed", "trafficIntensity", "tunnels"]);
  });

  it("builds a single-option avoid state", () => {
    expect(routeAvoidStateForOption("bridges")).toEqual({
      ...noAvoids,
      bridges: true,
    });
  });
});
