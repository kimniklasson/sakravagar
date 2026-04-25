-- Schemalägger Edge Function `scrape` via pg_cron + pg_net.
-- Ersätter GitHub Actions cron som glider/hoppas över under hög last.
--
-- OBS: Supabase managed Postgres tillåter inte ALTER DATABASE-parametrar
-- för icke-superusers, så funktionens URL och delade hemlighet inlinas
-- direkt i cron-schemat. Innan denna migration körs i SQL Editor måste
-- placeholders nedan ersättas med verkliga värden:
--   __FUNCTION_URL__     ex: https://<ref>.supabase.co/functions/v1/scrape
--   __SHARED_SECRET__    samma värde som Edge Function-secret SCRAPE_SHARED_SECRET
-- Hemligheten lagras i cron.job-tabellen (Supabase-intern, inte exponerad)
-- men committas alltså inte till git via denna fil.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Ta bort eventuellt tidigare jobb innan vi (om)skapar — gör migrationen idempotent.
do $$
declare
  v_jobid bigint;
begin
  select jobid from cron.job where jobname = 'scrape-trafikverket' into v_jobid;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'scrape-trafikverket',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := '__FUNCTION_URL__',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __SHARED_SECRET__'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
