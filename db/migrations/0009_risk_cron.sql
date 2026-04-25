-- Cron-jobb för risk-pipelinen.
--
-- Två separata jobb:
--   1. snap-event-segments — var 5:e minut. Snabb catch-up på nya events
--      från scrapern. snap_pending_events() är billig att köra ofta — den
--      avslutar direkt om inga events är pending.
--   2. refresh-risk-mv — var 15:e minut. Concurrent refresh av materialized
--      view (kräver UNIQUE-index, finns redan). Concurrent = inga write-
--      locks, läsningar via risk_in_bbox blockas inte.
--
-- Migration är idempotent: tar bort eventuellt befintligt jobb innan
-- (om)skapande, samma mönster som 0004_pg_cron_scrape.sql.

create extension if not exists pg_cron;

do $$
declare
  v_jobid bigint;
begin
  select jobid from cron.job where jobname = 'snap-event-segments' into v_jobid;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  select jobid from cron.job where jobname = 'refresh-risk-mv' into v_jobid;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'snap-event-segments',
  '*/5 * * * *',
  $cron$ select snap_pending_events(5000); $cron$
);

select cron.schedule(
  'refresh-risk-mv',
  '*/15 * * * *',
  $cron$ refresh materialized view concurrently risk_per_segment; $cron$
);
