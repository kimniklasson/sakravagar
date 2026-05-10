# scraper

Node/TypeScript-scraper som hämtar Trafikverket-data och skriver till Supabase. Den används för lokal/manuell körning och som GitHub Actions-nödknapp.

Production-scrapen körs via Supabase `pg_cron` + Edge Function i `supabase/functions/scrape/`.

## Köra lokalt

1. Kopiera `.env.example` till `.env` och fyll i:
   - `TRAFIKVERKET_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`

2. Installera och kör:

   ```sh
   pnpm install
   pnpm --filter @trafik/scraper run dev
   ```

## Vad den gör

1. Hämtar `Situation.Deviation` från Trafikverket och delar upp:
   - `MessageType=Olycka` -> `events`
   - övriga relevanta deviations -> `disturbances`
2. Hämtar `TrafficFlow` -> `traffic_flow_measurements`.
3. Mappar rader till Supabase-format och filtrerar bort poster utan koordinat.
4. Upsertar i batchar för att undvika Supabase statement-timeouts.
5. Loggar summary med antal hämtade/upsertade rader, batchar, koordinatbortfall och körtid.

## Produktionsscheduler

Källan till schemaläggningen ligger i databasmigrationerna:

- `db/migrations/0004_pg_cron_scrape.sql` — `pg_cron`/`pg_net` anropar Edge Function `scrape`.
- `supabase/functions/scrape/index.ts` — Deno-versionen som körs i production.

När Trafikverket-transformen ändras behöver Node-scrapern och Edge Function-versionen hållas i sync tills Node-spåret tas bort.

## Analysera pollingintervall

```sh
pnpm --filter @trafik/scraper run analyze:polling
```

Analysen jämför vår observerade tid (`first_seen` -> `last_seen`) med Trafikverkets egna tider (`raw.StartTime` -> `raw.EndTime`). Analysen 2026-05-01 på 226 events stödde att behålla 30 min polling.

## Struktur

```text
src/
├── env.ts
├── trafikverket.ts
├── supabase.ts
├── transform.ts
├── analyze-polling.ts
└── index.ts
```

## Felsökning

| Symptom | Trolig orsak |
| --- | --- |
| `Trafikverket API 403` | Fel eller avstängd nyckel |
| `ZodError` på response | Schemaändring i Trafikverket API |
| högt `skipped_no_coord` | Vissa händelser saknar WGS84-koordinat |
| upsert-timeout | Batchstorlek/payload för stor, särskilt disturbances |
| dubbla olycksrader | Kontrollera PK på `events.id` och `onConflict: "id"` |
