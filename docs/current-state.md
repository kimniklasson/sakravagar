# Current state — 2026-05-01

Kort projektminne för nya sessioner. Läs detta först, sedan `PROJECT.md` för produktidén och `docs/decisions.md` för långlivade vägval.

Senaste större arbetslogg: `docs/session-2026-05-01.md`.

## Produktläge

Säkravägar.se är en Next/MapLibre-karta för personer som känner oro i trafiken. MVP:n visar historiska olyckor, aktuella olyckor och vägbaserade risk-/trygghetslager. Routing använder nu self-hostad GraphHopper som första riktiga steg mot "undvik om möjligt"-routing med egna vägvikter, men filtervikterna behöver fortsatt kalibreras.

Aktiva lager i UI:t:

- **Risk** — vägsegment färgas efter deduplicerade olyckor normaliserat mot ÅDT. Risk är gul→röd och är den enda varma riskskalan.
- **Flöde** — ÅDT från NVDB/Lastkajen, blå skala, underlagsdata.
- **Störning** — aktuella vägarbeten och kö-/trafikstörningar från Trafikverket, separat från olyckshistoriken.
- **Liveflöde** — Trafikverkets TrafficFlow-mätplatser snappade till närmaste vägsegment. Täckningen är bäst i Stockholm/Göteborg.
- **Hastighet** — NVDB-hastighetsgränser 90 km/h eller högre, default av.
- **Olyckor** — historiska olyckor som neutral heatmap/punkter; pågående olyckor som pulserande vita punkter.

Senaste UI-beteende: den röda liveboxen visar globalt antal pågående olyckor. Klick på boxen fokuserar kartan på aktiva olyckor: 1 olycka flyger till zoom 10, 2+ kör `fitBounds` så alla syns.

Ruttplaneraren finns under liveboxen och har fungerande geocoding/routing-koppling. Adressfält söker via egen `/api/geocode`-proxy mot Nominatim, GPS reverse-geocodas till läsbar plats när provider svarar, och rutten räknas automatiskt via egen `/api/route`. `/api/route` använder GraphHopper när `GRAPHHOPPER_BASE_URL` finns och faller tillbaka till OSRM annars.

Ruttplanerarstatus:

- `Från`/`Till`-fält finns i `RoutePlannerBox` i `web/components/Map/Map.tsx`.
- `Din plats` visas bara när `Från adress` faktiskt har fokus och är tomt. Den ligger som absolut overlay under första fältet, startar ungefär vid textkolumnen och animerar in.
- GPS-flowet använder `navigator.geolocation`, visar CSS-loader och `Hämtar plats...` under hämtning, sätter koordinat direkt och uppdaterar label via reverse geocoding om möjligt. Om plats nekas/timeoutar eller reverse geocoding misslyckas visas begripligt felmeddelande i ruttpanelen.
- Textinput debouncar mot `/api/geocode`, visar upp till 5 svenska träffar och sätter stop-koordinat när användaren väljer en träff. Om användaren bara skriver färdigt använder auto-routing bästa geocoding-träffen för stopp som saknar koordinat.
- Geocoding-resultat visas som korta etiketter (`väg/plats, ort`) i UI:t. Backend rankar träffar efter hur väl den visade etiketten matchar queryn, och behåller föregående träffar under laddning så listan inte blinkar tom vid svaga mellanqueries som `Hästsk`.
- Primär ruttritning kan dras direkt på kartan. Hover visar `Dra för att ändra rutt` och en liten punkt på ruttlinjen. Under drag körs en throttlad preview via `/api/route` med `preview: true`, vilket hämtar en GraphHopper/OSRM-rutt utan Supabase-score. Vid släpp ersätts eventuell tidigare dold via-punkt med den nya och `/api/route` räknar om rutt + risk/exposure.
- Draghandles har enkel HTML drag/drop-reorder av stop-arrayen. Rensa-knappen tömmer Från/Till och tar bort mellanliggande dolda via-punkter.
- Normalflödet är att rutten ritas automatiskt när Från/Till har tolkats.
- När en rutt finns expanderar boxen med tid till destination, distans och "Undvik om möjligt"-filter. Alla filter är off default.
- Undvik-filter finns för `Vägar med olyckshistorik`, `Höga hastigheter (90+)` och `Störningar (kö/vägarbeten)`. Info-ikonen till vänster expanderar kort förklaring per filter; toggeln till höger ändrar ruttvalet.
- Toggle visar loading-copy `Jämför alternativ...` och gör ett nytt `/api/route`-anrop med aktiva preferenser när minst ett filter är på. Initial rutt utan filter hämtar bara snabbaste vägen.
- När ett filter är aktivt visas tidsbudget-slider: `0 / 10 / 20 / 30 / 45 / 60 / ∞`. Tidsbudgeten är ett hårt filter för visade alternativ: rutter över vald extra restid döljs/returneras inte som förslag. Sliderändring triggar ny jämförelse mot `/api/route`; `∞` öppnar för längre undvik-rutter.
- Vald rutt visar kvarvarande exponering för aktiva filter, t.ex. kilometer 90+ kvar, antal störningar nära rutten eller kvarvarande olycksriskpoäng.
- Failstate visas i 5 sekunder. Om flera kandidater finns men inget bättre matchar aktiva filter visas `Tyvärr hittades ingen bättre rutt. Snabbaste rutten är fortfarande bästa matchningen.` Om bara en kandidat finns visas `Hittade inga alternativa rutter att jämföra.`
- Ruttlinjer ligger i `addRouteLayer`/`setRouteLayerData` i `web/components/Map/layers.ts`: primär rutt är turkos, alternativa rutter är diskreta vita linjer. Filtren väljer primär rutt bland GraphHopper-/OSRM-kandidaterna. Vita alternativrutter har en bred osynlig hit-line och kan klickas på kartan för att bli vald primärrutt. Primärrutten har också en bred osynlig hit-line för manuell drag-omdragning.
- `/api/route` accepterar `avoid`, `maxExtraMinutes` och `preview`. Normalt returneras `avoidScores` + `exposure` per rutt för `accidentHistory`, `highSpeed` och `disturbances`. Olyckshistorik använder `risk_in_bbox`, höghastighet använder `large_roads_in_bbox`, och störningar använder aktiva `disturbances_public`-punkter nära rutten. `preview: true` används bara under kartdragning och hoppar över scoring för att hålla previewn billig.
- GraphHopper-kandidater: utan aktiva filter hämtas snabbaste GraphHopper-rutten. Med aktiva filter hämtas snabbaste baseline + GraphHopper `alternative_route`. Om `highSpeed` är aktiv används en hård "calm" custom model med lägre prioritet för `MOTORWAY`, `TRUNK`, `PRIMARY`, `max_speed >= 100`, `max_speed >= 90` och `max_speed >= 80`; highSpeed får även en diversifierad custom-kandidat via aktiva störningszoner för att hitta fler låg-/noll-högfartskorridorer, men UI:t rankar den bara på toggles som användaren faktiskt valt. Vid tidsbudget `∞` öppnas GraphHopper-sökningen upp med högre `max_weight_factor`, fler `alternative_route`-paths och större kandidatlimit. Om `accidentHistory` eller `disturbances` är aktiva byggs dynamiska custom areas/penalty zones från risksegment och aktiva störningspunkter i baseline-korridoren, och dessa läggs in i GraphHoppers `priority`-modell. Custom model kräver `ch.disable: true`. OSRM används bara om GraphHopper-env saknas; då visas notice i UI:t när undvik-filter är aktiva eftersom OSRM bara kan jämföra ett fåtal standardalternativ.
- Filterranking i UI:t är constraint-baserad: välj lägst genomsnittlig avoid-score bland kandidater inom tidsbudgeten. Vid lika trygghet väljs mindre extra tid och därefter kortare total tid. Alternativ över tidsbudgeten filtreras bort från kartan.
- Layout desktop: info/live/tidsfönster ligger i vänsterstacken, ruttplaneraren ligger separat uppe till höger, och zoom/location ligger centrerat längst ner. `fitBounds` för rutter/live tar hänsyn till både vänster- och högerkontroller.
- Nya assets ligger i `web/public/icons/search.svg`, `draghandles.svg`, `close-circle.svg`, `varning.svg`. Location/zoom återanvänder inline-ikonerna i `Map.tsx`.
- `type-small-x` finns i `web/styles/globals.css` för små texter utan versaler och med `letter-spacing: 0`.

Kvar för ruttplaneraren:

- Nominatim är fortfarande publik default för geocoding; byt till dedikerad provider/self-host/avtalad instans före större publik trafik.
- GraphHopper custom models påverkar nu vägkostnaden för höghastighet, olyckshistorik och aktiva störningar. Olyckshistorik/störningar rankas fortfarande efteråt också, så UI:t kan välja bästa kandidat inom tidsbudget.
- Nästa routingsteg: kalibrera penalty zone-storlek, maxantal och multipliers mot verkliga ruttfall så omvägarna blir tydliga utan att kännas överdrivna.
- Kalibrera factor-scores och tidsbudget-default på verkliga exempel.
- Finlira routeplanner-UI enligt Kims senaste designfeedback.
- Senare: tydligare swap-knapp för bara Från/Till, och riktig alternativpanel när flera rutter finns.

## Arkitektur

- **Scrape:** Supabase `pg_cron` + `pg_net` anropar Edge Function `supabase/functions/scrape`. GitHub Actions-workflowet finns kvar som manuell nödknapp.
- **Databas:** Supabase Postgres + PostGIS. SQL-migrations ligger i `db/migrations/`.
- **Webb:** Next.js App Router i `web/`, MapLibre GL JS, CSS Modules + design tokens.
- **Routing:** Self-hostad GraphHopper på Hetzner bakom Caddy/HTTPS och header-token. Vercel anropar via `/api/route`; GraphHopper är inte publikt exponerad direkt.
- **Delade typer:** `shared/`, men frontendens API-rutter exporterar också lokala response-typer där det är smidigast.

## Domäner och routing-infra

- App-domän: `https://säkravägar.se` (`xn--skravgar-0zae.se`) på Vercel production.
- Gammal Vercel-domän finns kvar: `https://sakravagar.vercel.app/`.
- DNS hanteras i Cloudflare free plan. Loopia är registrar för `säkravägar.se`; Loopia nameservers ska peka på Cloudflare (`blair.ns.cloudflare.com`, `scott.ns.cloudflare.com` vid setup 2026-05-01).
- Cloudflare DNS-poster:
  - `A @ -> 76.76.21.21` för Vercel root.
  - `CNAME www -> cname.vercel-dns.com`.
  - `A routing -> 116.203.135.46`, DNS only.
- Routing-server: Hetzner CPX32, Ubuntu 24.04, IPv4 `116.203.135.46`, ungefär 8 GB RAM/150 GB disk. Kostnad ungefär 250 kr/mån inkl. svensk moms.
- GraphHopper ligger i `/opt/graphhopper` på servern. Version: `graphhopper-web-11.0.jar`. Sverige-OSM ligger i `/opt/graphhopper/data/sweden-latest.osm.pbf`, graph cache i `/opt/graphhopper/graph-cache`.
- Systemd-service: `graphhopper.service`, lyssnar bara på `localhost:8989` och admin på `localhost:8990`.
- Caddy-service: `caddy.service`, exponerar `https://routing.säkravägar.se` / `https://routing.xn--skravgar-0zae.se`, reverse-proxyar till `127.0.0.1:8989` bara när requesten har rätt `X-Routing-Token`.
- Token ligger på servern i `/root/routing-token.txt`. Dela inte värdet i chat/loggar/repo. Vercel env vars:
  - `GRAPHHOPPER_BASE_URL=https://routing.xn--skravgar-0zae.se`
  - `GRAPHHOPPER_TOKEN=<värdet från /root/routing-token.txt>`
- UFW på servern: incoming default deny, outgoing allow. Publikt öppna portar: `22`, `80`, `443`. GraphHopper-port `8989` är localhost-only.
- 4 GB swap finns i `/swapfile` för importmarginal. Första Sverige-importen peakade runt 3.1 GB RAM och använde ingen swap.
- Testade 2026-05-01:
  - `https://routing.säkravägar.se/info` utan token -> `404`.
  - Samma med `X-Routing-Token` -> `200`.
  - Floda -> Göteborg via GraphHopper svarade med snabb kandidat och calm-kandidat.

Trafikverket-flöden som scrapas:

- `Situation`/`Deviation` med `MessageType=Olycka` → `events`
- övriga relevanta `Situation`/`Deviation` → `disturbances`
- `TrafficFlow` → `traffic_flow_measurements`

## Viktiga dataregler

- Pågående olycka = `last_seen >= now() - 90 min`.
- `/api/events` kräver `bbox`. Med `live=1` returnerar den bara aktiva olyckor inom bbox.
- Liveboxens antal hämtas via hel-Sverige-bbox och `live=1`, inte från nuvarande viewport.
- Risk och popup ska räkna samma logiska olyckor: dedup per `fid + message + road_number + first_seen-hour`.
- Risk aggregeras per `fid`. Aggregera inte på `element_id`; det kan slå ihop olika fysiska vägsträckor.
- `nvdb_trafik_latest` filtrerar äldre mätperioder per `element_id` men behåller syskon-`fid` inom senaste mätperioden.
- ÅDT-/risk-/hastighetslager är bbox/tile-baserade för att undvika stora Supabase-svar och blinkande lager.
- `events.raw` ska inte exponeras publikt. Publik läsning går via vyer/API/RPC.

## Frontend

Huvudfiler:

- `web/components/Map/Map.tsx` — React-state och UI-boxar. Initierar MapLibre, lagercontrollers, timers, livebox-fokus, zoom/location och mobilattribution.
- `web/components/Map/layers.ts` — MapLibre-källor/lager, bbox-loaders, live-eventhämtning, popuphandler och renderordning.
- `web/components/Map/Map.module.css` — overlay-layout, boxar, toggles, ikoner, responsiv placering.
- `web/styles/globals.css` — globala typografiklasser, MapLibre popup-styling och attribution-overrides.
- `web/styles/tokens.css` — brandfärger, Univers-font och typografitokens.

Renderprinciper:

- Flöde ligger under Risk; events ligger över båda.
- Olyckspunkter/heatmap är neutrala vita/grå, inte varma riskfärger.
- MapLibre popups ligger utanför React/CSS Modules, därför används globala `.seg-popup-*`-klasser.
- Mobil använder `visualViewport`-variabler för att undvika browser chrome/body-scroll-problem.

## API-rutter

- `web/app/api/events/route.ts` — `events_public`, kräver `bbox`, stödjer `since` och `live=1`.
- `web/app/api/events/stats/route.ts` — datafönster/färskhet för UI-copy.
- `web/app/api/risk/route.ts` — `risk_in_bbox`.
- `web/app/api/adt/route.ts` — `adt_in_bbox`.
- `web/app/api/large-roads/route.ts` — `large_roads_in_bbox`.
- `web/app/api/disturbances/route.ts` — aktiva vägarbeten/köer.
- `web/app/api/traffic-flow/route.ts` — aktiva TrafficFlow-segment.
- `web/app/api/geocode/route.ts` — Nominatim-proxy för search/reverse, Sverige-bounds, svensk `Accept-Language`, kortetiketter och lokal resultatrankning.
- `web/app/api/route/route.ts` — routingproxy. Använder GraphHopper om `GRAPHHOPPER_BASE_URL` finns, annars OSRM. Returnerar ruttkandidater och `avoidScores`.
- `web/app/api/segment/route.ts` — `segment_detail(p_fid)` för popup.
- `web/app/api/_utils.ts` — bbox-validering och JSON/cache-headers.

Alla tunga bbox-rutter ska ha både API-side area guard och SQL-side limit.

## Databas och migrations att känna till

- `0004_pg_cron_scrape.sql` — schemalägger Edge Function-scrape.
- `0008_risk_pipeline.sql` + `0009_risk_cron.sql` — snapping, `risk_per_segment`, risk-refresh.
- `0011_segment_detail_v2.sql` — popupens segmentdetaljer och dedup.
- `0012_resnap_orphans.sql` — self-healing för events som markerats processed utan segmentmatch.
- `0014_correct_dedup_strategy.sql` — korrekt `fid`-baserad risk efter felaktig `element_id`-premiss.
- `0016_remove_tsk.sql` — TSK är borttaget ur UI/dataflödet.
- `0018_live_disturbances.sql` — separat störningsspår.
- `0019_large_roads_filter.sql` — hastighets-/stora-vägar-data från Lastkajen.
- `0020_live_traffic_flow.sql` till `0022_stabilize_flow_segments.sql` — TrafficFlow och stabila segmentlinjer.
- `0023_security_limits_dedup.sql` — publika grants, server-limits och dedupad risk-MV.

## Gotchas

- Supabase PostGIS ligger i `extensions`. `security definer`-funktioner med explicit `search_path` måste inkludera `extensions`.
- Supabase free tier har kort `statement_timeout`; undvik stora bboxar och globala NVDB/Risk-anrop.
- MapLibre `interpolate` kräver strikt växande inputvärden.
- `<->` kNN kan rangordna på bbox-distance; diagnostik för närmaste segment bör re-ranka med `st_distance`.
- Kör inte `next build` medan `next dev` är igång. Stoppa dev-servern först om `.next` beter sig konstigt.
- Lokal geolocation kräver secure context; vanlig lokal HTTP visar alert, HTTPS-prod bör fungera.
- Lastkajen DB-import ska använda Supabase session pooler på port 5432, inte transaction pooler 6543.
- GraphHopper custom model fungerar inte i speed mode/CH; skicka `ch.disable: true` i POST-body för custom model-rutter. Snabbaste basrutten kan använda CH.
- Om GraphHopper-cache ska byggas om efter config/OSM-byte: stoppa `graphhopper.service`, ta bort eller flytta `/opt/graphhopper/graph-cache`, starta service igen. Import kan ta några minuter och bör följas med `journalctl -u graphhopper -f`.
- Lokalt devtest med GraphHopper kräver env vars. Kör exempelvis `TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') GRAPHHOPPER_BASE_URL='https://routing.xn--skravgar-0zae.se' GRAPHHOPPER_TOKEN="$TOKEN" pnpm web`. Utan env faller `/api/route` tillbaka till OSRM och reproducerar inte production-routing.

## Verifiering

Vanliga kommandon:

```sh
pnpm --filter @trafik/web run lint
pnpm --filter @trafik/web run typecheck
pnpm --filter @trafik/web run build
pnpm -r run typecheck
```

För lokal preview:

```sh
pnpm web
```

Om port 3000 är upptagen väljer Next en annan port.

För lokal preview som matchar production-routing:

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') \
GRAPHHOPPER_BASE_URL='https://routing.xn--skravgar-0zae.se' \
GRAPHHOPPER_TOKEN="$TOKEN" \
pnpm web
```

## Nästa fokus

- Testa och kalibrera routeplanner-filter på fler verkliga sträckor. Kända case: Floda -> Rönnäng ska byta till lugnare kandidat när `Höga hastigheter (90+)` slås på.
- Kalibrera `accidentHistory` och `disturbances` penalty zones i GraphHopper och följ upp med manuella smoke tests på kända sträckor.
- När olyckshistoriken mognat: kalibrera riskskalan om från preliminära värden till mer stabila brytpunkter.
