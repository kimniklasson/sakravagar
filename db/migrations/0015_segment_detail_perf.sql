-- segment_detail performance fix.
--
-- Bakgrund: segment_detail timeoutade ofta på första-tredje klicket i
-- frontenden ("canceling statement due to statement timeout"). EXPLAIN
-- ANALYZE visade 4.2 sekunder cold för en single-fid call, med
-- temp read/written → spill till disk. Två huvudorsaker:
--
-- 1. nvdb_trafik_latest är en VIEW med rank()-window över hela
--    nvdb_trafik (66k rader). Postgres kan inte pusha down `where l.fid =
--    p_fid` genom window function → varje anrop scannar hela tabellen för
--    att hitta en rad. Direkt lookup på nvdb_trafik_pkey är 2ms istället.
--
-- 2. nvdb_tsk saknade index på element_id. Subquery `select ... from
--    nvdb_tsk where element_id = ...` scannade hela 26k-tabellen varje
--    anrop.
--
-- Fix: lägg index på nvdb_tsk(element_id) + skriv om segment_detail att
-- gå direkt mot nvdb_trafik via fid (via pkey) och ta senaste
-- matarsperiod för just den fid:n.
--
-- Logikskillnad mot nvdb_trafik_latest: vyn rankar matarsperiod desc per
-- element_id och behåller alla syskon-fids inom senaste perioden. Här
-- tar vi senaste mätningen för just den fiden vi vill visa info om. I
-- praktiken är resultatet samma för Lastkajen-uttag (alla rader i en
-- snapshot har samma matarsperiod), men semantiken är "visa senaste
-- mätning för detta segment" vilket är vad popupen vill ha.

create index if not exists nvdb_tsk_element_id_idx on nvdb_tsk (element_id);

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
    -- Direkt fid-lookup via pkey istället för window-vyn. Tar senaste
    -- matarsperiod för just den fid:n.
    select
      n.fid,
      n.element_id,
      n.extent_length as langd_m,
      n.adt_samtliga_fordon as adt_total,
      n.matarsperiod / 100 as matar,
      (select ts_klass_stracka
       from nvdb_tsk
       where element_id = n.element_id
       limit 1) as tsk_klass
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
    'tsk_klass', sb.tsk_klass,
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
