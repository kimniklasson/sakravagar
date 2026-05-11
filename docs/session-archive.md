# Session archive

Komprimerad historik från tidigare sessionsloggar. Den här filen är arkiv och ska inte användas som source of truth för aktuellt beteende; läs `docs/current-state.md` först.

## 2026-05-01

- Lade till `docs/routing-ops.md`, `docs/dev-workflow.md` och `docs/api.md`.
- Pollinganalys på 226 olycksevents stödde 30 min polling.
- Routeplanner fick GraphHopper/OSRM-kandidater, `avoidScores`/`exposure` och första budget-/rankingmodellen.

## 2026-05-02

- Flyttade routingpreferenser närmare GraphHopper custom models och lade till tydligare OSRM-fallback-notice.
- Implementerade Google Maps-liknande dragning av primärrutt med preview.
- Fixade Supabase security-invoker-varningar med migration `0024`.

## 2026-05-03

- Flyttade ruttplaneraren till vänsterstacken och ruttalternativ till tydligare kandidatläge.
- Tog bort tidsbudget-slidern ur UI:t; aktiva filter öppnar numera kandidatjämförelse.
- Stabiliserade vald/hoverad rutt separat från listordning.

## 2026-05-04

- Byggde kompakt lagerikonrad, hjälp-/datapanel och mobilanpassningar.
- Slog ihop olycksvisualiseringar under ett lugnare default-av-lager.
- Gjorde `Höga hastigheter` till 80+-badges och behöll 90+-exponering i route scoring.

## 2026-05-05

- Alla kartlager startar avstängda.
- Ruttalternativ flyttades till horisontell bottenrad.
- Infoboxen kompakteras efter första lyckade ruttberäkning.

## 2026-05-06

- Ruttkort fick kompakt metrikslista.
- Vald rutt fick annotations för höghastighet, broar, tunnlar och dåvarande notices.
- Höghastighetsexponering bytte till GraphHopper `max_speed` path details med NVDB som fallback.

## 2026-05-07

- Fixade mobil pan/viewport, mobil lagerkontroll och hjälpskärm.
- Lade till `Trafikintensiva vägar` med ÅDT som bas och TrafficFlow som förstärkning.
- Pausade lightmode som separat framtida arbete.

## 2026-05-08

- Optimerade trafikintensitetsrouting, kombinerade filter och routeprioritering.
- Lade till live-raw-grants, bbox-skydd för störningar, security headers och scraper-timeouts.
- Dokumenterade behovet av systematisk routingkalibrering på verkliga case.

## 2026-05-09

- Hårdnade publika API-fel och inputvalidering.
- Verifierade Edge Function/cron och fixade scraper-upserts i batchar.
- Lade till route-performancebudget, session-cache, coordinate-safe observability och mer kontrollerad GraphHopper-fanout.

## 2026-05-10

- Tog bort `Olycksrisk` och `Störningar` som planeringsfilter; de är nu kontrollager/route-notices.
- Lade till `Stadstrafik` som GraphHopper-filter baserat på statiska stadszoner samt `road_class`/`max_speed`, inte `urban_density`.
- Införde svenska bbox-guards i tunga API:er och frontendens lagerloaders.
- Lade till ruttkort-actions: delningslänk, Google Maps-länk och tumme upp/ner med valfri kommentar.
- Lade till migrationsspår för `route_snapshots` och `route_feedback`.
- Dokumenterade framtidsidén att berika ÅDT/Flöde med kommunal trafikmängdsdata för innerstadsgator.

## 2026-05-11

- Genomförde fyra review-pass: säkerhet/ops, routing-korrekthet, data/visualisering/observability och prestanda. Sammanfattning och beslut finns i `docs/review-log.md`.
- Hårdnade öppna route share/feedback-flöden med TTL, rate-limit/kostnadsskydd och cleanup-spår.
- Fixade trust-breaking routingkontrakt: saknad höghastighetsdata är `null`, via-punkter bevaras vid stop-edit och OSRM-copy beskriver begränsad scoring.
- Dokumenterade att risklinjer och ÅDT-segmentpopup är medvetet pausade produktval, inte aktiva buggar.
- Dedupade olycksvisualisering via `events_in_bbox`, förbättrade disturbance-fallback och lade minimal observability på bbox-API:er.
- Gjorde prestandastäd för route-scoring, bbox-RPC:er, cache headers och loader-refetch.
- Testade men backade ett väg-shimmer-loadingexperiment eftersom det blev för hetsigt för produktens lugna känsla.
- Bytte canonical domän till `sakravagar.se`, flyttade routing till `routing.sakravagar.se` och behöll gamla IDN-domänen som legacy redirect.
