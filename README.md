# trafik

Historisk olycksdata på svenska vägar — en webbapp som hjälper nervösa förare känna trygghet och välja säkrare rutter.

Idé, validering och strategi i [PROJECT.md](./PROJECT.md). Nuläge i [docs/current-state.md](./docs/current-state.md), vägval i [docs/decisions.md](./docs/decisions.md), utvecklarflöde i [docs/dev-workflow.md](./docs/dev-workflow.md), routingdrift i [docs/routing-ops.md](./docs/routing-ops.md) och senaste större sessionslogg i [docs/session-2026-05-01.md](./docs/session-2026-05-01.md).

## Arkitektur

```
Supabase pg_cron ──► Edge Function scrape ──► Trafikverket Öppna API
        │                         │
        │                         ▼ upsert
        └────────────────► Supabase Postgres + PostGIS
                                  │
                                  ▼ API/RPC
                         Next.js + MapLibre GL
```

- **Scraper** (`supabase/functions/scrape/`) — prod-scraper via Edge Function + pg_cron
- **Scraper CLI** (`scraper/`) — Node/TS-version för manuell körning/nödknapp
- **Web** (`web/`) — Next.js App Router, MapLibre-karta, API-rutter mot Supabase samt geocoding/routing-proxies
- **DB** (`db/`) — SQL-migrations, RPC:er, vyer och materialiserade vyer
- **Shared** (`shared/`) — TS-typer delade mellan scraper och web

## Kom igång (utvecklare)

Förutsätter att konton är uppsatta enligt [setup-checklistan](#setup-checklista) nedan.

```sh
corepack enable            # pnpm via Node >=20
pnpm install
cp .env.example .env       # fyll i värden
pnpm web                   # Next.js dev på :3000
pnpm scrape:dev            # manuell engångsscrape vid behov
```

## Setup-checklista

Engångsgrejer som inte kan automatiseras:

- [ ] Konto på [data.trafikverket.se](https://data.trafikverket.se/) och beställd nyckel för **Öppet API / TrafficInformation** (inte Datex II)
- [ ] Nytt Supabase-projekt på befintligt konto, region EU-nord/Stockholm
- [ ] PostGIS aktiverad: Supabase → Database → Extensions → `postgis`
- [ ] Schemat applicerat: kör migrationskedjan i [`db/migrations/`](./db/migrations/)
- [ ] Edge Function `scrape` deployad och `pg_cron`/`pg_net` aktiverat via migration
- [ ] Repo-secrets satta om GitHub Actions-nödknappen ska användas: `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- [ ] Vercel-projekt kopplat till `web/`, env-vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GRAPHHOPPER_BASE_URL` och `GRAPHHOPPER_TOKEN` samt dedikerade `NOMINATIM_*`/`OSRM_*`-värden före större publik trafik

## Deploy

- **Scraper** deployas som Supabase Edge Function. GitHub Actions finns bara som manuell nödknapp.
- **Web** deployas automatiskt när main uppdateras (Vercel Git-integration).

## Struktur

```
trafik/
├── scraper/               # Node/TS scraper CLI
├── web/                   # Next.js-frontend
├── shared/                # delade TS-typer
├── db/                    # SQL-migrations
├── .github/workflows/     # manuell scrape-nödknapp
├── docs/                  # nuläge, ADR-lite beslut, API och ops
├── PROJECT.md             # strategi & validering
└── README.md              # (du är här)
```
