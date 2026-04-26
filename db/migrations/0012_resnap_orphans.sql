-- Self-healing snap-pipeline.
--
-- Bakgrund: snap_pending_events() i 0008 har en CTE-konstruktion där
-- match-grenen (cross join lateral) är inner-join-semantik — events utan
-- matchning droppas — men markera-grenen uppdaterar `snap_processed_at`
-- för ALLA pending events. Resultat: om matchningen failar transient
-- (t.ex. statement-timeout, concurrent vy-eval, eller tillfällig last)
-- blir eventet "stuck" som processed-utan-segmentlänk och inga senare
-- körningar plockar upp det.
--
-- Detta märktes 2026-04-26 när E20-event SE_STA_TRISSID_1_19277034 låg
-- 0.6m från ett ÅDT-segment men ändå saknade event_segments-rad. Match
-- körd manuellt funkade omedelbart.
--
-- Fix här:
--   1. Höj snap-radien från 50m → 75m för att tåla GPS-fel + bredare vägar
--      (motorvägar är ofta 30-40m breda inkl. mittremsa, plus GPS-noggrann-
--      het på 5-15m, så 50m är ganska nära kanten).
--   2. Lägg till resnap_orphan_events() — idempotent funktion som hittar
--      events markerade som processed utan rad i event_segments och försöker
--      snappa dem på nytt. Kör inte om förra gången redan lyckats.
--   3. pg_cron-jobb som kör resnap dagligen kl 03:30 UTC. Lågt-belastnings-
--      tid, undviker krock med */15-min refresh-jobben och */5-min snap.
--   4. Engångs-körning av resnap_orphan_events() i botten av migrationen
--      för att fixa de orphans som finns i db nu.

-- ── 1. Uppdaterad snap-funktion: 75m radie ─────────────────────────────────
create or replace function snap_pending_events(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_processed int;
begin
  with pending as (
    select id, st_transform(geom, 3006) as geom_3006
    from events
    where snap_processed_at is null
    order by first_seen
    limit p_limit
  ),
  matches as (
    select p.id as event_id, n.fid, n.dist
    from pending p
    cross join lateral (
      select fid, st_distance(geom, p.geom_3006) as dist
      from nvdb_trafik_latest
      where st_dwithin(geom, p.geom_3006, 75)  -- höjt från 50m (2026-04-26)
      order by geom <-> p.geom_3006
      limit 1
    ) n
  ),
  ins as (
    insert into event_segments (event_id, fid, distance_m)
    select event_id, fid, dist from matches
    on conflict (event_id, fid) do update set
      distance_m = excluded.distance_m,
      snapped_at = now()
    returning event_id
  ),
  upd as (
    update events
    set snap_processed_at = now()
    where id in (select id from pending)
    returning id
  )
  select count(*)::int from upd into v_processed;

  return coalesce(v_processed, 0);
end;
$$;

grant execute on function snap_pending_events(int) to service_role;

-- ── 2. Resnap orphans ──────────────────────────────────────────────────────
-- Hittar events markerade som processed men utan event_segments-rad.
-- Försöker snappa dem på nytt med samma 75m-radie. Markerar inte om events
-- — de är redan processed. Bara insert-grenen körs, idempotent via
-- ON CONFLICT DO NOTHING (samma event kan ha snappats av en parallell
-- körning under tiden, vilket är OK).
create or replace function resnap_orphan_events(p_limit int default 1000)
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_inserted int;
begin
  with orphans as (
    select e.id, st_transform(e.geom, 3006) as geom_3006
    from events e
    where e.snap_processed_at is not null
      and not exists (select 1 from event_segments es where es.event_id = e.id)
    order by e.first_seen
    limit p_limit
  ),
  matches as (
    select o.id as event_id, n.fid, n.dist
    from orphans o
    cross join lateral (
      select fid, st_distance(geom, o.geom_3006) as dist
      from nvdb_trafik_latest
      where st_dwithin(geom, o.geom_3006, 75)
      order by geom <-> o.geom_3006
      limit 1
    ) n
  ),
  ins as (
    insert into event_segments (event_id, fid, distance_m)
    select event_id, fid, dist from matches
    on conflict (event_id, fid) do nothing
    returning event_id
  )
  select count(*)::int from ins into v_inserted;

  return coalesce(v_inserted, 0);
end;
$$;

grant execute on function resnap_orphan_events(int) to service_role;

-- ── 3. pg_cron-jobb (idempotent unschedule + schedule, samma mönster som 0009) ──
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
  '30 3 * * *',
  $cron$ select resnap_orphan_events(); $cron$
);

-- ── 4. Engångs-körning för befintliga orphans ──────────────────────────────
-- Förväntat: ≥2 nya rader i event_segments (E20-eventen + ev. fler nära väg).
-- Events >75m från NVDB påverkas inte (P-platser, småvägar).
select 'resnap_orphan_events ran, inserted: ' || resnap_orphan_events() as result;

-- Refresh MV så de nya event_segments-raderna syns i risk-färgningen direkt
-- (annars vänter vi på nästa */15-min cron-pass).
refresh materialized view concurrently risk_per_segment;
