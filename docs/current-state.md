# Current state — 2026-04-30

Kort projektminne för nya sessioner. Läs detta först, sedan `PROJECT.md` för produktidén och `docs/decisions.md` för långlivade vägval.

## Produktläge

Säkravägar.se är en Next/MapLibre-karta för personer som känner oro i trafiken. MVP:n visar historiska olyckor, aktuella olyckor och vägbaserade risk-/trygghetslager. Routing är fortfarande framtida fas.

Aktiva lager i UI:t:

- **Risk** — vägsegment färgas efter deduplicerade olyckor normaliserat mot ÅDT. Risk är gul→röd och är den enda varma riskskalan.
- **Flöde** — ÅDT från NVDB/Lastkajen, blå skala, underlagsdata.
- **Störning** — aktuella vägarbeten och kö-/trafikstörningar från Trafikverket, separat från olyckshistoriken.
- **Liveflöde** — Trafikverkets TrafficFlow-mätplatser snappade till närmaste vägsegment. Täckningen är bäst i Stockholm/Göteborg.
- **Hastighet** — NVDB-hastighetsgränser 90 km/h eller högre, default av.
- **Olyckor** — historiska olyckor som neutral heatmap/punkter; pågående olyckor som pulserande vita punkter.

Senaste UI-beteende: den röda liveboxen visar globalt antal pågående olyckor. Klick på boxen fokuserar kartan på aktiva olyckor: 1 olycka flyger till zoom 10, 2+ kör `fitBounds` så alla syns.

Ruttplaneraren finns under liveboxen och har nu första fungerande geocoding/routing-kopplingen. Adressfält söker via egen `/api/geocode`-proxy mot Nominatim, GPS reverse-geocodas till läsbar plats när provider svarar, och rutten räknas automatiskt via egen `/api/route`-proxy mot OSRM när alla stopp kan tolkas.

Ruttplanerarstatus:

- `Från`/`Till`-fält finns i `RoutePlannerBox` i `web/components/Map/Map.tsx`.
- `Din plats` visas bara när `Från adress` faktiskt har fokus och är tomt. Den ligger som absolut overlay under första fältet, startar ungefär vid textkolumnen och animerar in.
- GPS-flowet använder `navigator.geolocation`, visar CSS-loader i fältet under hämtning, sätter koordinat direkt och uppdaterar label via reverse geocoding om möjligt.
- Textinput debouncar mot `/api/geocode`, visar upp till 5 svenska träffar och sätter stop-koordinat när användaren väljer en träff. Om användaren bara skriver färdigt använder auto-routing bästa geocoding-träffen för stopp som saknar koordinat.
- Geocoding-resultat visas som korta etiketter (`väg/plats, ort`) i UI:t. Backend rankar träffar efter hur väl den visade etiketten matchar queryn, och behåller föregående träffar under laddning så listan inte blinkar tom vid svaga mellanqueries som `Hästsk`.
- `Lägg till ett stopp` lägger in nytt stopp före destinationen. Draghandles har enkel HTML drag/drop-reorder av stop-arrayen.
- Rensa-knapp finns på fält med text. `Alternativ` är korrekt stavat och kan fortfarande trigga routing manuellt, men normalflödet är att rutten ritas automatiskt när Från/Till har tolkats.
- Ruttlinjer ligger i `addRouteLayer`/`setRouteLayerData` i `web/components/Map/layers.ts`: primär rutt är turkos, alternativa rutter är diskreta vita linjer. Första alternativet är fortfarande OSRM:s primära/snabbaste, inte riskrankat.
- Layout desktop: info/live/tidsfönster ligger i vänsterstacken, ruttplaneraren ligger separat uppe till höger, och zoom/location ligger centrerat längst ner. `fitBounds` för rutter/live tar hänsyn till både vänster- och högerkontroller.
- Nya assets ligger i `web/public/icons/search.svg`, `draghandles.svg`, `close-circle.svg`. Plus/location återanvänder inline-ikonerna i `Map.tsx`.
- `type-small-x` finns i `web/styles/globals.css` för små texter utan versaler och med `letter-spacing: 0`.

Kvar för ruttplaneraren:

- Byt från publika Nominatim/OSRM-defaults till dedikerad provider, self-host eller avtalad instans före skarp publik trafik.
- Riskranka OSRM-alternativen så UI:t kan välja "tryggast av jämförda alternativ" snarare än bara OSRM:s första alternativ.
- Lägg riktig alternativpanel: visa snabbast/tryggast, distans/tid, riskpoäng och varför rutten bedöms tryggare.
- Senare: tydligare swap-knapp för bara Från/Till, och riktig alternativpanel när flera rutter finns.

## Arkitektur

- **Scrape:** Supabase `pg_cron` + `pg_net` anropar Edge Function `supabase/functions/scrape`. GitHub Actions-workflowet finns kvar som manuell nödknapp.
- **Databas:** Supabase Postgres + PostGIS. SQL-migrations ligger i `db/migrations/`.
- **Webb:** Next.js App Router i `web/`, MapLibre GL JS, CSS Modules + design tokens.
- **Delade typer:** `shared/`, men frontendens API-rutter exporterar också lokala response-typer där det är smidigast.

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
- `web/app/api/route/route.ts` — OSRM-proxy för bilrutter med upp till tre alternativ.
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

## Nästa fokus

- Fortsätt små UX-fixar i kartan före större redesign.
- När Kim levererar nya screenshots/interaktionsspec: bygg mot befintliga lager och tokens i stället för att byta datamodell.
- När olyckshistoriken mognat: kalibrera riskskalan om från preliminära värden till mer stabila brytpunkter.
