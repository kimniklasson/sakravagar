# Current state — 2026-05-15

Kort projektminne för nya sessioner. Läs detta först, sedan `PROJECT.md` för produktidé/prioritering, `docs/decisions.md` för långlivade vägval, `docs/api.md` för API-kontrakt, `docs/routing-ops.md` för GraphHopper-drift och `docs/review-log.md` för reviewspåret. Historiska sessionsanteckningar ligger komprimerade i `docs/session-archive.md` och ska inte läsas som nuläge.

## Produktläge

Säkravägar.se är en Next/MapLibre-karta för personer som känner oro i trafiken. MVP:n visar kontrollager för historiska olyckor, pågående olyckor, trafikflöde, trafikstörningar och höga hastigheter. Routing använder self-hostad GraphHopper när env finns och OSRM som lokal fallback.

Aktiva UI-lager:

- **Olyckor** — historiska och pågående olyckor. Default av. Klick på olyckspunkter öppnar en kompakt popup med live/historisk etikett, väg, beskrivning och uppdateringstid.
- **Trafikflöde** — ÅDT från NVDB/Lastkajen plus liveflöde från Trafikverket där mätdata finns. Default av. ÅDT-segment är medvetet inte klickbara; blå nyanser ska läsas som bakgrundssignal, inte som exakt segmentanalys. Liveflöde är klickbart och visar en kompakt popup med läge, fordon/timme, snitthastighet och uppdateringstid.
- **Trafikstörningar** — aktuella vägarbeten/köer/störningar. Default av. Klick på störningspunkter öppnar en kompakt popup med påverkan, väg, beskrivning och uppdateringstid.
- **Höga hastigheter** — badges för 80 km/h och högre. Default av.
- **Hjälp** — ruttförslagens filterlogik, kartlager, legender, datakällor och senaste uppdatering.

Segmentrisk-färgning finns kvar i backend/kod som vilande infrastruktur men är pausad i UI tills olyckshistoriken är tillräckligt stor för att ge en rimlig riskbild. Olyckslagret visar därför punkter/heatmap, inte röd-orange risklinjer.

Desktop har info/ruttplanerare i vänsterstacken, lagerknappar uppe till höger och zoom/location nere till höger. Mobil samlar lager bakom en `layers.svg`-knapp och visar hjälp som helskärm. Mobilens `Undvik om möjligt`-filter är en horisontellt scrollande rad för att spara kart-/ruttutrymme. Tyngre lager visar en liten spinner i lagerknappen medan bbox/tile-data hämtas. När användaren slår på `Trafikflöde`, `Trafikstörningar` eller `Höga hastigheter` från för låg zoomnivå zoomar kartan automatiskt in till lagrets miniminivå, så användaren inte möts av en tom karta utan feedback.

## Ruttplanerare

Ruttplaneraren finns i `web/components/Map/RoutePlannerBox.tsx`, med state/orchestration i `Map.tsx` och route-hjälpare i `routeModel.ts`. Den geocodar via `/api/geocode`, reverse-geocodar GPS-positioner och räknar rutter via `POST /api/route`.

`Undvik om möjligt`-filter:

- `Höga hastigheter`
- `Trafikintensiva vägar`
- `Stadstrafik`
- `Broar`
- `Tunnlar`
- `Stora rondeller`
- `Flerfiligt`

GraphHopper custom models påverkar vägkostnaden för dessa filter. `Stora rondeller` och `Flerfiligt` bygger på reducerat NVDB/Lastkajen-underlag från `korfalt_rondell_*.gpkg`; de importerar inte hela råpaketet utan bara segment som behövs för routing penalty areas och scoring. Lane-penalty-matchning är medvetet tight: stora rondeller och flerfiligt matchas nära ruttens faktiska segment, inte mot närliggande parallellvägar. `Flerfiligt` räknar motorväg/motorvägslänk som intrinsiskt flerfiligt och använder road class/speed-gating för att undvika att en vanlig väg bredvid motorvägen felklassas.

`Stadstrafik` bygger på manuellt avgränsade stadszoner och road-class/speed-faktorer. Zonerna är nu tätare kring stadskärnor, men större/komplexa stadsvägar inne i zonen räknas fortfarande som stadstrafik. Snabba motorvägssträckor genom utkanten ska däremot inte ge stadstrafikexponering bara för att de passerar nära staden.

Olyckshistorik och trafikstörningar är kontrollager/route-notices, inte planeringsfilter. Vald rutt visar pågående störningar och liveolyckor ovanpå ruttlinjen även när motsvarande kartlager är avstängt. Route-notices matchar bara punkter nära själva rutten, dedupar endast mycket nära dubbletter och är klickbara via osynliga hit-target-lager så användaren kan se beskrivning, väg och uppdateringstid.

`POST /api/route` är uppdelad efter arkitektur-reviewen: publika ruttyper ligger i `web/lib/routeTypes.ts`, och rena serverhjälpare ligger i `web/app/api/route/_routing/` (`types`, `request`, `timeout`, `telemetry`, `geometry`, `customModels`, `providers`, `providerFanout`, `routeDetails`, `dedupe`, `hybrid`, `scoring`, `highSpeedSelection`). Själva `route.ts` är nu i princip request handler, deadline/logging och response mapping.

MapLibre-lagren är uppdelade efter frontend cleanup. `web/components/Map/layers.ts` är bara export-yta, medan lagren ligger i `web/components/Map/layers/`: `route.ts` för ruttlinjer/annotationer, `adt.ts` för ÅDT, `largeRoads.ts` för hastighetsbadges, `risk.ts` för vilande risklager, `events.ts` för olycks-/live-lagret, `liveTraffic.ts` för störningar och trafikflöde, `bbox.ts` för delad viewport-loader och `popups.ts` för popup-interaktioner. `Map.tsx` har också börjat tunnas ut via `web/components/Map/hooks/`: MapLibre-livscykel, viewport-CSS-vars, route-controls-mått, live event summary, ruttstopp-sök och egna via-punktsmarkörer ligger där. Delnings-/feedback-payloads och Google Maps-länkbygge ligger i `web/components/Map/routeSharing.ts`. CSS för ruttplanerare, ruttalternativ, hjälppanel, loading-indikator och ikon-SVG:er är utbruten från `Map.module.css` till komponentnära CSS Modules.

Hjälppanelen har en egen ruttsektion som förklarar vad varje undvik-filter försöker ge användaren: lugnare hastigheter, mindre intensiv trafik, mindre stadskörning, färre broar/tunnlar samt färre stora rondeller och flerfiliga segment när rimliga alternativ finns. Den ligger före kartlagersektionen för att hjälpa användaren förstå ruttförslagen innan hen tolkar datalagren.

Viktiga beteenden:

- Auto-routing startar först när båda stopp har koordinater.
- Ruttlinjen är inte dragbar i MVP-flödet; via-punkter hanteras via stoppfältet.
- Utan aktiva filter visas snabbaste rutten. Med aktiva filter visas relevanta kandidater och listan sorteras efter filtermatchning, därefter tid och distans.
- Ruttkort visar `Undviker` bara när aktuell aktiv exponering praktiskt taget är noll. Låg men befintlig stadstrafik/trafikintensitet ska visas som `Låg`, inte som grön undvikelse.
- Frontend har kort session-cache för route-svar: 2 min för statiska filter och 5 min när `Trafikintensiva vägar` är aktivt.
- Delning skapar public route snapshots via `/api/route-shares` med 30 dagars TTL. Payloaden valideras via `web/lib/routeShareSchema.ts` både vid API-write och SSR-prefetch av `/r/[slug]`.
- Tumme upp/ner sparas via `/api/route-feedback` som kalibreringsunderlag, inte som direkt ranking-signal. Feedback-snapshots använder samma route-share-schema och sparas i 90 dagar.

## Data och API

Scrapen körs i production via Supabase `pg_cron` + `pg_net` mot Edge Function `supabase/functions/scrape`. Den gamla Node-scrapern är borttagen; manuell nödknapp i GitHub Actions triggar samma Edge Function via HTTP med `SCRAPE_SHARED_SECRET`.

Scrapade Trafikverket-flöden:

- `Situation`/`Deviation` med `MessageType=Olycka` -> `events`
- övriga relevanta `Situation`/`Deviation` -> `disturbances`
- `TrafficFlow` -> `traffic_flow_measurements`

Alla tunga bbox-API:er ska ha:

- obligatorisk `bbox`
- area guard i API:t
- `SWEDEN_DATA_BOUNDS`-guard i API:t
- SQL/RPC-limit eller motsvarande spärr

Detaljerade endpoint-kontrakt finns i `docs/api.md`.

## Infrastruktur

- **App:** `https://sakravagar.se` på Vercel.
- **DNS:** Loopia är registrar. Cloudflare DNS hanterar både `sakravagar.se` och legacy-domänen `säkravägar.se` / `xn--skravgar-0zae.se`.
- **Databas:** Supabase Postgres + PostGIS, migrations i `db/migrations/` och genererade Data API/RPC-typer i `db/database.types.ts`.
- **Routing:** Hetzner CPX32 med GraphHopper 11 bakom Caddy och `X-Routing-Token`. Drift i `docs/routing-ops.md`.
- **Tiles:** MapLibre GL med OpenFreeMap.

Supabase `pg_cron` kör fortsatt Trafikverket-scrape via Edge Function. Riskrelaterade cronjobb är däremot pausade i produktion sedan 2026-05-13 efter Disk IO-budgetvarningar på Nano: `resnap-orphan-events`, `snap-event-segments` och `refresh-risk-mv`. Supabase-metriken var lugn under minst tre timmar efter pausen, vilket pekar på att dessa jobb var den praktiska IOPS-drivaren. De ska inte aktiveras igen utan nytt beslut om riskdelen och IO-budget.

Vercel production behöver minst `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GRAPHHOPPER_BASE_URL` och `GRAPHHOPPER_TOKEN`. Lokal routing utan GraphHopper-env faller tillbaka till OSRM och matchar inte production-routing. Cloudflare Free har en aktiv rate limiting-regel `Limit route API` för exakt `/api/route`: 10 requests / 10 seconds per IP, action `Block`, duration 10 seconds. `/api/route` har dessutom ett per-instans concurrency cap för GraphHopper-skydd: default `ROUTE_MAX_CONCURRENT_TOTAL=8`, `ROUTE_MAX_CONCURRENT_PER_IP=3` och `ROUTE_CONCURRENCY_RETRY_AFTER_SECONDS=10` om env saknas.

Canonical domains:

- `https://sakravagar.se` är huvuddomän.
- `https://www.sakravagar.se` redirectar till huvuddomänen.
- `https://säkravägar.se` / `https://xn--skravgar-0zae.se` behålls som legacy redirect till huvuddomänen.
- GraphHopper nås från serverkod via `https://routing.sakravagar.se`; gamla `routing.xn--skravgar-0zae.se` accepteras temporärt av Caddy under övergång.

## Viktiga dataregler

- Pågående olycka = `last_seen >= now() - 90 min`.
- Trafikverkets `severity` exponeras för störningar men är ofta tomt i nuläget. Popupen faller därför tillbaka till neutral "Trafikstörning" när påverkan saknas; om `severity` fylls med t.ex. "mycket stor", "stor" eller "liten" påverkan mappas det till motsvarande badge.
- Kartans olyckspunkter dedupas i `events_in_bbox`; snappade events använder `fid + message + road_number + first_seen-hour`, orphans använder vägnummer + geohash-fallback.
- Riskinfrastrukturen och `segment_detail` dedupar logiska olyckor per `fid + message + road_number + first_seen-hour`, men risklinjer och segmentpopup är pausade i UI.
- Riskrelaterade snap-/refresh-jobb är pausade i prod, så `event_segments` och `risk_per_segment` ska ses som vilande data snarare än live-sanning.
- Risk aggregeras per `fid`, inte `element_id`.
- `nvdb_trafik_latest` väljer senaste mätperiod per `element_id` men behåller syskon-`fid`.
- `events.raw`, `disturbances.raw` och `traffic_flow_measurements.raw` ska inte exponeras publikt.
- ÅDT-/hastighetslager och vilande riskinfrastruktur är bbox/tile-baserade för att undvika stora Supabase-svar.
- Rondell-/körfältsfiltren använder reducerade tabeller `route_large_roundabouts` och `route_multilane_segments`, bbox-RPC:n `route_lane_penalties_in_bbox(...)`, max 4000 returnerade rader och capped GraphHopper penalty areas per request. Import + `0032_route_lane_penalties.sql` kördes i Supabase 2026-05-14: `route_multilane_segments` 20 132 rader och `route_large_roundabouts` 3 064 rader.

## Gotchas

- Supabase PostGIS ligger i schemat `extensions`; `security definer` med explicit `search_path` behöver inkludera `extensions`.
- Supabase Data API-exponering ska vara explicit i nya migrations. Alla nya `public`-tabeller, vyer, materialized views, funktioner och sekvenser behöver minsta nödvändiga `grant` i samma migration som objektet/RLS/policies; anta inte att default privileges gör objektet nåbart för `anon`, `authenticated` eller `service_role`.
- Efter schema-/RPC-ändringar: regenerera `db/database.types.ts` med Supabase CLI och kör web-typecheck. Serverkod ska skapa Supabase-klient via `web/lib/supabaseServer.ts` så `createClient<Database>` används konsekvent.
- API-rutter skickar `x-request-id` och serverloggar använder stabila eventnamn: `api_observation` för mätpunkter, `api_warning` för mjuka fallbackar och `api_error` för fel. Middleware-rate-limit och route-concurrency är process-/instanslokala skydd. Cloudflare-regeln för `/api/route` är yttre skydd på Free-planen, men räknare kan fortfarande vara Cloudflare-datacenterlokala och är inte exakt global concurrency-kontroll. Vid större publik trafik eller app-specifika kvoter behövs Upstash/Vercel KV eller annan delad state.
- Lastkajen bulkimport ska använda Supabase session pooler på port `5432`, inte transaction pooler `6543`.
- `Höga hastigheter` kräver att `scripts/import-large-roads.sh` körts efter 80+-ändringen; migrationen ensam skapar inte raderna.
- `Stora rondeller` och `Flerfiligt` kräver att `scripts/import-route-lane-penalties.sh` körts mot `korfalt_rondell_*.gpkg` innan `0032_route_lane_penalties.sql` appliceras i Supabase. Underlaget är importerat i prod per 2026-05-14. Om en route-smoke ger `largeRoundabouts`/`multilane` som `null`, kontrollera först att RPC:n `route_lane_penalties_in_bbox(...)` finns och att tabellraderna inte har skrivits över utan att migrationen körts om.
- Mobil touch: om pan/scroll plötsligt känns slumpmässigt låst, kontrollera först osynliga overlay-knappar med `pointer-events`. Ett bekräftat fall var mobilens stängda lager-meny: items hade `opacity: 0` men barnknappar kunde ändå få touch-target. Stängda menyer ska därför även använda `visibility: hidden` och slå av pointer events på barnen.
- GraphHopper custom model kräver `ch.disable: true`; snabbaste basrutten kan använda CH.
- Efter domän-/env-ändringar i Vercel krävs redeploy för att `PUBLIC_SITE_ORIGIN`, `GRAPHHOPPER_BASE_URL`, redirects och CSP ska börja gälla i production.
- Om GraphHopper-cache byggs om efter config/OSM-byte: stoppa service, flytta `/opt/graphhopper/graph-cache`, starta service och följ `journalctl -u graphhopper -f`.
- Kör inte `next build` samtidigt som `next dev` om `.next` börjar bete sig konstigt.
- Publik Nominatim är bara MVP-default; byt till dedikerad provider/self-host/avtalad instans före större publik trafik.
- Risklagret (`addRiskLayer`) och segmentpopupen är dormant by design. Återaktivera inte dem som buggfix utan ett nytt produktbeslut om datamognad och kognitiv belastning.
- Om Supabase Disk IO-budget börjar förbrukas snabbt igen: kontrollera först `cron.job` och verifiera att `resnap-orphan-events`, `snap-event-segments` och `refresh-risk-mv` fortfarande är avstängda innan andra optimeringar görs.

## Nästa fokus

- Följ upp `Stadstrafik`, `Trafikintensiva vägar`, `Flerfiligt` och `Stora rondeller` mot fler verkliga ruttfall. Dagens kalibreringar känns bättre i testade case, men logik för road class, speed och parallellvägar behöver fortsatt verklighetskontroll.
- Följ upp GraphHopper-fanout i prod-loggar, särskilt `highSpeed`, `trafficIntensity`, `cityTraffic` och kombinationer med bro/tunnel.
- Kör `0028_route_feedback_update_delete.sql` i Supabase innan live-test av toggle-bort av tumme, om den inte redan är körd.
- Följ upp verklig ruttfeedback när det finns tillräckligt många rader.
- Route cleanup för `/api/route/route.ts` är nu på en rimlig första nivå. Nästa routingsteg bör vara kalibrering/observability snarare än fler stora filflyttar.
- Fortsätt frontend cleanup utan UX-ändring när det passar: `Map.tsx` är den största kvarvarande filen efter route/layers-splitten. Prioritera routeplanner-orchestration först: route state, vald rutt, shared-route loading, planRoute/cache/fetch-flöde och map-control-state kan flyttas till hooks/moduler stegvis.
- `Map.module.css` är reducerad men fortfarande kvar som kartskal/styrpanel: info/live/time-box, lagerkontroller, högerkontroller, via-marker och mobil-attribution. Nästa låg-risk-split är map controls/info/live/time om filen börjar växa igen.
- `_routing/scoring.ts`, `layers/route.ts` och `layers/largeRoads.ts` är de största kvarvarande specialistmodulerna. De behöver inte delas nu, men är rimliga kandidater om framtida ändringar gör dem svåra att läsa.
- A11y: route suggestions som korrekt combobox/listbox/option samt InfoBox/fokus efter bekräftade produktbeslut.
- Framtidsidé: komplettera ÅDT/Flöde med kommunal trafikmängdsdata för centrala stadsgator. Göteborg och Stockholm visar luckor där kommunala gator saknar NVDB/Lastkajen-ÅDT. Prioritera som berikning av `Trafikintensiva vägar` och Flöde-lagret; använd bara sekundärt för `Stadstrafik` så signalerna inte dubbleras.
