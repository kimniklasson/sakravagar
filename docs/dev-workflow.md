# Dev workflow

Praktisk startguide för nya sessioner och nya utvecklare.

## Läsordning

1. `docs/current-state.md` — nuläge, gotchas och nästa fokus.
2. `PROJECT.md` — produktidé, validering och prioriteringar.
3. `docs/decisions.md` — långlivade tekniska vägval.
4. Relevant subsystem-README:
   - `web/README.md`
   - `db/README.md`
   - `scripts/README.md`

## Lokal start

```sh
corepack enable
pnpm install
cp .env.example .env
cp web/.env.example web/.env.local
pnpm web
```

Next startar normalt på `http://localhost:3000`. Om porten är upptagen väljer Next en annan port.

## Lokal start med production-routing

Använd detta när routeplanner-filter ska jämföras med production:

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') \
GRAPHHOPPER_BASE_URL='https://routing.sakravagar.se' \
GRAPHHOPPER_TOKEN="$TOKEN" \
pnpm web
```

Utan GraphHopper-env använder `/api/route` OSRM-fallback, vilket är bra för grundläggande UI-test men inte för kalibrering av trygghetsrouting.

## Vanliga verifieringar

```sh
pnpm --filter @trafik/web run lint
pnpm --filter @trafik/web run test
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

- `web/components/Map/Map.tsx` — MapLibre-init, orchestration och karta/UI-interaktion.
- `web/components/Map/hooks/` — extraherade Map-side-effects för MapLibre-livscykel, viewportmått, liveevent-summary, ruttstopp-sök och egna stoppmarkörer.
- `web/components/Map/RoutePlannerBox.tsx` — Från/Till, geocoding-resultat och undvik-pills.
- `web/components/Map/RouteAlternativesTray.tsx` — ruttkort, delning, Google Maps och feedback.
- `web/components/Map/routeModel.ts` — klientranking, labels och session-cache.
- `web/components/Map/routeSharing.ts` — route snapshot-payloads, feedback-payloads och externa ruttlänkar.
- `web/components/Map/layers.ts` — tunn export-yta för MapLibre-lager.
- `web/components/Map/layers/` — ruttlager, ÅDT, höga hastigheter, vilande risk, olyckor/live, störningar/trafikflöde, bbox-loader och popup.
- `web/lib/routeTypes.ts` — delade ruttsvarstyper för API och klient.
- `web/app/api/route/route.ts` — request handler, deadline/logging och response mapping för routing.
- `web/app/api/route/_routing/` — rena routinghjälpare för typer, request parsing, timeout, telemetry, geometri, custom models, provider-anrop, provider-fanout, route-detaljer, dedupe, hybridkandidater, scoring och high-speed selection.
- `db/migrations/` — schema, RPC:er, grants och cron.
- `supabase/functions/scrape/index.ts` — production-scraper.
