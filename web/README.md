# web

Next.js App Router + MapLibre GL. Läser events från Supabase via `/api/events`.

## Köra lokalt

```sh
cp .env.example .env.local
# fyll i SUPABASE_URL och SUPABASE_ANON_KEY
pnpm install
pnpm --filter @trafik/web run dev
# öppna http://localhost:3000
```

## Struktur

```
web/
├── app/
│   ├── layout.tsx            # root layout
│   ├── page.tsx              # huvudsida (laddar Map dynamiskt, ssr:false)
│   ├── page.module.css
│   └── api/events/route.ts   # bbox/since-query mot Supabase
├── components/
│   └── Map/
│       ├── Map.tsx           # MapLibre-init ('use client')
│       ├── Map.module.css
│       └── layers.ts         # GeoJSON-source + visualiserings-layer
├── lib/
│   ├── supabase.ts           # (tom placeholder)
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
4. Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
5. Deploy
