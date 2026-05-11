# Routing ops

Driftanteckningar för self-hostad routing i Säkravägar. Läs tillsammans med `docs/current-state.md` för nuläge och `docs/decisions.md` för varför GraphHopper valdes.

## Översikt

Routingkedjan:

```text
Next.js /api/route
  -> https://routing.sakravagar.se
  -> Caddy reverse proxy
  -> GraphHopper på localhost:8989
```

Publik app anropar aldrig GraphHopper direkt från browsern. All trafik går via Next.js API-rutten, som skickar `X-Routing-Token` till routingservern.

## Infrastruktur

- Server: Hetzner CPX32, Ubuntu 24.04.
- IPv4: `116.203.135.46`.
- Domän: `routing.sakravagar.se`.
- Legacy-domän under övergång: `routing.xn--skravgar-0zae.se`.
- GraphHopper: `/opt/graphhopper/graphhopper-web-11.0.jar`.
- OSM-data: `/opt/graphhopper/data/sweden-latest.osm.pbf`.
- Graph-cache: `/opt/graphhopper/graph-cache`.
- Systemd: `graphhopper.service`.
- Reverse proxy: `caddy.service`.
- Tokenfil på servern: `/root/routing-token.txt`.

Tokenvärdet ska inte in i chat, loggar eller repo.

## Vercel env

Production behöver:

```sh
GRAPHHOPPER_BASE_URL=https://routing.sakravagar.se
GRAPHHOPPER_TOKEN=<värdet från serverns /root/routing-token.txt>
```

Utan dessa variabler faller `web/app/api/route/route.ts` tillbaka till OSRM. Det är bra som utvecklingsfallback, men lokala tester matchar då inte production-routing.

## Snabb hälsokoll

Utan token ska endpointen inte avslöja GraphHopper:

```sh
curl -i https://routing.sakravagar.se/info
```

Förväntat: `404`.

Med token ska GraphHopper svara:

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt')
curl -i -H "X-Routing-Token: $TOKEN" https://routing.sakravagar.se/info
```

Förväntat: `200`.

## Lokal dev som matchar production

```sh
TOKEN=$(ssh root@116.203.135.46 'cat /root/routing-token.txt') \
GRAPHHOPPER_BASE_URL='https://routing.sakravagar.se' \
GRAPHHOPPER_TOKEN="$TOKEN" \
pnpm web
```

Testa sedan rutter via UI:t eller `POST /api/route`. Kända smoke test-sträckor:

- Floda -> Rönnäng: `Höga hastigheter` bör kunna välja en lugnare kandidat än snabbaste rutten.
- Floda -> Göteborg: ska returnera snabb kandidat och calm-kandidat när GraphHopper-env finns.

## GraphHopper custom models

`POST /api/route` hämtar snabbaste GraphHopper-rutten som baseline och, när `Undvik om möjligt` är aktivt, fler kandidater med custom models. Aktiva planeringsfilter är:

- `highSpeed` — sänker prioritet för motorväg/trunk och höga hastigheter, främst 90+.
- `trafficIntensity` — sänker prioritet för trafikintensiva ÅDT-segment och aktiva liveflödessegment med tät/långsam trafik.
- `cityTraffic` — sänker prioritet i statiska stadszoner, särskilt större/högre hastighetsleder.
- `bridges` / `tunnels` — sänker prioritet för GraphHoppers `road_environment == BRIDGE` respektive `TUNNEL`.

Olyckor och störningar är inte GraphHopper-filter längre. De följer med ruttsvaret som notices/annotations.

Custom models kräver:

```json
{
  "ch.disable": true
}
```

Om `ch.disable` saknas kan GraphHopper ignorera custom model eller svara med fel, beroende på profil/cache. Snabbaste baseline kan däremot använda CH.

## Bygga om graph-cache

Gör detta efter byte av OSM-fil eller större GraphHopper-configändring.

```sh
ssh root@116.203.135.46
systemctl stop graphhopper
mv /opt/graphhopper/graph-cache /opt/graphhopper/graph-cache.backup.$(date +%Y%m%d-%H%M)
systemctl start graphhopper
journalctl -u graphhopper -f
```

Första requesten eller starten bygger cache igen. För Sverige har importen hittills tagit några minuter och peakade runt 3.1 GB RAM.

## Uppdatera OSM-data

1. Ladda ned ny Sverige-PBF från Geofabrik till `/opt/graphhopper/data/`.
2. Stoppa `graphhopper.service`.
3. Flytta undan gamla `graph-cache`.
4. Starta `graphhopper.service`.
5. Följ `journalctl -u graphhopper -f`.
6. Kör hälsokoll med token.
7. Smoke-testa en riktig rutt via appens `/api/route`.

## Brandvägg och exponering

UFW:

- Incoming default deny.
- Outgoing allow.
- Publikt öppna portar: `22`, `80`, `443`.
- GraphHopper-port `8989` ska bara lyssna på localhost.

Caddy ska endast proxya requests med rätt `X-Routing-Token`. Requests utan token ska ge `404`, inte GraphHopper-fel.

## Felsökning

| Symptom | Trolig orsak | Kolla |
| --- | --- | --- |
| `/api/route` använder OSRM lokalt | GraphHopper-env saknas | Starta med `GRAPHHOPPER_BASE_URL` och `GRAPHHOPPER_TOKEN` |
| `routing.../info` utan token ger `200` | Caddy-regel läcker | Caddyfile och reload |
| `routing.../info` med token ger `404` | Fel token/header eller Caddy-regel | Tokenfil, Vercel env, Caddy logs |
| Custom model påverkar inte rutten | CH inte disabled eller OSRM-fallback används | Request body ska ha `ch.disable: true`; kontrollera GraphHopper-env |
| GraphHopper startar långsamt | Cache byggs om | `journalctl -u graphhopper -f` |
| Servern svarar inte på HTTPS | Caddy/cert/DNS | `systemctl status caddy`, Cloudflare DNS-only för `routing` |

## Relaterade filer

- `web/app/api/route/route.ts` — routingproxy, kandidater och avoidScores.
- `web/components/Map/Map.tsx` — routeplanner-state och filterranking i UI:t.
- `web/components/Map/layers.ts` — ruttlinjer på kartan.
- `docs/decisions.md` — ADR för GraphHopper/Hetzner.
