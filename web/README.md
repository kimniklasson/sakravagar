# web

Next.js App Router + MapLibre GL för Säkravägar. Visar kontrollager för olyckor, trafikflöde, vägkameror, störningar och höga hastigheter samt ruttplanering med trygghetsfilter.

## Köra lokalt

```sh
cp .env.example .env.local
# fyll i SUPABASE_URL och SUPABASE_ANON_KEY
pnpm install
pnpm --filter @trafik/web run dev
```

Next startar normalt på `http://localhost:3000`.

För lokal routing som matchar production:

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') \
GRAPHHOPPER_BASE_URL='https://routing.sakravagar.se' \
GRAPHHOPPER_TOKEN="$TOKEN" \
pnpm web
```

Utan `GRAPHHOPPER_BASE_URL` faller `/api/route` tillbaka till OSRM.

## Struktur

```text
web/
├── app/
│   ├── api/                  # bbox-data, geocoding, routing, shares och feedback
│   ├── r/[slug]/             # delade rutter
│   ├── layout.tsx
│   └── page.tsx
├── components/Map/
│   ├── Map.tsx               # MapLibre-init och orchestration
│   ├── RoutePlannerBox.tsx   # Från/Till + undvik-pills
│   ├── RouteAlternativesTray.tsx
│   ├── RouteLoadingIndicator.tsx
│   ├── HelpPanel.tsx
│   ├── MapIcons.tsx
│   ├── hooks/                # MapLibre-livscykel, viewport, liveevent och ruttstopp
│   ├── routeModel.ts         # klientranking, labels, cache
│   ├── routeSharing.ts       # delning, feedback och externa ruttlänkar
│   ├── layers.ts             # export-yta för MapLibre-lager
│   ├── layers/               # rutt, ÅDT, hastighet, risk, live/störningar, kameror, popup
│   └── Map.module.css
├── lib/
│   └── routeTypes.ts         # delade ruttsvarstyper
├── app/api/route/_routing/   # serverhjälpare för routing
├── public/icons/
└── styles/
```

## Styling

- Allt via `*.module.css`, `globals.css` eller tokens i `styles/tokens.css`.
- CSS Modules används för komponenter; globala klasser bara där MapLibre eller app-shell kräver det.
- Behåll design tokens som källa för färger/typografi när ett värde är återanvändbart.

## Viktiga API-rutter

- `/api/events` — dedupade olyckspunkter från `events_in_bbox`; kräver `bbox`, stödjer `live=1`.
- `/api/events/stats` — datafönster/färskhet för UI-copy.
- `/api/risk` — vilande segmentrisk via `risk_in_bbox`; UI-lagret är pausat tills datan är mognare.
- `/api/adt` — ÅDT/flöde via `adt_in_bbox`.
- `/api/traffic-flow` — aktiva TrafficFlow-mätningar snappade till segment.
- `/api/cameras` — aktiva Trafikverket-kameror inom bbox med direkt bildlänk. Används för både globalt kamera-lager och kameror inom 100 m från aktiv rutt.
- `/api/disturbances` — aktiva vägarbeten/kö-/trafikstörningar inom bbox.
- `/api/large-roads` — höghastighetssegment för 80+-badges.
- `/api/geocode` — Nominatim-proxy för svensk search/reverse.
- `/api/route` — GraphHopper/OSRM-routing via `POST`.
- `/api/route-shares` — public route snapshots för `/r/[slug]`, validerade via `web/lib/routeShareSchema.ts`.
- `/api/route-feedback` — tumme upp/ner som kalibreringsunderlag, med samma snapshot-schema som delningslänkar.
- `/api/segment` — vilande popupdetaljer för vägsegment; ÅDT-lagret är inte klickbart i nuvarande UI.

Alla tunga bbox-rutter ska ha API-side area guard, Sverige-bounds guard och SQL-side limit.

API-svar inkluderar `x-request-id` där serverrutten kan läsa eller skapa ett request-id. Serverloggar använder stabila eventnamn: `api_observation` för mätpunkter, `api_warning` för mjuka fallbackar och `api_error` för fel. Cloudflare Free har en aktiv rate limiting-regel på exakt `/api/route`: 10 requests / 10 seconds per IP, action `Block`, duration 10 seconds. `/api/route` använder dessutom en per-instans concurrency cap för att skydda GraphHopper: `ROUTE_MAX_CONCURRENT_TOTAL`, `ROUTE_MAX_CONCURRENT_PER_IP` och `ROUTE_CONCURRENCY_RETRY_AFTER_SECONDS` kan sättas i Vercel om defaultvärdena behöver justeras.

Server-side Supabase-klienter ska skapas via `web/lib/supabaseServer.ts`, som använder genererade typer från `db/database.types.ts`.

## Routeplanner

`Undvik om möjligt`-filter:

- `Höga hastigheter`
- `Trafikintensiva vägar`
- `Stadstrafik`
- `Broar`
- `Tunnlar`
- `Stora rondeller`
- `Flerfiligt`

GraphHopper påverkar dessa filter via custom model när env finns. Trafikintensitet använder ÅDT som bas och liveflöde som förstärkning. Stadstrafik använder statiska stadszoner och `road_class`/`max_speed`, eftersom vår GraphHopper-cache inte exponerar `urban_density`. Olyckor och störningar är kontrollager/route-notices, inte planeringsfilter.

Vald rutt visar Trafikverkets kameror som ligger inom 100 meter från ruttens geometri. Det är ett separat ruttlager utan klustring och är oberoende av om användaren har slagit på det globala kamera-lagret.

## Deploy

1. Importera repo i Vercel.
2. Root directory: `web`.
3. Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GRAPHHOPPER_BASE_URL`, `GRAPHHOPPER_TOKEN`, samt dedikerade `NOMINATIM_*`/`OSRM_*` före större publik trafik.
4. Deploy via Vercels Git-integration.

Routingdrift dokumenteras i `docs/routing-ops.md`.
