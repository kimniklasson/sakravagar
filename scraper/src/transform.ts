import { parseWgs84, type Deviation } from "./trafikverket.js";
import type { DisturbanceUpsertRow, UpsertRow } from "./supabase.js";

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
