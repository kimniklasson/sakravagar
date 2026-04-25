# Current state — 2026-04-25 (ADT-lager live i prod)

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
- ✅ **ADT-lager live i prod (2026-04-25)** — `/api/adt?bbox=...` kallar RPC `adt_in_bbox(min_lng,min_lat,max_lng,max_lat)` (migration 0006). RPC:n transformerar bbox till SWEREF99 3006 så GIST-indexet på `nvdb_trafik.geom` används direkt; bara matchande rader transformeras till 4326 för GeoJSON-output. Dedupar till senaste `matarsperiod` per `element_id` (NVDB lagrar varje års mätning som separat rad). `security definer` + explicit `search_path = public, extensions, pg_temp` så `st_transform`/`st_intersects` hittas (PostGIS ligger i `extensions` på Supabase). Frontend-lagret (`addAdtLayer` i `layers.ts`) ritar `line`-lager med `line-color` interpolate på `adt_total` (blå→röd, brytpunkter 500/2k/5k/10k/20k). Slutgiltiga inställningar: `ADT_MIN_ZOOM = 9` (zoom 8 timeoutade Supabase pga 7° brett bbox), `BBOX_PADDING = 0.3` (30% paddad cache så små panoreringar inte refetchar), area-guard (skippar fetch om paddad bbox > 8 sq°), `line-opacity` interpolerad mellan `ADT_MIN_ZOOM` och `ADT_MIN_ZOOM + 1` (båda stops kopplade till konstanten så de inte kan glida isär igen). Lagret läggs in *före* events-heatmapen så olyckspunkter renderas ovanpå.

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

**Strategi enligt Kim (2026-04-25):** Färdigställ alla *datalager* på kartan först (TSK + olyckor-per-miljon-fordon). Spara UI/UX/styling/legend till sist eftersom färgval, kart-stil, click-info etc kan påverkas av vilka lager som ska samexistera. Tids-filter och realtidsoverlays är också på listan men kommer efter datalager + kart-stil.

### Nu (datalager kvar):

1. **TSK-lager** — analogt med ADT. RPC `tsk_in_bbox(min_lng,min_lat,max_lng,max_lat)` mot `nvdb_tsk` (~27k segment). Line-color på `klass`: `Mycket god`→grön, `God`→ljusgrön/gul, `Mindre god`→orange, `Låg`→röd. Frontend: `addTskLayer` i samma fil, samma bbox-cache-mönster, troligen `minzoom: 9` också. Lägg in *före* events-heatmap (samma argument). Behöver bestämma: ska TSK och ADT visas samtidigt? Annars toggle. För MVP: visa båda samtidigt med olika line-width eller line-offset så de inte täcker varandra exakt — eller helt enkelt rita TSK något tjockare som "underlag" och ADT smalare ovanpå. Att fundera på i sessionen.

2. **Olyckor-per-miljon-fordon** — själva risk-måttet. Måste:
   - Snap:a varje `events`-punkt (EPSG:4326) till närmaste `nvdb_trafik`-segment (EPSG:3006). Mest praktiskt med `ST_DWithin` + `ST_Distance` + `ORDER BY ... LIMIT 1` per event. Tröskelvärde t.ex. 50m, annars matchas inte alls (parkering, småväg).
   - Aggregera per segment: `count(events) / (adt_total * 365 / 1e6)` → "olyckor per miljon fordon".
   - Materialiserad vy eller separat tabell — beräkna periodvis (cron, t.ex. 1×/dygn nattetid). Live-join är för dyrt.
   - Lager: replace heatmap-weight, eller separat lager. Funderar i sessionen.

### Sen (kart-UX/styling):

3. **Kart-stil + färger** — välj definitiv färgskala för ADT/TSK/risk. Kanske byta basemap-stil (Positron är ren men neutral; det finns "Liberty" eller egna stilar). Beslut här påverkar legend/copy.
4. **Legend / förklaring** — fast widget i kartan som visar färgskalor + lager-toggle.
5. **Click-info** — popup med vägnummer, ÅDT, säkerhetsklass, olyckor senaste året när man klickar på ett segment.
6. **Tids-filter** — slider/dropdown: visa events de senaste X dagar/månader/år.
7. **Realtidsoverlays** — pågående olyckor (events som inte har `valid_to`) markerade tydligare än historiska.

### Bakgrundsbruk (passivt):

- Låt cron rulla → events-tabellen växer. Cron verifierad fungera 2026-04-25 (200 OK var 30:e min). Olyckor-per-miljon-fordon-måttet blir mer meningsfullt ju mer data vi har; minst 1 månad innan det börjar säga något, gärna 6+.

## Gotchas värda att komma ihåg

- **Lastkajen credentials:** Direct connection (`db.<ref>.supabase.co:5432`) är IPv6-only → funkar inte. Använd **Session pooler** på `aws-1-eu-north-1.pooler.supabase.com:5432` (port 5432 — INTE 6543 som är Transaction pooler, den stödjer inte `COPY`).
- **Lösenord i `DATABASE_URL`:** URL-encodas om det innehåller specialtecken (`@` → `%40`, `+` → `%2B`).
- **NVDB-kolumnnamn:** ogr2ogr lowercasar och normaliserar (t.ex. `TS-klass-Stracka` → `ts_klass_stracka`, `Adt_samtliga_fordon` → `adt_samtliga_fordon`). `adt_public`-vyn aliasar till enklare namn (`adt_total`, `adt_tung`, `matar`).
- **Events-tabell är i EPSG:4326, NVDB i EPSG:3006.** Korsnings-join kräver `ST_Transform` — vyerna sköter detta på läsning.
- **PostGIS ligger i `extensions`-schemat på Supabase**, inte `public`. `security definer`-funktioner som sätter explicit `search_path` MÅSTE inkludera `extensions`, annars failar `st_transform`/`st_intersects` etc. med `function ... does not exist`. Vyer ärver connection-default och slipper, men funktioner som åsidosätter måste vara explicita.
- **Supabase free tier `statement_timeout`** för anon är ~8s. En bbox-query på 7° brett (zoom 8 i Sverige) timeoutade direkt — `{"error":"canceling statement due to statement timeout"}`. Vi löste det genom `ADT_MIN_ZOOM = 9` + 30% padding + en `MAX_BBOX_AREA_DEG2 = 8`-guard. För TSK-lagret kommer samma tröskelvärden behövas (zoom 8 → för stor bbox).
- **MapLibre `interpolate` kräver strikt växande input-värden.** Två stops på samma zoom (t.ex. `9 → 0` och `9 → 0.7`) ger silent broken layer (renderas inte). När du bumpar `ADT_MIN_ZOOM` — kontrollera att inga andra interpolations använder hardcoded zoom-värden som kolliderar. Vi knöt opacity-stops till `ADT_MIN_ZOOM` + `ADT_MIN_ZOOM + 1` för att undvika återfall.

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
| `db/migrations/0006_adt_rpc.sql` | RPC `adt_in_bbox` (security definer, transformerar bbox till 3006 för GIST-träff, dedupar via `row_number` på `element_id`). Mönster att följa för `tsk_in_bbox` i nästa migration (0007). |
| `.env` (rooten, ej committad) | `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (session pooler, URL-encodad). |
| `db/migrations/0001_init.sql` | Events-tabell + `events_public`-vy. |
| `db/migrations/0002_nvdb.sql` | Index + vyer `adt_public`, `tsk_public`, `tsk_rank`. |
| `scripts/import-nvdb.sh` | ogr2ogr-wrapper för att importera NVDB-GPKG från Lastkajen. Sällan-körd (årligen). |
| `scripts/README.md` | Setup-guide för NVDB-import (GDAL, DATABASE_URL). |
| `~/Desktop/ClaudeAI/Trafik_data/sakravagar_bas_2026_04_240307.gpkg` | Lastkajen-paketet. Inte i repot. Används vid ny import. |
