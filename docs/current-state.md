# Current state — 2026-04-24 (sen eftermiddag)

Körbar sammanfattning för att fortsätta i ny session. Läs denna + `PROJECT.md` + `docs/decisions.md` för full kontext.

## Vad som är klart

- ✅ Monorepo scaffoldat (`scraper/`, `web/`, `shared/`, `db/`)
- ✅ Supabase-projekt uppsatt (North EU / Stockholm)
- ✅ PostGIS aktiverat, schema applicerat (`db/migrations/0001_init.sql`)
- ✅ Trafikverket-nyckel `trafik-prod` skapad och i `.env`
- ✅ **Scrapern funkar end-to-end** — hämtar Deviations och upsertar till Supabase (`fetched: 3, upserted: 3`, ~1 s första körningen, ~300 ms andra)

## Lösningen på Trafikverket-400

Problemet var att `objecttype="Situation"` inte existerar utan **namespace**. Korrekt query:

```xml
<QUERY objecttype="Situation" namespace="Road.TrafficInfo" schemaversion="1.6" limit="1000">
  <FILTER>
    <EQ name="Deviation.MessageType" value="Olycka" />
  </FILTER>
</QUERY>
```

Två saker måste vara rätt:
- `namespace="Road.TrafficInfo"` — utan detta svarar API:et att objekttypen inte existerar
- `schemaversion="1.6"` — aktuell version (var 1.2/1.5 i våra tidigare försök)

Detta hittades genom att Kim öppnade datamodellen på data.trafikverket.se och såg "Namespace: Road.TrafficInfo" samt versionsdropdown på 1.6.

## Gotcha (löst)

Filtret `EQ name="Deviation.MessageType" value="Olycka"` matchar hela **Situationer** där minst en Deviation är en Olycka. Andra Deviations i samma Situation (t.ex. `Trafikmeddelande`) följer med i svaret.

**Lösning:** Scrapern filtrerar nu bort icke-`Olycka` Deviations klientsidan i `fetchDeviations` (scraper/src/trafikverket.ts). Bara rena olyckor hamnar i databasen.

**En gammal Trafikmeddelande-rad finns kvar i Supabase** från körningen innan filtret infördes — rensa med `DELETE FROM events WHERE raw->>'MessageType' <> 'Olycka'` eller manuellt i UI:t.

## Nästa steg

1. **Rensa gammal Trafikmeddelande-rad** i Supabase (se Gotcha).
2. **GitHub Actions** — publikt repo, pusha, sätt secrets (`TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), trigga workflow manuellt.
3. **Vercel-koppling** — `web/` som root, env `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
4. **Låt cron rulla 2-3 dagar** och verifiera att tabellen växer rimligt.
5. **MVP-heatmap** — enklaste möjliga MapLibre-karta som läser från `events_public`-vyn och ritar heatmap-lager.

## Filer att känna till

| Fil | Vad |
|-|-|
| `scraper/src/trafikverket.ts` | Query-XML byggs här. Nu uppdaterad med namespace + 1.6. |
| `scraper/src/index.ts` | Orchestrator, upsert till Supabase. |
| `.env` (rooten, ej committad) | `TRAFIKVERKET_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` |
| `db/migrations/0001_init.sql` | Events-tabell + `events_public`-vy. |
