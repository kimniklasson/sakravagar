import { describe, expect, it } from "vitest";
import type { RouteAvoidState } from "@/lib/routeTypes";
import {
  adtIntensityScore,
  buildPenaltyZoneCustomModel,
  emptyRouteAnnotations,
  scoreCityTraffic,
  scoreTrafficIntensity,
  trafficFlowIntensityScore,
} from "./scoring";
import type { AdtRow, OsrmRoute, TrafficFlowRow } from "./types";

const noAvoids: RouteAvoidState = {
  highSpeed: false,
  trafficIntensity: false,
  cityTraffic: false,
  bridges: false,
  tunnels: false,
};

const trafficAvoid: RouteAvoidState = {
  ...noAvoids,
  trafficIntensity: true,
};

function route(coordinates: GeoJSON.Position[], details: Partial<OsrmRoute> = {}): OsrmRoute {
  return {
    distance: 2_500,
    duration: 180,
    geometry: { type: "LineString", coordinates },
    ...details,
  };
}

function adtRow(adtTotal: number, coordinates: GeoJSON.Position[] = [[18, 59], [18.02, 59]]): AdtRow {
  return {
    fid: 1,
    adt_total: adtTotal,
    geometry: { type: "LineString", coordinates },
  };
}

function trafficFlowRow(overrides: Partial<TrafficFlowRow> = {}): TrafficFlowRow {
  return {
    site_id: 12,
    fid: 34,
    vehicle_flow_rate: 1_700,
    average_vehicle_speed: 40,
    data_quality: "good",
    measurement_time: "2026-05-13T12:00:00Z",
    last_seen: "2026-05-13T12:05:00Z",
    sample_count: 8,
    snap_distance_m: 12,
    geometry: { type: "LineString", coordinates: [[18, 59], [18.02, 59]] },
    ...overrides,
  };
}

describe("route scoring helpers", () => {
  it("initializes the full annotation shape", () => {
    expect(emptyRouteAnnotations()).toEqual({
      highSpeed: [],
      trafficIntensity: [],
      cityTraffic: [],
      bridges: [],
      tunnels: [],
      disturbances: [],
      liveAccidents: [],
    });
  });

  it("scores ADT and traffic flow into intensity bands", () => {
    expect(adtIntensityScore(1_999)).toBe(0);
    expect(adtIntensityScore(20_000)).toBe(0.78);
    expect(adtIntensityScore(60_000)).toBe(1);

    expect(trafficFlowIntensityScore(trafficFlowRow({ vehicle_flow_rate: 100, average_vehicle_speed: 80 }))).toBe(0.08);
    expect(trafficFlowIntensityScore(trafficFlowRow({ vehicle_flow_rate: 900, average_vehicle_speed: 70 }))).toBe(0.28);
    expect(trafficFlowIntensityScore(trafficFlowRow({ vehicle_flow_rate: 1_700, average_vehicle_speed: 40 }))).toBe(0.62);
    expect(trafficFlowIntensityScore(trafficFlowRow({ vehicle_flow_rate: 100, average_vehicle_speed: 20 }))).toBe(0.82);
  });

  it("scores traffic intensity when rows overlap the route", () => {
    const candidate = route([[18, 59], [18.02, 59]]);
    const metric = scoreTrafficIntensity(candidate, [adtRow(45_000)], [trafficFlowRow()]);

    expect(metric.score).toBeGreaterThan(0.5);
    expect(metric.exposure).toBeGreaterThan(1_000);
  });

  it("scores city traffic from road class details inside city areas", () => {
    const candidate = route(
      [
        [18.0, 59.3],
        [18.02, 59.31],
      ],
      {
        maxSpeedDetails: [[0, 1, 80]],
        roadClassDetails: [[0, 1, "MOTORWAY"]],
      },
    );

    const metric = scoreCityTraffic(candidate);

    expect(metric.score).toBeGreaterThan(0.5);
    expect(metric.exposure).toBeGreaterThan(1_000);
  });

  it("builds traffic intensity penalty areas from overlapping high-intensity rows", () => {
    const baseline = route([[18, 59], [18.02, 59]]);
    const model = buildPenaltyZoneCustomModel(
      {
        adtRows: [adtRow(45_000)],
        trafficFlowRows: [trafficFlowRow()],
      },
      trafficAvoid,
      [baseline],
    );

    expect(model?.areas?.features.map((feature) => feature.id)).toEqual([
      "traffic_intensity_adt_1",
      "traffic_intensity_flow_1_12_34",
    ]);
    expect(model?.priority?.map((rule) => rule.multiply_by)).toEqual(["0.22", "0.42"]);
    expect(buildPenaltyZoneCustomModel({ adtRows: [adtRow(45_000)], trafficFlowRows: [] }, noAvoids, [baseline]))
      .toBeUndefined();
  });
});
