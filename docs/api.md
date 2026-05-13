# API routes

Kort kontrakt för interna Next.js API-rutter i `web/app/api`. Alla svar är JSON om inget annat anges.

## Generella regler

- Tunga kartendpoints kräver `bbox` i formatet `minLng,minLat,maxLng,maxLat`.
- Bboxar valideras mot area och `SWEDEN_DATA_BOUNDS` innan Supabase/RPC anropas.
- SQL/RPC ska ha limit eller annan spärr. Klientens zoomlogik räcker inte som skydd.
- Publika svar ska inte exponera råa upstream-payloads.
- Supabase-fel loggas serverside och returneras som generiskt `server error`.

## Kartdata

| Endpoint | Query | Returnerar | Cache |
| --- | --- | --- | --- |
| `GET /api/events` | `bbox`, ev. `live=1`, ev. `since` | Dedupade olyckspunkter från `events_in_bbox` | 30 s |
| `GET /api/events/stats` | - | datafönster och färskhet för UI-copy | 30 s |
| `GET /api/risk` | `bbox` | deduplicerad segmentrisk via `risk_in_bbox` | 600 s |
| `GET /api/adt` | `bbox` | ÅDT-segment via `adt_in_bbox` | 24 h |
| `GET /api/traffic-flow` | `bbox` | aktiva TrafficFlow-mätningar snappade till segment | 20 s |
| `GET /api/disturbances` | `bbox` | aktiva vägarbeten/köer/störningar via `disturbances_in_bbox` | 30 s |
| `GET /api/large-roads` | `bbox` | höghastighetssegment för 80+-badges | 24 h |
| `GET /api/segment` | `fid` | `segment_detail(p_fid)` för popup | 1 h |

Pågående olycka definieras som `last_seen >= now() - 90 min`. `/api/events` dedupar kartpunkter innan visualisering; snappade events använder samma logiska regel som risk/popup: `fid + message + road_number + first_seen-hour`.

Risklinjer och segmentpopup är pausade i UI tills olycksunderlaget är större. `/api/risk` och `/api/segment` finns kvar för framtida återaktivering och intern verifiering.

## Geocode

`GET /api/geocode`

Lägen:

- Search: textquery till Nominatim med Sverige-bounds, svensk `Accept-Language`, kortetiketter och lokal rankning.
- Reverse: koordinater till läsbar plats.

Publik Nominatim är bara en MVP-default. Byt till dedikerad provider, self-host eller avtalad instans före större publik trafik.

## Route

`POST /api/route`

Body:

```json
{
  "coordinates": [[12.0, 57.0], [12.1, 57.1]],
  "avoid": {
    "highSpeed": true,
    "trafficIntensity": false,
    "cityTraffic": false,
    "bridges": false,
    "tunnels": false
  },
  "alternatives": 2,
  "maxExtraMinutes": null
}
```

Regler:

- `coordinates` kräver 2-10 svenska koordinater.
- `alternatives` clampas till 0-3.
- GraphHopper används när `GRAPHHOPPER_BASE_URL` finns; annars OSRM.

Svar:

- `routes[]` med geometri, tid, distans, `avoidScores`, `exposure` och `annotations`
- `avoid`
- `maxExtraMinutes`
- `provider`

Filter som påverkar GraphHopper custom model: `highSpeed`, `trafficIntensity`, `cityTraffic`, `bridges`, `tunnels`. Olyckor och störningar är route-notices/annotations, inte planeringsfilter.

Performance:

- `maxDuration = 60` på Vercel.
- snabbaste/ofiltrerad routing timeoutar efter 20 s.
- filtrerade alternativ timeoutar efter 55 s.
- timeout returnerar `504` med användarcopy.

Observability-loggen innehåller filter, antal koordinatstopp, alternativ-count, tidsbudget, provider/fallback, total tid, provider-tid, scoring-tid, GraphHopper request-/timeout-counts, kandidatantal och antal rutter tillbaka. Den ska inte logga koordinater, adresser eller geometrier.

## Route shares

`POST /api/route-shares`

Skapar en public route snapshot och returnerar `slug`, `url` och `expiresAt`. Payloaden valideras och får vara max 300 kB. Delningslänkar pekar på `/r/[slug]` och har 30 dagars TTL.

`GET /api/route-shares?slug=...`

- `200` med `payload` och `expiresAt` när länken finns och är giltig.
- `404` om sluggen inte finns.
- `410` om länken har gått ut.

Direkt tabellåtkomst är inte publik; API:t går via Supabase RPC.

## Route feedback

`POST /api/route-feedback`

Skapar en feedbackröst (`up`/`down`) och sparar en privat route snapshot med metadata. Returnerar feedback-id och snapshot-expiry. Feedback-snapshots har 90 dagars TTL.

`DELETE /api/route-feedback?id=...`

Tar bort en feedbackröst när användaren klickar på samma tumme igen.

Feedback är batchunderlag för routingkalibrering och ska inte påverka routing automatiskt i MVP-flödet.

Feedback-id fungerar som en kortlivad capability för att ta bort rösten från samma klientflöde. Write-RPC:erna körs server-side med service-role; direkt anonym RPC-write är stängd.
