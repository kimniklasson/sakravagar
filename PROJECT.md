# Trafiksäkerhets-app — projektanteckningar

Senast uppdaterad: 2026-04-23

## Idén

Webbapp som visar historisk olycksdata på svenska vägar för att hjälpa nervösa/rädda förare känna trygghet och välja säkrare rutter. Målgrupp: personer som känner oro inför trafiken och behöver bygga upp sitt självförtroende gradvis ("många bäckar små").

## Nuvarande inriktning (efter validering)

**MVP = heatmap, inte routing.**

Visa vägar färgkodade efter olycksfrekvens baserat på egen insamlad historik. Routing som potentiell fas 2 när datat växt och värdet är validerat.

## Validering — vad vi verifierat

### Datakällor

- ❌ **STRADA** (Transportstyrelsens fulla olycksdatabas): endast forskare/statistikändamål, inte kommersiella appar. Kräver formell ansökan enligt Lag 2021:319.
- ❌ **Transportstyrelsens publika olycksstatistik**: bara XLSX, bara nationell/länsnivå. För grovt för vägbaserad analys.
- ❌ **Trafikanalys**: samma — länsnivå som finaste uppdelning.
- ✅ **Trafikverkets öppna API** (api.trafikinfo.trafikverket.se): `Situation`/`Deviation`-objekt med olyckor i realtid, inkl. koordinater. **CC0-licens** — fri att lagra, använda kommersiellt, redistribuera.
- ✅ **NVDB**: svenska vägnätet, gratis via Lastkajen. Sparar för senare när routing blir aktuellt.

### Juridik & villkor

- Trafikverkets API: CC0 1.0 — inga restriktioner. Attribution ej krävs men artigt.
- Trafikverket övervakar trafik, hör av sig vid excess. Våra ~50 requests/dag är icke-problem.

### Konkurrens

- Ingen svensk konkurrent hittad som positionerar sig på säkerhet/trygghet.
- Google, Waze, HERE WeGo optimerar på snabbast/kortast, inte säkraste.
- Akademisk forskning finns (ScienceDaily 2023), Google har pratat om "safer routes" — inget lanserat i Sverige.

## Teknisk arkitektur (beslutad)

### Datainsamling
- **GitHub Actions cron** — publikt repo för obegränsade minuter (privat fungerar också men tightare marginal)
- **Polling-intervall: 30 min** att starta med. Utvärdera efter 1 månad baserat på typisk `aktiv-tid` per händelse. Justera om medianen är långt över eller nära 30 min.
- **Deduplicering på händelsens `Id`** — lagra första gången sedd, uppdatera `last_seen` vid varje återkomst
- Secrets (API-nyckel, DB-creds) via GitHub Actions secrets, inte i kod

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

## Nästa steg (imorgon och framåt)

1. Registrera API-nyckel hos Trafikverket ([data.trafikverket.se](https://data.trafikverket.se/))
2. Utforska `Situation`-objektet — hämta en testbatch, inspektera fält (Id, IconId, Geometry, ModifiedTime, etc.)
3. Designa schema i Supabase (events-tabell med dedupe på Id, first_seen/last_seen)
4. Bygg minimal Python/Node-scraper
5. Lägg upp GitHub Actions cron (30 min intervall)
6. Verifiera att data flödar in ett par dagar
7. Sedan: börja tänka på frontend/heatmap

## Öppna frågor / överväganden

- Ska vi även logga icke-olycka-händelser (stopp, vägarbeten)? Troligen nej i början — håll scope tight.
- Hur kategorisera allvarlighetsgrad? Kanske via `IconId` eller text i `Message`.
- Eventuellt parallellt: mejla Transportstyrelsen om STRADA-access för framtida berikning.

## Referenser

- [Trafikverkets öppna API](https://www.trafikverket.se/e-tjanster/trafikverkets-oppna-api-for-trafikinformation/)
- [Trafikverket Datautbytesportal](https://data.trafikverket.se/)
- [STRADA uttagswebb](https://www.transportstyrelsen.se/sv/om-oss/statistik-och-analys/statistik-inom-vagtrafik/olycksstatistik/om-strada/anvandarstod1/strada-uttagswebb/)
- [Supabase pricing](https://supabase.com/pricing)
- [GitHub Actions — minutes per plan](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
