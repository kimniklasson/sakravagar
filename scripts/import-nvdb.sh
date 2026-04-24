#!/usr/bin/env bash
# Importera NVDB-paket (GPKG från Lastkajen) till Supabase PostGIS.
# Körs sällan — en gång per ÅDT-release (årligen) eller när nya lager läggs till.
#
# Användning:
#   set -a && . .env && set +a
#   ./scripts/import-nvdb.sh /sökväg/till/paket.gpkg
#
# Krav:
#   - GDAL (ogrinfo, ogr2ogr):    brew install gdal
#   - DATABASE_URL i miljön       (Supabase: Project Settings → Database → Connection string → "Session pooler" eller "Direct connection")

set -euo pipefail

GPKG="${1:-}"

if [[ -z "$GPKG" ]]; then
  echo "Användning: $0 <sökväg till .gpkg>" >&2
  exit 1
fi

if [[ ! -f "$GPKG" ]]; then
  echo "Filen finns inte: $GPKG" >&2
  exit 1
fi

if ! command -v ogr2ogr >/dev/null; then
  echo "GDAL saknas. Installera: brew install gdal" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL är inte satt." >&2
  echo "Ladda .env först:  set -a && . .env && set +a" >&2
  exit 1
fi

echo "=== Lager i $GPKG ==="
ogrinfo -q "$GPKG"
echo ""

# Plocka ut lagernamn (strippar " (Line String)"-suffix)
mapfile -t layers < <(ogrinfo -q "$GPKG" | awk -F': ' '/^[0-9]+:/ {sub(/ \(.*/, "", $2); print $2}')

if [[ ${#layers[@]} -eq 0 ]]; then
  echo "Inga lager hittades i GPKG." >&2
  exit 1
fi

for layer in "${layers[@]}"; do
  target="nvdb_$(printf '%s' "$layer" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_' '_')"
  echo ""
  echo "=== Importerar '$layer' → tabell '$target' ==="
  ogr2ogr \
    -f PostgreSQL \
    "PG:$DATABASE_URL" \
    "$GPKG" "$layer" \
    -nln "$target" \
    -lco GEOMETRY_NAME=geom \
    -lco FID=fid \
    -lco OVERWRITE=YES \
    -lco PRECISION=NO \
    -nlt PROMOTE_TO_MULTI \
    --config PG_USE_COPY YES \
    -progress
done

echo ""
echo "Klart. Tabeller skapade i schemat 'public' med prefix 'nvdb_'."
echo "Nästa steg: inspektera kolumnerna och skriv db/migrations/0002_nvdb.sql (index, ev. renames, joins mot events)."
