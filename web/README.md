# web

Next.js App Router + MapLibre GL för Säkravägar. Visar kontrollager för olyckor, flöde, störningar och höga hastigheter samt ruttplanering med trygghetsfilter.

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
GRAPHHOPPER_BASE_URL='https://routing.xn--skravgar-0zae.se' \
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
│   ├── routeModel.ts         # route-typer, ranking, cache
│   ├── layers.ts             # MapLibre-källor/lager
│   └── Map.module.css
├── lib/
├── public/icons/
└── styles/
```

## Styling

- Allt via `*.module.css`, `globals.css` eller tokens i `styles/tokens.css`.
- CSS Modules används för komponenter; globala klasser bara där MapLibre eller app-shell kräver det.
- Behåll design tokens som källa för färger/typografi när ett värde är återanvändbart.

## Viktiga API-rutter

- `/api/events` — olyckor från `events_public`; kräver `bbox`, stödjer `live=1`.
- `/api/events/stats` — datafönster/färskhet för UI-copy.
- `/api/risk` — deduplicerad segmentrisk via `risk_in_bbox`.
- `/api/adt` — ÅDT/flöde via `adt_in_bbox`.
- `/api/traffic-flow` — aktiva TrafficFlow-mätningar snappade till segment.
- `/api/disturbances` — aktiva vägarbeten/kö-/trafikstörningar inom bbox.
- `/api/large-roads` — höghastighetssegment för 80+-badges.
- `/api/geocode` — Nominatim-proxy för svensk search/reverse.
- `/api/route` — GraphHopper/OSRM-routing via `POST`.
- `/api/route-shares` — public route snapshots för `/r/[slug]`.
- `/api/route-feedback` — tumme upp/ner och kommentar som kalibreringsunderlag.
- `/api/segment` — popupdetaljer för vägsegment.

Alla tunga bbox-rutter ska ha API-side area guard, Sverige-bounds guard och SQL-side limit.

## Routeplanner

`Undvik om möjligt`-filter:

- `Höga hastigheter`
- `Trafikintensiva vägar`
- `Stadstrafik`
- `Broar`
- `Tunnlar`

GraphHopper påverkar dessa filter via custom model när env finns. Trafikintensitet använder ÅDT som bas och liveflöde som förstärkning. Stadstrafik använder statiska stadszoner och `road_class`/`max_speed`, eftersom vår GraphHopper-cache inte exponerar `urban_density`. Olyckor och störningar är kontrollager/route-notices, inte planeringsfilter.

## Deploy

1. Importera repo i Vercel.
2. Root directory: `web`.
3. Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GRAPHHOPPER_BASE_URL`, `GRAPHHOPPER_TOKEN`, samt dedikerade `NOMINATIM_*`/`OSRM_*` före större publik trafik.
4. Deploy via Vercels Git-integration.

Routingdrift dokumenteras i `docs/routing-ops.md`.
