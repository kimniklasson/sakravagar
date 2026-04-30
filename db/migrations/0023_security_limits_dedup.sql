-- Tighten public read surface, align risk counts with popup deduping, and cap
-- heavy bbox RPCs so public endpoints cannot request unbounded geometry.

-- `events` contains raw upstream payloads. Keep anon/authenticated on the
-- curated columns needed by `events_public`, but remove table-wide SELECT so
-- `raw` is not directly readable through PostgREST.
revoke select on events from anon, authenticated;
grant select (
  id,
  icon_id,
  message,
  severity,
  road_number,
  county_no,
  geom,
  first_seen,
  last_seen,
  modified_time
) on events to anon, authenticated;

-- `nvdb_trafik` is public CC0 data, but table-wide grants make it too easy to
-- bypass API/RPC limits. Keep only the columns required by legacy public views.
revoke select on nvdb_trafik from anon, authenticated;
grant select (
  fid,
  element_id,
  matarsperiod,
  adt_samtliga_fordon,
  adt_tunga_fordon,
  osakerhet_samtliga_fordon,
  matmetod,
  extent_length,
  geom
) on nvdb_trafik to anon, authenticated;

do $$
begin
  if to_regclass('public.nvdb_tsk_deprecated') is not null then
    revoke select on nvdb_tsk_deprecated from anon, authenticated;
  end if;
end $$;

-- Rebuild risk_per_segment so it uses the same event definition as the popup:
-- one event per fid + message + road number + first_seen hour.
drop materialized view if exists risk_per_segment cascade;

create materialized view risk_per_segment as
with data_window as (
  select greatest(1.0,
    extract(epoch from (now() - coalesce(min(first_seen), now()))) / 86400.0
  ) as days
  from events
),
deduped_event_segments as (
  select distinct on (
    es.fid,
    coalesce(e.message, ''),
    coalesce(e.road_number, ''),
    date_trunc('hour', e.first_seen)
  )
    es.fid,
    e.id as event_id
  from event_segments es
  join events e on e.id = es.event_id
  order by
    es.fid,
    coalesce(e.message, ''),
    coalesce(e.road_number, ''),
    date_trunc('hour', e.first_seen),
    e.first_seen asc
)
select
  l.fid,
  l.element_id,
  l.adt_total,
  count(des.event_id)::int as events_count,
  case
    when count(des.event_id) = 0 then 0::float8
    else count(des.event_id) * 365.0 * 1e6
       / (l.adt_total * (select days from data_window))
  end as risk_per_milj_fordon,
  l.geom
from nvdb_trafik_latest l
left join deduped_event_segments des on des.fid = l.fid
group by l.fid, l.element_id, l.adt_total, l.geom;

create unique index risk_per_segment_fid_idx on risk_per_segment (fid);
create index risk_per_segment_geom_idx on risk_per_segment using gist (geom);
create index risk_per_segment_events_idx on risk_per_segment (events_count) where events_count > 0;

refresh materialized view risk_per_segment;

create or replace function risk_in_bbox(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8
) returns table (
  fid bigint,
  adt_total int,
  events_count int,
  risk_per_milj_fordon float8,
  geometry jsonb
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    fid,
    adt_total,
    events_count,
    risk_per_milj_fordon,
    st_asgeojson(st_transform(geom, 4326), 6)::jsonb as geometry
  from risk_per_segment
  where events_count > 0
    and st_intersects(
      geom,
      st_transform(st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326), 3006)
    )
  order by risk_per_milj_fordon desc nulls last
  limit 4000;
$$;

grant execute on function risk_in_bbox(float8, float8, float8, float8) to anon, authenticated;

drop function if exists adt_in_bbox(float8, float8, float8, float8);

create function adt_in_bbox(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8
) returns table (
  fid bigint,
  element_id text,
  matar int,
  adt_total int,
  adt_tung int,
  osakerhet double precision,
  matmetod text,
  langd_m double precision,
  geometry jsonb
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    fid,
    element_id::text,
    null::int as matar,
    adt_total,
    null::int as adt_tung,
    null::double precision as osakerhet,
    null::text as matmetod,
    st_length(geom)::double precision as langd_m,
    st_asgeojson(st_transform(geom, 4326), 6)::jsonb as geometry
  from risk_per_segment
  where adt_total is not null
    and st_intersects(
      geom,
      st_transform(st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326), 3006)
    )
  order by adt_total desc nulls last, element_id nulls last, fid
  limit 4000;
$$;

grant execute on function adt_in_bbox(float8, float8, float8, float8) to anon, authenticated;

create or replace function large_roads_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8
) returns table (
  fid bigint,
  element_id text,
  class text,
  rank int,
  speed_limit int,
  road_type text,
  length_m double precision,
  geometry jsonb
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with bbox as (
    select st_transform(
      st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326),
      3006
    ) as geom
  )
  select
    r.fid,
    r.element_id,
    r.class,
    r.rank,
    r.speed_limit,
    r.road_type,
    r.length_m,
    st_asgeojson(st_transform(r.geom, 4326), 6)::jsonb as geometry
  from large_roads_public r, bbox b
  where st_intersects(r.geom, b.geom)
  order by r.rank asc, r.speed_limit nulls first
  limit 4000;
$$;

grant execute on function large_roads_in_bbox(float8, float8, float8, float8) to anon, authenticated;

create or replace function traffic_flow_segments_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  active_since timestamptz default now() - interval '45 minutes'
) returns table (
  site_id int,
  fid bigint,
  vehicle_flow_rate double precision,
  average_vehicle_speed double precision,
  data_quality text,
  measurement_time timestamptz,
  last_seen timestamptz,
  sample_count int,
  snap_distance_m double precision,
  geometry jsonb
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with bbox as (
    select
      st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326) as geom_4326
  ),
  candidate_sites as (
    select distinct tf.site_id
    from traffic_flow_measurements tf, bbox b
    where tf.deleted = false
      and tf.vehicle_type = 'anyVehicle'
      and tf.data_quality is distinct from 'bad'
      and tf.last_seen >= active_since
      and tf.geom && b.geom_4326
  ),
  site_flow as (
    select
      tf.site_id,
      sum(coalesce(tf.vehicle_flow_rate, 0))::double precision as vehicle_flow_rate,
      (
        sum(
          case
            when tf.average_vehicle_speed is not null
            then tf.average_vehicle_speed * greatest(coalesce(tf.vehicle_flow_rate, 0), 1)
            else 0
          end
        )
        / nullif(
          sum(
            case
              when tf.average_vehicle_speed is not null
              then greatest(coalesce(tf.vehicle_flow_rate, 0), 1)
              else 0
            end
          ),
          0
        )
      )::double precision as average_vehicle_speed,
      case
        when bool_or(tf.data_quality = 'degraded') then 'degraded'
        else 'good'
      end as data_quality,
      max(tf.measurement_time) as measurement_time,
      max(tf.last_seen) as last_seen,
      count(*)::int as sample_count,
      st_centroid(st_collect(st_transform(tf.geom, 3006))) as geom_3006
    from traffic_flow_measurements tf
    join candidate_sites cs on cs.site_id = tf.site_id
    where tf.deleted = false
      and tf.vehicle_type = 'anyVehicle'
      and tf.data_quality is distinct from 'bad'
      and tf.last_seen >= active_since
    group by tf.site_id
  ),
  snapped as (
    select
      sf.*,
      nearest.fid,
      nearest.geom as segment_geom,
      nearest.distance_m
    from site_flow sf
    cross join lateral (
      select
        n.fid,
        n.geom,
        st_distance(n.geom, sf.geom_3006) as distance_m
      from risk_per_segment n
      where n.geom && st_expand(sf.geom_3006, 120)
        and st_dwithin(n.geom, sf.geom_3006, 120)
      order by n.geom <-> sf.geom_3006, n.fid
      limit 1
    ) nearest
  )
  select
    site_id,
    fid,
    vehicle_flow_rate,
    average_vehicle_speed,
    data_quality,
    measurement_time,
    last_seen,
    sample_count,
    distance_m as snap_distance_m,
    st_asgeojson(st_transform(segment_geom, 4326), 6)::jsonb as geometry
  from snapped
  order by vehicle_flow_rate desc nulls last, site_id
  limit 1000;
$$;

grant execute on function traffic_flow_segments_in_bbox(float8, float8, float8, float8, timestamptz)
  to anon, authenticated;

notify pgrst, 'reload schema';
