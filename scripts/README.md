# scripts

Sällan-körda verktyg för Lastkajen/NVDB-importer. De är inte del av webben eller den löpande Trafikverket-scrapen.

## `import-nvdb.sh` — importera NVDB/ÅDT-paket från Lastkajen

Importerar ett GPKG-paket från Lastkajen till Supabase PostGIS. Används främst för ÅDT och vägnät som underlag till flöde/risk.

### Engångs-setup

1. Installera GDAL:

   ```sh
   brew install gdal
   ```

2. Lägg till `DATABASE_URL` i `.env`. Använd Supabase session pooler på port `5432`, inte transaction pooler `6543`, eftersom bulkimport använder `COPY`.

### Köra importen

```sh
set -a && . .env && set +a
./scripts/import-nvdb.sh ~/Downloads/sakravagar_bas_2026_04.gpkg
```

Scriptet listar lager i GPKG-filen och importerar varje lager som `nvdb_<lagernamn>` i `public`-schemat med `PG_USE_COPY`.

Efter import ska relevanta migrations/RPC:er finnas applicerade, framför allt ÅDT-/riskkedjan i `db/migrations/0002_*.sql` och framåt. TSK-spåret är borttaget ur UI/dataflödet via `0016_remove_tsk.sql`.

## `import-large-roads.sh` — importera höghastighetsunderlag

Importerar bara de rader som behövs från Lastkajen-paketet `sakravagar_filter_*.gpkg`:

- `Hastighetsgräns` där hastighet är 80 km/h eller högre
- `Vägtyp` där typen är `Motorväg`, `Motortrafikled`, `Motortrafikled mötesfri`, `4-fältsväg` eller `Vanlig väg mötesfri`

Detta undviker att hela hastighetslagret på cirka 2,2 miljoner rader hamnar i Supabase.

```sh
set -a && . .env && set +a
./scripts/import-large-roads.sh /sökväg/till/sakravagar_filter_253085.gpkg
```

Efter import:

```sh
/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0025_high_speed_badges_80.sql
```

Skapar/uppdaterar:

- `nvdb_large_roads_speed`
- `nvdb_large_roads_type`
- `large_roads_public`
- RPC `large_roads_in_bbox(...)`
