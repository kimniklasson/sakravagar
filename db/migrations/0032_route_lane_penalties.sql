-- Reducerade NVDB-lager för ruttfiltren "Stora rondeller" och "Flerfiligt".
--
-- Förväntar sig att `scripts/import-route-lane-penalties.sh` har importerat:
-- - route_large_roundabouts
-- - route_multilane_segments

create index if not exists route_large_roundabouts_geom_idx
  on route_large_roundabouts using gist (geom);

create index if not exists route_large_roundabouts_lane_count_idx
  on route_large_roundabouts (lane_count);

create index if not exists route_multilane_segments_geom_idx
  on route_multilane_segments using gist (geom);

create index if not exists route_multilane_segments_lane_count_idx
  on route_multilane_segments (lane_count);

alter table route_large_roundabouts enable row level security;
alter table route_multilane_segments enable row level security;

revoke all on route_large_roundabouts from anon, authenticated;
revoke all on route_multilane_segments from anon, authenticated;

create table if not exists route_lane_penalty_metadata (
  id text primary key,
  source_file text not null,
  imported_at timestamptz not null default now(),
  notes text not null default ''
);

insert into route_lane_penalty_metadata (id, source_file, notes)
values (
  'korfalt_rondell_294765',
  'korfalt_rondell_294765.gpkg',
  'Reducerat NVDB-underlag for route_large_roundabouts och route_multilane_segments.'
)
on conflict (id) do update
set
  source_file = excluded.source_file,
  notes = excluded.notes;

create or replace function route_lane_penalties_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  include_large_roundabouts boolean default true,
  include_multilane boolean default true
) returns table (
  kind text,
  fid bigint,
  element_id text,
  lane_count int,
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
  ),
  rows as (
    select
      'largeRoundabouts'::text as kind,
      r.fid,
      r.element_id,
      r.lane_count,
      r.length_m,
      r.geom
    from route_large_roundabouts r, bbox b
    where include_large_roundabouts
      and st_intersects(r.geom, b.geom)

    union all

    select
      'multilane'::text as kind,
      r.fid,
      r.element_id,
      r.lane_count,
      r.length_m,
      r.geom
    from route_multilane_segments r, bbox b
    where include_multilane
      and st_intersects(r.geom, b.geom)
  )
  select
    rows.kind,
    rows.fid,
    rows.element_id,
    rows.lane_count,
    rows.length_m,
    st_asgeojson(st_force2d(st_transform(rows.geom, 4326)), 6)::jsonb as geometry
  from rows
  order by
    rows.kind,
    rows.lane_count desc nulls last,
    rows.length_m desc nulls last,
    rows.fid
  limit 4000;
$$;

grant execute on function route_lane_penalties_in_bbox(float8, float8, float8, float8, boolean, boolean)
  to anon, authenticated;
