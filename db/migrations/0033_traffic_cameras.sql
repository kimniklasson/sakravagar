-- Trafikverkets vägkameror som fristående kartlager.
--
-- Camera-objektet innehåller både trafikflödeskameror och väglagskameror.
-- Vi lagrar metadata och Trafikverkets bild-URL, men inte själva bilden.

create table if not exists traffic_cameras (
  id                    text primary key,
  name                  text,
  camera_type           text,
  status                text,
  description           text,
  direction             text,
  county_no             int,
  active                boolean not null default false,
  deleted               boolean not null default false,
  content_type          text,
  icon_id               text,
  photo_url             text,
  photo_time            timestamptz,
  has_full_size_photo   boolean,
  has_sketch_image      boolean,
  geom                  geometry(Point, 4326) not null,
  first_seen            timestamptz not null default now(),
  last_seen             timestamptz not null default now(),
  modified_time         timestamptz,
  raw                   jsonb not null
);

create index if not exists traffic_cameras_geom_idx
  on traffic_cameras using gist (geom);
create index if not exists traffic_cameras_last_seen_idx
  on traffic_cameras (last_seen desc);
create index if not exists traffic_cameras_photo_time_idx
  on traffic_cameras (photo_time desc);
create index if not exists traffic_cameras_status_idx
  on traffic_cameras (status);
create index if not exists traffic_cameras_active_idx
  on traffic_cameras (active, deleted);

alter table traffic_cameras enable row level security;

drop policy if exists "traffic cameras are publicly readable" on traffic_cameras;
create policy "traffic cameras are publicly readable"
  on traffic_cameras for select
  using (true);

revoke select on traffic_cameras from anon, authenticated;
grant select (
  id,
  name,
  camera_type,
  status,
  description,
  direction,
  county_no,
  active,
  deleted,
  content_type,
  icon_id,
  photo_url,
  photo_time,
  has_full_size_photo,
  has_sketch_image,
  geom,
  first_seen,
  last_seen,
  modified_time
) on traffic_cameras to anon, authenticated;

create or replace view traffic_cameras_public
with (security_invoker = true)
as
select
  id,
  name,
  camera_type,
  status,
  description,
  direction,
  county_no,
  active,
  deleted,
  content_type,
  icon_id,
  photo_url,
  photo_time,
  has_full_size_photo,
  has_sketch_image,
  st_x(geom) as lng,
  st_y(geom) as lat,
  first_seen,
  last_seen,
  modified_time
from traffic_cameras
where deleted = false;

grant select on traffic_cameras_public to anon, authenticated;

create or replace function traffic_cameras_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8
)
returns table (
  id text,
  lng float8,
  lat float8,
  name text,
  camera_type text,
  status text,
  description text,
  direction text,
  county_no int,
  active boolean,
  content_type text,
  icon_id text,
  photo_url text,
  photo_time timestamptz,
  has_full_size_photo boolean,
  has_sketch_image boolean,
  first_seen timestamptz,
  last_seen timestamptz,
  modified_time timestamptz
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
    c.id,
    st_x(c.geom)::float8 as lng,
    st_y(c.geom)::float8 as lat,
    c.name,
    c.camera_type,
    c.status,
    c.description,
    c.direction,
    c.county_no,
    c.active,
    c.content_type,
    c.icon_id,
    c.photo_url,
    c.photo_time,
    c.has_full_size_photo,
    c.has_sketch_image,
    c.first_seen,
    c.last_seen,
    c.modified_time
  from traffic_cameras c
  cross join bounds b
  where c.deleted = false
    and c.active = true
    and c.photo_url is not null
    and c.status = 'videoOrImagesAvailable'
    and c.geom && b.geom
    and st_intersects(c.geom, b.geom)
  order by c.photo_time desc nulls last, c.id
  limit 2500;
$$;

grant execute on function traffic_cameras_in_bbox(float8, float8, float8, float8)
  to anon, authenticated;

notify pgrst, 'reload schema';
