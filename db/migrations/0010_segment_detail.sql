-- segment_detail(p_fid) — joinad info för en NVDB-segment-popup.
--
-- Returnerar en jsonb med:
--   - fid, element_id, langd_m
--   - adt_total, matar (senaste mätår, från nvdb_trafik_latest via fid)
--   - tsk_klass (från nvdb_tsk via element_id; LATERAL+limit 1 så vi inte
--     duplicerar när NVDB har fler än en tsk-rad per element_id)
--   - events_count, risk_per_milj_fordon (från risk_per_segment)
--   - recent_events: senaste 5 olyckor som snappats till segmentet
--
-- Anropas av frontenden vid klick på ett segment (alla NVDB-lager går mot
-- samma RPC eftersom de delar fid-rymd via nvdb_trafik_latest).
--
-- security definer: nvdb_trafik / nvdb_tsk / event_segments är RLS-skyddade,
-- anon kommer åt joinen via denna funktion. Explicit search_path inkluderar
-- extensions så st_* hittas.

create or replace function segment_detail(p_fid bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'fid', l.fid,
    'element_id', l.element_id,
    'langd_m', l.langd_m,
    'adt_total', l.adt_total,
    'matar', (
      select matarsperiod / 100
      from nvdb_trafik
      where fid = l.fid
      limit 1
    ),
    'tsk_klass', t.ts_klass_stracka,
    'events_count', coalesce(rps.events_count, 0),
    'risk_per_milj_fordon', rps.risk_per_milj_fordon,
    'recent_events', coalesce((
      select jsonb_agg(to_jsonb(re) order by re.first_seen desc)
      from (
        select e.id, e.message, e.severity, e.road_number, e.first_seen
        from event_segments es
        join events e on e.id = es.event_id
        where es.fid = p_fid
        order by e.first_seen desc
        limit 5
      ) re
    ), '[]'::jsonb)
  )
  from nvdb_trafik_latest l
  left join lateral (
    select ts_klass_stracka
    from nvdb_tsk
    where element_id = l.element_id
    limit 1
  ) t on true
  left join risk_per_segment rps on rps.fid = l.fid
  where l.fid = p_fid;
$$;

grant execute on function segment_detail(bigint) to anon, authenticated;
