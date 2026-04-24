# trafik

Historisk olycksdata på svenska vägar — en webbapp som hjälper nervösa förare känna trygghet och välja säkrare rutter.

Idé, validering och strategi i [PROJECT.md](./PROJECT.md). Vägval i [docs/decisions.md](./docs/decisions.md).

## Arkitektur

```
GitHub Actions (30 min) ──► Trafikverket Öppna API
         │
         ▼ upsert
   Supabase Postgres + PostGIS
         │
         ▼ PostgREST
   Next.js på Vercel + MapLibre GL
```

- **Scraper** (`scraper/`) — Node/TS, körs av GH Actions, skriver till Supabase
- **Web** (`web/`) — Next.js App Router, MapLibre-karta, läser från Supabase
- **DB** (`db/`) — SQL-migrations
- **Shared** (`shared/`) — TS-typer delade mellan scraper och web

## Kom igång (utvecklare)

Förutsätter att konton är uppsatta enligt [setup-checklistan](#setup-checklista) nedan.

```sh
corepack enable            # pnpm via Node >=20
pnpm install
cp .env.example .env       # fyll i värden
pnpm scrape:dev            # engångskörning mot Trafikverket → Supabase
pnpm web                   # Next.js dev på :3000
```

## Setup-checklista

Engångsgrejer som inte kan automatiseras:

- [ ] Konto på [data.trafikverket.se](https://data.trafikverket.se/) och beställd nyckel för **Öppet API / TrafficInformation** (inte Datex II)
- [ ] Nytt Supabase-projekt på befintligt konto, region EU-nord/Frankfurt
- [ ] PostGIS aktiverad: Supabase → Database → Extensions → `postgis`
- [ ] Schemat applicerat: kör [`db/migrations/0001_init.sql`](./db/migrations/0001_init.sql) i SQL Editor
- [ ] GitHub-repo (publikt, för gratis Actions-minuter)
- [ ] Repo-secrets satta: `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- [ ] Vercel-projekt kopplat till `web/`, env-vars `SUPABASE_URL` + `SUPABASE_ANON_KEY`

## Deploy

- **Scraper** deployas inte separat — GH Actions kör direkt från repot vid varje schema-triggering.
- **Web** deployas automatiskt när main uppdateras (Vercel Git-integration).

## Struktur

```
trafik/
├── scraper/               # Node/TS cron-scraper
├── web/                   # Next.js-frontend
├── shared/                # delade TS-typer
├── db/                    # SQL-migrations
├── .github/workflows/     # cron.yml
├── docs/                  # ADR-lite beslut
├── PROJECT.md             # strategi & validering
└── README.md              # (du är här)
```
