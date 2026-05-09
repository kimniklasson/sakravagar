# Current state — 2026-05-09

Kort projektminne för nya sessioner. Läs detta först, sedan `PROJECT.md` för produktidén och `docs/decisions.md` för långlivade vägval.

Senaste större arbetslogg: `docs/session-2026-05-09.md`.

## Produktläge

Säkravägar.se är en Next/MapLibre-karta för personer som känner oro i trafiken. MVP:n visar historiska olyckor, aktuella olyckor och vägbaserade risk-/trygghetslager. Routing använder nu self-hostad GraphHopper som första riktiga steg mot "undvik om möjligt"-routing med egna vägvikter, men filtervikterna behöver fortsatt kalibreras.

Aktiva lager i UI:t visas som en kompakt ikonrad uppe till höger på desktop. På mobil samlas lagerknapparna bakom en `layers.svg`-knapp nere till höger; knappen expanderar upp text+ikon-pills och byter till stängkryss när menyn är öppen.

- **Hjälp** — öppnar en beige hjälp-/datapanel från höger. Panelen förklarar datalager, legender, datakällor, polling/refresh och visar när datan senast uppdaterades.
- **Olyckor och risk** — gemensam toggle för vägsegment-risk, historiska olyckor och pågående olyckor. Default av för att inte tvinga fram stressande olycksvisualiseringar.
- **Trafikflöde (snitt)** — ÅDT från NVDB/Lastkajen, blå skala, underlagsdata och inte klickbart. Default av.
- **Liveflöde (storstad)** — Trafikverkets TrafficFlow-mätplatser snappade till närmaste vägsegment. Täckningen är bäst i Stockholm/Göteborg. Default av.
- **Trafikstörningar** — aktuella vägarbeten och kö-/trafikstörningar från Trafikverket, separat från olyckshistoriken. Default av.
- **Höga hastigheter** — NVDB-hastighetsgränser 80 km/h och högre, som badges utan linjelager. Default av.

Hjälppanelen:

- Desktop: glider in från höger; lager-/zoomkontroller flyttas åt vänster när panelen är öppen.
- Mobil: visas som helskärm med ett eget 24 px stängkryss längst upp till höger i modalen.
- `Olyckor och risk` är öppen default, men användaren kan stänga alla accordions. Max en accordion är öppen åt gången.
- Panelen har legender för risk/olyckor, ÅDT-flöde, liveflöde och trafikstörningar. Höga hastigheter förklaras i text utan egen legend.
- Scrollbar är dold för att undvika breddhopp i panelens innehåll.

Liveolyckor visas som en liten badge på `Olyckor och risk` endast när lagret är på. Klick på badgen fokuserar kartan på aktiva olyckor: 1 olycka flyger till zoom 10, 2+ kör `fitBounds` så alla syns. Själva togglen zoomar aldrig, den är bara av/på.

Ruttplaneraren finns direkt under infoboxen i vänsterstacken och har fungerande geocoding/routing-koppling. Adressfält söker via egen `/api/geocode`-proxy mot Nominatim, GPS reverse-geocodas till läsbar plats när provider svarar, och rutten räknas automatiskt via egen `/api/route`. `/api/route` använder GraphHopper när `GRAPHHOPPER_BASE_URL` finns och faller tillbaka till OSRM annars.

Vänster infobox expanderar lokalt nedåt med kort, syftesdriven tjänsteinfo. Den öppnar inte högerställda hjälppanelen; den panelen styrs av hjälpknappen i lagerikonraden och innehåller datakällor/metodförklaringar.

Ruttplanerarstatus:

- `Från`/`Till`-fält finns i `RoutePlannerBox` i `web/components/Map/Map.tsx`.
- Inputfälten använder `myposition.svg` och `mydestination.svg`, large text och 8 px hörnradie på fältblocket. På mobil är inputfälten tightare med 12 px vertikal padding. Det finns ingen separat container runt inputfält och pills.
- `Din plats` visas bara när `Från adress` faktiskt har fokus och är tomt. Den ligger som en vanlig resultatrad mellan start- och destinationsfältet.
- GPS-flowet använder `navigator.geolocation`, visar CSS-loader och `Hämtar plats...` under hämtning, sätter koordinat direkt och uppdaterar label via reverse geocoding om möjligt. Om plats nekas/timeoutar eller reverse geocoding misslyckas visas begripligt felmeddelande i ruttpanelen.
- Textinput debouncar mot `/api/geocode`, visar upp till 5 svenska träffar och sätter stop-koordinat när användaren väljer en träff. Upp/ned-tangenter markerar resultatrader och Enter/retur väljer markerad rad.
- Auto-routing startar bara när båda stopp redan har koordinater, alltså efter explicit geocoding-val eller GPS. Den ska inte autovälja första träffen medan användaren skriver.
- Geocoding-resultat visas som korta etiketter (`väg/plats, ort`) i UI:t. Backend rankar träffar efter hur väl den visade etiketten matchar queryn, och behåller föregående träffar under laddning så listan inte blinkar tom vid svaga mellanqueries som `Hästsk`.
- Primär ruttritning kan dras direkt på kartan. Hover visar `Dra för att ändra rutt` och en liten punkt på ruttlinjen. Under drag körs en throttlad preview via `/api/route` med `preview: true`, vilket hämtar en GraphHopper/OSRM-rutt utan Supabase-score. Vid släpp ersätts eventuell tidigare dold via-punkt med den nya och `/api/route` räknar om rutt + risk/exposure.
- Draghandles har enkel HTML drag/drop-reorder av stop-arrayen. Rensa-knappen tömmer Från/Till och tar bort mellanliggande dolda via-punkter.
- Normalflödet är att rutten ritas automatiskt när Från/Till har tolkats.
- `Undvik om möjligt` visas som pills för `Höga hastigheter`, `Trafikintensiva vägar`, `Broar`, `Tunnlar`, `Störningar` och `Olycksrisk`. Pills kan väljas innan Från/Till fylls i och ligger kvar genom input/geocode. På mobil ligger sektionen utan egen bakgrund 16 px under inputfälten för att inte täcka kartan. Varje pill har en kort vit tooltip i `m-small`. Undvik-score för höga hastigheter räknar 90+ km/h-exponering från GraphHopper `max_speed` path details när de finns, med NVDB som fallback. Trafikintensiva vägar använder ÅDT som bas och liveflöde som förstärkning där det finns. Broar/tunnlar räknas från GraphHopper `road_environment` path details.
- Aktiv filterladdning visas som liten spinner i aktiva pills. Det finns ingen separat stor `Jämför alternativ...`-box.
- Tidsbudget-slidern är borttagen ur UI:t. Utan aktiva filter visas bara snabbaste rutten. Med aktiva filter öppnas kandidatläget och användaren får se alla relevanta alternativ vi kan hitta.
- Routing-performancebudget: snabbaste rutt ska normalt kännas klar inom 0-4 sekunder och har server-timeout 20 sekunder; filtrerade alternativ ska normalt landa inom 0-12 sekunder, får mjuk info efter 12 sekunder, ovanligt-långsam-info efter 30 sekunder och server-timeout strax före Vercels 60-sekundersgräns. Timeoutcopy ber användaren prova senare, kortare resa eller färre undvik-val.
- Routeplanner har en frontend session-cache för `/api/route`-svar keyed på koordinater/via-punkter, aktiva undvik-filter, tidsbudget och antal alternativ. Den används för snabba filter-toggles, t.ex. när användaren går från `Höga hastigheter` till `Höga hastigheter + Trafikintensiva vägar` och tillbaka. TTL är konservativ: statiska filter 60 min, `Olycksrisk` 15 min, `Trafikintensiva vägar` 5 min och `Störningar` 2 min. Ingen permanent/server-cache finns ännu.
- Ruttalternativ visas som scrollande kort i botten av kartan. Varje kort visar titel, tid, distans och en metrikslista för aktiva `Undvik om möjligt`-val. Korten har 16 px padding, 8 px radius och `#555` vid 30% opacitet med 16 px blur. På mobil är korten 280 px breda och ligger 32 px från botten så de inte krockar med kartattributionen. Vald rutt har mörkare bakgrund. Metrikrader använder `m-small`, 15% vit top border, 60% vit vänstertext, 100% vit högertext och `#95FF97` för positiva värden.
- Alternativlistan sorteras efter aktiva `Undvik om möjligt`-kriterier först. Rutter som matchar filtren ungefär lika bra sorteras därefter på tid och sedan distans. Uppenbart dominerade rutter, alltså sådana som är sämre på aktiva filter utan att vara snabbare, tas bort från listan. Vald rutt är separat state från listordningen. Klick på alternativ i kartan autoscrollar listan till valt kort; klick på alternativ i listan fokuserar kartan på vald rutt.
- Hover/focus på ett alternativ markerar motsvarande linje på kartan utan att ändra listordningen.
- Bottenfade i alternativlistan visas bara när listan faktiskt har overflow.
- Failstate visas i 5 sekunder. Om flera kandidater finns men inget bättre matchar aktiva filter visas `Tyvärr hittades ingen bättre rutt. Snabbaste rutten är fortfarande bästa matchningen.` Om bara en kandidat finns visas `Hittade inga alternativa rutter att jämföra.`
- Ruttlinjer ligger i `addRouteLayer`/`setRouteLayerData` i `web/components/Map/layers.ts`: primär rutt är vit, alternativa rutter är fasta `#666666`-linjer med full opacitet. `setRouteLayerData` tar ett valfritt `selectedRouteId`, så UI:t kan hålla listan tidssorterad samtidigt som kartan markerar valt/hoverat alternativ. Alternativrutter har en bred osynlig hit-line och kan klickas på kartan för att bli vald primärrutt. Primärrutten har också en bred osynlig hit-line för manuell drag-omdragning. Vald rutt visar start-/slutmarkörer ovanpå linjen samt annotations för aktiva undvik-val: höghastighet rosa linje, broar magenta dash, tunnlar rödorange dash, störningar orange triangel och olyckshistorik röd punkt. Route annotations visas både när rutten väljs via kort och när den väljs direkt på kartlinjen.
- `/api/route` accepterar `avoid`, `maxExtraMinutes` och `preview`. Normalt returneras `avoidScores` + `exposure` per rutt för `accidentHistory`, `highSpeed`, `trafficIntensity`, `disturbances`, `bridges` och `tunnels`. Olyckshistorik använder `risk_in_bbox`, höghastighet använder `large_roads_in_bbox`, trafikintensitet använder `adt_in_bbox` och `traffic_flow_segments_in_bbox`, störningar använder aktiva `disturbances_public`-punkter nära rutten och broar/tunnlar använder GraphHopper `road_environment` path details. `preview: true` används bara under kartdragning och hoppar över scoring för att hålla previewn billig.
- `/api/route` loggar lätt routing-observability utan koordinater/adresser: aktiva undvik-filter, antal koordinatstopp, alternativ-count, tidsbudget, preview-flagga, provider/fallback, total tid, provider-tid, scoring-tid, GraphHopper request-/timeout-counts, kandidatantal före/efter hybrid/budget och antal rutter tillbaka. Detta ska användas för fanout-trimning och prestandabeslut.
- GraphHopper-kandidater: utan aktiva filter hämtas snabbaste GraphHopper-rutten plus GraphHopper `alternative_route`, men returnerar bara den snabbaste kandidaten till UI:t. Med aktiva filter hämtas snabbaste baseline + GraphHopper `alternative_route`, och faktisk snabbaste kandidat läggs först i API-svaret så baseline är konsekvent även när filter slås på. Om `highSpeed` är aktiv används en hård "calm" custom model och en mjukare balanserad modell med lägre prioritet för `MOTORWAY`, `TRUNK`, `max_speed >= 100` och `max_speed >= 90`; den straffar inte längre 80-vägar eller `PRIMARY` generellt, eftersom en vanlig 70-/80-väg inte ska räknas som hög hastighet bara på grund av vägklass. Om `bridges` eller `tunnels` är aktiva sänks prioriteten för `road_environment == BRIDGE` respektive `road_environment == TUNNEL`. När flera kärnrädslefilter kombineras hämtas även extra singelkandidater för varje aktivt kärnfilter (`highSpeed`, `trafficIntensity`, `bridges`, `tunnels`) separat, så en bra låg-hastighets-, lågtrafik-, låg-bro- eller låg-tunnelrutt inte försvinner bara för att den kombinerade modellen missar den. När sekundära filter (`disturbances` eller `accidentHistory`) kombineras med kärnrädslefilter hämtas även en extra core-kandidat utan de sekundära filtren, så en bra kärnfilterrutt inte försvinner bara för att den har fler störningar eller högre olyckshistorik. highSpeed får bara den diversifierade custom-kandidaten via aktiva störningszoner på längre highSpeed-only-rutter, eftersom den är dyr och redundant på kortare/lokala sökningar. Längre highSpeed-sökningar kan få hybridkandidater byggda från redan hämtade GraphHopper-rutter och via-kandidater från låg-hastighetspunkter i alternativa korridorer, så flera olika "undviker höga hastigheter"-förslag kan visas medan snabbare vägar bara fungerar som referenser. När `highSpeed` kombineras med andra filter tas en extra highSpeed-backbone med, så lugna korridorer från highSpeed-only finns kvar och de nya filtren adderar kompromissalternativ. Genererade via-/hybridkandidater med tydlig ut-och-tillbaka-avstickare sållas bort, och highSpeed-returen begränsas till de bästa lugna alternativen plus ett fåtal jämförelser med snabbare väg. Plain `highSpeed + trafficIntensity` hoppar över en tidigare redundant calm-kandidat, rena trafficIntensity-kombinationer skickar max cirka fem rutter vidare till scoring/UI och highSpeed+traffic kan returnera cirka sju rutter. Ett experiment med fria sidoförskjutna korridorprober backades ut eftersom det kunde skapa dead-end/vändningsrutter. Nästa parallellvägsstrategi bör utgå från faktiska vägsegment. Vid tidsbudget `∞` öppnas GraphHopper-sökningen upp med högre `max_weight_factor`, fler `alternative_route`-paths och större kandidatlimit. Om `accidentHistory` eller `disturbances` är aktiva byggs dynamiska custom areas/penalty zones från risksegment och aktiva störningspunkter i baseline-korridoren, och dessa läggs in i GraphHoppers `priority`-modell. Custom model kräver `ch.disable: true`. OSRM används bara om GraphHopper-env saknas; då visas notice i UI:t när undvik-filter är aktiva eftersom OSRM bara kan jämföra ett fåtal standardalternativ.
- Filterranking i UI:t väljer rekommenderad/markerad rutt efter viktad avoid-score och låter samma prioritering styra vänster-till-höger-ordningen i kortlistan. `Höga hastigheter` och `Trafikintensiva vägar` väger tyngst, broar/tunnlar därefter, medan `Störningar` och `Olycksrisk` är sekundära signaler. Extra restid läggs in som mjuk friktion så en marginellt lugnare rutt inte kan vinna med orimlig omväg. När filtermatchningen är ungefär lika används tid och sedan distans som tie-breakers.
- Layout desktop: info och ruttplanerare ligger i vänsterstacken, standardbredd 360 px. Lagerkontrollerna är en kompakt ikonrad uppe till höger, och zoom/location ligger nere till höger. Mobil har en fast knappstack nere till höger: layers/help/location, 24 px från höger och botten och frikopplad från ruttkorten. MapLibre-attribution visas permanent nere till vänster. Den gamla röda liveboxen och tidsfönsterboxen är borttagna.
- Nya assets ligger i `web/public/icons/myposition.svg`, `mydestination.svg`, `search.svg`, `draghandles.svg`, `close-circle.svg`, `varning.svg`, `help.svg`, `accidents.svg`, `flow.svg`, `live.svg`, `disturbances.svg`, `speed.svg`, `layers.svg`. Location/zoom återanvänder inline-ikonerna i `MapIcons.tsx`.
- `type-small-x` finns i `web/styles/globals.css` för små texter utan versaler och med `letter-spacing: 0`.

Kvar för ruttplaneraren:

- Nominatim är fortfarande publik default för geocoding; byt till dedikerad provider/self-host/avtalad instans före större publik trafik.
- GraphHopper custom models påverkar nu vägkostnaden för höghastighet, olyckshistorik och aktiva störningar. Olyckshistorik/störningar rankas fortfarande efteråt också, så UI:t kan välja bästa kandidat inom tidsbudget.
- Nästa routingsteg: kalibrera penalty zone-storlek, maxantal och multipliers mot verkliga ruttfall så omvägarna blir tydliga utan att kännas överdrivna.
- Kalibrera factor-scores och tidsbudget-default på verkliga exempel.
- Finlira routeplanner-UI efter lokal testning av nya alternativkort.
- Senare: tydligare swap-knapp för bara Från/Till.

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

- `web/components/Map/Map.tsx` — React-state och UI-boxar. Initierar MapLibre, lagercontrollers, timers, lagerikonrad, livebadge-fokus, zoom/location och mobilattribution.
- `web/components/Map/layers.ts` — MapLibre-källor/lager, bbox-loaders, live-eventhämtning, popuphandler, ruttmarkering och renderordning.
- `web/components/Map/Map.module.css` — overlay-layout, boxar, toggles, ikoner, responsiv placering.
- `web/styles/globals.css` — globala typografiklasser, MapLibre popup-styling och attribution-overrides.
- `web/styles/tokens.css` — brandfärger, Univers-font och typografitokens.

Renderprinciper:

- Flöde ligger under Risk; events ligger över båda.
- ÅDT-/snittflödeslagret är ren visuell kontext och ska inte öppna popup vid klick.
- Olyckspunkter/heatmap är neutrala vita/grå, inte varma riskfärger.
- MapLibre popups ligger utanför React/CSS Modules, därför används globala `.seg-popup-*`-klasser.
- Mobil använder `visualViewport`-variabler för att undvika browser chrome/body-scroll-problem, men håller kartans höjd stabil när textfält fokuseras så tangentbordet lägger sig ovanpå kartan/UI i stället för att flytta bottenkontroller och ruttkort.

## API-rutter

- `web/app/api/events/route.ts` — `events_public`, kräver `bbox`, stödjer `since` och `live=1`.
- `web/app/api/events/stats/route.ts` — datafönster/färskhet för UI-copy.
- `web/app/api/risk/route.ts` — `risk_in_bbox`.
- `web/app/api/adt/route.ts` — `adt_in_bbox`.
- `web/app/api/large-roads/route.ts` — `large_roads_in_bbox`, filtrerat till höghastighetssegment 80+ för kartbadges.
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
- `0019_large_roads_filter.sql` — höghastighetsdata från Lastkajen.
- `0020_live_traffic_flow.sql` till `0022_stabilize_flow_segments.sql` — TrafficFlow och stabila segmentlinjer.
- `0023_security_limits_dedup.sql` — publika grants, server-limits och dedupad risk-MV.
- `0025_high_speed_badges_80.sql` — kartlagret Höga hastigheter utökat från 90+ till 80+.

## Gotchas

- Supabase PostGIS ligger i `extensions`. `security definer`-funktioner med explicit `search_path` måste inkludera `extensions`.
- Supabase free tier har kort `statement_timeout`; undvik stora bboxar och globala NVDB/Risk-anrop.
- MapLibre `interpolate` kräver strikt växande inputvärden.
- `<->` kNN kan rangordna på bbox-distance; diagnostik för närmaste segment bör re-ranka med `st_distance`.
- Kör inte `next build` medan `next dev` är igång. Stoppa dev-servern först om `.next` beter sig konstigt.
- Lokal geolocation kräver secure context; vanlig lokal HTTP visar alert, HTTPS-prod bör fungera.
- Lastkajen DB-import ska använda Supabase session pooler på port 5432, inte transaction pooler 6543.
- `Höga hastigheter` kräver att Lastkajen-importen har körts med `scripts/import-large-roads.sh` efter 80+-ändringen; bara migrationen räcker inte för att skapa 80-rader.
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

- Frontend cleanup utan UX-ändring: `Map.tsx` är delvis uppdelad i `routeModel`, `RoutePlannerBox`, `RouteAlternativesTray`, `RouteLoadingIndicator`, `HelpPanel` och `MapIcons`. Kvar som möjliga rena extraktioner: `layers.ts`, `Map.module.css`, mer route state/hook-logik och `/api/route`.
- A11y avvaktar: route suggestions till korrekt combobox/listbox/option, InfoBox/fokus och övriga UX-/designnära tillgänglighetsfixar ska tas senare efter bekräftade produktbeslut.
- Scraper/Edge Function: störnings-upsert timeoutade när många `disturbances` kom i ett enda statement. Fixen är att skriva events, disturbances och traffic_flow i mindre batchar och logga batch-counts.
- Route-card UX senare: lägg till lätt ruttfeedback/betyg som kalibreringsunderlag, inte som direkt ranking-signal. Första versionen bör ha tumme upp/ner per rutt, snabborsaker vid negativ feedback (`Onödig avstickare`, `För mycket snabb väg`, `För lång omväg`, `För lika annan rutt`, `Saknar bättre alternativ`) och eventuell sökningsfeedback på hela resultatlistan. Spara filterkombination, route source, rank, tid/distans, exponeringar och antal presenterade rutter, men inte råa koordinater/adresser/geometrier.
- Route-card delning senare: designa delningskontroller för app-URL till samma rutt/sökning samt länk ut till Google Maps för den valda rutten eller start/slut. Utred om app-URL ska bära adresser/koordinater explicit eller en anonym query-id/hash.
- Följ upp GraphHopper-fanout i prod-loggar när fler verkliga sträckor testas, särskilt `highSpeed`, `trafficIntensity` och kombinationer med bro/tunnel.
- Senare: systematisk routingkalibrering på 10-20 verkliga sträckor och filterkombinationer. Spara förväntat beteende per case, särskilt när `Höga hastigheter` kombineras med andra undvik-filter.
- Följ upp build-hang isolerat om det återkommer. Senaste lokala build passerade.
- Ta design-/kodkonventionsbeslut om inline CSS custom properties och eventuell negativ letter-spacing.
- När olyckshistoriken mognat: kalibrera riskskalan om från preliminära värden till mer stabila brytpunkter.
