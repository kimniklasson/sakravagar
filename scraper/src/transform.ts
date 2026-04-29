import { parseWgs84, type Deviation, type TrafficFlow } from "./trafikverket.js";
import type { DisturbanceUpsertRow, TrafficFlowUpsertRow, UpsertRow } from "./supabase.js";

export function deviationToRow(d: Deviation, now: string): UpsertRow | null {
  const coord = parseWgs84(d.Geometry?.WGS84);
  if (!coord) return null; // utan koordinat är händelsen oanvändbar för kartan

  const county = d.CountyNo && d.CountyNo.length > 0 ? d.CountyNo[0] ?? null : null;

  return {
    id: d.Id,
    icon_id: d.IconId ?? null,
    message: d.Message ?? null,
    road_number: d.RoadNumber ?? null,
    county_no: county,
    geom: `SRID=4326;POINT(${coord.lng} ${coord.lat})`,
    last_seen: now,
    modified_time: d.ModifiedTime ?? null,
    raw: d,
  };
}

export function disturbanceToRow(d: Deviation, now: string): DisturbanceUpsertRow | null {
  const base = deviationToRow(d, now);
  if (!base) return null;

  return {
    ...base,
    message_type: d.MessageType ?? null,
    severity: d.SeverityText ?? null,
  };
}

export function trafficFlowToRow(f: TrafficFlow, now: string): TrafficFlowUpsertRow | null {
  const coord = parseWgs84(f.Geometry?.WGS84);
  if (!coord) return null;

  const vehicleType = f.VehicleType ?? "unknown";
  const lane = f.SpecificLane ?? "unknown";
  const side = f.MeasurementSide ?? "unknown";

  return {
    id: `${f.SiteId}:${vehicleType}:${lane}:${side}`,
    site_id: f.SiteId,
    measurement_time: f.MeasurementTime ?? null,
    measurement_or_calculation_period: f.MeasurementOrCalculationPeriod ?? null,
    vehicle_type: f.VehicleType ?? null,
    vehicle_flow_rate: f.VehicleFlowRate ?? null,
    average_vehicle_speed: f.AverageVehicleSpeed ?? null,
    data_quality: f.DataQuality ?? null,
    county_no: f.CountyNo ?? null,
    region_id: f.RegionId ?? null,
    deleted: f.Deleted ?? false,
    specific_lane: f.SpecificLane ?? null,
    measurement_side: f.MeasurementSide ?? null,
    geom: `SRID=4326;POINT(${coord.lng} ${coord.lat})`,
    last_seen: now,
    modified_time: f.ModifiedTime ?? null,
    raw: f,
  };
}
