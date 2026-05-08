-- Tighten live-data read surface.
--
-- `disturbances` and `traffic_flow_measurements` contain raw upstream payloads.
-- Keep anon/authenticated on the curated columns needed by public views and
-- route scoring, but remove direct access to `raw`.

revoke select on disturbances from anon, authenticated;
grant select (
  id,
  icon_id,
  message_type,
  message,
  severity,
  road_number,
  county_no,
  geom,
  first_seen,
  last_seen,
  modified_time
) on disturbances to anon, authenticated;

revoke select on traffic_flow_measurements from anon, authenticated;
grant select (
  id,
  site_id,
  measurement_time,
  measurement_or_calculation_period,
  vehicle_type,
  vehicle_flow_rate,
  average_vehicle_speed,
  data_quality,
  county_no,
  region_id,
  deleted,
  specific_lane,
  measurement_side,
  geom,
  first_seen,
  last_seen,
  modified_time
) on traffic_flow_measurements to anon, authenticated;
