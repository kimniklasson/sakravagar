# Current state — 2026-04-25 (alla datalager klara, in på UX-fasen)

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
- ✅ **ADT-lager live i prod (2026-04-25)** — `/api/adt?bbox=...` kallar RPC `adt_in_bbox(min_lng,min_lat,max_lng,max_lat)` (migration 0006). RPC:n transformerar bbox till SWEREF99 3006 så GIST-indexet på `nvdb_trafik.geom` används direkt; bara matchande rader transformeras till 4326 för GeoJSON-output. Dedupar till senaste `matarsperiod` per `element_id` (NVDB lagrar varje års mätning som separat rad). `security definer` + explicit `search_path = public, extensions, pg_temp` så `st_transform`/`st_intersects` hittas (PostGIS ligger i `extensions` på Supabase). Frontend-lagret (`addAdtLayer` i `layers.ts`) ritar `line`-lager med `line-color` interpolate på `adt_total` (blå→röd, brytpunkter 500/2k/5k/10k/20k). Slutgiltiga inställningar: `NVDB_MIN_ZOOM = 9` (zoom 8 timeoutade Supabase pga 7° brett bbox), `BBOX_PADDING = 0.3` (30% paddad cache så små panoreringar inte refetchar), area-guard (skippar fetch om paddad bbox > 8 sq°), `line-opacity` interpolerad mellan `NVDB_MIN_ZOOM` och `NVDB_MIN_ZOOM + 1`. Lagret läggs in *före* events-heatmapen så olyckspunkter renderas ovanpå.
- ✅ **TSK-lager live (2026-04-25)** — `/api/tsk?bbox=...` kallar RPC `tsk_in_bbox` (migration 0007). Samma mönster som ADT men utan tids-dedup (TSK lagras som en rad per `element_id`). RPC:n ordnar segment så `Låg` (röd) renderas sist → ovanpå övriga klasser i MapLibre. Frontend-lagret `addTskLayer` ritar `line`-lager med `match`-uttryck på `klass` (RdYlGn: `Mycket god`→`#1a9850`, `God`→`#a6d96a`, `Mindre god`→`#fdae61`, `Låg`→`#d7191c`). Bredare line-width (8→2.5, 12→5, 16→9) än ADT så att ADT-färgen syns som en stripa ovanpå när båda lagren är synliga samtidigt. Render-ordning: TSK underst, ADT ovanpå TSK, events-heatmap överst. Bbox-loader-logiken extraherad till delad helper `createBboxLoader` i `layers.ts`.
- ✅ **Lager-toggle UI (2026-04-25)** — checkbox-panel top-left i kartan (`Map.module.css` `.controls`). Tre toggles (TSK + Risk + ÅDT), alla default på. `addAdtLayer`/`addTskLayer`/`addRiskLayer` returnerar `LayerController { setVisible }`. `setVisible(false)` sätter MapLibre `visibility: none` OCH pausar bbox-loadern (sparar fetches när lagret inte syns). `setVisible(true)` återaktiverar; cachen behålls så det inte sker onödig refetch om viewporten inte hunnit röra sig.

- ✅ **Risk-pipeline live (2026-04-25)** — "olyckor per miljon fordon" per nvdb-segment.
  - **Migration 0008_risk_pipeline.sql:**
    - `events.snap_processed_at` (markör för batch-snap)
    - `event_segments(event_id, fid, distance_m)` — multi-match-kapabel via PK på (event_id, fid), men just nu lagras top-1 per event. RLS på, anon kommer åt via RPC.
    - View `nvdb_trafik_latest` — dedup till senaste matarsperiod per element_id (54 370 unika segment av 66 645 rader).
    - Function `snap_pending_events(p_limit int default 5000) returns int` — plockar oprocessade events, hittar närmaste `nvdb_trafik_latest`-segment inom 50m via `ST_DWithin` + `ORDER BY geom <-> point` + `LIMIT 1`. Markerar alla pending som processade (även de utan match — de stannar utan rad i event_segments).
    - Materialiserad vy `risk_per_segment(fid, element_id, adt_total, events_count, risk_per_milj_fordon, geom)`. UNIQUE-index på fid (krävs för CONCURRENTLY refresh) + GIST på geom.
    - RPC `risk_in_bbox(min_lng, min_lat, max_lng, max_lat)` — filtrerar `events_count > 0` så tomma sträckor inte returneras. Samma 3006-bbox-trick som ADT/TSK för indexträff.
  - **Migration 0009_risk_cron.sql:** två pg_cron-jobb: `snap-event-segments` (`*/5 * * * *`, kör `snap_pending_events(5000)`) och `refresh-risk-mv` (`*/15 * * * *`, `REFRESH MATERIALIZED VIEW CONCURRENTLY risk_per_segment`).
  - **Backfill:** 40 events processerade, 35 snappade (5 var >50m från nvdb-vägar — sannolikt P-platser eller småvägar utanför datasetet). 31 unika segment med olyckor — högst risk just nu på fid 37851 med 3 olyckor på 2 dagar (ÅDT 4449).
  - **Frontend:** `addRiskLayer` i `layers.ts`, `/api/risk?bbox=...`. Färgskala på `log10(risk_per_milj_fordon)` (interpolation 0→2→3→4→5 = grön→gul→orange→röd) eftersom råa värden spänner 6 storleksordningar med så lite data. Render-ordning: TSK → Risk → ADT → events. **Tröskelvärden är preliminära** — kalibreras om när vi har 6+ månader data.
  - **Vid NVDB-re-import:** fid:s kan ändras → `truncate event_segments; update events set snap_processed_at = null;` så cron snapar om allt nästa pass.
  - **Designval om segment-längd (2026-04-25):** Risk-lagret färgar *hela* NVDB-segmentet en olycka snappats till — inte en buffer runt punkten. Längden varierar från ~50m (i tätbebyggt) till flera km (motorvägssträckor utan korsningar) eftersom NVDB delar upp vägar vid korsningar / ändrade attribut. Vi behåller detta eftersom ÅDT-måttet är *segment-aggregerat*: risk = olyckor / (ÅDT × tid) är matematiskt rätt aggregation per segment, inte per godtycklig buffer. Gör att en enstaka olycka kan lysa upp 5km, men det blir mer rättvisande när data mognar (flera olyckor på samma sträcka = starkare signal). Punkten visas separat via circle-lagret vid zoom ≥10. Click-info-popupen ska förklara detta i UI:t när den byggs.

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

1. ~~**TSK-lager**~~ ✅ klart 2026-04-25, se ovan.

2. ~~**Olyckor-per-miljon-fordon**~~ ✅ klart 2026-04-25, se ovan.

### Nu (kart-UX, valt nästa):

**Click-info popup** — högsta prio (överenskommet med Kim 2026-04-25 sen kväll). Klickar man på ett segment ska en popup visa:
- Vägnummer (om någon — finns på events, finns inte i nvdb_trafik direkt; måste kanske utredas vad som finns på NVDB-sidan eller kompletteras från ev. vägnummer-vy)
- ÅDT (`adt_total` från `risk_per_segment` eller `nvdb_trafik_latest`)
- TSK-klass (joina mot `nvdb_tsk` på element_id eller geometrisk närhet — *element_id-join borde funka eftersom samma vägsegmentering*, men verifiera)
- Antal olyckor + datum för senaste i segmentet (från `event_segments` + `events`)
- **Kort förklaring** att alla siffror gäller hela NVDB-segmentet, inte bara olyckspunkten — Kim ställde just denna fråga, och om-tjänsten-text kan därför skjutas tills senare eftersom popupen själv förklarar.

Implementation-skiss att utvärdera i ny session:
- MapLibre `click`-listener på `RISK_LAYER_ID` (eller alla NVDB-lager?) → hämta `feature.properties` + ev. extra fetch för olyckslistan.
- Ny RPC `segment_detail(fid)` som returnerar joined data inkl. olyckor — eller flera /api-anrop. RPC är troligen renare.
- Popup-komponent — MapLibre har inbyggd `Popup` men en custom React-komponent ger bättre kontroll på styling.

### Sen (UX-bygge i ordning):

1. **Legend / förklaring** — fast widget med färgskalor för respektive lager. Naturligt efter click-info.
2. **Om-tjänsten / info-modal** — mer omfattande introduktion. Kanske inte nödvändig om popupen + legend räcker.
3. **Tids-filter** — slider/dropdown: visa events de senaste X dagar/månader/år.
4. **Realtidsoverlays** — pågående olyckor (events som inte har `valid_to`) markerade tydligare än historiska.
5. **Kart-stil + färger** — slutgiltig kalibrering av färgskalor när vi har mer data. Eventuellt byta basemap.

### Bakgrundsbruk (passivt):

- Låt cron rulla → events-tabellen växer. Cron verifierad fungera 2026-04-25 (200 OK var 30:e min). Olyckor-per-miljon-fordon-måttet blir mer meningsfullt ju mer data vi har; minst 1 månad innan det börjar säga något, gärna 6+.

## Gotchas värda att komma ihåg

- **Lastkajen credentials:** Direct connection (`db.<ref>.supabase.co:5432`) är IPv6-only → funkar inte. Använd **Session pooler** på `aws-1-eu-north-1.pooler.supabase.com:5432` (port 5432 — INTE 6543 som är Transaction pooler, den stödjer inte `COPY`).
- **Lösenord i `DATABASE_URL`:** URL-encodas om det innehåller specialtecken (`@` → `%40`, `+` → `%2B`).
- **NVDB-kolumnnamn:** ogr2ogr lowercasar och normaliserar (t.ex. `TS-klass-Stracka` → `ts_klass_stracka`, `Adt_samtliga_fordon` → `adt_samtliga_fordon`). `adt_public`-vyn aliasar till enklare namn (`adt_total`, `adt_tung`, `matar`).
- **Events-tabell är i EPSG:4326, NVDB i EPSG:3006.** Korsnings-join kräver `ST_Transform` — vyerna sköter detta på läsning.
- **PostGIS ligger i `extensions`-schemat på Supabase**, inte `public`. `security definer`-funktioner som sätter explicit `search_path` MÅSTE inkludera `extensions`, annars failar `st_transform`/`st_intersects` etc. med `function ... does not exist`. Vyer ärver connection-default och slipper, men funktioner som åsidosätter måste vara explicita.
- **Supabase free tier `statement_timeout`** för anon är ~8s. En bbox-query på 7° brett (zoom 8 i Sverige) timeoutade direkt — `{"error":"canceling statement due to statement timeout"}`. Vi löste det genom `ADT_MIN_ZOOM = 9` + 30% padding + en `MAX_BBOX_AREA_DEG2 = 8`-guard. För TSK-lagret kommer samma tröskelvärden behövas (zoom 8 → för stor bbox).
- **MapLibre `interpolate` kräver strikt växande input-värden.** Två stops på samma zoom (t.ex. `9 → 0` och `9 → 0.7`) ger silent broken layer (renderas inte). När du bumpar `NVDB_MIN_ZOOM` — kontrollera att inga andra interpolations använder hardcoded zoom-värden som kolliderar. Vi knöt opacity-stops till `NVDB_MIN_ZOOM` + `NVDB_MIN_ZOOM + 1` för att undvika återfall.
- **Risk-lagrets `line-color` använder log10**, inte linjär interpolation, eftersom `risk_per_milj_fordon` spänner 6 storleksordningar med så få datapunkter (~10⁰ till ~10⁶ olyckor/M fordon på 1-2 dagars data). När data mognat (≥6 mån) bör vi byta till linjär interpolation med rimliga brytpunkter (t.ex. 0.05/0.5/2/10 olyckor/M fordon).
- **Preview-MCP fungerar ej i `~/Desktop/`** — macOS TCC + Claude.app:s "disclaimer helper" har generisk code-signing-ID som gör att TCC-grants inte persisterar för spawnade MCP-processer ([issue #36832](https://github.com/anthropics/claude-code/issues/36832)). Bash-tooket inom Claude Code fungerar (huvudprocessen har grants), men `mcp__Claude_Preview__preview_start` faller på `Operation not permitted`. Workaround: flytta projektet till `~/dev/`, `~/Code/`, eller liknande icke-skyddad mapp, ELLER ge Claude.app Full Disk Access. Kim har valt att köra `pnpm web` lokalt själv i en terminal istället för att flytta nu.

## Filer att känna till

| Fil | Vad |
|-|-|
| `scraper/src/trafikverket.ts` | Query-XML byggs här. Namespace + 1.6 + klientfilter. |
| `scraper/src/index.ts` | Orchestrator, upsert till Supabase. |
| `scraper/src/env.ts` | Env-schema: `SUPABASE_SERVICE_KEY` (ej `_ROLE_KEY`). |
| `.github/workflows/cron.yml` | GitHub Actions cron. Schema `17,47 * * * *`. Ingen `version:` på `pnpm/action-setup`. |
| `web/components/Map/MapLoader.tsx` | Client wrapper runt dynamisk MapLibre-import. |
| `web/components/Map/Map.tsx` | MapLibre-karta. Anropar `addTskLayer` + `addRiskLayer` + `addAdtLayer` + `addEventsLayer` på `load`. Toggle-UI för TSK+Risk+ÅDT ovanpå kartan. |
| `web/components/Map/Map.module.css` | `.map` + `.controls`-panel-styling. |
| `web/components/Map/layers.ts` | Lager-definitioner. `addEventsLayer` (heatmap+circles), `addAdtLayer` + `addTskLayer` + `addRiskLayer` (line, bbox-driven via delad `createBboxLoader`). Returnerar `LayerController { setVisible }`. |
| `web/app/api/events/route.ts` | Hämtar `events_public` från Supabase. |
| `web/app/api/adt/route.ts` | Kallar RPC `adt_in_bbox(min_lng,min_lat,max_lng,max_lat)`. Kräver `bbox`-param. |
| `web/app/api/tsk/route.ts` | Kallar RPC `tsk_in_bbox`. Samma mönster som /api/adt. |
| `web/app/api/risk/route.ts` | Kallar RPC `risk_in_bbox`. Returnerar fid, adt_total, events_count, risk_per_milj_fordon, geometry. |
| `db/migrations/0006_adt_rpc.sql` | RPC `adt_in_bbox` (security definer, transformerar bbox till 3006 för GIST-träff, dedupar via `row_number` på `element_id`). |
| `db/migrations/0007_tsk_rpc.sql` | RPC `tsk_in_bbox` (samma mönster, utan tids-dedup, sorterar Låg-segment sist för render-ordning). |
| `db/migrations/0008_risk_pipeline.sql` | Hela risk-pipelinen: `event_segments`-tabell, `nvdb_trafik_latest`-vy, `snap_pending_events()`-funktion, `risk_per_segment` MV, `risk_in_bbox`-RPC. |
| `db/migrations/0009_risk_cron.sql` | pg_cron-jobben `snap-event-segments` (var 5:e min) + `refresh-risk-mv` (var 15:e min). |
| `.env` (rooten, ej committad) | `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (session pooler, URL-encodad). |
| `db/migrations/0001_init.sql` | Events-tabell + `events_public`-vy. |
| `db/migrations/0002_nvdb.sql` | Index + vyer `adt_public`, `tsk_public`, `tsk_rank`. |
| `scripts/import-nvdb.sh` | ogr2ogr-wrapper för att importera NVDB-GPKG från Lastkajen. Sällan-körd (årligen). |
| `scripts/README.md` | Setup-guide för NVDB-import (GDAL, DATABASE_URL). |
| `~/Desktop/ClaudeAI/Trafik_data/sakravagar_bas_2026_04_240307.gpkg` | Lastkajen-paketet. Inte i repot. Används vid ny import. |
