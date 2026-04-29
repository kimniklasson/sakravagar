-- Linjeversion av Liveflöde.
--
-- Trafikverkets TrafficFlow är punktmätningar. Den här RPC:n aggregerar
-- körfält/sensorer per site och snappar varje site till närmaste
-- `risk_per_segment`-segment inom 120 meter. `risk_per_segment` är en
-- materialiserad, geom-indexerad kopia av senaste NVDB/ÅDT-segment och är
-- därför mycket billigare att nearest-neighbor-söka mot än vyn
-- `nvdb_trafik_latest`. Resultatet är fortfarande mätplatsbaserat, men
-- renderas som vägsegment i UI:t.

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
      st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326) as geom_4326,
      st_transform(
        st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326),
        3006
      ) as geom_3006
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
    from traffic_flow_measurements tf, bbox b
    where tf.deleted = false
      and tf.vehicle_type = 'anyVehicle'
      and tf.data_quality is distinct from 'bad'
      and tf.last_seen >= active_since
      -- Använd punkt-GiST-indexet direkt i 4326. För punktdata räcker bbox-
      -- operatorn här; `st_intersects` ovanpå samma envelope gav onödig kostnad.
      and tf.geom && b.geom_4326
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
      order by n.geom <-> sf.geom_3006
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
  order by vehicle_flow_rate desc nulls last;
$$;

grant execute on function traffic_flow_segments_in_bbox(float8, float8, float8, float8, timestamptz)
  to anon, authenticated;
