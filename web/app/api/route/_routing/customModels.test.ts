import { describe, expect, it } from "vitest";
import {
  avoidBridgeCustomModel,
  buildCityTrafficCustomModel,
  calmRouteCustomModel,
  linePenaltyArea,
  mergeCustomModels,
} from "./customModels";

describe("GraphHopper custom model helpers", () => {
  it("builds city traffic model when routes overlap a configured city area", () => {
    const model = buildCityTrafficCustomModel([
      {
        distance: 1_000,
        duration: 60,
        geometry: {
          type: "LineString",
          coordinates: [
            [18.0, 59.3],
            [18.1, 59.35],
          ],
        },
      },
    ]);

    expect(model?.areas?.features.map((feature) => feature.id)).toContain("city_stockholm");
    expect(model?.priority?.some((rule) => rule.if.includes("city_stockholm"))).toBe(true);
  });

  it("skips city traffic model outside configured city areas", () => {
    expect(buildCityTrafficCustomModel([
      {
        distance: 1_000,
        duration: 60,
        geometry: {
          type: "LineString",
          coordinates: [
            [14, 63],
            [14.1, 63.1],
          ],
        },
      },
    ])).toBeUndefined();
  });

  it("creates padded line penalty areas", () => {
    const feature = linePenaltyArea("test", [[18, 59], [18.01, 59.01]], 120);

    expect(feature?.id).toBe("test");
    expect(feature?.geometry.type).toBe("Polygon");
    expect(feature?.geometry.coordinates[0]).toHaveLength(5);
  });

  it("merges priority rules and area features", () => {
    const area = linePenaltyArea("penalty", [[18, 59], [18.01, 59.01]], 120);
    const merged = mergeCustomModels(
      calmRouteCustomModel,
      avoidBridgeCustomModel,
      area ? { areas: { type: "FeatureCollection", features: [area] } } : undefined,
    );

    expect(merged?.priority?.length).toBe(
      (calmRouteCustomModel.priority?.length ?? 0) + (avoidBridgeCustomModel.priority?.length ?? 0),
    );
    expect(merged?.areas?.features.map((feature) => feature.id)).toEqual(["penalty"]);
  });
});
