import { describe, expect, it } from "vitest";
import type { RouteAvoidState } from "@/lib/routeTypes";
import {
  adtIntensityScore,
  buildPenaltyZoneCustomModel,
  disturbancePoints,
  emptyRouteAnnotations,
  scoreCityTraffic,
  scoreDisturbances,
  scoreRouteLanePenalty,
  scoreTrafficIntensity,
  trafficFlowIntensityScore,
} from "./scoring";
import type { AdtRow, DisturbanceRow, OsrmRoute, RouteLanePenaltyRow, TrafficFlowRow } from "./types";

const noAvoids: RouteAvoidState = {
  highSpeed: false,
  trafficIntensity: false,
  cityTraffic: false,
  bridges: false,
  tunnels: false,
  largeRoundabouts: false,
  multilane: false,
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

function disturbanceRow(overrides: Partial<DisturbanceRow> = {}): DisturbanceRow {
  return {
    id: "disturbance-1",
    lng: 18.01,
    lat: 59,
    message_type: "Vägarbete",
    ...overrides,
  };
}

function routeLanePenaltyRow(overrides: Partial<RouteLanePenaltyRow> = {}): RouteLanePenaltyRow {
  return {
    kind: "largeRoundabouts",
    fid: 77,
    element_id: "abc",
    lane_count: 2,
    length_m: 120,
    geometry: { type: "LineString", coordinates: [[18, 59], [18.002, 59]] },
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
      largeRoundabouts: [],
      multilane: [],
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
        [12.935, 57.719],
        [12.945, 57.722],
      ],
      {
        distance: 700,
        maxSpeedDetails: [[0, 1, 50]],
        roadClassDetails: [[0, 1, "RESIDENTIAL"]],
      },
    );

    const metric = scoreCityTraffic(candidate);

    expect(metric.score).toBeGreaterThan(0.5);
    expect(metric.exposure).toBeGreaterThan(500);
  });

  it("deduplicates disturbance annotations and scoring by location", () => {
    const candidate = route([[18, 59], [18.02, 59]]);
    const rows = [
      disturbanceRow({ id: "SE_STA_TRISSID_1_1", message_type: "Vägarbete" }),
      disturbanceRow({ id: "SE_STA_TRISSID_2_1", message_type: "Trafikmeddelande" }),
      disturbanceRow({ id: "SE_STA_TRISSID_1_2", lng: 18.015 }),
    ];

    const annotations = disturbancePoints(candidate, rows);
    const metric = scoreDisturbances(candidate, rows);

    expect(annotations).toHaveLength(2);
    expect(metric.exposure).toBe(2);
  });

  it("ignores disturbances that are merely near the route corridor", () => {
    const candidate = route([[18, 59], [18.02, 59]]);
    const rows = [
      disturbanceRow({ id: "on-route", lng: 18.01, lat: 59.0003 }),
      disturbanceRow({ id: "nearby-side-street", lng: 18.01, lat: 59.0006 }),
    ];

    const annotations = disturbancePoints(candidate, rows);
    const metric = scoreDisturbances(candidate, rows);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.coordinates).toEqual([18.01, 59.0003]);
    expect(metric.exposure).toBe(1);
  });

  it("scores large roundabout and multilane exposure when rows overlap the route", () => {
    const candidate = route([[18, 59], [18.02, 59]]);

    const largeRoundaboutMetric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({ kind: "largeRoundabouts", lane_count: 3, length_m: 140 }),
    ]);
    const multilaneMetric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({ kind: "multilane", fid: 88, lane_count: 3, length_m: 900 }),
    ]);

    expect(largeRoundaboutMetric.score).toBeGreaterThan(0);
    expect(largeRoundaboutMetric.exposure).toBe(140);
    expect(multilaneMetric.score).toBeGreaterThan(0);
    expect(multilaneMetric.exposure).toBeGreaterThan(1_000);
  });

  it("returns null lane exposure when no lane rows are available", () => {
    const candidate = route([[18, 59], [18.02, 59]]);
    const metric = scoreRouteLanePenalty(candidate, []);

    expect(metric).toEqual({ score: null, exposure: null });
  });

  it("returns zero lane exposure when rows are available but none overlap the route", () => {
    const candidate = route([[18, 59], [18.02, 59]]);
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        geometry: { type: "LineString", coordinates: [[19, 59], [19.01, 59]] },
      }),
    ]);

    expect(metric).toEqual({ score: 0, exposure: 0 });
  });

  it("does not count nearby large roundabouts on adjacent roads", () => {
    const candidate = route([[18, 59], [18.02, 59]]);
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        kind: "largeRoundabouts",
        geometry: { type: "LineString", coordinates: [[18.01, 59.0007], [18.012, 59.0007]] },
      }),
    ]);

    expect(metric).toEqual({ score: 0, exposure: 0 });
  });

  it("does not count nearby multilane segments on adjacent roads", () => {
    const candidate = route([[18, 59], [18.02, 59]], {
      roadClassDetails: [[0, 1, "RESIDENTIAL"]],
    });
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        kind: "multilane",
        lane_count: 3,
        geometry: { type: "LineString", coordinates: [[18.01, 59.0002], [18.012, 59.0002]] },
      }),
    ]);

    expect(metric).toEqual({ score: 0, exposure: 0 });
  });

  it("counts nearby multilane segments on major roads", () => {
    const candidate = route([[18, 59], [18.02, 59]], {
      roadClassDetails: [[0, 1, "MOTORWAY"]],
    });
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        kind: "multilane",
        lane_count: 3,
        length_m: 900,
        geometry: { type: "LineString", coordinates: [[18.01, 59.0002], [18.012, 59.0002]] },
      }),
    ]);

    expect(metric.exposure).toBeGreaterThan(1_000);
  });

  it("counts motorway route details as multilane even without lane rows", () => {
    const candidate = route([[18, 59], [18.02, 59]], {
      roadClassDetails: [[0, 1, "MOTORWAY"]],
    });
    const metric = scoreRouteLanePenalty(candidate, [], "multilane");

    expect(metric.exposure).toBeGreaterThan(1_000);
    expect(metric.score).toBeGreaterThan(0.4);
  });

  it("does not count ordinary two-lane rows as multilane", () => {
    const candidate = route([[18, 59], [18.02, 59]], {
      roadClassDetails: [[0, 1, "PRIMARY"]],
    });
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        kind: "multilane",
        lane_count: 2,
        geometry: { type: "LineString", coordinates: [[18.01, 59], [18.012, 59]] },
      }),
    ]);

    expect(metric).toEqual({ score: 0, exposure: 0 });
  });

  it("does not apply multilane lane rows to low-speed secondary roads", () => {
    const candidate = route([[18, 59], [18.02, 59]], {
      maxSpeedDetails: [[0, 1, 50]],
      roadClassDetails: [[0, 1, "SECONDARY"]],
    });
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        kind: "multilane",
        lane_count: 3,
        geometry: { type: "LineString", coordinates: [[18.01, 59], [18.012, 59]] },
      }),
    ]);

    expect(metric).toEqual({ score: 0, exposure: 0 });
  });

  it("allows multilane lane rows on higher-speed secondary roads", () => {
    const candidate = route([[18, 59], [18.02, 59]], {
      maxSpeedDetails: [[0, 1, 80]],
      roadClassDetails: [[0, 1, "SECONDARY"]],
    });
    const metric = scoreRouteLanePenalty(candidate, [
      routeLanePenaltyRow({
        kind: "multilane",
        lane_count: 3,
        geometry: { type: "LineString", coordinates: [[18.01, 59], [18.012, 59]] },
      }),
    ]);

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

  it("caps lane penalty areas and ignores rows far from the baseline", () => {
    const baseline = route([[18, 59], [18.02, 59]]);
    const laneAvoid: RouteAvoidState = {
      ...noAvoids,
      largeRoundabouts: true,
      multilane: true,
    };
    const largeRoundabouts = Array.from({ length: 40 }, (_, index) => routeLanePenaltyRow({
      kind: "largeRoundabouts",
      fid: index + 1,
      length_m: 100 + index,
    }));
    const multilane = Array.from({ length: 50 }, (_, index) => routeLanePenaltyRow({
      kind: "multilane",
      fid: index + 100,
      lane_count: 3,
      length_m: 100 + index,
    }));
    const model = buildPenaltyZoneCustomModel(
      {
        adtRows: [],
        trafficFlowRows: [],
        largeRoundabouts: [
          ...largeRoundabouts,
          routeLanePenaltyRow({
            kind: "largeRoundabouts",
            fid: 999,
            geometry: { type: "LineString", coordinates: [[19, 59], [19.01, 59]] },
          }),
        ],
        multilane,
      },
      laneAvoid,
      [baseline],
    );

    const ids = model?.areas?.features.map((feature) => feature.id) ?? [];
    expect(ids.filter((id) => id.startsWith("large_roundabout_"))).toHaveLength(25);
    expect(ids.filter((id) => id.startsWith("multilane_"))).toHaveLength(35);
    expect(ids).not.toContain("large_roundabout_999");
  });
});
