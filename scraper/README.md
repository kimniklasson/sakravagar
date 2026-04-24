# scraper

Node/TypeScript-scraper som hämtar olyckshändelser från Trafikverkets öppna API och skriver till Supabase. Körs av GitHub Actions var 30:e minut.

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

1. Hämtar alla aktiva `Situation.Deviation` med `MessageType = "Olycka"` från Trafikverket.
2. Mappar varje Deviation → en rad i `events`-tabellen.
3. Upsert på `id` (Trafikverkets Deviation.Id):
   - Insert → `first_seen` sätts till `now()` via default, `last_seen` = nu.
   - Update → bara `last_seen`, `modified_time`, `raw` uppdateras. `first_seen` bevaras.
4. Loggar summary: `fetched`, `upserted`, `skipped_no_coord`, `elapsed_ms`.

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
