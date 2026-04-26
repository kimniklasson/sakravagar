-- Korrekt dedup-strategi för nvdb_trafik_latest, samt rollback till
-- fid-baserad aggregering i risk_per_segment och segment_detail.
--
-- Bakgrund (upptäckt 2026-04-26 efter 0013):
-- Felet i 0013 var att jag antog att flera fids med samma element_id
-- representerade samma fysiska segment (olika riktningar / körfält /
-- mätningar) och därför skulle aggregeras ihop. Verklig data visar att
-- de är OLIKA fysiska sträckor:
--   element_id '12753:300613' → 5 fids över 4–5 km av E20:
--     fid 53355 — 3312m, Bragnum-sträckan (5 km söder)
--     fid 53587 — 3023m, Galmetorp-sträckan (där olyckan är)
--     ... etc
-- 0013 aggregerade alla 5 fids till "lägsta fid" (53355 = Bragnum), så
-- Galmetorp-olyckan färgade Bragnum-sträckan. Helt fel sträcka.
--
-- Det ursprungliga problemet i 0008 var dock dubbletter MELLAN matarsperioder
-- (samma fysiska segment mätt 2023, 2024 etc — skulle ge överlappande
-- linjer på kartan). Det är fortfarande ett legitimt problem.
--
-- Korrekt strategi:
--   * Per element_id, behåll bara den senaste matarsperioden.
--   * Inom samma matarsperiod, behåll ALLA fids — de är olika sträckor.
--   * Aggregera risk per fid (event_segments → fid → segment).
--
-- Detta ger:
--   * Inga dubbletter över år (gammal mätning av samma sträcka filtreras bort).
--   * Alla fysiska sträckor representeras.
--   * event_segments-rader på fid X räknas mot exakt fid X. Olyckor
--     hamnar på rätt sträcka.

-- ── 1. Korrekt nvdb_trafik_latest ──────────────────────────────────────────
-- Behåll alla rader vars matarsperiod = max(matarsperiod) för det
-- element_id:et. Inom samma matarsperiod behålls alla fids (de är olika
-- fysiska sträckor).
--
-- Använder rank() (inte row_number) så att alla rader med samma matar-
-- speriod får rank 1 — vi behåller alltså alla syskon-fids. Window function
-- är O(N log N) — den correlated subquery-versionen var O(N²) och
-- timeoutade på 8s default.
create or replace view nvdb_trafik_latest as
select fid, element_id, adt_total, geom, langd_m
from (
  select
    n.fid,
    n.element_id,
    n.adt_samtliga_fordon as adt_total,
    n.geom,
    n.extent_length as langd_m,
    rank() over (
      partition by coalesce(element_id::text, 'fid:' || fid::text)
      order by matarsperiod desc nulls last
    ) as matar_rank
  from nvdb_trafik n
  where n.adt_samtliga_fordon is not null
    and n.adt_samtliga_fordon > 0
    and n.geom is not null
) ranked
where matar_rank = 1;

-- ── 2. risk_per_segment aggregerar per fid (rollback till 0008-stil) ──────
drop materialized view if exists risk_per_segment cascade;

create materialized view risk_per_segment as
with data_window as (
  select greatest(1.0,
    extract(epoch from (now() - coalesce(min(first_seen), now()))) / 86400.0
  ) as days
  from events
)
select
  l.fid,
  l.element_id,
  l.adt_total,
  count(es.event_id)::int as events_count,
  case
    when count(es.event_id) = 0 then 0::float8
    else count(es.event_id) * 365.0 * 1e6
       / (l.adt_total * (select days from data_window))
  end as risk_per_milj_fordon,
  l.geom
from nvdb_trafik_latest l
left join event_segments es on es.fid = l.fid
group by l.fid, l.element_id, l.adt_total, l.geom;

create unique index risk_per_segment_fid_idx on risk_per_segment (fid);
create index risk_per_segment_geom_idx on risk_per_segment using gist (geom);
create index risk_per_segment_events_idx on risk_per_segment (events_count) where events_count > 0;

refresh materialized view risk_per_segment;

-- ── 3. Återskapa risk_in_bbox (drop:ades med CASCADE) ─────────────────────
create or replace function risk_in_bbox(
  min_lng float8, min_lat float8, max_lng float8, max_lat float8
) returns table (
  fid bigint,
  adt_total int,
  events_count int,
  risk_per_milj_fordon float8,
  geometry jsonb
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    fid,
    adt_total,
    events_count,
    risk_per_milj_fordon,
    st_asgeojson(st_transform(geom, 4326), 6)::jsonb as geometry
  from risk_per_segment
  where events_count > 0
    and st_intersects(
      geom,
      st_transform(st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326), 3006)
    )
  order by risk_per_milj_fordon desc nulls last;
$$;

grant execute on function risk_in_bbox(float8, float8, float8, float8) to anon, authenticated;

-- ── 4. segment_detail joinar event_segments via fid (rollback från 0013) ──
create or replace function segment_detail(p_fid bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with target as (
    select fid, element_id, langd_m, adt_total
    from nvdb_trafik_latest
    where fid = p_fid
  ),
  raw_events as (
    -- Plocka events som snappats till exakt detta fid (inte hela element_id).
    select e.id, e.message, e.severity, e.road_number, e.first_seen
    from event_segments es
    join events e on e.id = es.event_id
    where es.fid = p_fid
  ),
  deduped as (
    -- Trafikverket lägger upp flera meddelanden för samma incident:
    -- behandla (samma text, samma vägnr, samma timme) som en logisk olycka.
    select distinct on (
      coalesce(message, ''),
      coalesce(road_number, ''),
      date_trunc('hour', first_seen)
    )
      id, message, severity, road_number, first_seen
    from raw_events
    order by
      coalesce(message, ''),
      coalesce(road_number, ''),
      date_trunc('hour', first_seen),
      first_seen asc
  ),
  data_window as (
    select greatest(
      1.0 / 24.0,
      extract(epoch from (now() - coalesce(min(first_seen), now()))) / 86400.0
    ) as days
    from events
  ),
  agg as (
    select
      (select count(*)::int from deduped) as events_count,
      (select days from data_window) as days,
      (select adt_total from target) as adt_total
  )
  select jsonb_build_object(
    'fid', t.fid,
    'element_id', t.element_id,
    'langd_m', t.langd_m,
    'adt_total', t.adt_total,
    'matar', (
      select matarsperiod / 100
      from nvdb_trafik
      where fid = t.fid
      limit 1
    ),
    'tsk_klass', (
      select ts_klass_stracka
      from nvdb_tsk
      where element_id = t.element_id
      limit 1
    ),
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
  from target t
  cross join agg;
$$;

grant execute on function segment_detail(bigint) to anon, authenticated;

-- ── 5. Verifiering ─────────────────────────────────────────────────────────
-- Förväntat: fid 53587 (Galmetorp) finns nu i MV med events_count=1.
-- Bragnum (fid 53355) ska INTE ha events_count > 0 eftersom inga events
-- snappats dit.
select
  fid,
  round(st_x(st_transform(st_centroid(geom), 4326))::numeric, 4) as centroid_lng,
  round(st_y(st_transform(st_centroid(geom), 4326))::numeric, 4) as centroid_lat,
  adt_total,
  events_count,
  round(risk_per_milj_fordon::numeric, 1) as risk
from risk_per_segment
where element_id = '12753:300613'
order by fid;

-- Antal rader i nya nvdb_trafik_latest (förväntat: ≤ 66 645, troligen
-- 50–60k efter borttagna gamla matarsperioder).
select count(*) as nvdb_latest_rows from nvdb_trafik_latest;
