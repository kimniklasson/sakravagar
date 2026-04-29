-- Aktuellt trafikläge från Trafikverkets TrafficFlow-objekt.
--
-- TrafficFlow är mätplatsbaserat, inte färdiga vägsträckor. Vi lagrar därför
-- senaste observation per site/lane/fordonstyp som punktdata först. Ett senare
-- steg kan snappa mätplatserna mot NVDB-segment och färga sträckor.

create table if not exists traffic_flow_measurements (
  id                                  text primary key,
  site_id                             int not null,
  measurement_time                    timestamptz,
  measurement_or_calculation_period   int,
  vehicle_type                        text,
  vehicle_flow_rate                   double precision,
  average_vehicle_speed               double precision,
  data_quality                        text,
  county_no                           int,
  region_id                           int,
  deleted                             boolean not null default false,
  specific_lane                       text,
  measurement_side                    text,
  geom                                geometry(Point, 4326) not null,
  first_seen                          timestamptz not null default now(),
  last_seen                           timestamptz not null default now(),
  modified_time                       timestamptz,
  raw                                 jsonb not null
);

create index if not exists traffic_flow_measurements_geom_idx
  on traffic_flow_measurements using gist (geom);
create index if not exists traffic_flow_measurements_last_seen_idx
  on traffic_flow_measurements (last_seen desc);
create index if not exists traffic_flow_measurements_measurement_time_idx
  on traffic_flow_measurements (measurement_time desc);
create index if not exists traffic_flow_measurements_site_idx
  on traffic_flow_measurements (site_id);
create index if not exists traffic_flow_measurements_quality_idx
  on traffic_flow_measurements (data_quality);

alter table traffic_flow_measurements enable row level security;

drop policy if exists "traffic flow is publicly readable" on traffic_flow_measurements;
create policy "traffic flow is publicly readable"
  on traffic_flow_measurements for select
  using (true);

create or replace view traffic_flow_public as
select
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
  st_x(geom) as lng,
  st_y(geom) as lat,
  first_seen,
  last_seen,
  modified_time
from traffic_flow_measurements
where deleted = false;

grant select on traffic_flow_public to anon, authenticated;
