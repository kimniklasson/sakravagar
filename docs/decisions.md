# Design decisions (ADR-lite)

Korta anteckningar över vägval. En post per icke-trivialt beslut — för future-you och eventuella medhjälpare.

## 2026-04-24 — Stack: GH Actions + Supabase + Vercel

**Valt:** GitHub Actions cron (publikt repo) → Supabase Postgres med PostGIS → Next.js på Vercel.

**Varför:** 0 kr/mån hela vägen till MVP. Alla tre tjänsterna har generösa gratisnivåer som räcker länge. Publikt repo krävs för obegränsade Actions-minuter.

**Övervägt:** Supabase Edge Functions + pg_cron istället för GH Actions — enklare arkitektur men sämre debug-UI och risk att free-tier projekt pausas efter 7 dagars inaktivitet. Firebase — kräver Blaze-plan (kreditkort) för Cloud Functions, och Firestore är dåligt lämpad för geospatiala queries.

## 2026-04-24 — Scraper-språk: Node/TypeScript

**Valt:** Node + TypeScript.

**Varför:** Samma språk som frontenden = mindre mental växling, delade typer möjligt via `shared/`. Tillräckligt för HTTP + DB-inserts.

**Övervägt:** Python — trevligare om vi vill göra data-analys i notebooks senare, men overkill för ren scrape.

## 2026-04-24 — Frontend: Next.js App Router

**Valt:** Next.js 15+ med App Router.

**Varför:** Vercel-native deploy, SSR/SSG om vi vill SEO-optimera delbara länkar senare, branschstandard.

## 2026-04-24 — Karta: MapLibre GL JS + OpenFreeMap

**Valt:** MapLibre GL JS, tiles från OpenFreeMap.

**Varför:** Helt gratis, ingen registrering eller API-nyckel för tiles, CC0. Vektor-tiles ger smidig rendering oavsett visualiseringstyp (heatmap, circle, line, extrusion).

**Övervägt:** Mapbox — snyggast out-of-the-box men risk för kostnad vid >50k laddningar/mån. Leaflet — enklare men raster-only och klumpigare.

## 2026-04-24 — Styling: CSS Modules

**Valt:** CSS Modules + design tokens i `tokens.css`.

**Varför:** Kim är designer och vill äga stilen — atomic classes (Tailwind) skulle gå emot det. CSS Modules ger scoped ren CSS utan kollisioner.

## 2026-04-24 — Datamodell: punkt + `raw jsonb`

**Valt:** En rad per Deviation, koordinat som `geometry(Point, 4326)`, hela API-objektet i `raw jsonb`.

**Varför:** Punkt räcker för all punkt-baserad visualisering (heatmap, circle, hex). `raw`-kolumnen är framtidssäkring — om vi senare vill extrahera ett fält vi inte tänkt på slipper vi scrapa om.

**Konsekvens:** Färgade vägsegment kräver ett tilläggsspår (NVDB/OSM + map-matching), men datamodellen behöver inte ändras — bara en `road_segment_id`-kolumn läggs till vid behov och beräknas bakåt.

## 2026-04-24 — Polling: 30 min

**Valt:** Cron var 30:e minut.

**Varför:** Välbalanserat första gissning — olyckor hinner fångas även om de är kortlivade, men API-trafiken är hanterbar.

**Utvärderas:** Efter 1 månad med riktig data. Beräkna median `aktiv-tid` per händelse. Om median är klart över 30 min → sänk till 60 min (halvera API-trafiken).

## 2026-04-25 — Cron flyttad från GH Actions till Supabase pg_cron

**Valt:** Schemalägg scrapen via `pg_cron` + `pg_net` direkt i Supabase, som anropar en Edge Function `scrape` (Deno-port av Node-scrapern). GH Actions-workflowen behållen som manuell `workflow_dispatch`-knapp.

**Varför:** GitHub Actions schedule är beryktat opålitlig under hög last — observerade 1–2 timmars gap över natten trots `*/30 * * * *`-schema. För en heatmap som lever på färska data är missade fönster värre än lite extra setup. pg_cron kör i databasen och triggar ändå konsekvent. Allt ligger nu inom Supabase = enklare ops, samma stack.

**Övervägt:** External cron (cron-job.org) → `workflow_dispatch` via GitHub API. Fungerar men flyttar bara opålitligheten ett steg — och det är ett extra system att hålla koll på. Cloudflare Workers Cron Triggers — pålitligast men kräver port av scrapern till Workers-runtime utan stark Postgres-klient.

**Konsekvens:** Scraper-koden finns nu i två versioner — `scraper/` (Node, kvar för manuell körning via `workflow_dispatch`) och `supabase/functions/scrape/` (Deno, prod). Håll dem i sync vid förändringar; eller på sikt ta bort Node-versionen om den inte används.

## 2026-04-24 — Dedupe-strategi

**Valt:** Primärnyckel på `Deviation.Id`. Upsert med `first_seen` bevarad via default, `last_seen` uppdaterad.

**Varför:** Samma olycka rapporteras i flera polling-rundor så länge den är aktiv. Vi vill veta både när vi först såg den och senaste gången — det ger oss "aktiv tid" som är värdefullt för framtida analys.
