import { describe, expect, it } from "vitest";
import {
  compareFastestRoutes,
  routeHighSpeedExposureForSelection,
  selectHighSpeedRoutesForReturn,
  selectHighSpeedViaPoints,
} from "./highSpeedSelection";
import type { OsrmRoute } from "./types";

function route(overrides: Partial<OsrmRoute> = {}): OsrmRoute {
  return {
    distance: 24_000,
    duration: 1_200,
    geometry: {
      type: "LineString",
      coordinates: [
        [18, 59],
        [18, 59.05],
        [18, 59.1],
        [18, 59.15],
        [18, 59.2],
      ],
    },
    ...overrides,
  };
}

describe("high-speed route selection helpers", () => {
  it("uses max-speed path details when ranking high-speed exposure", () => {
    const highSpeed = route({ maxSpeedDetails: [[0, 4, 100]] });
    const calmer = route({ maxSpeedDetails: [[0, 4, 60]] });

    expect(routeHighSpeedExposureForSelection(highSpeed)).toBeGreaterThan(20_000);
    expect(routeHighSpeedExposureForSelection(calmer)).toBe(0);
  });

  it("keeps the baseline while adding the calmest high-speed alternative", () => {
    const baseline = route({ source: "fastest", maxSpeedDetails: [[0, 4, 100]], duration: 900 });
    const calm = route({ source: "calm", maxSpeedDetails: [[0, 4, 60]], duration: 1_300 });
    const medium = route({ source: "medium", maxSpeedDetails: [[0, 4, 90]], duration: 1_100 });

    const selected = selectHighSpeedRoutesForReturn([baseline, medium, calm], 3, ["highSpeed"]);

    expect(selected.map((candidate) => candidate.source)).toEqual(["fastest", "calm", "medium"]);
  });

  it("selects low-speed via points away from reference routes", () => {
    const lowSpeedCandidate = route({ maxSpeedDetails: [[0, 4, 60]] });
    const nearbyReference = route({
      geometry: {
        type: "LineString",
        coordinates: [
          [18, 59],
          [18, 59.2],
        ],
      },
    });
    const farReference = route({
      geometry: {
        type: "LineString",
        coordinates: [
          [18.1, 59],
          [18.1, 59.2],
        ],
      },
    });

    expect(selectHighSpeedViaPoints([lowSpeedCandidate], [nearbyReference])).toEqual([]);
    expect(selectHighSpeedViaPoints([lowSpeedCandidate], [farReference])).toEqual([[18, 59.1]]);
  });

  it("compares fastest routes by duration first, then distance", () => {
    expect(compareFastestRoutes(route({ duration: 100, distance: 10_000 }), route({ duration: 150, distance: 8_000 })))
      .toBeLessThan(0);
    expect(compareFastestRoutes(route({ duration: 100, distance: 8_000 }), route({ duration: 110, distance: 9_000 })))
      .toBeLessThan(0);
  });
});
