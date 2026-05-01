# API routes

Kort kontrakt för interna Next.js API-rutter i `web/app/api`. Alla svar är JSON om inget annat anges.

## Generella regler

- Tunga kartendpoints ska kräva `bbox`.
- Bbox-format: `minLng,minLat,maxLng,maxLat`.
- API-rutter ska validera bbox-area på serversidan.
- SQL/RPC ska också ha limit eller annan spärr. Klientens zoomlogik räcker inte som skydd.
- Publika svar ska inte exponera `events.raw`.

## Events

`GET /api/events`

Query:

- `bbox` krävs.
- `live=1` returnerar bara pågående olyckor.
- `since` kan användas för tidsfilter.

Användning:

- Historiska olyckspunkter/heatmap.
- Liveboxens Sverige-count via hel-Sverige-bbox + `live=1`.

Pågående olycka definieras som `last_seen >= now() - 90 min`.

## Event stats

`GET /api/events/stats`

Returnerar datafönster och färskhet för UI-copy.

## Risk

`GET /api/risk`

Query:

- `bbox` krävs.

Returnerar deduplicerad risk per vägsegment via `risk_in_bbox`.

Riskregeln ska matcha popupen: dedup per `fid + message + road_number + first_seen-hour`.

## ADT / flöde

`GET /api/adt`

Query:

- `bbox` krävs.

Returnerar ÅDT-data via `adt_in_bbox`. Används för blått flödeslager och risknormalisering.

## TrafficFlow

`GET /api/traffic-flow`

Query:

- `bbox` krävs.

Returnerar aktiva Trafikverket TrafficFlow-mätningar snappade till närmaste vägsegment. Täckning är bäst i Stockholm/Göteborg.

## Disturbances

`GET /api/disturbances`

Query:

- `bbox` krävs.

Returnerar aktiva vägarbeten, köer och trafikstörningar från `disturbances_public`. Separat från olyckshistorik.

## Large roads

`GET /api/large-roads`

Query:

- `bbox` krävs.

Returnerar hastighets-/stora-vägar-segment från `large_roads_in_bbox`, främst för `Höga hastigheter (90+)`.

## Geocode

`GET /api/geocode`

Lägen:

- Search: textquery till Nominatim med Sverige-bounds och svensk `Accept-Language`.
- Reverse: koordinater till läsbar plats.

Backend kortar etiketter och rankar resultat efter matchning mot den visade etiketten.

Publik Nominatim är bara en MVP-default. Byt till dedikerad provider, self-host eller avtalad instans före större publik trafik.

## Route

`GET /api/route`

Används av routeplanner. Använder GraphHopper när `GRAPHHOPPER_BASE_URL` finns och OSRM som fallback annars.

Returnerar:

- ruttkandidater
- primär geometri
- tid/distans
- `avoidScores` för `accidentHistory`, `highSpeed` och `disturbances`

GraphHopper-kandidater:

1. Snabbaste rutten.
2. Calm-kandidat med custom model för bland annat motorväg, trunk och höga hastigheter.

Olyckshistorik och störningar påverkar i dag efterhandsrankning. Nästa routingsteg är att flytta dem närmare GraphHopper-kostnaden via custom areas/penalty zones.

## Segment

`GET /api/segment`

Returnerar `segment_detail(p_fid)` för popup. Popup och risklager ska använda samma dedup-definition så kartfärg och detaljvy inte säger olika saker.
