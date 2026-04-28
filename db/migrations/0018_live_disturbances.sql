-- Aktuella trafikstörningar som separat live-overlay.
--
-- Avsiktligt skild från `events`: olyckshistoriken används för riskberäkning,
-- medan störningar (vägarbeten, köer, hinder m.m.) är färsk driftinformation
-- som bara ska visas som karta-overlay.

create table if not exists disturbances (
  id              text primary key,
  icon_id         text,
  message_type    text,
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

create index if not exists disturbances_geom_idx on disturbances using gist (geom);
create index if not exists disturbances_last_seen_idx on disturbances (last_seen desc);
create index if not exists disturbances_message_type_idx on disturbances (message_type);

alter table disturbances enable row level security;

drop policy if exists "disturbances are publicly readable" on disturbances;
create policy "disturbances are publicly readable"
  on disturbances for select
  using (true);

create or replace view disturbances_public as
select
  id,
  icon_id,
  message_type,
  message,
  severity,
  road_number,
  county_no,
  st_x(geom) as lng,
  st_y(geom) as lat,
  first_seen,
  last_seen,
  modified_time
from disturbances;

grant select on disturbances_public to anon, authenticated;
