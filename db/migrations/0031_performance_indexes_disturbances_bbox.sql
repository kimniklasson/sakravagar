-- Låg-risk prestandafixar för växande datamängd.
--
-- * events_first_seen_idx gör datafönster och since-filter skalbara.
-- * disturbances_in_bbox använder GIST på geom i stället för view-kolumnerna
--   st_x/st_y, samma princip som events_in_bbox.

create index if not exists events_first_seen_idx on events (first_seen);

drop function if exists disturbances_in_bbox(float8, float8, float8, float8, timestamptz);

create or replace function disturbances_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  p_active_since timestamptz default null
)
returns table (
  id text,
  lng float8,
  lat float8,
  icon_id text,
  message_type text,
  road_number text,
  message text,
  severity text,
  first_seen timestamptz,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with bounds as (
    select st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326) as geom
  )
  select
    d.id,
    st_x(d.geom)::float8 as lng,
    st_y(d.geom)::float8 as lat,
    d.icon_id,
    d.message_type,
    d.road_number,
    d.message,
    d.severity,
    d.first_seen,
    d.last_seen
  from disturbances d
  cross join bounds b
  where d.geom && b.geom
    and st_intersects(d.geom, b.geom)
    and (p_active_since is null or d.last_seen >= p_active_since)
  order by d.last_seen desc, d.id
  limit 2000;
$$;

grant execute on function disturbances_in_bbox(float8, float8, float8, float8, timestamptz)
  to anon, authenticated;

notify pgrst, 'reload schema';
