-- TSK bbox-RPC: returnerar tsk_public-rader vars geometri korsar bbox.
-- Samma mönster som adt_in_bbox: transformera bbox till SWEREF99 3006 så att
-- GIST-indexet på nvdb_tsk.geom används direkt. Skillnad mot ADT: ingen
-- mätperiod-dedup behövs (TSK lagras som en rad per element_id).
--
-- Order by klass-rank så att "Låg" (röd) renderas SIST → ovanpå övriga
-- klasser i MapLibre. Då tappas inte de farliga sträckorna bakom säkrare
-- segment vid överlapp.

create or replace function tsk_in_bbox(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8
) returns setof tsk_public
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    fid,
    element_id,
    ts_klass_stracka                                    as klass,
    extent_length                                       as langd_m,
    st_asgeojson(st_transform(geom, 4326), 6)::jsonb    as geometry
  from nvdb_tsk
  where ts_klass_stracka is not null
    and geom is not null
    and st_intersects(
      geom,
      st_transform(st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326), 3006)
    )
  order by case ts_klass_stracka
    when 'Mycket god' then 1
    when 'God'        then 2
    when 'Mindre god' then 3
    when 'Låg'        then 4
  end nulls last;
$$;

grant execute on function tsk_in_bbox(float8, float8, float8, float8) to anon, authenticated;
