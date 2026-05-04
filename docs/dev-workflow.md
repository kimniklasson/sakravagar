# Dev workflow

Praktisk startguide för nya sessioner och nya utvecklare.

## Läsordning

1. `docs/current-state.md` — nuläge, gotchas och nästa fokus.
2. `PROJECT.md` — produktidé, validering och prioriteringar.
3. `docs/decisions.md` — långlivade tekniska vägval.
4. Relevant subsystem-README:
   - `web/README.md`
   - `db/README.md`
   - `scraper/README.md`
   - `scripts/README.md`

## Lokal start

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm web
```

Next startar normalt på `http://localhost:3000`. Om porten är upptagen väljer Next en annan port.

## Lokal start med production-routing

Använd detta när routeplanner-filter ska jämföras med production:

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') \
GRAPHHOPPER_BASE_URL='https://routing.xn--skravgar-0zae.se' \
GRAPHHOPPER_TOKEN="$TOKEN" \
pnpm web
```

Utan GraphHopper-env använder `/api/route` OSRM-fallback, vilket är bra för grundläggande UI-test men inte för kalibrering av trygghetsrouting.

## Vanliga verifieringar

```sh
pnpm --filter @trafik/web run lint
pnpm --filter @trafik/web run typecheck
pnpm -r run typecheck
```

Kör `pnpm --filter @trafik/web run build` när ändringen påverkar Next-konfiguration, API-rutter, server/client-boundaries eller deployrisk.

Kör inte `next build` samtidigt som `next dev` är igång om `.next` börjar bete sig konstigt.

## Ruttplanerar-smoke tests

- Floda -> Rönnäng: `Höga hastigheter` ska kunna välja en lugnare kandidat än snabbaste rutten.
- Floda -> Göteborg: GraphHopper ska ge både snabb och calm-kandidat när env finns.
- GPS-knappen kräver secure context. Vanlig lokal HTTP kan ge browser-varning; production HTTPS ska fungera.

## Dokumentationsregel

När ett beteende ändras:

- Uppdatera `docs/current-state.md` om det påverkar nuläge, gotchas eller nästa fokus.
- Uppdatera `docs/decisions.md` om valet är långlivat och icke-trivialt.
- Uppdatera subsystem-README om en utvecklare annars skulle starta, deploya eller felsöka fel.

## Viktiga ytor

- `web/components/Map/Map.tsx` — UI-state, routeplanner, livebox och interaktion.
- `web/components/Map/layers.ts` — MapLibre-källor/lager, bbox-laddning och popup.
- `web/app/api/route/route.ts` — GraphHopper/OSRM, kandidater och `avoidScores`.
- `db/migrations/` — schema, RPC:er, grants och cron.
- `supabase/functions/scrape/index.ts` — production-scraper.
- `scraper/` — lokal/manuell Node-scraper.
