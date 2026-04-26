-- TSK (TrafikSäkerhetsKlass) tas bort från frontend och API.
--
-- Bakgrund: TSK-lagret tillförde marginellt värde för usecaset (rädd
-- förare som vill veta säkrare vägar). Klassningen är starkt korrelerad
-- med ÅDT (stora vägar är typiskt bredare/mötesfria → "Mycket god"), så
-- visuellt blev TSK en blekare version av ÅDT-lagret. Risk + ÅDT +
-- olyckor täcker det viktigaste och blir tydligare utan TSK.
--
-- "Soft removal" snarare än drop: vi byter namn på tabellen till
-- nvdb_tsk_deprecated och tar bort RPC + vyer. Datan är därmed ute ur
-- API:t men finns fortfarande på disk om vi ändrar oss. Reversering är
-- trivial: rename tillbaka + recreate views/RPC.
--
-- För att importera om från Lastkajen-paketet om vi någon gång släpper
-- soft-archive helt: scripts/import-nvdb.sh + gpkg-fil i
-- ~/Desktop/ClaudeAI/Trafik_data/.

-- 1. Drop RPC som anon använder.
drop function if exists tsk_in_bbox(double precision, double precision, double precision, double precision);

-- 2. Drop publika vyer.
drop view if exists tsk_rank;
drop view if exists tsk_public;

-- 3. Drop indexet skapat i 0015 — det fanns för att snabba upp
--    segment_detail-subqueryns nvdb_tsk(element_id)-lookup, vilket vi nu
--    tar bort.
drop index if exists nvdb_tsk_element_id_idx;

-- 4. Rename tabellen så namnet är borta från PostgREST/anon-yta.
alter table if exists nvdb_tsk rename to nvdb_tsk_deprecated;

-- 5. Skriv om segment_detail utan tsk_klass.
create or replace function segment_detail(p_fid bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with deduped as (
    select distinct on (
      coalesce(e.message, ''),
      coalesce(e.road_number, ''),
      date_trunc('hour', e.first_seen)
    )
      e.id, e.message, e.severity, e.road_number, e.first_seen
    from event_segments es
    join events e on e.id = es.event_id
    where es.fid = p_fid
    order by
      coalesce(e.message, ''),
      coalesce(e.road_number, ''),
      date_trunc('hour', e.first_seen),
      e.first_seen asc
  ),
  data_window as (
    select greatest(
      1.0 / 24.0,
      extract(epoch from (now() - coalesce(min(first_seen), now()))) / 86400.0
    ) as days
    from events
  ),
  segment_base as (
    select
      n.fid,
      n.element_id,
      n.extent_length as langd_m,
      n.adt_samtliga_fordon as adt_total,
      n.matarsperiod / 100 as matar
    from nvdb_trafik n
    where n.fid = p_fid
    order by n.matarsperiod desc nulls last
    limit 1
  ),
  agg as (
    select
      (select count(*)::int from deduped) as events_count,
      (select days from data_window) as days,
      (select adt_total from segment_base) as adt_total
  )
  select jsonb_build_object(
    'fid', sb.fid,
    'element_id', sb.element_id,
    'langd_m', sb.langd_m,
    'adt_total', sb.adt_total,
    'matar', sb.matar,
    'events_count', agg.events_count,
    'data_window_days', agg.days,
    'risk_per_passage_pct', case
      when agg.events_count = 0 or agg.adt_total is null or agg.adt_total <= 0 then null
      else (agg.events_count::float8 / (agg.adt_total::float8 * agg.days)) * 100.0
    end,
    'risk_per_milj_fordon', case
      when agg.events_count = 0 or agg.adt_total is null or agg.adt_total <= 0 then null
      else agg.events_count::float8 * 365.0 * 1e6 / (agg.adt_total::float8 * agg.days)
    end,
    'recent_events', coalesce((
      select jsonb_agg(to_jsonb(re) order by re.first_seen desc)
      from (
        select id, message, severity, road_number, first_seen
        from deduped
        order by first_seen desc
        limit 5
      ) re
    ), '[]'::jsonb)
  )
  from segment_base sb
  cross join agg;
$$;

grant execute on function segment_detail(bigint) to anon, authenticated;
