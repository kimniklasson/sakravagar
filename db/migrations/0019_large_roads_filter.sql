-- Publik bbox-RPC för trygghetsfiltret "Stora vägar".
--
-- Förväntar sig att `scripts/import-large-roads.sh` har importerat:
-- - nvdb_large_roads_speed: Hastighetsgräns >= 90
-- - nvdb_large_roads_type: valda Vägtyp-klasser

create index if not exists nvdb_large_roads_speed_geom_idx
  on nvdb_large_roads_speed using gist (geom);

create index if not exists nvdb_large_roads_type_geom_idx
  on nvdb_large_roads_type using gist (geom);

create index if not exists nvdb_large_roads_speed_speed_limit_idx
  on nvdb_large_roads_speed (speed_limit);

create index if not exists nvdb_large_roads_type_road_type_idx
  on nvdb_large_roads_type (road_type);

drop view if exists large_roads_public;

create view large_roads_public as
select
  fid,
  element_id,
  'high_speed'::text as class,
  1::int as rank,
  speed_limit,
  null::text as road_type,
  length_m,
  geom
from nvdb_large_roads_speed
where speed_limit >= 90

union all

select
  fid,
  element_id,
  case
    when road_type = 'Motorväg' then 'motorway'
    when road_type in ('Motortrafikled', 'Motortrafikled mötesfri') then 'motor_traffic_road'
    else 'major_road'
  end as class,
  case
    when road_type = 'Motorväg' then 4
    when road_type in ('Motortrafikled', 'Motortrafikled mötesfri') then 3
    else 2
  end as rank,
  null::int as speed_limit,
  road_type,
  length_m,
  geom
from nvdb_large_roads_type
where road_type in ('Motorväg', 'Motortrafikled', 'Motortrafikled mötesfri', '4-fältsväg', 'Vanlig väg mötesfri');

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
  order by r.rank asc, r.speed_limit nulls first;
$$;

grant execute on function large_roads_in_bbox(float8, float8, float8, float8) to anon, authenticated;
