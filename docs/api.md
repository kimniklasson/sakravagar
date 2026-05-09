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

Returnerar ÅDT-data via `adt_in_bbox`. Används för blått, icke-klickbart flödeslager och risknormalisering.

## TrafficFlow

`GET /api/traffic-flow`

Query:

- `bbox` krävs.

Returnerar aktiva Trafikverket TrafficFlow-mätningar snappade till närmaste vägsegment. Täckning är bäst i Stockholm/Göteborg.

## Disturbances

`GET /api/disturbances?bbox=minLng,minLat,maxLng,maxLat`

Query:

- `bbox` krävs.

Returnerar aktiva vägarbeten, köer och trafikstörningar från `disturbances_public` inom angiven bbox. Separat från olyckshistorik.

## Large roads

`GET /api/large-roads`

Query:

- `bbox` krävs.

Returnerar high-speed-segment från `large_roads_in_bbox`. Kartlagret visar badges för 80 km/h och högre, medan routeplannerns high-speed-score fortsatt räknar 90+ km/h-exponering.

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
- `avoidScores` för `accidentHistory`, `highSpeed`, `trafficIntensity`, `disturbances`, `bridges` och `tunnels`

GraphHopper-kandidater:

1. Snabbaste rutten.
2. Alternativa snabbaste rutter när filter är aktiva.
3. Filterstyrda custom model-kandidater:
   - `highSpeed` sänker prioritet för motorväg/trunk och höga hastigheter.
   - `trafficIntensity` sänker prioritet för trafikintensiva ÅDT-segment och aktiva liveflödessegment med tät/långsam trafik.
   - `bridges`/`tunnels` sänker prioritet för GraphHoppers `road_environment`-värden `BRIDGE` och `TUNNEL`.
   - `accidentHistory` skapar penalty zones runt risksegment i baseline-korridoren.
   - `disturbances` skapar penalty zones runt aktiva störningspunkter i baseline-korridoren.

Olyckshistorik, trafikintensiva vägar, störningar, broar och tunnlar påverkar GraphHoppers vägkostnad när GraphHopper-env finns. Bro-/tunnelexponering räknas från GraphHopper `road_environment` path details, medan övriga filter även poängsätts efteråt för ranking, exponeringstext och jämförelse mot snabbaste rutt.

Performancebudget:

- Snabbaste rutt/icke-filtrerad routing ska normalt kännas klar inom 0-4 sekunder och timeoutar server-side efter 20 sekunder.
- Filtrerade alternativ ska normalt kännas klara inom 0-12 sekunder, kan visa mjuk väntinfo efter 12 och 30 sekunder, och timeoutar server-side efter 55 sekunder.
- `/api/route` sätter `maxDuration = 60` så appens egna timeout hinner svara före Vercels hårda gräns.
- Timeoutfel returnerar 504 med användarcopy som föreslår att prova senare, kortare resa eller färre undvik-val.

## Segment

`GET /api/segment`

Returnerar `segment_detail(p_fid)` för popup. Popup och risklager ska använda samma dedup-definition så kartfärg och detaljvy inte säger olika saker.
