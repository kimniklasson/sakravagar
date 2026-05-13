import { describe, expect, it } from "vitest";
import {
  distanceBetweenCoordinatesMeters,
  distancePointToLineMeters,
  flattenLineString,
  geometryLengthMeters,
  midpoint,
  routeBbox,
  routeMatchLine,
  routeOriginLat,
  sampleLineMax,
  toLngLat,
} from "./geometry";

describe("route geometry helpers", () => {
  it("measures coordinate distance using the route projection", () => {
    expect(distanceBetweenCoordinatesMeters([18, 59], [18.01, 59], 59)).toBeCloseTo(573, 0);
    expect(distanceBetweenCoordinatesMeters([18, 59], [18, 59.01], 59)).toBeCloseTo(1_105, 0);
  });

  it("measures point-to-line distance", () => {
    const line: GeoJSON.Position[] = [
      [18, 59],
      [18.01, 59],
    ];

    expect(distancePointToLineMeters([18.005, 59.001], line, 59)).toBeCloseTo(111, 0);
  });

  it("samples long lines while preserving the final coordinate", () => {
    const line = Array.from({ length: 10 }, (_, index) => [18 + index * 0.001, 59] as GeoJSON.Position);

    expect(sampleLineMax(line, 3)).toEqual([
      [18, 59],
      [18.003, 59],
      [18.006, 59],
      [18.009, 59],
    ]);
  });

  it("flattens line and multilinestring geometries", () => {
    expect(flattenLineString({ type: "LineString", coordinates: [[18, 59], [18.1, 59.1]] })).toHaveLength(1);
    expect(flattenLineString({
      type: "MultiLineString",
      coordinates: [
        [[18, 59], [18.1, 59.1]],
        [[19, 60], [19.1, 60.1]],
      ],
    })).toHaveLength(2);
  });

  it("calculates route bbox and clamps to Sweden bounds", () => {
    expect(routeBbox([
      { geometry: { type: "LineString", coordinates: [[9.01, 54.01], [10, 55]] } },
    ], 0.1)).toEqual({
      minLng: 9,
      minLat: 54,
      maxLng: 10.1,
      maxLat: 55.1,
    });
  });

  it("calculates line metrics and coordinate helpers", () => {
    const route = { geometry: { type: "LineString", coordinates: [[18, 59], [18.01, 59.02]] } as GeoJSON.LineString };

    expect(routeOriginLat(route)).toBeCloseTo(59.01);
    expect(routeMatchLine(route)).toEqual(route.geometry.coordinates);
    expect(geometryLengthMeters(route.geometry, 59)).toBeGreaterThan(2_000);
    expect(midpoint(route.geometry.coordinates)).toEqual([18.01, 59.02]);
    expect(toLngLat([18, 59])).toEqual([18, 59]);
    expect(toLngLat([18, Number.NaN])).toBeNull();
  });
});
