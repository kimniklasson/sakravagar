# scraper

Node/TypeScript-scraper som hämtar Trafikverket-data och skriver till Supabase. Den används som lokal/manuell nödknapp.

Production-scrapen körs via Supabase `pg_cron` + Edge Function i `supabase/functions/scrape/`. GitHub Actions finns kvar som manuell `workflow_dispatch`, inte som primär scheduler.

## Köra lokalt

1. Kopiera `.env.example` till `.env` och fyll i värden:
   - `TRAFIKVERKET_API_KEY` — från data.trafikverket.se (Öppet API / TrafficInformation)
   - `SUPABASE_URL` — Project Settings → API → URL
   - `SUPABASE_SERVICE_KEY` — Project Settings → API → `service_role` key (hemlig!)

2. Installera och kör:
   ```sh
   pnpm install
   pnpm --filter @trafik/scraper run dev
   ```

## Vad den gör

1. Hämtar aktiva `Situation.Deviation` med olyckor från Trafikverket.
2. Mappar varje Deviation till en rad i `events`-tabellen.
3. Upsert på `id` (Trafikverkets Deviation.Id):
   - Insert → `first_seen` sätts till `now()` via default, `last_seen` = nu.
   - Update → bara `last_seen`, `modified_time`, `raw` uppdateras. `first_seen` bevaras.
4. Loggar summary: `fetched`, `upserted`, `skipped_no_coord`, `elapsed_ms`.

Edge Function-versionen ansvarar även för produktionsflödena som dokumenteras i `docs/current-state.md`: olyckor, störningar och TrafficFlow.

## Produktionsscheduler

Källan till schemaläggningen ligger i databasmigrationerna:

- `db/migrations/0004_pg_cron_scrape.sql` — `pg_cron`/`pg_net` anropar Edge Function `scrape`.
- `supabase/functions/scrape/index.ts` — Deno-versionen av scrapern som körs i production.

När Trafikverket-transformen ändras behöver Node-scrapern och Edge Function-versionen hållas i sync tills Node-spåret tas bort.

## Analysera pollingintervall

Efter att databasen samlat olyckor en stund kan pollingintervallet utvärderas mot både vår observerade tid (`first_seen` → `last_seen`) och Trafikverkets egna tider (`raw.StartTime` → `raw.EndTime`):

```sh
pnpm --filter @trafik/scraper run analyze:polling
```

Analysen 2026-05-01 på 226 events stödde att behålla 30 minuter: deklarerad p10 var cirka 45 minuter, inga events hade deklarerad varaktighet under 30 minuter, och `pg_cron` hade kört stabilt var 30:e minut.

## Struktur

```
src/
├── env.ts          # zod-validerad env-laddning
├── trafikverket.ts # API-klient + WGS84-parse
├── supabase.ts     # upsert-wrapper
├── transform.ts    # Deviation → UpsertRow
└── index.ts        # orchestration
```

## Fält som kan behöva justeras

Trafikverkets API är stabilt men inte immutable. Om zod-parsningen börjar skrika:

- `trafikverket.ts` → `DeviationSchema`: lägg till/ändra fält. `.passthrough()` är på så okända fält bevaras.
- `buildQuery()`: `schemaversion` kan behöva bumpas om fältnamn ändrats.
- `MessageType = "Olycka"`-filtret — kolla i deras datakatalog om svenska termer ändras.

## Felsökning

| Symptom | Trolig orsak |
|---------|--------------|
| `Trafikverket API 403` | Fel eller avstängd nyckel |
| `ZodError` på RESPONSE | Schema-ändring, inspektera råsvar med `console.log(JSON.stringify(json, null, 2))` |
| `skipped_no_coord` högt | Vissa händelser saknar WGS84-koordinat — förväntat, troligen vägarbeten/info |
| Dedupe fungerar inte (rader dubbleras) | Kolla att `id`-kolumnen är PK och att upsert-anrop använder `onConflict: "id"` |
