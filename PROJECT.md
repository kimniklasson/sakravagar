# Trafiksäkerhets-app — projektanteckningar

Senast uppdaterad: 2026-05-10

## Idén

Säkravägar.se visar historisk och aktuell trafikdata på svenska vägar för att hjälpa oroliga förare känna mer kontroll och välja lugnare rutter. Målgruppen är personer som behöver bygga självförtroende gradvis, inte förare som jagar snabbaste vägen.

## MVP-inriktning

**Kartbaserade kontrollager + trygghetsrouting.**

MVP:n visar olyckor, trafikflöde, trafikstörningar och höga hastigheter som kontrollager. Ruttplaneraren använder self-hostad GraphHopper för `Undvik om möjligt`-filter där höga hastigheter, trafikintensiva vägar, stadstrafik, broar och tunnlar påverkar vägkostnaden. Olyckor och störningar visas som lager/route-notices, inte som planeringsfilter.

Alla tunga kartlager ska skyddas med bbox-area, Sverige-bounds och SQL/RPC-limit.

## Verifierat

### Datakällor

- ❌ **STRADA** — kräver formell ansökan och är inte lämplig som MVP-källa för kommersiell app.
- ❌ **Transportstyrelsens/Trafikanalys publika statistik** — nationell/länsnivå, för grovt för vägbaserad analys.
- ✅ **Trafikverkets öppna API** — `Situation`/`Deviation` och `TrafficFlow`, med koordinater och CC0-licens.
- ✅ **NVDB/Lastkajen** — vägnät, ÅDT och hastighetsdata. Används för risknormalisering, flödeslager, höghastighetsbadges och routing-scoring.

### Juridik och marknad

- Trafikverkets API-data är CC0 1.0. Attribution krävs inte, men är rimligt.
- Nuvarande polling är låg volym.
- Ingen svensk konkurrent hittad som positionerar sig på tryggare rutter för oroliga förare. Google/Waze/HERE optimerar främst snabbast/kortast.

## Arkitektur

- **Scrape:** Supabase `pg_cron` + Edge Function `scrape`. GitHub Actions finns kvar som manuell nödknapp.
- **Databas:** Supabase Postgres + PostGIS.
- **Webb:** Next.js på Vercel, MapLibre GL, CSS Modules + tokens.
- **Routing:** Self-hostad GraphHopper 11 på Hetzner bakom Caddy/HTTPS och header-token. OSRM är fallback när GraphHopper-env saknas.
- **Kostnad:** 0 kr/mån för app/databas under MVP, plus routingservern när GraphHopper behövs i production.

## Tidsperspektiv

- Dag 1: tom databas.
- Månad 1: begränsat historiskt värde, men aktuell olycks-/störningsdata och routing fungerar.
- Månad 6-12: historisk heatmap/risk blir mer meningsfull på riksnivå.

Viktigt: fortsätt samla data löpande. Varje dag utan polling är en dag mindre historik.

## Nuvarande byggfokus

1. Kalibrera routing mot verkliga sträckor, särskilt `Stadstrafik` och `Trafikintensiva vägar`.
2. Följ upp GraphHopper-fanout och prestanda i prod-loggar.
3. Använd ruttfeedback som batchunderlag när tillräckligt många rader finns.
4. Fortsätt frontend cleanup utan UX-ändring: mindre route-/UI-moduler, senare mer `layers.ts`, `Map.module.css`, route state/hook-logik och `/api/route`.
5. A11y avvaktar produkt-/designbeslut: route suggestions, InfoBox/fokus och närliggande interaktioner.
6. Låt olyckshistoriken växa innan riskskalan hårdkalibreras.

## Framtida datalager

Högst relevanta kompletteringar:

- **Kommunal trafikmängdsdata för innerstäder** — framtidsidé. Lastkajen/NVDB täcker större/statliga leder bra men kan lämna luckor på kommunala innerstadsgator, t.ex. centrala Göteborg och Stockholm. Malmö och Stockholm har nedladdningsbara öppna geodata; Göteborg har publik Power BI-vy men behöver helst stabil export/API. Bör först berika `Trafikintensiva vägar` och Flöde-lagret, och eventuellt kalibrera `Stadstrafik` sekundärt. Import bör normalisera källa, licens, mätår, metric-typ (`ÅDT`, `MVD`, `ÅMVD`), råvärde, normaliserat värde och geometri i separat lager innan union med NVDB.
- **`TrafficSafetyCamera`** — ATK-kameror som proxy för kända farliga sträckor.
- **`RoadCondition`** — halka/friktion som realtidslager snarare än historisk heatmap.
- **Viltolyckor/viltstängsel** — relevant i skogsområden men kräver separat källa/integration.

NVDB-mängder i Trafikverkets öppna API kan vara användbara som komplement, men ÅDT ingår inte där och hämtas fortsatt via Lastkajen.

## Öppna frågor

- Hur ska allvarlighetsgrad kategoriseras utan STRADA? Möjliga signaler är `IconId`, `SeverityText` och text i `Message`.
- Om projektet går bortom MVP: utred om Transportstyrelsen kan ge STRADA-access för begränsad, tillåten användning.

## Referenser

- [Trafikverkets öppna API](https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/)
- [Trafikverket Datautbytesportal](https://data.trafikverket.se/)
- [STRADA uttagswebb](https://www.transportstyrelsen.se/sv/om-oss/statistik-och-analys/statistik-inom-vagtrafik/olycksstatistik/om-strada/anvandarstod1/strada-uttagswebb/)
- [Supabase pricing](https://supabase.com/pricing)
