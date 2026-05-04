#!/usr/bin/env bash
# Importera bara de Lastkajen-lager/rader som behövs för filtret "Höga hastigheter".
#
# Importen är medvetet smal:
# - Hastighetsgräns: bara 80 km/h och uppåt
# - Vägtyp: motorväg, motortrafikled, 4-fältsväg och mötesfri vanlig väg
#
# Användning:
#   set -a && . .env && set +a
#   ./scripts/import-large-roads.sh /sökväg/till/sakravagar_filter_253085.gpkg

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

echo "=== Importerar Hastighetsgräns >= 80 → nvdb_large_roads_speed ==="
ogr2ogr \
  -f PostgreSQL \
  "PG:$DATABASE_URL" \
  "$GPKG" \
  -sql "select id, ELEMENT_ID as element_id, cast(Hogsta_tillatna_hastighet as integer) as speed_limit, EXTENT_LENGTH as length_m, geom from NVDB_DK_O_48_Hastighetsgrans where cast(Hogsta_tillatna_hastighet as integer) >= 80" \
  -nln "nvdb_large_roads_speed" \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  -lco OVERWRITE=YES \
  -lco PRECISION=NO \
  -nlt PROMOTE_TO_MULTI \
  --config PG_USE_COPY YES \
  -progress

echo ""
echo "=== Importerar valda Vägtyp-rader → nvdb_large_roads_type ==="
ogr2ogr \
  -f PostgreSQL \
  "PG:$DATABASE_URL" \
  "$GPKG" \
  -sql "select id, ELEMENT_ID as element_id, Typ as road_type, Korfaltsbeskrivning as lane_description, EXTENT_LENGTH as length_m, geom from VIS_DK_O_15_Vagtyp where Typ in ('Motorväg','Motortrafikled','Motortrafikled mötesfri','4-fältsväg','Vanlig väg mötesfri')" \
  -nln "nvdb_large_roads_type" \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  -lco OVERWRITE=YES \
  -lco PRECISION=NO \
  -nlt PROMOTE_TO_MULTI \
  --config PG_USE_COPY YES \
  -progress

echo ""
echo "Klart. Kör därefter migration 0019_large_roads_filter.sql i Supabase."
