# Current state — 2026-04-25 (post-ADT-lager)

Körbar sammanfattning för att fortsätta i ny session. Läs denna + `PROJECT.md` + `docs/decisions.md` för full kontext.

## Vad som är klart

- ✅ Monorepo scaffoldat (`scraper/`, `web/`, `shared/`, `db/`, `scripts/`)
- ✅ Supabase-projekt uppsatt (North EU / Stockholm), PostGIS aktiverat, schema applicerat (0001 + 0002)
- ✅ Trafikverket-nyckel `trafik-prod` skapad
- ✅ Scrapern funkar end-to-end — hämtar Deviations (filter `MessageType=Olycka`) och upsertar till Supabase
- ✅ **Schemaläggning via Supabase pg_cron + pg_net → Edge Function `scrape`** (sedan 2026-04-25). GitHub Actions schedule glider/hoppas över under hög last (såg 1–2h gap över natten); migrerade därför till pg_cron som kör `*/30 * * * *` direkt i databasen. Edge Function (`supabase/functions/scrape/index.ts`) är Deno-port av scrapern. Secrets i Supabase: `TRAFIKVERKET_API_KEY`, `SCRAPE_SHARED_SECRET`. Cron-jobbet ligger inlinat med URL+secret i `cron.job` (Supabase tillåter inte ALTER DATABASE för icke-superusers). GitHub Actions-workflowen behållen som manuell nödknapp (`workflow_dispatch`).
- ✅ **Vercel live** — https://sakravagar.vercel.app/ (root = `web/`, Next.js, env `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Auto-deploy på push till `main`.
  - Gotcha löst: Next 15 App Router tillåter inte `ssr: false` i Server Components. Dynamisk MapLibre-import ligger nu i en client wrapper: `web/components/Map/MapLoader.tsx`.
- ✅ **MVP-heatmap kopplad** — `web/components/Map/layers.ts` hämtar från `/api/events` (som läser `events_public`-vyn) och ritar MapLibre `heatmap`-lager + circle-lager som tonar in vid zoom ≥10.
  - Gotcha löst: API-routen läste `SUPABASE_URL`/`SUPABASE_ANON_KEY` men på Vercel var bara `NEXT_PUBLIC_*`-varianterna satta. Routen har nu fallback till `NEXT_PUBLIC_*`.
- ✅ **NVDB-data importerad från Lastkajen (2026-04-24)** — ÅDT + TSK i Supabase via `scripts/import-nvdb.sh`:
  - `nvdb_trafik` — 66 645 segment, `Adt_samtliga_fordon`, `Adt_tunga_fordon`, `osakerhet_samtliga_fordon`, `matarsperiod` (YYYYMM, senaste 2026), `matmetod`, LINESTRING i SWEREF99 TM (EPSG:3006)
  - `nvdb_tsk` — 26 642 segment, `ts_klass_stracka` (`Mycket god`, `God`, `Mindre god`, `Låg`), LINESTRING i 3006
  - Vägtrafiknät (2.5M segment) medvetet **ej importerat** — skulle äta upp hela Supabase free tier. Filen sparad i `~/Desktop/ClaudeAI/Trafik_data/sakravagar_bas_2026_04_240307.gpkg` för framtida import om/när vi behöver hela vägnätet (t.ex. för routing-fas).
  - Publika vyer `adt_public`, `tsk_public` (och `tsk_rank`) serverar GeoJSON i WGS84 med 6 decimalers precision — redo för MapLibre.
- ✅ **ADT-lager live (2026-04-25)** — `/api/adt?bbox=...` kallar RPC `adt_in_bbox(min_lng,min_lat,max_lng,max_lat)` (migration 0006). RPC:n transformerar bbox till SWEREF99 3006 så GIST-indexet på `nvdb_trafik.geom` används direkt; bara matchande rader transformeras till 4326 för GeoJSON-output. Dedupar till senaste `matarsperiod` per `element_id` (NVDB lagrar varje års mätning som separat rad). `security definer` + explicit `search_path = public, extensions, pg_temp` så `st_transform`/`st_intersects` hittas (PostGIS ligger i `extensions` på Supabase). Frontend-lagret (`addAdtLayer` i `layers.ts`) ritar `line`-lager med `line-color` interpolate på `adt_total` (blå→röd, brytpunkter 500/2k/5k/10k/20k), `minzoom: 8`, paddad bbox-cache (50%) så små panoreringar/inzoomningar inte triggar refetch. Lagret läggs in *före* events-heatmapen så olyckspunkter renderas ovanpå.

## Trafikverket-query (fungerande)

```xml
<QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="1000">
  <FILTER>
    <EQ name="Deviation.MessageType" value="Olycka" />
  </FILTER>
</QUERY>
```

- `namespace="Road.TrafficInfo"` krävs
- `schemaversion="1.6"` är aktuell
- Scrapern filtrerar klientsidan bort icke-`Olycka` Deviations (EQ matchar Situationer där minst en Deviation är Olycka, syskon-Deviations följer med i svaret)

## Nästa steg

1. **Verifiera ADT-lagret i prod** — `migration 0006_adt_rpc.sql` är applicerad i Supabase. Vid deploy: kolla att `/api/adt?bbox=...` returnerar segment och att linjer dyker upp vid zoom ≥ 8.
2. **TSK-lager** analogt — RPC `tsk_in_bbox` mot `nvdb_tsk`, line-color på `klass` (`Mycket god`→grön, `Låg`→röd). Borde vara en kort iteration nu när mönstret är satt.
3. **Förfina heatmap** när olycksdata växt mer: räkna olyckor per miljon fordon (`events × 1e6 / (adt_total × 365)`) som heatmap-weight. Då blir det *farliga* vägar, inte *stora* vägar. Kräver join events↔nvdb (snap event-punkt till närmaste segment) — en separat tabell eller materialized view.
4. **Låt cron rulla 2–3 dagar** (passivt) och verifiera att events-tabellen växer rimligt. Cron verifierad fungera 2026-04-25 — 200 OK var 30:e minut efter 401-fix.

## Gotchas värda att komma ihåg

- **Lastkajen credentials:** Direct connection (`db.<ref>.supabase.co:5432`) är IPv6-only → funkar inte. Använd **Session pooler** på `aws-1-eu-north-1.pooler.supabase.com:5432` (port 5432 — INTE 6543 som är Transaction pooler, den stödjer inte `COPY`).
- **Lösenord i `DATABASE_URL`:** URL-encodas om det innehåller specialtecken (`@` → `%40`, `+` → `%2B`).
- **NVDB-kolumnnamn:** ogr2ogr lowercasar och normaliserar (t.ex. `TS-klass-Stracka` → `ts_klass_stracka`, `Adt_samtliga_fordon` → `adt_samtliga_fordon`). `adt_public`-vyn aliasar till enklare namn (`adt_total`, `adt_tung`, `matar`).
- **Events-tabell är i EPSG:4326, NVDB i EPSG:3006.** Korsnings-join kräver `ST_Transform` — vyerna sköter detta på läsning.
- **PostGIS ligger i `extensions`-schemat på Supabase**, inte `public`. `security definer`-funktioner som sätter explicit `search_path` MÅSTE inkludera `extensions`, annars failar `st_transform`/`st_intersects` etc. med `function ... does not exist`. Vyer ärver connection-default och slipper, men funktioner som åsidosätter måste vara explicita.

## Filer att känna till

| Fil | Vad |
|-|-|
| `scraper/src/trafikverket.ts` | Query-XML byggs här. Namespace + 1.6 + klientfilter. |
| `scraper/src/index.ts` | Orchestrator, upsert till Supabase. |
| `scraper/src/env.ts` | Env-schema: `SUPABASE_SERVICE_KEY` (ej `_ROLE_KEY`). |
| `.github/workflows/cron.yml` | GitHub Actions cron. Schema `17,47 * * * *`. Ingen `version:` på `pnpm/action-setup`. |
| `web/components/Map/MapLoader.tsx` | Client wrapper runt dynamisk MapLibre-import. |
| `web/components/Map/Map.tsx` | MapLibre-karta. Anropar `addAdtLayer` + `addEventsLayer` på `load`. |
| `web/components/Map/layers.ts` | Lager-definitioner. `addEventsLayer` (heatmap+circles) + `addAdtLayer` (line, bbox-driven via moveend). |
| `web/app/api/events/route.ts` | Hämtar `events_public` från Supabase. |
| `web/app/api/adt/route.ts` | Kallar RPC `adt_in_bbox(min_lng,min_lat,max_lng,max_lat)`. Kräver `bbox`-param. |
| `db/migrations/0006_adt_rpc.sql` | RPC `adt_in_bbox` (security definer, transformerar bbox till 3006 för GIST-träff, dedupar via `row_number` på `element_id`). |
| `.env` (rooten, ej committad) | `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (session pooler, URL-encodad). |
| `db/migrations/0001_init.sql` | Events-tabell + `events_public`-vy. |
| `db/migrations/0002_nvdb.sql` | Index + vyer `adt_public`, `tsk_public`, `tsk_rank`. |
| `scripts/import-nvdb.sh` | ogr2ogr-wrapper för att importera NVDB-GPKG från Lastkajen. Sällan-körd (årligen). |
| `scripts/README.md` | Setup-guide för NVDB-import (GDAL, DATABASE_URL). |
| `~/Desktop/ClaudeAI/Trafik_data/sakravagar_bas_2026_04_240307.gpkg` | Lastkajen-paketet. Inte i repot. Används vid ny import. |
