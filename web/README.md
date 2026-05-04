# web

Next.js App Router + MapLibre GL. Visar risk-, flödes-, störnings-, liveflödes- och ruttlager för Säkravägar.

## Köra lokalt

```sh
cp .env.example .env.local
# fyll i SUPABASE_URL och SUPABASE_ANON_KEY
# geocoding/routing har lokala defaults i .env.example, men skarp trafik bör ha dedikerad provider
pnpm install
pnpm --filter @trafik/web run dev
# öppna http://localhost:3000
```

För lokal routing som matchar production, starta med GraphHopper-env:

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') \
GRAPHHOPPER_BASE_URL='https://routing.xn--skravgar-0zae.se' \
GRAPHHOPPER_TOKEN="$TOKEN" \
pnpm web
```

Utan `GRAPHHOPPER_BASE_URL` faller `/api/route` tillbaka till OSRM.

## Struktur

```
web/
├── app/
│   ├── layout.tsx            # root layout
│   ├── page.tsx              # huvudsida (laddar Map dynamiskt, ssr:false)
│   ├── page.module.css
│   └── api/                  # bbox-data, geocoding, routing och route scores
├── components/
│   └── Map/
│       ├── Map.tsx           # MapLibre-init ('use client')
│       ├── Map.module.css
│       └── layers.ts         # GeoJSON-source + visualiserings-layer
├── lib/
│   ├── supabase.ts
│   └── types.ts              # re-export från @trafik/shared
├── styles/
│   ├── globals.css
│   └── tokens.css            # design tokens som CSS custom properties
├── next.config.ts
└── tsconfig.json
```

## Stylingregler

- **Inga inline styles.** Allt via `*.module.css` (scoped) eller `globals.css`.
- **Design tokens** i `tokens.css` som CSS custom properties — ändra där för global konsekvens.
- **Co-location:** komponent + dess CSS Module i samma mapp.

## Viktiga API-rutter

- `/api/events` — olyckor från `events_public`; kräver `bbox`, stödjer `live=1`.
- `/api/events/stats` — datafönster/färskhet för UI-copy.
- `/api/risk` — deduplicerad segmentrisk via `risk_in_bbox`.
- `/api/adt` — ÅDT/flöde via `adt_in_bbox`.
- `/api/traffic-flow` — aktiva TrafficFlow-mätningar snappade till segment.
- `/api/disturbances` — aktiva vägarbeten/kö-/trafikstörningar.
- `/api/large-roads` — höghastighetssegment för badge-lagret och ruttfiltrets scoring.
- `/api/geocode` — Nominatim-proxy för svensk search/reverse.
- `/api/route` — routingproxy. Använder GraphHopper om env finns, annars OSRM.
- `/api/segment` — popupdetaljer för vägsegment.

Alla tunga bbox-rutter ska ha både API-side area guard och SQL-side limit.

## Routeplanner

Ruttplaneraren bor i `components/Map/Map.tsx`. Den geocodar `Från`/`Till`, ritar primär och alternativa rutter via `layers.ts`, och rankar kandidater med `avoidScores` från `/api/route`.

Aktiva "Undvik om möjligt"-filter:

- `Vägar med olyckshistorik`
- `Höga hastigheter`
- `Störningar (kö/vägarbeten)`
- `Broar`
- `Tunnlar`

GraphHopper påverkar höga hastigheter, broar och tunnlar via custom model. Broar/tunnlar exponeras med `road_environment` path details. Olyckshistorik och störningar skickas också in som dynamiska penalty zones när deras filter är aktiva, och poängsätts efteråt för ranking/exponering i UI:t.

## Byta visualiseringstyp

Allt bor i `components/Map/layers.ts`. GeoJSON-källan är visualiserings-agnostisk; byt bara `map.addLayer({ type: ... })`.

| Typ             | Använd när |
|-----------------|------------|
| `circle`        | MVP-default — enkel, läsbar på alla zoom-nivåer |
| `heatmap`       | När du vill visa täthet i regioner |
| `fill-extrusion`| 3D, kräver att du aggregerar till polygoner (hex-grid) först |
| `line`          | Färgade vägsegment — kräver map-matching mot NVDB/OSM först |

Kim tar beslut om definitiv visualisering när riktig data flödar in.

## Deploy till Vercel

1. Import repo i Vercel dashboard
2. Root directory: `web`
3. Framework: Next.js (autodetekteras)
4. Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GRAPHHOPPER_BASE_URL`, `GRAPHHOPPER_TOKEN`, samt ev. `NOMINATIM_*` och `OSRM_*` för dedikerade providers
5. Deploy

Routingdrift dokumenteras i `docs/routing-ops.md`.
