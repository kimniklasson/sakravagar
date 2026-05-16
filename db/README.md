# db

Databasschema för trafik-appen. Supabase Postgres + PostGIS, med migrations för events, NVDB/ÅDT, segmentrisk, störningar, TrafficFlow, vägkameror och publika RPC:er.

## Applicera schema

För ett nytt Supabase-projekt: kör migrationskedjan i `migrations/` i ordning.

Tre alternativ för lokal/initial applicering:

### 1. Supabase SQL Editor (enklast för MVP)
1. Öppna ditt Supabase-projekt → SQL Editor → New query
2. Klistra in en migration i taget från `migrations/`
3. Kör i nummerordning

### 2. Supabase CLI
```sh
brew install supabase/tap/supabase
supabase link --project-ref <din-ref>
supabase db push
```

### 3. psql direkt
```sh
for f in migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## Schema i korthet

Kärntabellen för Trafikverket-olyckor är `events`.

| Kolumn          | Syfte |
|-----------------|-------|
| `id`            | Trafikverkets `Deviation.Id` — primärnyckel, dedupe-bas |
| `icon_id`       | T.ex. `roadAccident` — används för att härleda severity senare |
| `message`       | Fritext från API:et |
| `severity`      | Härlett fält, null första passet |
| `road_number`   | T.ex. `E4` |
| `county_no`     | Länsnummer |
| `geom`          | PostGIS Point, SRID 4326 (WGS84) |
| `first_seen`    | När scrapern först såg händelsen |
| `last_seen`     | Senast bekräftad som aktiv i API:et |
| `modified_time` | Trafikverkets `ModifiedTime` |
| `raw`           | Hela API-objektet som jsonb — framtidssäkring |

## Varför `raw jsonb`?

Om vi senare vill extrahera ett fält vi inte tänkt på slipper vi scrapa om gammal data. Disk är billigt; tid är inte det.

## Framtida migrations

Numrera i ordning efter senaste filen i `migrations/`. En ADR-post i `docs/decisions.md` om valet är icke-trivialt.

Supabase ändrar Data API-defaults under 2026: nya objekt i `public` ska inte antas bli nåbara via PostgREST/GraphQL utan explicita grants. Varje migration som skapar tabell, vy, materialized view, funktion eller sekvens i `public` ska därför också ange minsta nödvändiga behörigheter, t.ex. `grant select ... to anon, authenticated`, `grant execute on function ... to anon, authenticated` eller service-role-only grants för server-/Edge-kod. RLS/policies styr raderna, men `grant` styr om objektet alls är nåbart via Supabase Data API.

Om objektet inte ska exponeras direkt, gör det tydligt i migrationen: enable RLS utan publik policy och använd en smal `security definer`-RPC eller server-side `service_role` i stället.

Efter schema-/RPC-ändringar i Supabase ska `database.types.ts` regenereras:

```sh
pnpm exec supabase gen types typescript --project-id evgrkuxpqyoucvfrarap --schema public > db/database.types.ts
```

Webbens serverkod använder typerna via `web/lib/supabaseServer.ts`. Kör `pnpm --filter @trafik/web run typecheck` efter regenerering så brutna RPC-signaturer fångas direkt.

## Viktiga migrations

- `0004_pg_cron_scrape.sql` — schemalägger Edge Function-scrape via `pg_cron`/`pg_net`.
- `0008_risk_pipeline.sql` + `0009_risk_cron.sql` — snapping och segmentrisk. Risk-cronjobben `snap-event-segments` och `refresh-risk-mv` är pausade i produktion sedan 2026-05-13 eftersom riskdelen är vilande och Supabase Nano varnade för Disk IO-budget.
- `0011_segment_detail_v2.sql` — popupdetaljer och dedup.
- `0014_correct_dedup_strategy.sql` — `fid`-baserad risk i stället för `element_id`.
- `0018_live_disturbances.sql` — separat störningslager.
- `0019_large_roads_filter.sql` — höghastighetsfilter från Lastkajen.
- `0020_live_traffic_flow.sql` till `0022_stabilize_flow_segments.sql` — TrafficFlow.
- `0023_security_limits_dedup.sql` — publika grants, limits och dedupad risk-MV.
- `0024_security_invoker_public_views.sql` — security-invoker på publika vyer skapade efter `0003`.
- `0025_high_speed_badges_80.sql` — utökar kartlagret Höga hastigheter från 90+ till 80+ efter omimport.
- `0027_route_sharing_feedback.sql` — skapar `route_snapshots`, `route_feedback` och RPC:er för delade ruttlänkar och feedbackskapande.
- `0028_route_feedback_update_delete.sql` — lägger till RPC:er för tidigare feedbackkommentarer och för att ta bort feedbackröst.
- `0030_events_dedup_and_orphan_resnap.sql` — dedupad `events_in_bbox` för kartpunkter och timvis resnap av orphans. `resnap-orphan-events` är pausat i produktion sedan 2026-05-13; orphans visas fortsatt med vägnummer + geohash-fallback.
- `0031_performance_indexes_disturbances_bbox.sql` — index för `events.first_seen` och GIST-baserad `disturbances_in_bbox`.
- `0032_route_lane_penalties.sql` — index/RPC för reducerat Lastkajen-underlag till `Stora rondeller` och `Flerfiligt`. Kräver att `scripts/import-route-lane-penalties.sh` har importerat `route_large_roundabouts` och `route_multilane_segments` först.
- `0033_traffic_cameras.sql` — Trafikverkets `Camera`-objekt, publik vy och `traffic_cameras_in_bbox`.

## Dataregler

- Pågående olycka = `last_seen >= now() - 90 min`.
- Kartpunkter dedupas via `events_in_bbox`; riskinfrastruktur och `segment_detail` dedupar logiska olyckor per `fid + message + road_number + first_seen-hour`.
- Risk aggregeras per `fid`, inte `element_id`.
- Riskrelaterade snap-/refresh-cronjobb är pausade i produktion; behandla `event_segments` och `risk_per_segment` som vilande data tills riskdelen återaktiveras.
- `events.raw`, `disturbances.raw`, `traffic_flow_measurements.raw` och `traffic_cameras.raw` ska inte exponeras publikt.
- Publika, tunga RPC:er ska ha både bbox-filter och response-limit.
- `route_lane_penalties_in_bbox(...)` returnerar max 4000 reducerade straffsegment och exponerar inte råtabellerna direkt till `anon`/`authenticated`.

## Supabase-gotchas

- PostGIS ligger i schemat `extensions`. `security definer`-funktioner med explicit `search_path` måste inkludera `extensions`.
- Supabase Data API kräver framåt explicita grants för nya `public`-objekt. Lägg grants i samma migration som objektet och RLS/policies så ny tabell/vy/RPC inte tyst slutar fungera när default privileges ändras.
- Supabase free tier har kort `statement_timeout`; undvik stora bboxar och globala risk-/NVDB-anrop.
- Lastkajen bulkimport ska använda session pooler på port `5432`, inte transaction pooler `6543`.
