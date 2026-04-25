-- ADT bbox-RPC: returnerar adt_public-rader vars geometri korsar bbox.
-- Använder GIST-index på nvdb_trafik.geom (SWEREF99 TM, 3006) genom att
-- transformera bbox till 3006 istället för 66k rader till 4326. Det gör
-- index-träffen billig: bara matchande rader transformeras till WGS84
-- inför GeoJSON-serialisering.
--
-- security definer: anon har ingen läsrättighet direkt på nvdb_trafik
-- (RLS, ingen policy). Funktionen kör som ägaren och returnerar vy-shapen.

create or replace function adt_in_bbox(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8
) returns setof adt_public
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  -- NVDB lagrar en rad per element_id PER mätperiod — samma vägsträcka finns
  -- alltså som 4-6 rader (2018, 2020, ... 2026). Vi vill bara visa senaste,
  -- annars överlappar de varandra och färgen flimrar mellan zoom/pan.
  -- row_number över bbox-filtrerade resultatet så GIST-indexet jobbar först.
  select
    fid, element_id, matar, adt_total, adt_tung, osakerhet, matmetod, langd_m, geometry
  from (
    select
      fid,
      element_id,
      matarsperiod / 100                                          as matar,
      adt_samtliga_fordon                                         as adt_total,
      adt_tunga_fordon                                            as adt_tung,
      osakerhet_samtliga_fordon                                   as osakerhet,
      matmetod,
      extent_length                                               as langd_m,
      st_asgeojson(st_transform(geom, 4326), 6)::jsonb            as geometry,
      row_number() over (
        partition by coalesce(element_id::text, 'fid:' || fid::text)
        order by matarsperiod desc nulls last
      ) as rn
    from nvdb_trafik
    where adt_samtliga_fordon is not null
      and geom is not null
      and st_intersects(
        geom,
        st_transform(st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326), 3006)
      )
  ) ranked
  where rn = 1
  order by adt_total desc nulls last;  -- stabil ordning
$$;

grant execute on function adt_in_bbox(float8, float8, float8, float8) to anon, authenticated;
