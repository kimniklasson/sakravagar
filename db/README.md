# db

Databasschema för trafik-appen. Supabase Postgres + PostGIS, med migrations för events, NVDB/ÅDT, segmentrisk, störningar, TrafficFlow och publika RPC:er.

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

## Viktiga migrations

- `0004_pg_cron_scrape.sql` — schemalägger Edge Function-scrape via `pg_cron`/`pg_net`.
- `0008_risk_pipeline.sql` + `0009_risk_cron.sql` — snapping och segmentrisk.
- `0011_segment_detail_v2.sql` — popupdetaljer och dedup.
- `0014_correct_dedup_strategy.sql` — `fid`-baserad risk i stället för `element_id`.
- `0018_live_disturbances.sql` — separat störningslager.
- `0019_large_roads_filter.sql` — höghastighetsfilter från Lastkajen.
- `0020_live_traffic_flow.sql` till `0022_stabilize_flow_segments.sql` — TrafficFlow.
- `0023_security_limits_dedup.sql` — publika grants, limits och dedupad risk-MV.
- `0024_security_invoker_public_views.sql` — security-invoker på publika vyer skapade efter `0003`.
- `0025_high_speed_badges_80.sql` — utökar kartlagret Höga hastigheter från 90+ till 80+ efter omimport.
- `0027_route_sharing_feedback.sql` — skapar `route_snapshots`, `route_feedback` och RPC:er för delade ruttlänkar och feedbackskapande.
- `0028_route_feedback_update_delete.sql` — lägger till RPC:er för att uppdatera feedbackkommentar och ta bort feedbackröst.

## Dataregler

- Pågående olycka = `last_seen >= now() - 90 min`.
- Risk och popup dedupar logiska olyckor per `fid + message + road_number + first_seen-hour`.
- Risk aggregeras per `fid`, inte `element_id`.
- `events.raw` ska inte exponeras publikt.
- Publika, tunga RPC:er ska ha både bbox-filter och response-limit.

## Supabase-gotchas

- PostGIS ligger i schemat `extensions`. `security definer`-funktioner med explicit `search_path` måste inkludera `extensions`.
- Supabase free tier har kort `statement_timeout`; undvik stora bboxar och globala risk-/NVDB-anrop.
- Lastkajen bulkimport ska använda session pooler på port `5432`, inte transaction pooler `6543`.
