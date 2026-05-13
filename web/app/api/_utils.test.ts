import { describe, expect, it } from "vitest";
import { parseBboxParam, SWEDEN_DATA_BOUNDS } from "./_utils";

describe("parseBboxParam", () => {
  const opts = { required: true, maxArea: 1, bounds: SWEDEN_DATA_BOUNDS };

  it("requires bbox when configured", () => {
    expect(parseBboxParam(null, opts)).toEqual({ bbox: null, error: "bbox required" });
  });

  it("allows missing bbox when optional", () => {
    expect(parseBboxParam(null, { maxArea: 1 })).toEqual({ bbox: null, error: null });
  });

  it("rejects malformed bbox values", () => {
    expect(parseBboxParam("18,59,20", opts).error).toBe("bbox must be 4 finite numbers");
    expect(parseBboxParam("18,59,nope,60", opts).error).toBe("bbox must be 4 finite numbers");
  });

  it("rejects reversed or globally invalid coordinates", () => {
    expect(parseBboxParam("20,59,18,60", opts).error).toBe("bbox outside valid coordinate bounds");
    expect(parseBboxParam("18,95,20,96", { required: true, maxArea: 10 }).error)
      .toBe("bbox outside valid coordinate bounds");
  });

  it("rejects bbox outside supported data bounds", () => {
    expect(parseBboxParam("8,59,10,60", opts).error).toBe("bbox outside supported data bounds");
  });

  it("rejects bbox above max area", () => {
    expect(parseBboxParam("18,59,20,60", opts).error).toBe("bbox too large");
  });

  it("returns parsed bbox with area", () => {
    expect(parseBboxParam("18,59,18.5,59.4", opts)).toEqual({
      bbox: {
        minLng: 18,
        minLat: 59,
        maxLng: 18.5,
        maxLat: 59.4,
        area: 0.1999999999999993,
      },
      error: null,
    });
  });
});
