# Current state — 2026-04-24 (kväll, post-heatmap)

Körbar sammanfattning för att fortsätta i ny session. Läs denna + `PROJECT.md` + `docs/decisions.md` för full kontext.

## Vad som är klart

- ✅ Monorepo scaffoldat (`scraper/`, `web/`, `shared/`, `db/`)
- ✅ Supabase-projekt uppsatt (North EU / Stockholm), PostGIS aktiverat, schema applicerat
- ✅ Trafikverket-nyckel `trafik-prod` skapad
- ✅ Scrapern funkar end-to-end — hämtar Deviations (filter `MessageType=Olycka`) och upsertar till Supabase
- ✅ **GitHub Actions cron** på repo `kimniklasson/sakravagar` — **publikt sedan 2026-04-24** (bytte från privat pga att schedule-events inte firade på privat free tier, bara push-triggers körde). Kör `*/30 * * * *`. Secrets satta: `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
- ✅ Push- och manual-dispatch-körningar gröna. **Schedule-fireningar ska börja dyka upp nu när repot är publikt** — verifiera genom att kolla Actions-tabben om ~1h och leta efter Event = `schedule`.
- ✅ **Vercel live** — https://sakravagar.vercel.app/ (root = `web/`, Next.js, env `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Auto-deploy på push till `main`.
  - Gotcha löst: Next 15 App Router tillåter inte `ssr: false` i Server Components. Dynamisk MapLibre-import ligger nu i en client wrapper: `web/components/Map/MapLoader.tsx`.
- ✅ **MVP-heatmap kopplad** — `web/components/Map/layers.ts` hämtar från `/api/events` (som läser `events_public`-vyn) och ritar MapLibre `heatmap`-lager + circle-lager som tonar in vid zoom ≥10.
  - Gotcha löst: API-routen läste `SUPABASE_URL`/`SUPABASE_ANON_KEY` men på Vercel var bara `NEXT_PUBLIC_*`-varianterna satta. Routen har nu fallback till `NEXT_PUBLIC_*`.

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

1. **Verifiera att schedule firar** (~1h efter publikt-byte). Kolla https://github.com/kimniklasson/sakravagar/actions efter körningar med Event = `schedule`.
2. **Låt cron rulla 2-3 dagar** (passivt) och verifiera att tabellen växer rimligt (~48 körningar/dag).
3. **Förfina heatmap** när data växt: tidsfilter (UI-koppla `?since=`-parametern som redan finns i `/api/events`), severity-viktning (mappa `severity` → `heatmap-weight`), väg-segmentering (snap mot NVDB).

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
