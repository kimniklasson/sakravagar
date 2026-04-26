-- segment_detail v2: dedup + risk i procent per passage + datafönster.
--
-- Bakgrund: Trafikverkets feed lägger ofta upp flera meddelanden för samma
-- olycka (initial rapport + "kvar på platsen" + uppdateringar), och scrapern
-- lagrar varje med sitt eget id. Det blåser upp events_count och gör
-- risk-måttet vilseledande. Vi dedupar därför på
-- (message, road_number, date_trunc('hour', first_seen)) i RPC:n och räknar
-- om både visning och risk på den deduplicerade listan.
--
-- Risk visas som procent per fordonspassage:
--   risk_pct = events_count / (adt_total * data_window_days) * 100
--
-- data_window_days = från första registrerade event i hela datasamlingen
-- till nu — alltså datasetets totala observationsfönster, inte tiden
-- sedan första olyckan på just det här segmentet (det skulle inflatera
-- risken kraftigt på sträckor som varit "tysta" länge före en olycka).
-- Frontenden visar fönstret tydligt så användaren ser hur tunt underlaget är.
--
-- Vi behåller `risk_per_milj_fordon` i return-shapen för bakåtkompatibilitet
-- men beräknat på dedup-talet — annars hade det varit inkonsistent med
-- procent-måttet ovan.

create or replace function segment_detail(p_fid bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with deduped as (
    -- distinct on över (text, vägnr, timme) ger en rad per "logisk olycka".
    -- order by ... e.first_seen asc inom partitionen behåller äldsta som
    -- representativ rad.
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
      l.fid,
      l.element_id,
      l.langd_m,
      l.adt_total,
      (
        select matarsperiod / 100
        from nvdb_trafik
        where fid = l.fid
        limit 1
      ) as matar,
      (
        select ts_klass_stracka
        from nvdb_tsk
        where element_id = l.element_id
        limit 1
      ) as tsk_klass
    from nvdb_trafik_latest l
    where l.fid = p_fid
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
