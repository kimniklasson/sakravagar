# Current state — 2026-04-27 (overlays komplett: top-left + bottom-left + right-side, 3-tier typografi)

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
- ✅ **Om-modal (2026-04-26)** — "Om tjänsten"-knapp längst ner i `.controls`-panelen öppnar en centrerad modal (480px max, backdrop med rgba 0.45) som förklarar vad kartan visar. Innehåller: intro, "Lager"-lista (TSK/ÅDT/Risk/Olyckor med kort förklaring per lager), "Tips"-lista (klick/toggle/tidsfilter/zoom), och "Datakällor" (Trafikverket Open API + NVDB via Lastkajen) med disclaimer. **Stängning:** X-knapp (top-right i modalen), klick på backdrop, eller Escape-tangenten — useEffect på `aboutOpen` registrerar/avregistrerar Escape-listenern. **A11y:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="about-title"`, `aria-label="Stäng"` på X-knappen. Bestämt nu att hoppa över first-visit auto-show / localStorage — bara öppna/stäng-element räcker tills vidare. Hela modalen är troligen kandidat för redesign när Kim ger screenshots/specifikation.

- ✅ **Hit-target-lager för historiska events (2026-04-26)** — fix för att klick på heatmap-pixlar utzoomat inte gjorde något. `events-circles` har `minzoom: 10` så historiska events syntes/var klickbara först vid zoom 10+. Lade till `events-hit-target`-lager: samma source/filter som historical (`is_live = false`), `circle-radius: 10`, `circle-opacity: 0`, ingen minzoom. Inkluderat sist i `eventLayerIds`-prioriteten så live-core och synliga circles vinner när de finns. Resultat: klickbara historiska events vid alla zoom-nivåer (samma UX som live), heatmappen oförändrad visuellt.

- ✅ **segment_detail performance fix (2026-04-26, migration 0015)** — fix för "canceling statement due to statement timeout" på första-tredje klick på segment.
  - **Diagnos via EXPLAIN ANALYZE:** segment_detail tog **4183 ms** cold på en single-fid call, med temp read=480 written=482 (= disk-spill). Två orsaker:
    1. `nvdb_trafik_latest` är en VIEW med `rank()`-window över hela `nvdb_trafik` (66k rader). Postgres kan inte pusha down `where l.fid = p_fid` genom window function → varje anrop scannade hela tabellen.
    2. `nvdb_tsk` saknade index på `element_id`. Subqueryn `select ts_klass_stracka from nvdb_tsk where element_id = ...` scannade hela 26k-tabellen varje anrop.
  - **Fix:** index på `nvdb_tsk(element_id)` + skriv om `segment_detail` att gå direkt mot `nvdb_trafik` via fid (pkey-lookup) och ta senaste matarsperiod för just den fid:n med `order by matarsperiod desc limit 1`. Hoppar över window-vyn helt.
  - **Resultat: 4183 ms → 3-11 ms** (~400× snabbare), inget temp-spill längre. Långt under 8s anon-timeout.
  - **Logikskillnad mot vyn:** vyn rankar matarsperiod desc per element_id och behåller alla syskon-fids inom senaste perioden; nya RPC:n tar senaste mätningen för just den fiden vi vill visa. I praktiken samma resultat för Lastkajen-snapshots där alla rader har samma matarsperiod, men semantiken är mer "visa senaste mätning för detta segment" vilket är vad popupen vill ha.
  - **Frontend oförändrat** — RPC:n returnerar samma jsonb-shape, bara snabbare. (`tsk_klass`-fältet togs sen bort i 0016, se nedan.)

- ✅ **TSK borttaget (2026-04-26, migration 0016)** — TSK-lagret tillförde marginellt värde (klassningen korrelerar starkt med ÅDT), så det togs bort för att förenkla UI:t och fokusera på Risk + ÅDT + olyckor.
  - **DB:** "soft removal" snarare än drop — `nvdb_tsk` renamed till `nvdb_tsk_deprecated`, `tsk_in_bbox`-RPC droppad, `tsk_public` + `tsk_rank`-vyer droppade, `nvdb_tsk_element_id_idx` (skapad i 0015) droppat. Datan finns kvar på disk för enkel återställning utan att behöva re-importera från Lastkajen-paketet. Återställning: `alter table nvdb_tsk_deprecated rename to nvdb_tsk` + recreate views/RPC från 0007.
  - **`segment_detail` uppdaterad** att inte returnera `tsk_klass` i jsonb-resultatet. Fortsatt snabb (3-11 ms).
  - **Frontend:** borttagen `addTskLayer` + alla referenser i `layers.ts`, borttagen toggle/legend/modal-rad i `Map.tsx`, raderad `web/app/api/tsk/route.ts`, borttagen TSK-fältet från `SegmentDetail`-typen och TSK-raden från segment-popupen. Render-ordning är nu: Risk underst, ADT ovanpå, events överst.
  - **Tabellstorlek:** ~23 MB datan kvarvarande som arkiv (i `nvdb_tsk_deprecated`); inte återanvänt fysiskt utrymme just nu men inte heller längre i anon API yta.

- ✅ **Glapp i ÅDT-färgning förklarat + dokumenterat (2026-04-26)** — Kim noterade vita glapp mitt på motorvägar (E4/E20 vid Kungens Kurva). Verifierat: bara 5 av 62 741 rader i `nvdb_trafik` har null-ÅDT, så glappen beror inte på vår filtrering. Det är NVDB:s grunddata — Trafikverket mäter per "avsnitt" (mellan korsningar), och korta segment vid trafikplatser/avfarter får ofta ingen mätning. Att fylla i glappen skulle kräva selektiv import av Vägtrafiknät-mängden vilket hade varit hanterbart men inte värt det. **Beslut: acceptera + dokumentera.** Kort förtydligande tillagt i om-modalens ÅDT-listrad. Kim flaggade samtidigt att han inte är säker på att vilja behålla ÅDT-lagret visuellt på sikt — det är primärt ett medel för risk-viktning, inte en slutprodukt. Sparat som feedback-memory så framtida sessioner inte protectar ÅDT-lagret som om det vore kärnfunktion.

- ✅ **Lastkajen ÅDT-täckning sanity-checked (2026-04-26)** — Kim verifierade i Lastkajens UI att kategorin "Vägtrafikdata" bara innehåller en dataprodukt: **"Trafik"**. Det är samma produkt vi redan har importerat som `nvdb_trafik` (66645 segment, 62741 efter 0017-städningen). **Slutsats: WYSIWYG på Lastkajen för aggregerad ÅDT.** Inga blindspots — vi har allt NVDB tillhandahåller.
  - **Bonus-insikt från Lastkajens tooltip för "Trafik":** *"ÅDT som redovisas är ett flöde för hela mätavsnittet och baserar sig på 2 till 6 mätningar fördelade på vardag och helg i en slumpmässigt vald punkt inom avsnittet. Flödet kan även vara ett bedömt värde."* Två viktiga konsekvenser:
    1. **Underlaget är tunt** — 2-6 mätningar per avsnitt. Förklarar varför `osakerhet_samtliga_fordon`-fältet finns och varför värdena varierar.
    2. **En del värden är modellerade**, inte uppmätta. Vi har `matmetod`-fältet importerat men använder det inte i UI:t — kan vara värt att exponera i segment-popupen vid ett senare tillfälle ("uppmätt" vs "bedömt") för transparens. Inte prioriterat just nu.
  - **Vidare ÅDT-täckning kräver kommunala dataset** (Stockholm/Göteborg/Malmös öppna trafikmätningar) — inte triviall integration, separat fas om/när stadstrafik blir prioriterat.

- ✅ **Rensa gamla ÅDT-mätningar (2026-04-26, migration 0017)** — 3904 äldre rader (av 66645, ~6%) borta. `nvdb_trafik_latest`-vyn dedupar redan till senaste matarsperiod per element_id, så de äldre raderna var död vikt — inga frontend-förändringar behövdes. Storleken på tabellen är fortfarande 95 MB direkt efter (autovacuum återanvänder space över tid; ingen `vacuum full` körs eftersom det kräver lock).

- ✅ **Realtidsoverlays (2026-04-26)** — pågående olyckor markeras tydligt och uppdateras live.
  - **"Pågående" = `last_seen >= now() - 90 min`** (3 polling-cykler à 30 min). Ingen DB-ändring behövdes — Trafikverket droppar avslutade olyckor ur feeden så `last_seen` slutar uppdateras automatiskt. `is_live` härleds client-side i `addEventsLayer` när features konstrueras (`Date.parse(p.last_seen) >= Date.now() - LIVE_THRESHOLD_MS`).
  - **Tre events-lager nu** (allt under samma `events`-source): heatmap (oförändrad, alla events), `events-circles` filtrerat till `is_live = false` (historiska, oförändrad styling), och två nya lager för pågående:
    - `events-live-halo` — pulserande röd cirkel som expanderar och tonas ut (radar-ping). Animeras via `requestAnimationFrame` i `startLivePulse(map)`: `circle-radius` 6 → 28, `circle-opacity` 0.55 → 0, period 1500 ms. Loopen kollar `map.getLayer(LIVE_HALO_LAYER_ID)` varje frame så den avbryter sig själv automatiskt när map.remove() körs. Inga zoombegränsningar.
    - `events-live-core` — statisk röd prick (`#d7191c`) med 2px vit kant, radie 4–10 över zoom 4–16. Alltid synlig.
  - **Render-ordning** (events-stacken, ovanpå NVDB-lagren): heatmap → historical circles → live halo → live core. Live-core är klickbar (öppnar event-popup som vanligt); halo skippas i klick-prioritet eftersom den expanderar och skulle ge "fuzzy" träffyta — klick på halo faller igenom till core eller segment under.
  - **Auto-refresh:** `setInterval(60_000)` i `Map.tsx` kallar `addEventsLayer` igen. `timeWindowRef` läses inifrån intervallet så aktuellt tidsfilter respekteras utan att intervallet behöver återskapas. `addEventsLayer` är idempotent (setData på existerande source) och returnerar nu `{ liveCount }` så frontend kan visa antal.
  - **Badge** i `.controls` (överst, ovanför "Lager"-titeln): röd pulserande prick + "N pågående olyckor". Visas bara när `liveCount > 0`. CSS-puls via `@keyframes livePulse` på box-shadow (för pillen i UI:t — karta-pulsen är rAF eftersom MapLibre canvas inte tar CSS).
  - **Legend-block** "Pågående olyckor" med samma pulserande prick + nooten "Synliga vid alla zoom-nivåer". Wrapper-villkoret för `.legend` utökat till `(tskVisible || riskVisible || adtVisible || liveCount > 0)` så legenden dyker upp så fort något pågår även om alla NVDB-lager är av.
  - **Tidsfilter krockar inte** med pågående: pågående events har per definition färskt `first_seen` också (de finns kvar i feeden), så `since`-filtret stänger aldrig ute dem oavsett vilken bucket användaren väljer.
  - **Live-tröskeln** (90 min) är konstant `LIVE_THRESHOLD_MS` i `layers.ts`. Vid datatestning kan den tillfälligt höjas (t.ex. 7 dagar) för att se renderingen även när inga aktiva events finns just nu.

- ✅ **Tidsfilter för events (2026-04-26)** — dropdown under lager-toggles i samma `.controls`-panel: "Alla / 7d / 30d / 6m / 1y". Default = "Alla". Påverkar bara events-lagret (heatmap + cirklar); risk-lagret är fortsatt aggregerat över hela datafönstret. **API-ändring:** `since`-filtret i `/api/events` bytte från `last_seen` till `first_seen` — `last_seen` är scraperns senaste observation och skulle gjort att gamla pågående olyckor felaktigt dök upp i "senaste 7 dagar". Existerande `since`-param accepterades redan, inga andra callsites använde den. **Frontend:** `addEventsLayer(map, { since })` re-fetchar och kör `setData` på befintlig source (idempotent). `Map.tsx` håller `timeWindow`-state, `sinceFromWindow()` räknar ut ISO-string vid fetch (relativt "nu"). `useEffect` på `timeWindow` re-fetchar; första load gör redan rätt fetch så vi guardar med `mapLoadedRef`. **Verifierat mot prod-API:** alla 57 events ligger inom 7 dagar (cron startade 2026-04-25), så alla dropdown-val ger samma count just nu — sanity-test med `since=morgondagen` returnerar 0. Filtret blir meningsfullt när data mognat.

- ✅ **Legend-widget (2026-04-26)** — fast panel `bottom-left` (`Map.module.css` `.legend`) som förklarar färgskalorna för varje aktivt lager. Hela widgeten döljs om alla tre lager-toggles är av; varje sektion visas/döljs i takt med sin checkbox. **TSK:** 2×2-grid med 4 kategori-rutor (Mycket god/God/Mindre god/Låg). **Risk:** gradient + "låg → hög"-etiketter + "Preliminär — kalibreras när data mognat"-not. Medvetet inga absoluta tal eftersom log10-värdena är vilseledande vid nuvarande datavolym. **ÅDT:** gradient med exakt samma stops som kartans interpolation (500 vid 0%, 2000 vid 7.69%, 5000 vid 23.08%, 10000 vid 48.72%, 20000 vid 100%) så en färg i legenden visuellt motsvarar samma färg på kartan. Etiketter: "500" / "20 000+" + under-not "fordon/dygn". Positionerad `bottom: 28px` för att inte krocka med MapLibres attribution-control.

- ✅ **Lager-toggle UI (2026-04-25)** — checkbox-panel top-left i kartan (`Map.module.css` `.controls`). Tre toggles (TSK + Risk + ÅDT), alla default på. `addAdtLayer`/`addTskLayer`/`addRiskLayer` returnerar `LayerController { setVisible }`. `setVisible(false)` sätter MapLibre `visibility: none` OCH pausar bbox-loadern (sparar fetches när lagret inte syns). `setVisible(true)` återaktiverar; cachen behålls så det inte sker onödig refetch om viewporten inte hunnit röra sig.

- ✅ **Click-info popup (2026-04-25 sen kväll, uppdaterad 2026-04-26)** — klick på ett NVDB-segment visar segmentdetaljer; klick på en eventcirkel visar event-detaljer.
  - **Migration 0010_segment_detail.sql:** första versionen av RPC `segment_detail(p_fid bigint) returns jsonb`. Joinar `nvdb_trafik_latest` + `nvdb_tsk` + `risk_per_segment` + senaste 5 events via `event_segments`. `security definer` + `search_path = public, extensions, pg_temp`.
  - **Migration 0011_segment_detail_v2.sql (2026-04-26):** ersätter RPC:n med dedup-logik + risk-procent + datafönster.
    - **Dedup:** `distinct on (coalesce(message,''), coalesce(road_number,''), date_trunc('hour', first_seen))` — Trafikverket lägger upp flera meddelanden för samma incident (initial rapport, "kvar på platsen", uppdateringar) och scrapern lagrar varje med eget id. RPC:n behandlar nu en grupp med samma text/vägnr/timme som *en* logisk olycka. Påverkar både `events_count` och `recent_events`.
    - **`data_window_days`:** `(now() - min(first_seen)) / 86400` från ALLA events (datasamlingens fönster), inte segmentets eget. Per-segment-fönster skulle inflatera risken på sträckor som varit "tysta" länge före en olycka.
    - **`risk_per_passage_pct`:** `events_count / (adt_total * data_window_days) * 100`. Frontenden visar med 2 signifikanta siffror.
    - **`risk_per_milj_fordon`:** behållen för bakåtkompat men beräknad på dedup-talet.
    - Min-cap på datafönstret: `greatest(1.0/24.0, ...)` så vi aldrig delar med ≈ 0 första timmen.
  - **API route** `/api/segment?fid=N` (`web/app/api/segment/route.ts`) kallar RPC:n. Exporterar `SegmentDetail`-typen (`risk_per_passage_pct`, `data_window_days`, `risk_per_milj_fordon`, …) som `layers.ts` återanvänder.
  - **`/api/events` utökad (2026-04-26):** selectar nu också `message`, `severity`, `first_seen` (utöver `last_seen`) — eventcirklarna får dem som GeoJSON-feature-properties så event-popupen kan rendera utan extra fetch.
  - **Click-handler** `addPopupHandler(map)` i `layers.ts` (hette `addSegmentClickHandler` t.o.m. 2026-04-25). Lyssnar på events-circles + alla tre NVDB-lager. Prioritetsordning vid klick: **events-circles → risk → adt → tsk** — eventcirkeln vinner alltid om den ligger under klick-punkten, klick lite vid sidan om faller igenom till segmentet. Cursor → pointer på hover för alla fyra lagren.
  - **Två popup-flöden:**
    - **Event-popup** (`renderEvent`): all data finns redan på feature.properties, ingen fetch. Visar vägnummer, datum (`first_seen`), severity och full message-text. Footer: "Klicka på vägsegmentet för aggregerad statistik. Saknas vägen i ÅDT-datasetet visas ingen färgning."
    - **Segment-popup** (`renderSegment`): RPC-anrop till `/api/segment?fid=N` med `renderLoading()` som direkt feedback. Visar vägnr-grupp (unika från events), ÅDT (mätår), säkerhetsklass, **antal olyckor (deduplicerat)**, **risk i procent per passage**, **datafönster** (formaterad: timmar / X dagar / X månader / X år). När datafönstret är < 30 dagar markeras risk-värdet med "*" och en orange info-ruta längst ner: *"Datafönstret är kort — riskvärdet är preliminärt och kan förändras kraftigt när mer historik samlats in."* Tröskeln `DATA_WINDOW_THIN_DAYS = 30` ligger som konstant överst i popup-blocket.
  - **Popup-styling** ligger i `web/styles/globals.css` (klassprefix `seg-popup-*`). MapLibre renderar popup-DOM utanför Reacts träd, så CSS Modules funkar inte — globala selektorer krävs. Använder design tokens (`--color-text`, `--color-border`, `--color-severity-med` för warn-rutan, etc) från `tokens.css`.
  - **HTML-escape:** alla värden från databasen (message, road_number, klass, severity, datafönster-text) körs genom `escapeHtml` innan de stoppas in i `setHTML`.

- ✅ **Self-healing snap-pipeline (2026-04-26)** — fix för "orphan events" (events markerade som processed men utan rad i `event_segments`).
  - **Bakgrund:** Kim observerade ett E20-event (Galmetorp) som inte hade vägfärgning. Diagnostik visade att eventet låg 0,6 m från ett ÅDT-segment men ändå saknade `event_segments`-rad. Manuell match-query funkade omedelbart. Det betyder att match-grenen i `snap_pending_events` failade transient (statement-timeout, samtidig vy-eval, eller liknande) men `update`-grenen markerade ändå eventet som processed → "stuck" utan möjlighet till retry. CTE-kedjan har inner-join-semantik på match-grenen men full update-ALLA på markera-grenen, så missarna blir tysta.
  - **Migration 0012_resnap_orphans.sql:**
    1. **Snap-radie höjd 50 → 75m** i `snap_pending_events()`. Motorvägar är ofta 30–40m breda inkl. mittremsa, plus GPS-noggrannhet på 5–15m, så 50m var nära kanten. 75m fångar fler legitima träffar utan att börja matcha till parallella servicevägar (de är vanligen >100m bort).
    2. **`resnap_orphan_events(p_limit)`** — idempotent funktion som hittar `events` med `snap_processed_at IS NOT NULL` men utan `event_segments`-rad och försöker snappa dem på nytt. Bara insert-grenen körs (ingen markeringen), `ON CONFLICT DO NOTHING` så det är säkert att köra parallellt.
    3. **Nytt pg_cron-jobb `resnap-orphan-events`** — körs dagligen kl 03:30 UTC (lågbelastning). Catch-all för framtida transient-failures utan att kostnaden för var-5-min-snap förändras.
    4. **Engångs-körning** i botten av migrationen: `select resnap_orphan_events()` + `refresh materialized view concurrently risk_per_segment` så de nya event_segments-raderna syns i risk-färgningen direkt utan att vänta på nästa */15-min refresh.
  - **Förväntad effekt:** 2 av 6 orphan-events i db just nu (mätt 2026-04-26 morgon) borde snappas direkt vid migrationkörning. Resterande 3 är >100m från NVDB (P-platser, småvägar) och kommer aldrig matcha; det 6:e saknar geom-data.
  - **Faktiskt utfall: 3 events insertades** efter migration (en mer än förväntat) — den höjda 50→75m-radien fångade ett event i 50–75m-intervallet som tidigare missade.

- ⚠️ **0013 var fel premiss — ersatt av 0014 (2026-04-26)**. Den första hypotesen var att flera fids inom samma element_id var "samma fysiska segment, olika mätningar" och borde aggregeras ihop. Verklig data visade motsatsen: element_id är en NVDB-logisk grupperare (vägelement) som kan delas av flera **fysiskt olika** sträckor. För element 12753:300613 finns 5 fids över ~7 km E20 (Bragnum, Galmetorp, m.fl.). 0013-fix:en aggregerade alla events i samma element_id till "lägsta fid" (Bragnum) → Galmetorp-olyckan färgade Bragnum-sträckan, 5 km bort. Helt fel sträcka.

- ✅ **Korrekt dedup-strategi (2026-04-26, migration 0014)** — fix för Galmetorp pekar på Galmetorp.
  - **Insikt:** `element_id` är inte fysisk identifier. Dedup på element_id gör att olika sträckor slås samman, vilket är fel. Korrekt strategi:
    - Per element_id: behåll bara den senaste matarsperioden (filtrerar bort år-dubbletter, vilket var det ursprungliga syftet i 0008).
    - Inom samma matarsperiod: behåll **alla** fids — de är olika fysiska sträckor.
    - Aggregera risk per **fid** (rollback från 0013).
  - **Migration 0014_correct_dedup_strategy.sql:**
    1. `nvdb_trafik_latest` använder `rank() over (partition by element_id order by matarsperiod desc)` med filter `where matar_rank = 1`. Alla fids inom senaste matarsperioden behålls. (Första försöket använde correlated subquery → O(N²) → timeoutade på Supabase 8s default. Bytte till window function.)
    2. `risk_per_segment` aggregerar per fid igen (`group by l.fid` etc, som ursprungligen i 0008). `events_count = count(es.event_id)` med `left join event_segments on es.fid = l.fid`.
    3. `segment_detail` joinar `event_segments via fid = p_fid`, inte via element_id.
  - **Utfall:** fid 53587 (Galmetorp, ÅDT 4438, TSK God) har events_count=1, risk ≈ 0,012% per passage. fid 53355 (Bragnum) har events_count=0 — ingen vägfärgning där, helt korrekt.
  - **Statistik:** `nvdb_trafik_latest` har nu 62 736 rader (var 54 370 i 0013, ursprungligen 66 645 från Lastkajen-importen). Skillnaden mot 0013 är att vi nu behåller alla syskon-fids inom senaste matarsperiod istället för att kollapsa till en representant.
  - **Operationell anteckning:** Migrationen kördes mot prod-db direkt via psql (correlated subquery-versionen timeoutade och drop:ade `risk_per_segment` halvvägs — fixades genom att köra den snabba versionen direkt i SQL utan migrationsfilen). Migrationsfilen i repot är uppdaterad till den fungerande window function-versionen och är säker att köra om vid en framtida re-deploy.

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

**Status vid sessionsslut 2026-04-26:** Click-info popup, self-healing snap, korrekt dedup-strategi (0014), legend-widget, tidsfilter, om-modal, realtidsoverlays, segment_detail-perf-fix (0015), TSK borttaget (0016), gamla ÅDT-år rensade (0017), och hit-target-lager för utzoomad klickbarhet är klara. 0013-migrationen är neutraliserad till en `select 1;`-no-op med doc-kommentar — fresh re-deploy hamnar i samma state som 0014 utan att 0013:s fel-premiss körs.

**Kommunal ÅDT-utforskning 2026-04-26 — bortvalt nu.** Kim ville utforska Stockholm/Göteborg/Malmö för stadstrafik. Resultat: Göteborg har bara en webbportal `trafikmangder.stadsbyggnad.goteborg.se/1970-2018/` (ingen export, slutar 2018); Stockholm har tekniskt bra format (WFS + OGC API Features + CC0, linjegeometri, heltäckande via interpolation, ÅDT per linje) men datan är från 2014-2015; Malmö ej verifierat. Beslut: skjut till framtida fas — datavintage motiverar inte arbetet just nu. Detaljer i memory `reference_adt_data_sources.md`.

- ✅ **Dark basemap (2026-04-26)** — bytte från `https://tiles.openfreemap.org/styles/positron` till self-hosted `web/public/styles/sakravagar_dark.json` (derived från OpenFreeMap Dark + customized i Maputnik). Tile/sprite/glyph-sources pekar fortsatt på OpenFreeMap så vi behåller gratis-no-key-setupen. Kim labbade fram brand-paletten i Maputnik och exporterade direkt; vi behöver inte fylla i Mapbox/MapTiler/Thunderforest-tokens i exportdialogen eftersom inga sources refererar till dessa providers.

- ✅ **Radial vignette över kartan (2026-04-27)** — `.map::after` med `radial-gradient(ellipse closest-side at center, rgba(34,34,34,0) 0% 70%, rgba(34,34,34,0.6) 100%)`. Inre 70% av ellipsens radie är klar karta, gradient i yttre 30%. `pointer-events: none` så klick går igenom till kartan. `closest-side` gör att 60%-stoppet träffar precis på kanternas mitt — på desktop blir topp/botten 60% opaque och hörnen mörkare; på mobil blir sidor 60% och topp/botten mörkare. Kalibrerad genom iterativ tweaking (50% → 70% radie, 80% → 60% maxopacity).

- ✅ **Bottom-left lager-toggles live (2026-04-27)** — Risk + Flöde som glas-boxar (`rgba(85,85,85,0.3)` + 16px backdrop-blur, samma som TimeBox), 320px breda, 2px gap. Stack:as via `.layerControls` (`bottom: 40px; left: 40px`).
  - **Anatomi per box:** info-i (10x10) + label "RISK"/"FLÖDE" + 6-stops färgskala (16x10 swatches, 2px radius, 2px gap mellan) + toggle (24x10 pill, 8x8 knob med 1px-marginaler).
  - **Toggle-interaktion:** ON = vit pill + #555 knob (höger), OFF = #555 pill + vit knob (vänster). 200ms ease-transition på både färg och position. Knob slidar via `left: 1px ↔ left: 15px`.
  - **Klick-zoner:** klick var som helst i boxen togglar expanderad förklaring (samma `.expander`-mekanik som InfoBox/LiveBox). Klick i höger 48px-strip (24px padding-left på `<button>` + 24px synlig pill = 48px hit-zon) togglar lagret on/off via `e.stopPropagation()` + `LayerController.setVisible`. Box-clicket kommer aldrig fram till boxens onClick när man klickar på toggle.
  - **OFF-state styling:** ikon+text 60% opacity, swatcher 30% opacity, toggle inverterad — alla animerade via `transition: opacity 200ms ease`.
  - **Tooltips på swatches:** custom CSS via `::after { content: attr(title) }`, opacity 0→1 på `:hover`, 150ms transition, z-index 10. Native `title` har 1-2s delay vilket inte var användbart. Etiketter: Risk = "Mycket låg / Låg / Måttlig / Förhöjd / Hög / Mycket hög"; Flöde = samma men med "lågt"/"högt"-form. Positionerad ovanför swatch med 8px gap så Flöde-tooltips kan flyta upp över Risk-boxen.
  - **Wirat upp** till `addRiskLayer` / `addAdtLayer` controllers via `setVisible`. Båda PÅ vid sidladdning. `useEffect` på `riskOn`/`adtOn` synkar mot map-lagren.
  - Färgskalorna kalibrerades senare 2026-04-27, se "Färg- och heatmap-kalibrering" nedan. `RISK_SCALE`/`FLOW_SCALE`-konstanter ligger fortsatt i `Map.tsx` och matchar MapLibre-linjernas färgskala.

- ✅ **Right-side map-kontroller (2026-04-27)** — ersatt MapLibres default `NavigationControl` med custom-knappar + omstylad attribution.
  - **Top-right stack** (`bottom-right` mirror, `top: 40px; right: 40px`, `gap: 2px`):
    - **Zoom-grupp** (plus + minus, 1px gap mellan så de visuellt sitter ihop). Plus = `border-radius: 8px 8px 0 0`, minus = `0 0 8px 8px`. Klickar `map.zoomIn() / zoomOut()`.
    - **Locate-knapp** (separat under, 2px gap). Klickar `navigator.geolocation.getCurrentPosition` → `map.flyTo({ center, zoom: 14 })` → `setAtUserLocation(true)`. Persistent inverterad medan användaren är centrerad på sin position; återgår till default vid första `dragend` (manuell pan).
  - **Knapp-styling:** 40x40, 16x16 inline-SVG centrerad via flex (12px implicit padding). Glas-bg `rgba(85,85,85,0.3)` + 16px blur. Default `color: rgba(255,255,255,0.6)`. Hover → `var(--color-white)` med 250ms ease. `:active` → vit bg + #333 ikon med `transition: none` (snäpper inverterad), släpp animerar tillbaka via base-transition. `.iconBtnActive`-class (locate vid centrering) ger persistent inverterad — `.iconBtnActive:hover { color: #333 }` overridar hover så ikonen syns på vit bg.
  - **Inline SVG** för plus/minus/location med `currentColor` + `vector-effect: non-scaling-stroke` (samma mönster som info/road).
  - **Locate-state-tracking:** `map.on("dragend", ...)` är enda signalen som växlar `atUserLocation` till false. Zoom (knappar/scroll/pinch) ändrar inte centrum så locate-state ska inte påverkas.
  - **Attribution rebuilt** istället för ersatt — licenskrav från OFM/OMT/OSM gör att vi behåller MapLibres `AttributionControl` med `compact: true` och styler om den hela. Realiserat i `globals.css` med `!important` eftersom maplibre-gl.css importeras från `Map.tsx` och bundlas EFTER globals.css i Next.js, så samma-specificitet-selektorer från maplibre vinner annars.
    - **Layout:** Glas-pill (samma bg som zoom-knapparna) i bottom-right (`bottom: 40px; right: 40px`). Kollapsat = bara info-knappen 40x40. Expanderat = X-knapp till vänster + attribution-text till höger. Container är right-anchored, så när text blir synlig växer baren leftward och X-knappen "hoppar" från hörnet till vänster om texten — matchar Kims mockup.
    - **Ikoner via `mask-image`:** info.svg / close.svg sätts som `mask` på knappen (`<summary>`), `background-color` ger ikonens färg. Default 60% vit, hover 100%. Mask-tekniken används eftersom maplibre genererar knappens DOM och vi inte kan ge den inline-SVG.
    - **Animation:** överstyrt maplibres `display: none/block`-toggle med `display: block !important` plus `max-width: 0 → 600px` och `padding: 0 → 16px` med samma 320ms `cubic-bezier(0.4, 0, 0.2, 1)` som `.expander` till vänster. `overflow: hidden` på pill-wrappern klipper texten under animationen.
    - **State-detection-bug fixad:** maplibre 4 har INVERTERAD logik kring `<details open>` i compact-läge. `_toggleAttribution` i maplibres källkod sätter faktiskt `[open]`-attributet när panelen STÄNGS och tar bort det när den ÖPPNAS. Klassen `.maplibregl-compact-show` är vad som faktiskt styr inner-synligheten. Vi byter till close.svg på `.maplibregl-compact-show .maplibregl-ctrl-attrib-button` (NOT `details[open]`).
    - **Text-styling:** medium-tier från tokens (14px / 1.20 / -0.03em), 60% vit, vita länkar på `:hover`.

- ✅ **TimeBox interaction-refactor (2026-04-27)** — gick från "hela boxen öppnar dropdown" till "hela boxen togglar expand, höger-zonen öppnar dropdown".
  - Boxen själv har `onClick={onToggleOpen}` + `cursor: pointer`. Höger-zonen `.timeSelectGroup` har `onClick={(e) => e.stopPropagation()}` så att klick där inte också triggar expand. Native `<select>` ligger absolut placerad bara över höger-zonen (inte hela boxen som tidigare) med `opacity: 0` och tar klicken — `.timeSelectValue` och `.dropdownIcon` har `pointer-events: none` så klick faller igenom till select.
  - **Info-i tillagd** vänster om "Tidsfönster"-texten (8px gap, samma som övriga boxar). Header-layout: `display: flex; gap: 8px;` med `margin-left: auto` på höger-zonen för att skjuta den till höger oavsett label-bredd. Senare finputs 2026-04-27: "Tidsfönster"-labeln är 100% vit, dropdown-zonen har egen vit 10%-platta (`rgba(255,255,255,0.1)`), 8px padding och 4px radius. Hela `.timeBox` har nu padding `8px 8px 8px 16px`.
  - **Expander-content:** "Tidsfönstret styr vilka olyckor som visas på kartan — både i värmekartan och som enskilda punkter när du zoomar in. Risk-färgningen baseras alltid på all data oavsett val här." Reuses `.expander` / `.expanderOpen` / `.expanderInner` så animationen är konsistent med InfoBox/LiveBox/LayerBox.

- ✅ **Typografi 3-tier-system (2026-04-27)** — DRY:at ut alla `font-size`/`line-height`/`letter-spacing`-värden i overlay-CSS:en.
  - **Tokens i `tokens.css`:** sex variabler — `--type-{large,medium,small}-{size,line,tracking}`:
    - Large (header-text): 20px / 1.15 / -0.05em
    - Medium (brödtext): 14px / 1.20 / -0.03em
    - Small (labels): 10px / 0.9 / 0.08em
  - **Utility-classes i `globals.css`:** `.type-large`, `.type-medium`, `.type-small`. Endast size + line-height + letter-spacing — INTE color/uppercase/etc (det sätts per komponent).
  - **Refaktorering via `composes from global`:** alla 11 textklasser i `Map.module.css` gör nu `composes: type-X from global;` plus det som faktiskt skiljer (color, padding, margin, text-transform). Visuellt identiskt — samma värden, men nu omöjligt att smyga in en 11px eller 13px text utan att frångå systemet.
  - **Klass-fördelning:**
    - large: `infoBoxLogo`, `infoBoxIntro`
    - medium: `infoBoxBody`, `infoBoxSources`, `liveBoxBody`, `layerBoxBody`, `timeBoxBody`
    - small: `liveBoxLabel`, `layerBoxLabel`, `timeLabel`, `timeSelectValue`
  - **Maplibre-attribution drar samma medium-tier** men via direkta `var(--type-medium-*)`-referenser eftersom globals.css inte är CSS-modul (composes funkar inte där).
  - **Inte rört (medvetna undantag):** `.timeSelect option` (13px — native dropdown-overlay där browsers ignorerar de flesta stilar), alla `.seg-popup-*`-klasser (segment-popup, separat designyta som inte passar in i 3-tier just nu).

- ✅ **Live-halo förfining (2026-04-27)** — `events-live-halo` på kartan är nu vit och matchar live-pricken i röda boxen: kärna 10px diameter, halo 10→24px diameter, 1.6s `ease-in-out`, opacity 0→0.3→0. Live-core är också helt vit utan stroke. Poängen är att pågående olyckor syns tydligt men inte introducerar ännu en riskfärg på kartan.

- ✅ **Top-left redesign live (2026-04-27)** — komplett ombyggnad av kontrollerna i övre vänstra hörnet enligt Kims Figma-spec.
  - **Tillgångar:** `web/public/font/UniversNextProRegular.ttf` (Univers Next Pro Regular, enda fontvarianten — opacity används för kontrast istället för weight). Ikoner i `web/public/icons/`: `road.svg`, `info.svg`, `location.svg`, `minus.svg`, `plus.svg`, `dropdown.svg`. Alla ikoner uppdaterade till `stroke="currentColor"` + `stroke-width="1"` + `vector-effect: non-scaling-stroke` (CSS) så strokebredden alltid är 1 CSS-pixel oavsett displaystorlek (kritiskt för `info.svg` som är 16x16 viewBox renderad vid 10x10).
  - **Brand-färger** tillagda i `tokens.css`: `--color-beige #E6E0D4`, `--color-red #FF2F00`, `--color-dark #333`, `--color-white #fff`. Plus `--font-univers` token. Befintliga `--color-*`-tokens (popup-styling) lämnades oförändrade så event/segment-popup-rendering inte påverkas.
  - **`@font-face`** för Univers + global `-webkit-font-smoothing: antialiased` i `globals.css`.
  - **Tre boxar** (40px från top-left, 320px bred, 2px gap mellan boxarna):
    1. **InfoBox** (beige bg, 24px padding) — "Säkravägar.se"-logo (röd, Large 20px/-5%/1.15) + road-ikon (28x18). Always synlig: intro-text "För dig som känner oro i trafiken...". Klick på kollapsad box öppnar; klick på road-ikonen togglar; **bara ikonen stänger** (klick på text/länkar i innehållet stänger inte — undviker accidental close vid markering). Expanderad innehåller body-paragrafer + datakällor-block (`#333` 60% text på `#333` 5% bg, 8px radius, inkluderar länkar till Trafikverket Open API + Lastkajen).
    2. **LiveBox** (16px padding) — två states baserat på `liveCount`:
        - **Calm** (`count === 0`): vit bg, mörk text, info-ikon left + "Inga rapporterade olyckor just nu". Ingen puls. Klick expanderar förklarande paragraf.
        - **Active** (`count > 0`): röd bg `#FF2F00`, vit text, "X PÅGÅENDE OLYCKOR" + pulserande prick höger. Vit prick 10px med pseudo-element `::after`-halo som pulsar 10→24px scale via `livePulse` keyframes (1.6s ease-in-out infinite, opacity 0→0.6→0).
        - Båda states delar samma expanded-content (förklaringen om pågående olyckor) — animeras in/ut med samma `.expander`-mekanik.
    3. **TimeBox** (16px padding) — `rgba(85,85,85,0.3)` bg + `backdrop-filter: blur(16px)`. Label "TIDSFÖNSTER" (60% vit) left + native `<select>` höger med custom dropdown-ikon. Selected value `text-align-last: right` + caps via `text-transform: uppercase` (selectens displayvärde). Options-listan har `text-transform: none` + `text-align: left` så menyn visar sentence case ("Alla olyckor", etc); browsers respekterar oftast detta men inte alla 100% konsekvent.
  - **Road→X morph** — samma 3 paths i SVG:n animeras via CSS transforms. Topplinjen `translateY(8px) rotate(45deg)`, bottomlinjen `translateY(-8px) rotate(-45deg)`, mittlinjen `opacity: 0`. `transform-box: view-box` + `transform-origin: 14px 9px` (viewBox-center). 280ms cubic-bezier(0.4, 0, 0.2, 1). Mittlinjens dash-pattern (`5 4`) animeras via `roadDashScroll` keyframes (1.4s linear infinite, `stroke-dashoffset: 0 → -9` = en periodlängd) så det ser ut som en väg som rör sig höger→vänster när boxen är kollapsad. Animationen pausas (`animation-play-state: paused`) när den är öppen så vi inte spelar dolda animationsframes.
  - **Expand/collapse-animation** — `.expander` använder `grid-template-rows: 0fr → 1fr`-tricket (modern CSS, evergreen browsers). Inner-elementet sätter `overflow: hidden` + `min-height: 0`. 320ms cubic-bezier(0.4, 0, 0.2, 1). Ingen behöver känna content-höjden i förväg, vilket gör mekaniken återanvändbar mellan InfoBox och LiveBox.
  - **Borttaget i redesignen:** `.controls`-panelen (gammal whitebox med checkbox-toggles + select), `.legend` (bottom-left RISK/ÅDT-förklaringar), `.aboutBackdrop`/`.aboutModal` ("Om tjänsten"-modalen — innehållet bor nu i InfoBox expanded). State `riskVisible`/`adtVisible` + `aboutOpen`/`legendBlock`-grenar är borta. Lager-toggles + legend återimplementeras imorgon ihop med bottom-left-skissen.

Alla MVP-element finns nu på plats; nästa naturliga steg är **bottom-left förklaring/legend + lager-toggles** (Kims design-skiss) eller fortsatt UI-polering.

**Status 2026-04-27 sen kväll:** Bottom-left lager-toggles + right-side controls + attribution-redesign + 3-tier typografi-system klart. Hela overlayskelettet matchar nu Kims Figma-spec på top-left, bottom-left, top-right och bottom-right.

**Status 2026-04-27 färg- och heatmap-kalibrering:** Kartans färgspråk renodlades så att *risk* är enda varma varningsskalan, *flöde* är blått underlagsdata, och olyckor/heatmap är neutrala händelsemarkörer.

- **Risk-skalan** är gul→röd, baserat på bottenfärg `#FFF382` + `#FF2F00` overlay i 0/20/40/60/80/100%-steg:
  - `#FFF382`, `#FFCC68`, `#FFA54E`, `#FF7D34`, `#FF561A`, `#FF2F00`
  - Används både i `RISK_SCALE` i `Map.tsx` och `risk-lines` i `layers.ts`.
- **Flöde-skalan** är ljusblåvit→blå, baserat på bottenfärg `#F2F8FF` + `#0077FF` overlay i 0/20/40/60/80/100%-steg:
  - `#F2F8FF`, `#C2DEFF`, `#91C4FF`, `#61ABFF`, `#3091FF`, `#0077FF`
  - Används både i `FLOW_SCALE` i `Map.tsx` och `adt-lines` i `layers.ts`.
- **Renderordning** ändrad: Flöde/ÅDT ligger underst, Risk ovanpå Flöde, och events/heatmap/punkter ovanpå båda. Produktlogik: Flöde är underlag, Risk är slutsats.
- **Heatmap** är neutral grå, inte röd/orange. Slutlig `heatmap-color`-spec:
  - density `0.00`: `#000000` alpha 0%
  - density `0.40`: `#666666` alpha 25%
  - density `0.51`: `#666666` alpha 100%
  - Teknisk implementation: `DEFAULT_HEATMAP_STOPS` + `heatmapColorExpression()` i `layers.ts`, så alpha kan uttryckas utan ad hoc rgba-strängar.
- **Historiska eventpunkter** (`events-circles`) är nu helvita: fill `#ffffff`, stroke `#ffffff`.
- **Pågående eventpunkter** är också helvita och pulserar enligt live-boxens visuella språk (se Live-halo ovan).
- **Temporärt Heatmap Lab byggdes och togs bort** samma session. Det användes bara för att labba density/color/alpha-stops live i previewn. Inget lab-UI finns kvar i koden.
- **Designprincip beslutad:** Olyckspunkter och heatmap ska inte indikera risk med färg. De visar *att händelser finns*. Riskfärg bor på risksträckorna; flöde bor i blå skala.

**Nästa fokus:** mobilläget. Overlayskelettet funkar på desktop, men nästa session bör kontrollera mobilbredd: top-left stacken, bottom-left lagerboxar, right controls, attribution, popup-positionering och text som kan klämmas i `TimeBox`/`LayerBox`.

**Kims plan för UI/UX:** Så fort alla element/information finns på plats kommer Kim göra en samlad redesign och leverera screenshots + interaktionsspecifikation. Vi bygger alltså vidare med funktion först, designnit sen — inte värt att polera enskilda komponenter just nu eftersom de kommer ritas om ändå.

**Strategi enligt Kim (2026-04-25):** Färdigställ alla *datalager* på kartan först (TSK + olyckor-per-miljon-fordon). Spara UI/UX/styling/legend till sist eftersom färgval, kart-stil, click-info etc kan påverkas av vilka lager som ska samexistera. Tids-filter och realtidsoverlays är också på listan men kommer efter datalager + kart-stil.

### Nu (datalager kvar):

1. ~~**TSK-lager**~~ ✅ klart 2026-04-25, se ovan.

2. ~~**Olyckor-per-miljon-fordon**~~ ✅ klart 2026-04-25, se ovan.

### Nu (kart-UX, valt nästa):

1. ~~**Click-info popup**~~ ✅ klart 2026-04-25, dedup + risk-procent + event-click tillagt 2026-04-26, se ovan.

2. ~~**Legend / förklaring**~~ ✅ klart 2026-04-26, se ovan.

3. ~~**Om-tjänsten / info-modal**~~ ✅ klart 2026-04-26, se ovan.

4. ~~**Tids-filter**~~ ✅ klart 2026-04-26 (dropdown), se ovan. Kim önskar slider-version sen när data mognat.

5. ~~**Realtidsoverlays**~~ ✅ klart 2026-04-26, se ovan.

6. **Kart-stil + färger** — slutgiltig kalibrering av färgskalor när vi har mer data. Eventuellt byta basemap.

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
- **CTE-kedjor med data-modifying branches kan ha tysta fail-modes.** `snap_pending_events` har en `match` (cross join lateral, inner-join-semantik) och en `update` (kör för alla pending) i samma CTE-kedja. När match-grenen returnerar 0 rader för ett event blir det inte snappat, men update-grenen markerar det ändå som processed — eventet blir "stuck". Vi har en `resnap_orphan_events()` + dagligt cron-jobb (0012) som plockar upp dessa, men lärdomen är att framtida CTE-kedjor som lägger till och uppdaterar bör kontrolleras för att se till att de behandlar samma rader, eller åtminstone har en separat catch-all-mekanism.
- **NVDB `element_id` är INTE en fysisk segment-identifier.** Det är en logisk grupperare för "vägelement" som kan inkludera flera fysiskt olika fids längs en längre vägdel. T.ex. element 12753:300613 består av 5 fids över ~7 km E20 (Bragnum + Galmetorp + ...). Dedup eller aggregering på element_id-nivå slår alltså ihop olika fysiska sträckor — fel. Korrekt nivå för risk-aggregering och click-info är fid. För att hantera år-dubbletter (samma fid mätt över flera år) använder vi `rank() over (partition by element_id order by matarsperiod desc)` och filtrerar `matar_rank = 1` — det filtrerar bort äldre årets mätningar utan att slå ihop syskon-fids inom samma år.
- **`<->` kNN-operator returnerar bbox-distance, inte true distance.** Under diagnostiken av Galmetorp-eventet såg vi att `select fid, st_distance(...) from nvdb_trafik_latest order by geom <-> point limit 1` returnerade ETT segment ena gången och ett ANNAT (1158m bort) andra gången — beroende på query-planer / index-cache. För säker närmaste-segment-sökning, använd större `LIMIT N` (t.ex. 10) och re-rank på `st_distance(...)` i en outer query. snap_pending_events räddas av `st_dwithin(...,75)`-filtret som gör att fel matches automatiskt droppas, men diagnostik-queries direkt mot dist är opålitliga.
- **Risk-färgning på kartan vs popupens procent-tal är inte direkt jämförbara just nu.** Kartfärgen (`risk_in_bbox` → `risk_per_segment` MV) är beräknad på *odeduplicerad* events_count, medan popupens `risk_per_passage_pct` är beräknad på dedup-talet. Vid normal datavolym konvergerar de, men i tunt dataläge kan kartan färga en sträcka kraftigt rött medan popupen visar ett betydligt lägre tal. Att flytta dedup-logiken in i MV:n skulle göra dem konsistenta men kräver omräkning av `events_count` vid varje refresh — TBD om/när det blir ett problem (troligen acceptabelt så länge vi har tunn data och det är ändå preliminärt).
- **Preview-MCP fungerar ej i `~/Desktop/`** — macOS TCC + Claude.app:s "disclaimer helper" har generisk code-signing-ID som gör att TCC-grants inte persisterar för spawnade MCP-processer ([issue #36832](https://github.com/anthropics/claude-code/issues/36832)). Bash-tooket inom Claude Code fungerar (huvudprocessen har grants), men `mcp__Claude_Preview__preview_start` faller på `Operation not permitted`. Workaround: flytta projektet till `~/dev/`, `~/Code/`, eller liknande icke-skyddad mapp, ELLER ge Claude.app Full Disk Access. Kim har valt att köra `pnpm web` lokalt själv i en terminal istället för att flytta nu.

## Filer att känna till

| Fil | Vad |
|-|-|
| `scraper/src/trafikverket.ts` | Query-XML byggs här. Namespace + 1.6 + klientfilter. |
| `scraper/src/index.ts` | Orchestrator, upsert till Supabase. |
| `scraper/src/env.ts` | Env-schema: `SUPABASE_SERVICE_KEY` (ej `_ROLE_KEY`). |
| `.github/workflows/cron.yml` | GitHub Actions cron. Schema `17,47 * * * *`. Ingen `version:` på `pnpm/action-setup`. |
| `web/components/Map/MapLoader.tsx` | Client wrapper runt dynamisk MapLibre-import. |
| `web/components/Map/Map.tsx` | MapLibre-karta. Anropar `addRiskLayer` + `addAdtLayer` + `addEventsLayer` + `addPopupHandler` på `load`, lagrar controllers i `layerCtrlRef` för later setVisible. Sub-komponenter: `InfoBox` (beige med road→X-morph), `LiveBox` (calm/active states + pulse-halo), `TimeBox` (whole-box-expand + dropdown-zone), `LayerBox` (Risk/Flöde med toggle-zone + tooltips), zoom/locate-knappar inline. Inline-SVG för `RoadOrXIcon`/`InfoIcon`/`DropdownIcon`/`PlusIcon`/`MinusIcon`/`LocationIcon` så CSS kan animera paths. State: `infoOpen`/`liveOpen`/`riskOpen`/`adtOpen`/`timeOpen` (boxar), `riskOn`/`adtOn` (lager), `atUserLocation` (locate). `map.on("dragend", ...)` växlar atUserLocation→false. `RISK_SCALE`/`FLOW_SCALE`-konstanter med `{color, label}` per stop — dessa ska matcha linjefärgerna i `layers.ts`. |
| `web/components/Map/Map.module.css` | Brand-styling. `.controls` (top-left), `.layerControls` (bottom-left), `.rightControls` (top-right). Box-stilar: `.infoBox`/`.liveBox`/`.timeBox`/`.layerBox` + ikon-styling (`.roadIcon`/`.infoIcon`/`.dropdownIcon`/`.btnIcon`) + delad `.expander`/`.expanderOpen`/`.expanderInner` med grid-template-rows-trick för smooth collapse/expand. `.iconBtn` (40x40 glas) + `.iconBtnActive` (persistent inverterad) för zoom/locate. Toggle-styling (`.layerToggle`/`.layerToggleKnob`/`.layerToggleHit`) med ON/OFF-färgväxling och knob-position-animation. `.layerScale span::after` är custom CSS-tooltip via `attr(title)`. Alla textregler komponerar `type-X from global`. Också `.map::after` radial vignette. |
| `web/components/Map/layers.ts` | Lager-definitioner. `addEventsLayer` (neutral grå heatmap + vita historical circles + vita live-punkter; properties: id/icon_id/road_number/message/severity/first_seen/last_seen). `DEFAULT_HEATMAP_STOPS` = 0.00 transparent, 0.40 `#666` 25%, 0.51 `#666` 100%. Live-halo matchar live-boxen: vit, 10→24px diameter, 1.6s ease-in-out, peak-opacity 0.3. `addAdtLayer` + `addRiskLayer` (line, bbox-driven via delad `createBboxLoader`). Renderordning: ADT/Flöde underst, Risk ovanpå, events överst. `addPopupHandler` (event-popup + segment-popup, prioritet events→Risk→ADT). Returnerar `LayerController { setVisible }`. |
| `web/styles/tokens.css` | Brand-färger + Univers-font-token + `--type-{large,medium,small}-{size,line,tracking}`-tokens (3-tier typografi). |
| `web/styles/globals.css` | Globala stilar inkl. `.type-large`/`.type-medium`/`.type-small` utility-classes (för `composes from global` i CSS Modules). `.seg-popup-*`-popup-styling. Maplibre attribution-overrides (info/close.svg via mask-image, glas-pill, max-width-animation, `.maplibregl-compact-show`-baserad open-state). |
| `web/public/icons/close.svg` | X-ikon (16x16, stroke). Används av maplibre attribution-pill när expanderad (via mask-image). |
| `web/public/font/UniversNextProRegular.ttf` | Univers Next Pro Regular — den enda fontvarianten i appen. Loaded via `@font-face` i `globals.css`. |
| `web/public/icons/*.svg` | Brand-ikoner med `stroke="currentColor"` + `stroke-width="1"` + `vector-effect: non-scaling-stroke` (CSS). `road.svg` (28x18) har dashed mittlinje för animation; `info.svg` (16x16, renderas vid 10px); `dropdown.svg` (11x10); `location.svg`/`minus.svg`/`plus.svg` (oanvända just nu, kommer in i nästa iteration med bottom-left). |
| `web/public/styles/sakravagar_dark.json` | MapLibre style.json — fork av OpenFreeMap Dark, brand-customized i Maputnik. Tile/sprite/glyph-sources pekar på `tiles.openfreemap.org` så vi behåller gratis-no-key-setupen. |
| `web/styles/globals.css` | Globala stilar inkl. `.seg-popup-*` (popup-styling — global eftersom MapLibre Popup ligger utanför Reacts CSS Modules-tråd). |
| `web/app/api/events/route.ts` | Hämtar `events_public` från Supabase. |
| `web/app/api/adt/route.ts` | Kallar RPC `adt_in_bbox(min_lng,min_lat,max_lng,max_lat)`. Kräver `bbox`-param. |
| `web/app/api/tsk/route.ts` | Kallar RPC `tsk_in_bbox`. Samma mönster som /api/adt. |
| `web/app/api/risk/route.ts` | Kallar RPC `risk_in_bbox`. Returnerar fid, adt_total, events_count, risk_per_milj_fordon, geometry. |
| `web/app/api/segment/route.ts` | Kallar RPC `segment_detail(p_fid)`. Tar `?fid=N` query-param. Exporterar `SegmentDetail`-typen (importeras av `layers.ts`). |
| `db/migrations/0006_adt_rpc.sql` | RPC `adt_in_bbox` (security definer, transformerar bbox till 3006 för GIST-träff, dedupar via `row_number` på `element_id`). |
| `db/migrations/0007_tsk_rpc.sql` | RPC `tsk_in_bbox` (samma mönster, utan tids-dedup, sorterar Låg-segment sist för render-ordning). |
| `db/migrations/0008_risk_pipeline.sql` | Hela risk-pipelinen: `event_segments`-tabell, `nvdb_trafik_latest`-vy, `snap_pending_events()`-funktion, `risk_per_segment` MV, `risk_in_bbox`-RPC. |
| `db/migrations/0009_risk_cron.sql` | pg_cron-jobben `snap-event-segments` (var 5:e min) + `refresh-risk-mv` (var 15:e min). |
| `db/migrations/0010_segment_detail.sql` | RPC `segment_detail(p_fid)` — första versionen, ersatt av 0011. |
| `db/migrations/0011_segment_detail_v2.sql` | RPC `segment_detail` v2 — dedup på (message, road_number, hour) + `risk_per_passage_pct` + `data_window_days`. |
| `db/migrations/0012_resnap_orphans.sql` | Self-healing snap-pipeline. Snap-radie 50→75m + `resnap_orphan_events()` + dagligt pg_cron-jobb 03:30 UTC. |
| `db/migrations/0013_fix_segment_dedup.sql` | ⚠️ Fel premiss. Aggregerade per element_id vilket slog ihop fysiskt olika sträckor. Ersatt av 0014. Ej giltig att köra om — 0014 sätter rätt state. |
| `db/migrations/0014_correct_dedup_strategy.sql` | Korrekt dedup. `nvdb_trafik_latest` filtrerar äldre matarsperiod per element_id men behåller alla syskon-fids. `risk_per_segment` aggregerar per fid igen. |
| `.env` (rooten, ej committad) | `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `DATABASE_URL` (session pooler, URL-encodad). |
| `db/migrations/0001_init.sql` | Events-tabell + `events_public`-vy. |
| `db/migrations/0002_nvdb.sql` | Index + vyer `adt_public`, `tsk_public`, `tsk_rank`. |
| `scripts/import-nvdb.sh` | ogr2ogr-wrapper för att importera NVDB-GPKG från Lastkajen. Sällan-körd (årligen). |
| `scripts/README.md` | Setup-guide för NVDB-import (GDAL, DATABASE_URL). |
| `~/Desktop/ClaudeAI/Trafik_data/sakravagar_bas_2026_04_240307.gpkg` | Lastkajen-paketet. Inte i repot. Används vid ny import. |
