import { describe, expect, it } from "vitest";
import { lineLengthMeters } from "./geometry";
import { buildHybridRoutes } from "./hybrid";
import type { OsrmRoute } from "./types";

function route(source: string, coordinates: GeoJSON.Position[]): OsrmRoute {
  const distance = lineLengthMeters(coordinates, 59.06);
  return {
    source,
    distance,
    duration: distance / 20,
    geometry: { type: "LineString", coordinates },
  };
}

describe("hybrid route helpers", () => {
  it("does not build hybrids unless avoid options justify extra route synthesis", () => {
    const routes = [
      route("a", [[18, 59], [18.02, 59.02], [18.04, 59.04]]),
      route("b", [[18, 59], [18.04, 59.02], [18.04, 59.04]]),
    ];

    expect(buildHybridRoutes(routes, [])).toEqual([]);
  });

  it("combines a prefix from one route with a suffix from another after rejoin", () => {
    const prefixRoute = route("prefix", [
      [18.0, 59.0],
      [18.0, 59.025],
      [18.02, 59.045],
      [18.04, 59.06],
      [18.02, 59.09],
      [18.08, 59.12],
    ]);
    const suffixRoute = route("suffix", [
      [18.0, 59.0],
      [18.04, 59.02],
      [18.04, 59.06],
      [18.08, 59.085],
      [18.08, 59.12],
    ]);

    const hybrids = buildHybridRoutes([prefixRoute, suffixRoute], ["highSpeed"]);
    const expectedHybrid = hybrids.find((candidate) => candidate.source === "hybrid-1-2");

    expect(expectedHybrid?.geometry.coordinates).toEqual([
      [18.0, 59.0],
      [18.0, 59.025],
      [18.02, 59.045],
      [18.04, 59.06],
      [18.08, 59.085],
      [18.08, 59.12],
    ]);
  });
});
