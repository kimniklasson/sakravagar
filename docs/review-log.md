# Review log

Arbetslogg för större review-pass och vilka beslut/fixar de ledde till. Läs `docs/current-state.md` som nuläge; den här filen är motivering och spårbarhet.

## 2026-05-11 — Pass 1: säkerhet och operativ robusthet

Fokus var öppna write-vektorer, API-kostnad, headers och driftbarhet.

Viktiga fynd:

- Anonyma route shares och route feedback behövde rate-limit, kortare TTL och schemalagd cleanup.
- Feedback update/delete byggde på capability-ID; modellen behövde antingen dokumenteras eller kompletteras med token/TTL/throttle.
- Edge Function-secret jämfördes inte constant-time och normaliserade env-värdet för aggressivt.
- Trafikverket XML-query byggdes via textinterpolation.
- CSP hade för bred script-policy.
- `/api/route`, `/api/geocode` och flera bbox-endpoints saknade tillräckliga kostnadsspärrar, caching eller dokumenterade limits.

Åtgärdat/landat:

- Route snapshots fick 30 dagars TTL, feedback snapshots 90 dagar och cleanup via `pg_cron`.
- Rate-limit/kostnadsspärrar och service-role-konfiguration lades till för öppna endpoints.
- GraphHopper-/routeflöden fick tydligare throttling och robustare fallbackbeteenden.
- CSP tajtades i produktion genom att `unsafe-eval` endast tillåts i dev.
- CORS-/originhantering för delningslänkar bygger på `PUBLIC_SITE_ORIGIN`.

Kvarvarande medvetna uppföljningar:

- Capability-modellen för feedback är accepterad för MVP men ska omprövas om feedback blir ett mer publikt UGC-flöde.
- Scraper/Edge Function har fortfarande duplicerad logik och bör delas eller konsolideras på sikt.

## 2026-05-11 — Pass 2: routing-korrekthet och UI-kontrakt

Fokus var om användaren kan lita på rutternas etiketter och om ruttflöden kan skriva över varandra.

Viktiga fynd:

- `scoreHighSpeed` returnerade tidigare 0 meter när underliggande data saknades, vilket UI:t kunde visa som grön "Undviker".
- Stop-redigering kunde tappa via-punkter eftersom flera setters filtrerade bort andra mellan-stops.
- Shared route kunde skrivas över av tidiga användarändringar och auto-planering.
- OSRM-noticen behövde vara tydligare med att reservroutern saknar vägdetaljer för exakt avoid-scoring.
- Flera ruttkort kunde etiketteras "Snabbaste" samtidigt.

Åtgärdat/landat:

- Saknad höghastighetsdata representeras som `null`, inte 0.
- Stop-uppdateringar använder ersättning per id och bevarar via-punkter.
- Shared-route-fetchen skyddas bättre mot användarmutationer.
- OSRM-copy förklarar begränsad avoid-scoring.
- "Snabbaste" begränsas till baseline/snabbaste-kandidaten.

Kvarvarande medvetna uppföljningar:

- Dedupe-parametrar för långa rutter bör fortsätta observeras i prod innan kalibrering.
- Hybridrutter bör på sikt få mer sanity-check av join-geometri om de börjar synas ofta.

## 2026-05-11 — Pass 3: data, visualisering och observability

Fokus var om kartan visar samma verklighet som backend räknar på.

Viktiga beslut/fynd:

- Risklinjer var bortkopplade i UI. Det var ett medvetet produktval eftersom olyckshistoriken är för tunn för en rättvis riskbild.
- ÅDT-/segmentpopup var också medvetet borttagen eftersom den gav för exakt och intensiv interaktion för målgruppen.
- Heatmap/live-cirklar behövde dedupa Trafikverkets multipla tekniska rader för samma logiska olycka.
- Disturbance-kategorisering skulle inte tappa okända `MessageType` tyst.
- Orphan-resnap behövde köras oftare för att liveolyckor inte ska bli synliga först när de redan är historiska.
- Minimal observability behövdes även utanför `/api/route`.

Åtgärdat/landat:

- `events_in_bbox` dedupar före visualisering; live-events ingår inte samtidigt i historisk heatmap.
- `disturbances` fick fallback-kategori `other` och loggar okända kategorier.
- `resnap_orphan_events` schemalades tätare.
- Bbox-API:er fick strukturerade `api_observation`-loggar med request-id.
- `current-state` och ADR dokumenterar att risklinjer och ÅDT-segmentpopup är dormant by design.

Kvarvarande medvetna uppföljningar:

- Riskinfrastruktur får ligga kvar som vilande backend tills datamängden motiverar riskfärgning.
- Om segmentpopup återinförs ska det vara ett nytt produktbeslut, inte en "buggfix".

## 2026-05-11 — Pass 4: prestanda

Fokus var snabbare svar inom samma gratis-/MVP-infrastruktur.

Viktiga fynd:

- `fetchPenaltyZoneRows` kunde hämta samma ÅDT-/TrafficFlow-data flera gånger per route-request.
- Events/disturbances bör använda PostGIS-bbox-RPC i stället för lat/lng-filter på vyer.
- ÅDT/large-roads/risk/segment-cache var konservativt kort för data som ändras långsamt.
- Event- och disturbance-loaders behövde bbox-containment för att undvika onödiga refetches vid små panoreringar.
- Shared-route första visning kan på sikt SSR-prefetchas.

Åtgärdat/landat:

- Route-scoring/preference-data dedupliceras mer inom requesten.
- `events_in_bbox` och `disturbances_in_bbox` används för skalbar bbox-läsning.
- Cache headers för långsammare data förlängdes.
- Lagerloaders refetchar mindre aggressivt när ny viewport ryms i redan hämtad bbox.
- `events_first_seen` indexerades för växande dataset.

Kvarvarande medvetna uppföljningar:

- SSR-prefetch av delade rutter är fortfarande en bra UX-vinst men inte blockerande.
- Edge runtime-flytt för enkla API-routes kan tas senare när stabilitet väger tyngre än cold-start-optimering.

## 2026-05-14 — Arkitekturcleanup: kvarvarande filsplit

Status efter route- och layer-cleanup:

- `web/app/api/route/route.ts` är nere på handler-nivå. Routinglogik, providers, custom models, dedupe, hybridbygge, timeout/concurrency, telemetry och tester ligger i `web/app/api/route/_routing/`.
- `web/components/Map/layers.ts` är bara export-yta. Kartlagren ligger i `web/components/Map/layers/`.
- `web/components/Map/Map.tsx` är fortfarande den viktigaste kvarvarande frontend-filen att tunna ut. Nästa rimliga pass är routeplanner-orchestration: route state, vald rutt, shared-route loading, planRoute/cache/fetch-flöde och map-control-state.
- Första `web/components/Map/Map.module.css`-splitten är gjord: `RoutePlannerBox`, `RouteAlternativesTray`, `HelpPanel`, `RouteLoadingIndicator` och `MapIcons` har egna CSS Modules. `Map.module.css` är kvar som kartskal/styrpanel: info/live/time-box, lagerkontroller, högerkontroller, via-marker och mobil-attribution.
- `_routing/scoring.ts`, `layers/route.ts` och `layers/largeRoads.ts` är accepterade specialistmoduler för nu. Dela först om ändringar i respektive område gör dem kognitivt tunga igen.

## 2026-05-11 — Loadingstate-experiment

Ett dev-only experiment byggdes för att animera synliga vägar med shimmer medan rutter beräknas. Effekten gick att justera via ett temporärt labb, men upplevdes för hetsig även vid långsammare tider.

Beslut:

- Experimentet backades helt.
- Den tidigare, lugnare loadingstaten med linjalanimation och dämpad bakgrund behålls.
- Ingen shimmer-kod eller labbpanel finns kvar i nuläget.

## 2026-05-11 — Domänbyte till sakravagar.se

Målet var att slippa punycode/IDN-friktion i delningslänkar och göra ASCII-domänen canonical.

Åtgärdat/landat:

- `sakravagar.se` är canonical huvuddomän.
- `www.sakravagar.se` redirectar till `sakravagar.se`.
- `säkravägar.se` / `xn--skravgar-0zae.se` behålls som legacy redirect till `sakravagar.se`.
- `routing.sakravagar.se` är ny GraphHopper base URL.
- Caddy på Hetzner accepterar både `routing.sakravagar.se` och `routing.xn--skravgar-0zae.se`.
- Vercel env uppdaterades till `PUBLIC_SITE_ORIGIN=https://sakravagar.se` och `GRAPHHOPPER_BASE_URL=https://routing.sakravagar.se`.
- Cloudflare DNS för `sakravagar.se`: `A @ -> 216.198.79.1`, `CNAME www -> 3ddc00e03f73de81.vercel-dns-017.com`, `A routing -> 116.203.135.46`, alla DNS-only.
- Smoke test efter propagation: huvuddomän, www-redirect, legacy redirect, route sharing och GraphHopper-routing fungerade.

Kvarvarande medvetna uppföljningar:

- Gamla punycode-domänen visar i Vercel "DNS Change Recommended", men är legacy och kan ligga kvar så länge redirecten fungerar.
- När gammal routing-host inte längre behövs kan `routing.xn--skravgar-0zae.se` tas bort ur Caddy och CSP.
