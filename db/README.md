# db

Databasschema för trafik-appen. Supabase Postgres + PostGIS.

## Applicera schema

Tre alternativ:

### 1. Supabase SQL Editor (enklast för MVP)
1. Öppna ditt Supabase-projekt → SQL Editor → New query
2. Klistra in innehållet från `migrations/0001_init.sql`
3. Kör

### 2. Supabase CLI
```sh
brew install supabase/tap/supabase
supabase link --project-ref <din-ref>
supabase db push
```

### 3. psql direkt
```sh
psql "$DATABASE_URL" -f migrations/0001_init.sql
```

## Schema i korthet

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

Numrera i ordning: `0002_*.sql`, `0003_*.sql`. En ADR-post per migration i `docs/decisions.md` om valet är icke-trivialt.
