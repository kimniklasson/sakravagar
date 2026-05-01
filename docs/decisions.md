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

**Första datacheck 2026-05-01:** Behåll 30 min. Efter cirka en veckas insamling fanns 226 olycksevents. `pg_cron` hade kört scrape-jobbet 301 gånger utan failures och med 30 min som maxgap. Observerad `last_seen - first_seen` hade median 30 min; 35% var single-observation-events. Trafikverkets `raw.StartTime -> raw.EndTime` hade p10 cirka 45 min och inga events under 30 min, vilket talar emot att 30-minuterspolling missar många olyckor just nu. Kör om analysen efter ytterligare 1–2 veckor och igen efter en månad.

## 2026-04-25 — Cron flyttad från GH Actions till Supabase pg_cron

**Valt:** Schemalägg scrapen via `pg_cron` + `pg_net` direkt i Supabase, som anropar en Edge Function `scrape` (Deno-port av Node-scrapern). GH Actions-workflowen behållen som manuell `workflow_dispatch`-knapp.

**Varför:** GitHub Actions schedule är beryktat opålitlig under hög last — observerade 1–2 timmars gap över natten trots `*/30 * * * *`-schema. För en heatmap som lever på färska data är missade fönster värre än lite extra setup. pg_cron kör i databasen och triggar ändå konsekvent. Allt ligger nu inom Supabase = enklare ops, samma stack.

**Övervägt:** External cron (cron-job.org) → `workflow_dispatch` via GitHub API. Fungerar men flyttar bara opålitligheten ett steg — och det är ett extra system att hålla koll på. Cloudflare Workers Cron Triggers — pålitligast men kräver port av scrapern till Workers-runtime utan stark Postgres-klient.

**Konsekvens:** Scraper-koden finns nu i två versioner — `scraper/` (Node, kvar för manuell körning via `workflow_dispatch`) och `supabase/functions/scrape/` (Deno, prod). Håll dem i sync vid förändringar; eller på sikt ta bort Node-versionen om den inte används.

## 2026-04-24 — Dedupe-strategi

**Valt:** Primärnyckel på `Deviation.Id`. Upsert med `first_seen` bevarad via default, `last_seen` uppdaterad.

**Varför:** Samma olycka rapporteras i flera polling-rundor så länge den är aktiv. Vi vill veta både när vi först såg den och senaste gången — det ger oss "aktiv tid" som är värdefullt för framtida analys.

## 2026-04-30 — Segmentrisk: popupens dedup-definition är source of truth

**Valt:** Både `risk_per_segment` och `segment_detail` räknar olyckor dedupat per `fid + message + road_number + first_seen-hour`.

**Varför:** Trafikverkets feed kan skapa flera tekniska rader som i praktiken beskriver samma incident. Om vi är tillräckligt säkra på att det är samma händelse ska användaren se och räkna den som en olycka, inte som flera. Popupen var redan den mest användarnära definitionen; migration 0023 flyttar samma logik till risk-MV:n så kartfärg och popup inte säger olika saker.

**Konsekvens:** Riskvärden kan bli lägre än tidigare på segment där feeden skapat dubbletter, men de blir mer begripliga och konsekventa. Om vi senare hittar bättre upstream-fält för incident-identitet bör den gemensamma dedup-regeln uppdateras på ett ställe och användas av både karta och popup.

## 2026-04-30 — Publika API:er ska begränsa bbox på servern

**Valt:** Alla tunga kartendpoints validerar bbox på serversidan och SQL-RPC:erna har response-limits.

**Varför:** Klientens zoom- och tile-logik skyddar bara vanliga användarflöden. Publika endpoints kan anropas direkt, så servern måste själv neka orimliga koordinater/stora bboxar och hindra obegränsade GeoJSON-svar.

**Konsekvens:** Frontend måste alltid skicka bbox till `/api/events` och tyngre lager. För hel-Sverige-vyer tillåts events/störningar fortsatt stora bboxar, men NVDB/Risk-lagren hålls till mindre ytor.

## 2026-04-30 — ESLint via CLI, inte `next lint`

**Valt:** `web` använder ESLint flat config (`eslint.config.mjs`) och scriptet `lint` kör `eslint .`.

**Varför:** `next lint` är deprecated och startade en interaktiv setup-prompt i projektet. ESLint CLI är repeterbart i CI/lokal terminal och fångar React/Next/TypeScript-regler utan prompt.

**Konsekvens:** `eslint`, `eslint-config-next` och `@eslint/eslintrc` är devDependencies. Pnpm-store är låst till repo-lokal `.pnpm-store` via `.npmrc` eftersom den gamla installationen pekade mot en felaktig user-path.

## 2026-05-01 — Routing: self-hostad GraphHopper på Hetzner

**Valt:** Self-hosta GraphHopper 11 på Hetzner CPX32 (`trafik-routing`, IPv4 `116.203.135.46`) bakom Caddy/HTTPS och header-token. Appen anropar GraphHopper via Vercel `/api/route` med `GRAPHHOPPER_BASE_URL` och `GRAPHHOPPER_TOKEN`. GraphHopper lyssnar bara på `localhost:8989`; publikt finns endast `https://routing.säkravägar.se` med `X-Routing-Token`.

**Varför:** Vi behöver kunna påverka vägkostnad, särskilt för `Höga hastigheter (90+)`, utan att vara låsta till publika OSRM:s få standardalternativ. GraphHopper custom model ger ett rimligt MVP-steg mot lugnare rutter. Hetzner CPX32 är billigare och mer förutsägbart än GraphHopper Cloud/Render/Railway, men utan att förlita sig på osäkra free-tier VPS:er.

**Övervägt:** GraphHopper Cloud — snabbast operativt men dyrare och mindre kontroll över kostnad över tid. Oracle Always Free — tekniskt möjlig men olämplig som MVP-ryggrad p.g.a. kapacitets-/reclaim-risk. pgRouting/egen graf — maximal kontroll men för stort steg nu; kräver egen hantering av routbart vägnät, svängregler, enkelriktat, prestanda och uppdateringar.

**Konsekvens:** Vi äger nu en extra driftkomponent utanför Vercel/Supabase. Servern måste hållas uppdaterad och GraphHopper-grafen behöver byggas om när OSM/config ändras. Första setup: Ubuntu 24.04, Java 21, GraphHopper JAR i `/opt/graphhopper`, Sverige-PBF från Geofabrik, 4 GB swap, UFW med endast 22/80/443 publikt, Caddy med LetsEncrypt. Lokala devtester som ska matcha production måste sätta GraphHopper-env vars; annars faller `/api/route` tillbaka till OSRM.

## 2026-05-01 — Domän och DNS: Cloudflare + Vercel

**Valt:** `säkravägar.se` köpt via Loopia, men DNS hanteras i Cloudflare free plan. Appen ligger på Vercel production (`xn--skravgar-0zae.se`/`säkravägar.se`), routing på `routing.säkravägar.se` mot Hetzner. DNS-poster: `A @ -> 76.76.21.21`, `CNAME www -> cname.vercel-dns.com`, `A routing -> 116.203.135.46` DNS-only.

**Varför:** Cloudflare DNS är gratis, stabilt och gör det enklare att hantera subdomäner utan Loopias DNS-paket. Vercel får fortsatt sköta appens certifikat/deploys, medan Caddy sköter routing-subdomänens certifikat på Hetzner.

**Konsekvens:** Unicode-domänen behöver ibland anges som punycode i tekniska system: `xn--skravgar-0zae.se` och `routing.xn--skravgar-0zae.se`. Vercel accepterade punycode-varianten. Cloudflare DNS-posten för `routing` ska vara DNS-only så Caddy/Hetzner hanterar HTTPS direkt.
