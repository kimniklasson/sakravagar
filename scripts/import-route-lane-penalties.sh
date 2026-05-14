#!/usr/bin/env bash
# Importera reducerat NVDB-underlag för ruttfiltren "Stora rondeller" och
# "Flerfiligt". Scriptet importerar inte hela Lastkajen-paketet, utan bara de
# segment som behövs som straffzoner i routing.
#
# Användning:
#   set -a && . .env && set +a
#   ./scripts/import-route-lane-penalties.sh /sökväg/till/korfalt_rondell_294765.gpkg

set -euo pipefail

GPKG="${1:-}"

if [[ -z "$GPKG" ]]; then
  echo "Användning: $0 <sökväg till korfalt_rondell_*.gpkg>" >&2
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

echo "=== Importerar flerfiliga segment → route_multilane_segments ==="
ogr2ogr \
  -f PostgreSQL \
  "PG:$DATABASE_URL" \
  "$GPKG" \
  -overwrite \
  -dim XY \
  -dialect SQLite \
  -sql "select id as source_id, ELEMENT_ID as element_id, Korfaltsantal as lane_count, EXTENT_LENGTH as length_m, geom from NVDB_DK_O_105_Antal_korfalt2 where Korfalt_i_vagens_bakriktning like '%;%' or Korfalt_i_vagens_framriktning like '%;%'" \
  -nln "route_multilane_segments" \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  -lco PRECISION=NO \
  -nlt PROMOTE_TO_MULTI \
  --config PG_USE_COPY YES \
  -progress

echo ""
echo "=== Importerar stora rondeller → route_large_roundabouts ==="
ogr2ogr \
  -f PostgreSQL \
  "PG:$DATABASE_URL" \
  "$GPKG" \
  -overwrite \
  -dim XY \
  -dialect SQLite \
  -sql "select c.id as source_id, c.ELEMENT_ID as element_id, max(k.Korfaltsantal) as lane_count, c.EXTENT_LENGTH as length_m, c.geom from NVDB_DK_O_11_Cirkulationsplats c join NVDB_DK_O_105_Antal_korfalt2 k on c.ELEMENT_ID = k.ELEMENT_ID where k.Korfaltsantal >= 2 group by c.id" \
  -nln "route_large_roundabouts" \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  -lco PRECISION=NO \
  -nlt PROMOTE_TO_MULTI \
  --config PG_USE_COPY YES \
  -progress

echo ""
echo "Klart. Kör därefter migration 0032_route_lane_penalties.sql i Supabase."
