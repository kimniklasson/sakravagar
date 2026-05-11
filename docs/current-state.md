# Current state — 2026-05-10

Kort projektminne för nya sessioner. Läs detta först, sedan `PROJECT.md` för produktidé/prioritering, `docs/decisions.md` för långlivade vägval, `docs/api.md` för API-kontrakt och `docs/routing-ops.md` för GraphHopper-drift. Historiska sessionsanteckningar ligger komprimerade i `docs/session-archive.md` och ska inte läsas som nuläge.

## Produktläge

Säkravägar.se är en Next/MapLibre-karta för personer som känner oro i trafiken. MVP:n visar kontrollager för historiska olyckor, pågående olyckor, trafikflöde, trafikstörningar och höga hastigheter. Routing använder self-hostad GraphHopper när env finns och OSRM som lokal fallback.

Aktiva UI-lager:

- **Olyckor** — historiska och pågående olyckor. Default av.
- **Trafikflöde** — ÅDT från NVDB/Lastkajen plus liveflöde från Trafikverket där mätdata finns. Default av. ÅDT-segment är medvetet inte klickbara; blå nyanser ska läsas som bakgrundssignal, inte som exakt segmentanalys.
- **Trafikstörningar** — aktuella vägarbeten/köer/störningar. Default av.
- **Höga hastigheter** — badges för 80 km/h och högre. Default av.
- **Hjälp** — datakällor, legender, metodcopy och senaste uppdatering.

Segmentrisk-färgning finns kvar i backend/kod som vilande infrastruktur men är pausad i UI tills olyckshistoriken är tillräckligt stor för att ge en rimlig riskbild. Olyckslagret visar därför punkter/heatmap, inte röd-orange risklinjer.

Desktop har info/ruttplanerare i vänsterstacken, lagerknappar uppe till höger och zoom/location nere till höger. Mobil samlar lager bakom en `layers.svg`-knapp och visar hjälp som helskärm.

## Ruttplanerare

Ruttplaneraren finns i `web/components/Map/RoutePlannerBox.tsx`, med state/orchestration i `Map.tsx` och route-hjälpare i `routeModel.ts`. Den geocodar via `/api/geocode`, reverse-geocodar GPS-positioner och räknar rutter via `POST /api/route`.

`Undvik om möjligt`-filter:

- `Höga hastigheter`
- `Trafikintensiva vägar`
- `Stadstrafik`
- `Broar`
- `Tunnlar`

GraphHopper custom models påverkar vägkostnaden för dessa fem filter. Olyckshistorik och trafikstörningar är kontrollager/route-notices, inte planeringsfilter. Vald rutt visar pågående störningar och liveolyckor ovanpå ruttlinjen även när motsvarande kartlager är avstängt.

Viktiga beteenden:

- Auto-routing startar först när båda stopp har koordinater.
- Primär rutt kan dras direkt på kartan; preview kör `POST /api/route` med `preview: true` och hoppar över Supabase-scoring.
- Utan aktiva filter visas snabbaste rutten. Med aktiva filter visas relevanta kandidater och listan sorteras efter filtermatchning, därefter tid och distans.
- Frontend har kort session-cache för route-svar: 2 min för statiska filter och 5 min när `Trafikintensiva vägar` är aktivt.
- Delning skapar public route snapshots via `/api/route-shares` med 30 dagars TTL.
- Tumme upp/ner och valfri kommentar sparas via `/api/route-feedback` som kalibreringsunderlag, inte som direkt ranking-signal. Feedback-snapshots sparas i 90 dagar.

## Data och API

Scrapen körs i production via Supabase `pg_cron` + `pg_net` mot Edge Function `supabase/functions/scrape`. Node-scrapern i `scraper/` finns kvar för lokal/manuell körning och GitHub Actions-nödknapp.

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

- **App:** `https://säkravägar.se` (`xn--skravgar-0zae.se`) på Vercel.
- **DNS:** Cloudflare free plan. Loopia är registrar.
- **Databas:** Supabase Postgres + PostGIS, migrations i `db/migrations/`.
- **Routing:** Hetzner CPX32 med GraphHopper 11 bakom Caddy och `X-Routing-Token`. Drift i `docs/routing-ops.md`.
- **Tiles:** MapLibre GL med OpenFreeMap.

Vercel production behöver minst `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GRAPHHOPPER_BASE_URL` och `GRAPHHOPPER_TOKEN`. Lokal routing utan GraphHopper-env faller tillbaka till OSRM och matchar inte production-routing.

## Viktiga dataregler

- Pågående olycka = `last_seen >= now() - 90 min`.
- Kartans olyckspunkter dedupas i `events_in_bbox`; snappade events använder `fid + message + road_number + first_seen-hour`, orphans använder vägnummer + geohash-fallback.
- Riskinfrastrukturen och `segment_detail` dedupar logiska olyckor per `fid + message + road_number + first_seen-hour`, men risklinjer och segmentpopup är pausade i UI.
- Risk aggregeras per `fid`, inte `element_id`.
- `nvdb_trafik_latest` väljer senaste mätperiod per `element_id` men behåller syskon-`fid`.
- `events.raw`, `disturbances.raw` och `traffic_flow_measurements.raw` ska inte exponeras publikt.
- ÅDT-/hastighetslager och vilande riskinfrastruktur är bbox/tile-baserade för att undvika stora Supabase-svar.

## Gotchas

- Supabase PostGIS ligger i schemat `extensions`; `security definer` med explicit `search_path` behöver inkludera `extensions`.
- Lastkajen bulkimport ska använda Supabase session pooler på port `5432`, inte transaction pooler `6543`.
- `Höga hastigheter` kräver att `scripts/import-large-roads.sh` körts efter 80+-ändringen; migrationen ensam skapar inte raderna.
- GraphHopper custom model kräver `ch.disable: true`; snabbaste basrutten kan använda CH.
- Om GraphHopper-cache byggs om efter config/OSM-byte: stoppa service, flytta `/opt/graphhopper/graph-cache`, starta service och följ `journalctl -u graphhopper -f`.
- Kör inte `next build` samtidigt som `next dev` om `.next` börjar bete sig konstigt.
- Publik Nominatim är bara MVP-default; byt till dedikerad provider/self-host/avtalad instans före större publik trafik.
- Risklagret (`addRiskLayer`) och segmentpopupen är dormant by design. Återaktivera inte dem som buggfix utan ett nytt produktbeslut om datamognad och kognitiv belastning.

## Nästa fokus

- Kalibrera `Stadstrafik` och `Trafikintensiva vägar` mot verkliga ruttfall så omvägarna märks utan att bli orimliga.
- Följ upp GraphHopper-fanout i prod-loggar, särskilt `highSpeed`, `trafficIntensity`, `cityTraffic` och kombinationer med bro/tunnel.
- Kör `0028_route_feedback_update_delete.sql` i Supabase innan live-test av feedbackkommentar och toggle-bort av tumme, om den inte redan är körd.
- Följ upp verklig ruttfeedback när det finns tillräckligt många rader.
- Fortsätt frontend cleanup utan UX-ändring: möjliga rena extraktioner är `layers.ts`, `Map.module.css`, mer route state/hook-logik och `/api/route`.
- A11y: route suggestions som korrekt combobox/listbox/option samt InfoBox/fokus efter bekräftade produktbeslut.
- Framtidsidé: komplettera ÅDT/Flöde med kommunal trafikmängdsdata för centrala stadsgator. Göteborg och Stockholm visar luckor där kommunala gator saknar NVDB/Lastkajen-ÅDT. Prioritera som berikning av `Trafikintensiva vägar` och Flöde-lagret; använd bara sekundärt för `Stadstrafik` så signalerna inte dubbleras.
