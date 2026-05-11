-- Deduplicera olyckspunkter innan de når heatmap/live-cirklar.
--
-- Segmentrisk och segment_detail räknar logiska olyckor per
-- fid + message + road_number + first_seen-hour. Kartpunkterna ska följa
-- samma princip där ett event har hunnit snappas till NVDB. Orphans faller
-- tillbaka till vägnummer + geohash så de fortsätter synas tills resnap
-- hittar ett segment.

drop function if exists events_in_bbox(float8, float8, float8, float8, timestamptz, timestamptz);

create or replace function events_in_bbox(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  p_since timestamptz default null,
  p_live_since timestamptz default null
)
returns table (
  id text,
  lng float8,
  lat float8,
  icon_id text,
  road_number text,
  message text,
  severity text,
  first_seen timestamptz,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with bounds as (
    select st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326) as geom
  ),
  normalized as (
    select
      e.id,
      e.icon_id,
      e.road_number,
      e.message,
      e.severity,
      e.geom,
      e.first_seen,
      e.last_seen,
      coalesce(es.fid::text, 'orphan:' || coalesce(e.road_number, '') || ':' || st_geohash(e.geom, 7)) as dedup_segment_key,
      coalesce(e.message, '') as dedup_message,
      coalesce(e.road_number, '') as dedup_road_number,
      date_trunc('hour', e.first_seen) as dedup_hour
    from events e
    left join event_segments es on es.event_id = e.id
    cross join bounds b
    where e.geom && b.geom
      and st_intersects(e.geom, b.geom)
      and (p_since is null or e.first_seen >= p_since)
  ),
  ranked as (
    select
      n.*,
      min(n.first_seen) over logical_event as logical_first_seen,
      max(n.last_seen) over logical_event as logical_last_seen,
      row_number() over (
        partition by n.dedup_segment_key, n.dedup_message, n.dedup_road_number, n.dedup_hour
        order by n.first_seen asc, n.last_seen desc, n.id
      ) as rn
    from normalized n
    window logical_event as (
      partition by n.dedup_segment_key, n.dedup_message, n.dedup_road_number, n.dedup_hour
    )
  )
  select
    r.id,
    st_x(r.geom)::float8 as lng,
    st_y(r.geom)::float8 as lat,
    r.icon_id,
    r.road_number,
    r.message,
    r.severity,
    r.logical_first_seen as first_seen,
    r.logical_last_seen as last_seen
  from ranked r
  where r.rn = 1
    and (p_live_since is null or r.logical_last_seen >= p_live_since)
  order by r.logical_last_seen desc, r.id
  limit 5000;
$$;

grant execute on function events_in_bbox(float8, float8, float8, float8, timestamptz, timestamptz)
  to anon, authenticated;

-- Orphan-resnap ska vara snabb nog för live-olyckor. Tidigare dygnsjobbet
-- gjorde att en olycka som missade första snap ofta blev historisk innan den
-- dök upp i segmentbaserad data.
create extension if not exists pg_cron;

do $$
declare
  v_jobid bigint;
begin
  select jobid from cron.job where jobname = 'resnap-orphan-events' into v_jobid;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'resnap-orphan-events',
  '17 * * * *',
  $cron$ select resnap_orphan_events(); $cron$
);

notify pgrst, 'reload schema';
