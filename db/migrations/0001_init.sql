-- Initial schema för trafik-appen.
-- Körs en gång i Supabase SQL Editor (eller via supabase CLI).
-- PostGIS måste vara aktiverad: Dashboard → Database → Extensions → postgis.

create extension if not exists postgis;

create table if not exists events (
  id              text primary key,
  icon_id         text,
  message         text,
  severity        text,
  road_number     text,
  county_no       int,
  geom            geometry(Point, 4326) not null,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  modified_time   timestamptz,
  raw             jsonb not null
);

create index if not exists events_geom_idx        on events using gist (geom);
create index if not exists events_last_seen_idx   on events (last_seen desc);
create index if not exists events_modified_time_idx on events (modified_time desc);

-- RLS: publik läsning för frontend (anon key), skrivning endast via service role.
alter table events enable row level security;

drop policy if exists "events are publicly readable" on events;
create policy "events are publicly readable"
  on events for select
  using (true);

-- (Ingen insert/update/delete-policy → bara service_role kan skriva, vilket är vad vi vill.)

-- Publik vy för frontend: exponerar lng/lat som kolumner istället för WKB-geometri.
-- PostgREST returnerar geometry-kolumner som hex-WKB, vilket är besvärligt i klient.
-- Denna vy gör frontend-querien trivial: select lng, lat, icon_id, ... from events_public.
create or replace view events_public as
select
  id,
  icon_id,
  message,
  severity,
  road_number,
  county_no,
  st_x(geom) as lng,
  st_y(geom) as lat,
  first_seen,
  last_seen,
  modified_time
from events;

grant select on events_public to anon, authenticated;
