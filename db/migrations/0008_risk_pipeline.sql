-- Risk-pipeline: snapa events till nvdb-segment + materialiserad vy med
-- "olyckor per miljon fordon" per segment.
--
-- Kedja:
--   1. events får kolumn snap_processed_at (markör för batch-snap-jobbet)
--   2. event_segments lagrar snap-resultatet (event_id → fid + distance_m).
--      Multi-match-kapabel via PK på (event_id, fid) även om vi för nu
--      bara lagrar top-1 per event.
--   3. nvdb_trafik_latest dedupar nvdb_trafik till senaste matarsperiod
--      per element_id — det är dessa segment vi snapar mot och aggregerar
--      risk över. (NVDB lagrar varje års mätning som separat rad.)
--   4. snap_pending_events(limit) plockar events utan snap_processed_at
--      och hittar närmaste segment inom 50m. Anropas av cron.
--   5. risk_per_segment är materialiserad vy: events_count + risk-måttet
--      per segment. Refreshas av cron.
--   6. risk_in_bbox är RPC som frontenden använder (samma mönster som
--      adt_in_bbox / tsk_in_bbox).
--
-- Vid NVDB-re-import: fid:s kan ändras → event_segments måste återbyggas.
-- Steg: truncate event_segments; update events set snap_processed_at = null;
-- sen kör snap_pending_events() från cron.

-- ── 1. snap-markör ──────────────────────────────────────────────────────────
alter table events add column if not exists snap_processed_at timestamptz;

-- Partial-index så cron-batchen hittar pending events snabbt.
create index if not exists events_snap_pending_idx
  on events (id) where snap_processed_at is null;

-- ── 2. snap-resultat ────────────────────────────────────────────────────────
create table if not exists event_segments (
  event_id      text not null references events(id) on delete cascade,
  fid           bigint not null,
  distance_m    real not null,
  snapped_at    timestamptz not null default now(),
  primary key (event_id, fid)
);

create index if not exists event_segments_fid_idx on event_segments (fid);

-- RLS: ingen läs-policy på event_segments. Anon kommer åt risken via
-- RPC:n risk_in_bbox (security definer), inte direkt.
alter table event_segments enable row level security;

-- ── 3. dedup-vy: senaste mätperiod per element_id ───────────────────────────
create or replace view nvdb_trafik_latest as
select fid, element_id, adt_samtliga_fordon as adt_total, geom, extent_length as langd_m
from (
  select *,
    row_number() over (
      partition by coalesce(element_id::text, 'fid:' || fid::text)
      order by matarsperiod desc nulls last
    ) as rn
  from nvdb_trafik
  where adt_samtliga_fordon is not null
    and adt_samtliga_fordon > 0
    and geom is not null
) ranked
where rn = 1;

-- ── 4. batch-snap-funktion ──────────────────────────────────────────────────
-- Plockar upp till p_limit oprocessade events, snapar var och en till
-- närmaste segment inom 50m, och markerar alla som processed (även de
-- utan match — de förblir i events utan en rad i event_segments).
--
-- security definer + explicit search_path = public, extensions, pg_temp
-- så att st_transform/st_dwithin/<-> hittas (PostGIS i extensions-schemat
-- på Supabase). Returns int = antalet events processade.
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
      where st_dwithin(geom, p.geom_3006, 50)
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

-- ── 5. materialiserad vy: risk per segment ──────────────────────────────────
-- "Olyckor per miljon fordon" = events_count / (adt_total * dagar_data / 365 / 1e6)
--                             = events_count * 365 * 1e6 / (adt_total * dagar_data)
--
-- Dagar_data = tiden mellan första registrerade event och nu. Tills vi har
-- 12+ månader data är detta måttet brusigt: 1 olycka på 1 dag → enormt tal.
-- Frontenden visar därför events_count + risk så användaren själv kan se
-- om datan är gles. Tröskelvärden (färgskala) får kalibreras om när vi har
-- mogen data — gör inget bygge på exakta gränser nu.
create materialized view if not exists risk_per_segment as
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

-- UNIQUE-index krävs för REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists risk_per_segment_fid_idx
  on risk_per_segment (fid);
create index if not exists risk_per_segment_geom_idx
  on risk_per_segment using gist (geom);
create index if not exists risk_per_segment_events_idx
  on risk_per_segment (events_count) where events_count > 0;

-- Initial fyllning (första gången — concurrently funkar inte på tom MV).
refresh materialized view risk_per_segment;

-- ── 6. RPC för frontend ─────────────────────────────────────────────────────
-- Filtrerar events_count > 0 default — segment där inget hänt ritas inte.
-- Färgkalibreringen bestäms i frontenden via ColorBrewer-stops.
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
