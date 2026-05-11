-- Begränsa anonym write-yta för route snapshots/feedback.
--
-- API-routes skriver nu med service-role från servern. Direkt anon/authenticated
-- RPC-write stängs så publika klienter inte kan fylla `route_snapshots` via
-- PostgREST. Retention kortas också för befintliga och framtida snapshots.

alter table route_snapshots
  alter column expires_at set default (now() + interval '90 days');

update route_snapshots
set expires_at = least(expires_at, created_at + interval '30 days')
where is_public
  and expires_at > created_at + interval '30 days';

update route_snapshots
set expires_at = least(expires_at, created_at + interval '90 days')
where not is_public
  and expires_at > created_at + interval '90 days';

create or replace function create_route_snapshot(
  p_slug text,
  p_is_public boolean,
  p_payload jsonb,
  p_expires_at timestamptz default (now() + interval '90 days')
) returns table (
  id uuid,
  slug text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a json object';
  end if;

  if pg_column_size(p_payload) > 300000 then
    raise exception 'payload too large';
  end if;

  if p_is_public and (p_slug is null or p_slug !~ '^[A-Za-z0-9_-]{10,64}$') then
    raise exception 'invalid public slug';
  end if;

  if p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;

  if p_expires_at > now() + interval '91 days' then
    raise exception 'expires_at too far in the future';
  end if;

  return query
  insert into route_snapshots (slug, is_public, payload, expires_at)
  values (p_slug, p_is_public, p_payload, p_expires_at)
  returning route_snapshots.id, route_snapshots.slug, route_snapshots.expires_at;
end;
$$;

revoke execute on function create_route_snapshot(text, boolean, jsonb, timestamptz)
  from anon, authenticated;
grant execute on function create_route_snapshot(text, boolean, jsonb, timestamptz)
  to service_role;

revoke execute on function create_route_feedback(uuid, text, text, jsonb, jsonb)
  from anon, authenticated;
grant execute on function create_route_feedback(uuid, text, text, jsonb, jsonb)
  to service_role;

revoke execute on function update_route_feedback_comment(uuid, text)
  from anon, authenticated;
grant execute on function update_route_feedback_comment(uuid, text)
  to service_role;

revoke execute on function delete_route_feedback(uuid)
  from anon, authenticated;
grant execute on function delete_route_feedback(uuid)
  to service_role;

create extension if not exists pg_cron;

do $$
declare
  v_jobid bigint;
begin
  select jobid from cron.job where jobname = 'cleanup-route-snapshots' into v_jobid;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'cleanup-route-snapshots',
  '17 2 * * *',
  $cron$ select cleanup_expired_route_snapshots(); $cron$
);
