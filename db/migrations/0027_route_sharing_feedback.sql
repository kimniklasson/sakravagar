-- Delade rutter och ruttfeedback.
--
-- Route-snapshots används både för publika delningslänkar och för privata
-- feedback-snapshots. Publik åtkomst går enbart via SECURITY DEFINER-RPC:er,
-- så tabellerna exponeras inte direkt via PostgREST.

create extension if not exists pgcrypto;

create table if not exists route_snapshots (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,
  is_public   boolean not null default false,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '1 year'),
  constraint route_snapshots_slug_format check (
    slug is null or slug ~ '^[A-Za-z0-9_-]{10,64}$'
  ),
  constraint route_snapshots_public_slug check (
    is_public = false or slug is not null
  ),
  constraint route_snapshots_payload_object check (
    jsonb_typeof(payload) = 'object'
  )
);

create index if not exists route_snapshots_expires_at_idx
  on route_snapshots (expires_at);

create index if not exists route_snapshots_public_slug_idx
  on route_snapshots (slug)
  where is_public and slug is not null;

alter table route_snapshots enable row level security;

create table if not exists route_feedback (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid references route_snapshots(id) on delete set null,
  vote        text not null check (vote in ('up', 'down')),
  comment     text,
  route_meta  jsonb not null default '{}'::jsonb,
  search_meta jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint route_feedback_comment_length check (
    comment is null or char_length(comment) <= 200
  ),
  constraint route_feedback_route_meta_object check (
    jsonb_typeof(route_meta) = 'object'
  ),
  constraint route_feedback_search_meta_object check (
    jsonb_typeof(search_meta) = 'object'
  )
);

create index if not exists route_feedback_created_at_idx
  on route_feedback (created_at desc);

create index if not exists route_feedback_snapshot_id_idx
  on route_feedback (snapshot_id);

alter table route_feedback enable row level security;

create or replace function create_route_snapshot(
  p_slug text,
  p_is_public boolean,
  p_payload jsonb,
  p_expires_at timestamptz default (now() + interval '1 year')
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

  return query
  insert into route_snapshots (slug, is_public, payload, expires_at)
  values (p_slug, p_is_public, p_payload, p_expires_at)
  returning route_snapshots.id, route_snapshots.slug, route_snapshots.expires_at;
end;
$$;

grant execute on function create_route_snapshot(text, boolean, jsonb, timestamptz)
  to anon, authenticated;

create or replace function get_public_route_snapshot(
  p_slug text
) returns table (
  payload jsonb,
  expires_at timestamptz,
  expired boolean
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    case when s.expires_at <= now() then null else s.payload end as payload,
    s.expires_at,
    s.expires_at <= now() as expired
  from route_snapshots s
  where s.slug = p_slug
    and s.is_public
  limit 1;
$$;

grant execute on function get_public_route_snapshot(text)
  to anon, authenticated;

create or replace function create_route_feedback(
  p_snapshot_id uuid,
  p_vote text,
  p_comment text,
  p_route_meta jsonb default '{}'::jsonb,
  p_search_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_comment text;
begin
  if p_vote not in ('up', 'down') then
    raise exception 'invalid vote';
  end if;

  v_comment := nullif(btrim(coalesce(p_comment, '')), '');
  if v_comment is not null and char_length(v_comment) > 200 then
    raise exception 'comment too long';
  end if;

  if p_route_meta is null or jsonb_typeof(p_route_meta) <> 'object' then
    raise exception 'route_meta must be a json object';
  end if;

  if p_search_meta is null or jsonb_typeof(p_search_meta) <> 'object' then
    raise exception 'search_meta must be a json object';
  end if;

  insert into route_feedback (
    snapshot_id,
    vote,
    comment,
    route_meta,
    search_meta
  )
  values (
    p_snapshot_id,
    p_vote,
    v_comment,
    p_route_meta,
    p_search_meta
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function create_route_feedback(uuid, text, text, jsonb, jsonb)
  to anon, authenticated;

create or replace function cleanup_expired_route_snapshots()
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_deleted int;
begin
  delete from route_snapshots
  where expires_at <= now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function cleanup_expired_route_snapshots()
  to service_role;
