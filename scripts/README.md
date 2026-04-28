# scripts

Sällan-körda verktyg. Inte del av scraper- eller web-koden.

## `import-nvdb.sh` — importera NVDB-paket från Lastkajen

Laddar ett GPKG-paket från Lastkajen (ÅDT + Vägtrafiknät + TSK mm) in i Supabase PostGIS.

### Engångs-setup

1. **Installera GDAL:**
   ```sh
   brew install gdal
   ```

2. **Lägg till `DATABASE_URL` i `.env`** — den direkta Postgres-strängen, inte Supabase-REST:
   - Supabase dashboard → Project Settings → **Database** → Connection string
   - Välj **"Session pooler"** (port 5432, URI-format). Transaction pooler funkar *inte* för bulk-import eftersom `COPY` kräver session-nivå.
   - Kopiera strängen, byt ut `[YOUR-PASSWORD]` mot databaslösenordet.
   - Formatet: `postgresql://postgres.<ref>:<password>@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`

### Köra importen

```sh
set -a && . .env && set +a
./scripts/import-nvdb.sh ~/Downloads/sakravagar_bas_2026_04.gpkg
```

Scriptet:
1. Listar alla lager i GPKG
2. Importerar varje lager till en tabell `nvdb_<lagernamn>` i `public`-schemat
3. Använder `PG_USE_COPY` för snabb bulk-insert

Förväntad körtid: några minuter för hela Sverige.

### Efter import

Lager som kommer in blir typiskt:
- `nvdb_trafik` — ÅDT per vägsegment
- `nvdb_trafiksakerhetsklass_stracka_bil` — TSK-klassning
- `nvdb_vagtrafiknat` — vägnätets topologi

**Nästa steg** efter första importen: inspektera kolumnerna (`\d nvdb_trafik` i psql eller Supabase Table Editor) och skriv `db/migrations/0002_nvdb.sql` som:
- Lägger till GIST-index på geom-kolumnerna
- Skapar en vy eller materialiserad vy som joinar olycksevent mot närmaste vägsegment
- Ev. normaliserar kolumnnamn om Lastkajens namngivning är obekväm

### Varför en engångs-import och inte polling?

ÅDT uppdateras årligen. Vägnätet ändras sällan. Ingen poäng att polla — vi kör `import-nvdb.sh` en gång per år när nya mätdata släppts.

## `import-large-roads.sh` — importera trygghetsfiltret "Stora vägar"

Importerar bara de rader som behövs från Lastkajen-paketet `sakravagar_filter_*.gpkg`:

- `Hastighetsgräns` där hastighet är 90 km/h eller högre
- `Vägtyp` där typen är `Motorväg`, `Motortrafikled`, `Motortrafikled mötesfri`, `4-fältsväg` eller `Vanlig väg mötesfri`

Detta undviker att hela hastighetslagret på ~2,2 miljoner rader hamnar i Supabase.

```sh
set -a && . .env && set +a
./scripts/import-large-roads.sh /Users/kimniklasson/Documents/sakravagar_filter_Geopackage_253085/sakravagar_filter_253085.gpkg
```

Efter import:

```sh
/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0019_large_roads_filter.sql
```

Skapar:

- `nvdb_large_roads_speed`
- `nvdb_large_roads_type`
- `large_roads_public`
- RPC `large_roads_in_bbox(...)`
