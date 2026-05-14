import { describe, expect, it } from "vitest";
import type { RouteSharePayload } from "./routeShareSchema";
import {
  parseFeedbackVote,
  parseRouteSharePayload,
  parseSlug,
  parseUuid,
} from "./routeShareSchema";

function validPayload(overrides: Partial<RouteSharePayload> = {}): RouteSharePayload {
  return {
    version: 1,
    createdAt: "2026-05-14T10:00:00.000Z",
    stops: [
      { id: "from", label: "Start", coordinates: [18.06, 59.33], source: "manual" },
      { id: "to", label: "Mal", coordinates: [18.08, 59.31], source: "manual" },
    ],
    routeAvoids: {
      highSpeed: false,
      trafficIntensity: true,
      cityTraffic: false,
      bridges: false,
      tunnels: false,
    },
    selectedRoute: {
      id: "route-1",
      source: "graphhopper",
      distanceMeters: 4_200,
      durationSeconds: 600,
      geometry: {
        type: "LineString",
        coordinates: [
          [18.06, 59.33],
          [18.07, 59.32],
          [18.08, 59.31],
        ],
      },
      safetyScore: null,
      avoidScores: {
        highSpeed: null,
        trafficIntensity: 0.2,
        cityTraffic: null,
        bridges: null,
        tunnels: null,
      },
      exposure: {
        highSpeedMeters: null,
        trafficIntensityMeters: 800,
        cityTrafficMeters: null,
        disturbances: 0,
        liveAccidents: 0,
        bridgeMeters: null,
        tunnelMeters: null,
      },
      annotations: {
        highSpeed: [],
        trafficIntensity: [
          {
            kind: "trafficIntensity",
            geometry: {
              type: "LineString",
              coordinates: [
                [18.06, 59.33],
                [18.07, 59.32],
              ],
            },
          },
        ],
        cityTraffic: [],
        bridges: [],
        tunnels: [],
        disturbances: [
          { kind: "disturbances", coordinates: [18.065, 59.325], category: "traffic" },
        ],
        liveAccidents: [],
      },
    },
    provider: "graphhopper",
    selectedRouteRank: 0,
    presentedRouteCount: 2,
    ...overrides,
  };
}

describe("route share schema", () => {
  it("accepts a compact route snapshot payload", () => {
    const parsed = parseRouteSharePayload(validPayload(), { maxBytes: 300_000 });

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        version: 1,
        provider: "graphhopper",
        selectedRoute: { id: "route-1" },
      },
    });
  });

  it("rejects malformed route geometry", () => {
    const parsed = parseRouteSharePayload({
      ...validPayload(),
      selectedRoute: {
        ...validPayload().selectedRoute,
        geometry: { type: "LineString", coordinates: [[18.06, 59.33]] },
      },
    }, { maxBytes: 300_000 });

    expect(parsed).toEqual({ ok: false, error: "payload selectedRoute invalid" });
  });

  it("rejects missing route avoid switches", () => {
    const parsed = parseRouteSharePayload({
      ...validPayload(),
      routeAvoids: { highSpeed: false },
    }, { maxBytes: 300_000 });

    expect(parsed).toEqual({ ok: false, error: "payload routeAvoids invalid" });
  });

  it("uses snapshot-specific errors for feedback snapshots", () => {
    const parsed = parseRouteSharePayload(null, {
      maxBytes: 300_000,
      label: "snapshot",
    });

    expect(parsed).toEqual({ ok: false, error: "snapshot must be an object" });
  });

  it("rejects payloads above the byte limit", () => {
    const parsed = parseRouteSharePayload(validPayload({
      stops: [
        { id: "from", label: "x".repeat(200), coordinates: [18.06, 59.33], source: "manual" },
        { id: "to", label: "y".repeat(200), coordinates: [18.08, 59.31], source: "manual" },
      ],
    }), { maxBytes: 100 });

    expect(parsed).toEqual({ ok: false, error: "payload too large" });
  });

  it("normalizes primitive route-share fields", () => {
    expect(parseSlug(" abcDEF_123456 ")).toBe("abcDEF_123456");
    expect(parseSlug("too-short")).toBeNull();
    expect(parseUuid("7d444840-9dc0-11d1-b245-5ffdce74fad2")).toBe("7d444840-9dc0-11d1-b245-5ffdce74fad2");
    expect(parseUuid("not-a-uuid")).toBeNull();
    expect(parseFeedbackVote("up")).toBe("up");
    expect(parseFeedbackVote("meh")).toBeNull();
  });
});
