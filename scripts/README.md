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
