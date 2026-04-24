# Current state — 2026-04-24 (kväll, post-Vercel)

Körbar sammanfattning för att fortsätta i ny session. Läs denna + `PROJECT.md` + `docs/decisions.md` för full kontext.

## Vad som är klart

- ✅ Monorepo scaffoldat (`scraper/`, `web/`, `shared/`, `db/`)
- ✅ Supabase-projekt uppsatt (North EU / Stockholm), PostGIS aktiverat, schema applicerat
- ✅ Trafikverket-nyckel `trafik-prod` skapad
- ✅ Scrapern funkar end-to-end — hämtar Deviations (filter `MessageType=Olycka`) och upsertar till Supabase
- ✅ **GitHub Actions-cron live** på publikt repo `kimniklasson/sakravagar` (privat att börja med, byts till publikt innan frekvensökning). Kör `*/30 * * * *`. Secrets satta: `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
- ✅ Första grön körning på Actions — 4 rader i `events`, alla `roadAccident` med koordinater
- ✅ **Vercel live** — https://sakravagar.vercel.app/ (root = `web/`, Next.js, env `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Auto-deploy på push till `main`.
  - Gotcha löst: Next 15 App Router tillåter inte `ssr: false` i Server Components. Dynamisk MapLibre-import ligger nu i en client wrapper: `web/components/Map/MapLoader.tsx`.

## Trafikverket-query (fungerande)

```xml
<QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="1000">
  <FILTER>
    <EQ name="Deviation.MessageType" value="Olycka" />
  </FILTER>
</QUERY>
```

- `namespace="Road.TrafficInfo"` krävs
- `schemaversion="1.6"` är aktuell
- Scrapern filtrerar klientsidan bort icke-`Olycka` Deviations (EQ matchar Situationer där minst en Deviation är Olycka, syskon-Deviations följer med i svaret)

## Nästa steg

1. **MVP-heatmap** — enklaste möjliga MapLibre-karta som läser från `events_public`-vyn och ritar heatmap-lager. `web/app/api/events/route.ts` finns som stub, `web/components/Map/Map.tsx` finns men ritar inget data-lager än.
2. **Låt cron rulla 2-3 dagar** (passivt) och verifiera att tabellen växer rimligt (~48 körningar/dag).
3. **Byt GitHub-repo till publikt** innan ev. frekvensökning (privat = 2000 Actions-min/mån tak, publikt = obegränsat).

## Filer att känna till

| Fil | Vad |
|-|-|
| `scraper/src/trafikverket.ts` | Query-XML byggs här. Namespace + 1.6 + klientfilter. |
| `scraper/src/index.ts` | Orchestrator, upsert till Supabase. |
| `scraper/src/env.ts` | Env-schema: `SUPABASE_SERVICE_KEY` (ej `_ROLE_KEY`). |
| `.github/workflows/cron.yml` | GitHub Actions cron. Ingen `version:` på `pnpm/action-setup` — läser från `packageManager` i `package.json`. |
| `web/components/Map/MapLoader.tsx` | Client wrapper runt dynamisk MapLibre-import. Behövs pga Next 15 SSR-regler. |
| `web/components/Map/Map.tsx` | MapLibre-karta. Heatmap-lager ska kopplas till `events_public`-vyn. |
| `.env` (rooten, ej committad) | `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` |
| `db/migrations/0001_init.sql` | Events-tabell + `events_public`-vy. |
