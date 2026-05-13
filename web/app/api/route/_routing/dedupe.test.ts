import { describe, expect, it } from "vitest";
import { dedupeRoutes, dedupeRoutesForPresentation, routesAreNearDuplicates } from "./dedupe";
import type { OsrmRoute } from "./types";

const baseCoordinates: GeoJSON.Position[] = [
  [18, 59],
  [18.02, 59],
  [18.04, 59],
];

function route(overrides: Partial<OsrmRoute> = {}): OsrmRoute {
  return {
    distance: 2_300,
    duration: 180,
    geometry: { type: "LineString", coordinates: baseCoordinates },
    ...overrides,
  };
}

describe("route dedupe helpers", () => {
  it("removes identical geometry alternatives", () => {
    const first = route({ source: "fastest" });
    const duplicate = route({ source: "duplicate" });

    expect(dedupeRoutes([first, duplicate])).toEqual([first]);
  });

  it("keeps near alternatives when avoid-detail exposure differs meaningfully", () => {
    const highSpeed = route({
      source: "high-speed",
      maxSpeedDetails: [[0, 2, 100]],
    });
    const calmer = route({
      source: "calmer",
      distance: 2_500,
      duration: 195,
      maxSpeedDetails: [[0, 2, 60]],
    });

    expect(routesAreNearDuplicates(highSpeed, calmer)).toBe(false);
    expect(dedupeRoutes([highSpeed, calmer])).toHaveLength(2);
  });

  it("keeps the better presentation duplicate", () => {
    const slower = route({ source: "slower", distance: 2_300, duration: 210 });
    const faster = route({ source: "faster", distance: 2_320, duration: 160 });

    expect(dedupeRoutesForPresentation([slower, faster], [])).toEqual([faster]);
  });
});
