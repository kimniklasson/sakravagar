-- NVDB-lager från Lastkajen (engångsimport via scripts/import-nvdb.sh).
-- Tabellerna nvdb_trafik och nvdb_tsk skapas av ogr2ogr — denna migration
-- lägger till index och publika vyer som frontend kan läsa.
--
-- Förutsättning: scripts/import-nvdb.sh har körts mot denna databas.

-- Filter-index (GIST på geom finns redan via ogr2ogr)
create index if not exists nvdb_trafik_matarsperiod_idx on nvdb_trafik (matarsperiod desc);
create index if not exists nvdb_tsk_klass_idx           on nvdb_tsk (ts_klass_stracka);

-- Publik vy: ÅDT-segment i WGS84 (lat/lng) som GeoJSON-linjer.
-- Frontend hämtar denna via /api/adt (som events_public via /api/events).
create or replace view adt_public as
select
  fid,
  element_id,
  matarsperiod / 100                                          as matar,          -- YYYY
  adt_samtliga_fordon                                         as adt_total,
  adt_tunga_fordon                                            as adt_tung,
  osakerhet_samtliga_fordon                                   as osakerhet,
  matmetod,
  extent_length                                               as langd_m,
  st_asgeojson(st_transform(geom, 4326), 6)::jsonb            as geometry
from nvdb_trafik
where adt_samtliga_fordon is not null
  and geom is not null;

-- Publik vy: TSK-segment i WGS84.
create or replace view tsk_public as
select
  fid,
  element_id,
  ts_klass_stracka                                            as klass,
  extent_length                                               as langd_m,
  st_asgeojson(st_transform(geom, 4326), 6)::jsonb            as geometry
from nvdb_tsk
where ts_klass_stracka is not null
  and geom is not null;

-- Numerisk ordning för TSK-klasser (högre = säkrare).
create or replace view tsk_rank as
select
  klass,
  case klass
    when 'Mycket god' then 4
    when 'God'        then 3
    when 'Mindre god' then 2
    when 'Låg'        then 1
  end as rank
from (select distinct ts_klass_stracka as klass from nvdb_tsk) s;

grant select on adt_public, tsk_public, tsk_rank to anon, authenticated;

-- RLS: base-tabellerna får ingen läs-policy → bara service_role kan läsa dem.
-- Anon går via vyerna (som kör med vyskaparens rättigheter).
alter table nvdb_trafik enable row level security;
alter table nvdb_tsk    enable row level security;
