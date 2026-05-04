# Trafiksäkerhets-app — projektanteckningar

Senast uppdaterad: 2026-05-01

## Idén

Webbapp som visar historisk olycksdata på svenska vägar för att hjälpa nervösa/rädda förare känna trygghet och välja säkrare rutter. Målgrupp: personer som känner oro inför trafiken och behöver bygga upp sitt självförtroende gradvis ("många bäckar små").

## Nuvarande inriktning (efter validering)

**MVP = kartbaserad risk/trygghetsvy + ruttplanerare med första self-hostade trygghetsrouting.**

Visa historiska olyckor, pågående olyckor och vägsegment färgade efter risk normaliserad mot trafikflöde. Ruttplaneraren har geocoding, self-hostad GraphHopper-routing och "Undvik om möjligt"-filter. Höga hastigheter, broar och tunnlar påverkar kandidatgenereringen via GraphHopper custom model, och olyckshistorik/störningar skickas in som dynamiska penalty zones när de filtren är aktiva.

## Validering — vad vi verifierat

### Datakällor

- ❌ **STRADA** (Transportstyrelsens fulla olycksdatabas): endast forskare/statistikändamål, inte kommersiella appar. Kräver formell ansökan enligt Lag 2021:319.
- ❌ **Transportstyrelsens publika olycksstatistik**: bara XLSX, bara nationell/länsnivå. För grovt för vägbaserad analys.
- ❌ **Trafikanalys**: samma — länsnivå som finaste uppdelning.
- ✅ **Trafikverkets öppna API** (api.trafikinfo.trafikverket.se): `Situation`/`Deviation`-objekt med olyckor i realtid, inkl. koordinater. **CC0-licens** — fri att lagra, använda kommersiellt, redistribuera.
- ✅ **NVDB/Lastkajen**: svenska vägnätet, ÅDT och hastighetsdata. Används redan för risknormalisering, flödeslager och hastighetslager.

### Juridik & villkor

- Trafikverkets API: CC0 1.0 — inga restriktioner. Attribution ej krävs men artigt.
- Trafikverket övervakar trafik, hör av sig vid excess. Nuvarande polling är låg volym.

### Konkurrens

- Ingen svensk konkurrent hittad som positionerar sig på säkerhet/trygghet.
- Google, Waze, HERE WeGo optimerar på snabbast/kortast, inte säkraste.
- Akademisk forskning finns (ScienceDaily 2023), Google har pratat om "safer routes" — inget lanserat i Sverige.

## Teknisk arkitektur (beslutad)

### Datainsamling
- **Supabase pg_cron + Edge Function `scrape`** — hämtar Trafikverket-flöden och upsertar i Supabase.
- **GitHub Actions** finns kvar som manuell nödknapp, inte som primär schemaläggning.
- **Polling-intervall:** scrape-cron är fortfarande lugn nog för Trafikverkets API, men TrafficFlow kan behöva tätare intervall om det ska kännas minutnära.
- **Pollinganalys 2026-05-01:** 226 olycksevents analyserade efter ungefär en veckas insamling. `pg_cron` hade 301 lyckade körningar, median-gap 30 min, max-gap 30 min. Observerad olyckstid hade median 30 min och 35% single-observation-events. Trafikverkets `StartTime`→`EndTime` hade p10 cirka 45 min, p25 cirka 58 min och inga events under 30 min. Rekommendation: behåll 30 min och kör om `pnpm --filter @trafik/scraper run analyze:polling` efter ytterligare 1–2 veckor.
- **Deduplicering:** Trafikverkets `Deviation.Id` bevarar tekniska rader; användarnära risk/popup dedupar logiska olyckor per segment, meddelande, vägnummer och timme.

### Lagring
- **Supabase free tier** — Postgres med PostGIS. Nytt projekt på befintligt konto (delar inte quota med andra projekt)
- 500 MB räcker för flera års data

### Frontend
- **Vercel hobby** på befintligt konto. Shared bandwidth (100 GB/mån) är gott och väl för MVP

### Kostnad
- **0 kr/mån** hela vägen till MVP

## Tidsperspektiv

- Dag 1: tom databas
- Månad 1: begränsat värde, kan visa "senaste 30 dagarna"
- Månad 6–12: meningsfull heatmap på riksnivå

**Viktigt: starta insamlingen så snart som möjligt, även innan UI byggts.** Varje dag utan polling = en dag mindre historik vid lansering.

## Nuvarande byggfokus

1. Kalibrera ruttplanerarens filter på verkliga sträckor.
2. Låt olyckshistoriken växa; riskskalan blir mer meningsfull efter månader snarare än dagar.
3. Kalibrera GraphHopper penalty zones för olyckshistorik/störningar mot verkliga ruttfall.
4. Finlira ruttplanerarens UI efter Kims senaste designförslag.

## Potentiella framtida datalager

Olycksdata från `Situation` är kärnan, men heatmappen blir mer trovärdig om den viktas mot fler riskfaktorer. Kandidater, rankade efter relevans för "rädd förare"-usecaset:

**Hög prioritet — riskproxy oberoende av historik:**
- **`RoadData` v1** (öppna API:et, verifierat 2026-04-24) — `SpeedLimit`, `RoadWidth`, `BearingCapacity`, `RoadOwner`, `RoadConstruction2009`. Kan bli kompletterande källa, men NVDB/Lastkajen används redan för ÅDT/hastighet.
- **ÅDT (årsdygnstrafik)** — redan importerat från Lastkajen och används för risknormalisering samt Flöde-lagret.
- **`TrafficSafetyCamera`** — ATK-kameror sätts där dödsolyckor skett historiskt. Proxy för kända farliga sträckor, trivial att lägga in.

**Medelhög — realtidslager, inte del av historisk heatmap:**
- **`RoadCondition`** — friktion/halka. Användbart för "undvik idag"-vy snarare än statisk karta.
- **`TrafficFlow`** — implementerat som `Liveflöde`, snappat till närmaste vägsegment.
- **Vägarbeten/köer** — implementerat som separat `Störning`-overlay, inte del av historisk risk.

**Bonus från NVDB i öppna API:et (sedan feb 2025):**
12 NVDB-mängder tillgängliga via `api.trafikinfo`: `Hastighetsgräns`, `Vägbredd`, `Bärighet`, `AntalKörfält2`, `FunktionellVägklass`, `FörbjudenFärdriktning`, `Gatunamn`, `Höjdhinder_upp_till_45_dm`, `Väghållare`, `Vägnummer`, `Vägtrafiknät`, `ÖvrigtVägnamn`. Överlappar delvis `RoadData`. ÅDT ingår *inte* i denna lista.

**Behöver utredas:**
- **Viltolyckor / viltstängsel** — viltolyckor ägs av Nationella Viltolycksrådet, separat datakälla. Viltstängsel kan finnas i NVDB via Lastkajen. Relevant för nervösa förare i skogsområden men kräver egen integration.

## Öppna frågor / överväganden

- Hur kategorisera allvarlighetsgrad? Kanske via `IconId` eller text i `Message`.
- Eventuellt parallellt: mejla Transportstyrelsen om STRADA-access för framtida berikning.

## Referenser

- [Trafikverkets öppna API](https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/)
- [Trafikverket Datautbytesportal](https://data.trafikverket.se/)
- [STRADA uttagswebb](https://www.transportstyrelsen.se/sv/om-oss/statistik-och-analys/statistik-inom-vagtrafik/olycksstatistik/om-strada/anvandarstod1/strada-uttagswebb/)
- [Supabase pricing](https://supabase.com/pricing)
