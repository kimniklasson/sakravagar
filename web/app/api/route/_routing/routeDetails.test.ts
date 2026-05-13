import { describe, expect, it } from "vitest";
import {
  cityTrafficFactorForSegment,
  routeCumulativeDistances,
  routeEnvironmentDetailExposureMeters,
  routeGeneratedByForcedCorridor,
  routeHasOutAndBackSpur,
  routeHighSpeedDetailExposureMeters,
  routeSegmentSpeedLimit,
  speedLimitFromDetail,
} from "./routeDetails";
import type { OsrmRoute } from "./types";

function route(coordinates: GeoJSON.Position[], details: Partial<OsrmRoute> = {}): OsrmRoute {
  return {
    distance: 10_000,
    duration: 600,
    geometry: { type: "LineString", coordinates },
    ...details,
  };
}

describe("route detail helpers", () => {
  it("parses speed details from GraphHopper values", () => {
    expect(speedLimitFromDetail(90)).toBe(90);
    expect(speedLimitFromDetail("100 km/h")).toBe(100);
    expect(speedLimitFromDetail(null)).toBeNull();
    expect(speedLimitFromDetail("unknown")).toBeNull();
  });

  it("calculates high-speed and environment exposure from path details", () => {
    const candidate = route(
      [
        [18, 59],
        [18.02, 59],
        [18.04, 59],
      ],
      {
        maxSpeedDetails: [[0, 1, "80"], [1, 2, "100"]],
        roadEnvironmentDetails: [[0, 1, "BRIDGE"], [1, 2, "TUNNEL"]],
      },
    );

    expect(routeHighSpeedDetailExposureMeters(candidate)).toBeGreaterThan(1_000);
    expect(routeHighSpeedDetailExposureMeters(candidate)).toBeLessThan(1_300);
    expect(routeEnvironmentDetailExposureMeters(candidate, "BRIDGE")).toBeGreaterThan(1_000);
    expect(routeEnvironmentDetailExposureMeters(candidate, "TUNNEL")).toBeGreaterThan(1_000);
  });

  it("scores city traffic only inside configured city areas", () => {
    const stockholmMotorway = route(
      [
        [18.0, 59.3],
        [18.02, 59.31],
      ],
      {
        maxSpeedDetails: [[0, 1, 80]],
        roadClassDetails: [[0, 1, "MOTORWAY"]],
      },
    );
    const outsideCity = route(
      [
        [14.0, 63.0],
        [14.02, 63.01],
      ],
      {
        maxSpeedDetails: [[0, 1, 80]],
        roadClassDetails: [[0, 1, "MOTORWAY"]],
      },
    );

    expect(cityTrafficFactorForSegment(stockholmMotorway, 0)).toBeCloseTo(1.15);
    expect(cityTrafficFactorForSegment(outsideCity, 0)).toBe(0);
  });

  it("tracks forced-corridor sources and generated out-and-back spurs", () => {
    expect(routeGeneratedByForcedCorridor(route([[18, 59], [18.01, 59]], { source: "hybrid-1-2" }))).toBe(true);
    expect(routeGeneratedByForcedCorridor(route([[18, 59], [18.01, 59]], { source: "graphhopper" }))).toBe(false);

    const spurRoute = route([
      [18, 59],
      [18, 59.02],
      [18.02, 59.02],
      [18.04, 59.02],
      [18.06, 59.02],
      [18.04, 59.0204],
      [18.02, 59.0204],
      [18, 59.0204],
      [18, 59.04],
    ]);

    expect(routeCumulativeDistances(spurRoute).at(-1)).toBeGreaterThan(8_000);
    expect(routeHasOutAndBackSpur(spurRoute)).toBe(true);
  });

  it("reads segment speed limits by detail interval", () => {
    const candidate = route(
      [
        [18, 59],
        [18.01, 59],
        [18.02, 59],
      ],
      { maxSpeedDetails: [[0, 1, 70], [1, 2, "100 km/h"]] },
    );

    expect(routeSegmentSpeedLimit(candidate, 0)).toBe(70);
    expect(routeSegmentSpeedLimit(candidate, 1)).toBe(100);
  });
});
