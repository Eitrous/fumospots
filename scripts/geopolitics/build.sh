#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_ROOT="$REPO_ROOT/map-data/geopolitics"
GENERATED_ROOT="$DATA_ROOT/generated"
DIST_ROOT="$DATA_ROOT/dist"
PUBLIC_ARCHIVE="$REPO_ROOT/public/map-assets/geopolitics.pmtiles"
TIPPECANOE="${TIPPECANOE_BIN:-$(command -v tippecanoe || true)}"
PMTILES="${PMTILES_BIN:-$(command -v pmtiles || true)}"

if [[ -z "$TIPPECANOE" ]]; then
  echo "Tippecanoe is required. Install it or set TIPPECANOE_BIN." >&2
  exit 1
fi

TIPPECANOE_DECODE="${TIPPECANOE_DECODE_BIN:-$(dirname "$TIPPECANOE")/tippecanoe-decode}"
if [[ ! -x "$TIPPECANOE_DECODE" ]]; then
  echo "tippecanoe-decode is required next to Tippecanoe, or set TIPPECANOE_DECODE_BIN." >&2
  exit 1
fi

mkdir -p "$GENERATED_ROOT" "$DIST_ROOT" "$(dirname "$PUBLIC_ARCHIVE")"

node "$REPO_ROOT/scripts/geopolitics/fetch.mjs"
node "$REPO_ROOT/scripts/geopolitics/normalize.mjs"
node "$REPO_ROOT/scripts/geopolitics/validate.mjs"

"$TIPPECANOE" \
  --quiet \
  --force \
  --output "$DIST_ROOT/geopolitics.pmtiles" \
  --minimum-zoom 0 \
  --maximum-zoom 12 \
  --projection EPSG:4326 \
  --buffer 8 \
  --no-feature-limit \
  --no-tile-size-limit \
  --name "Fumo Geopolitics (CN worldview)" \
  --description "National, first-level, disputed, and political-label layers for the CN worldview" \
  --attribution "Natural Earth" \
  -L "admin0_boundary:$GENERATED_ROOT/admin0_boundary.geojson" \
  -L "admin1_boundary:$GENERATED_ROOT/admin1_boundary.geojson" \
  -L "disputed_boundary:$GENERATED_ROOT/disputed_boundary.geojson" \
  -L "maritime_boundary:$GENERATED_ROOT/maritime_boundary.geojson" \
  -L "country_label:$GENERATED_ROOT/country_label.geojson" \
  -L "region_label:$GENERATED_ROOT/region_label.geojson" \
  -L "official_place_label:$GENERATED_ROOT/official_place_label.geojson"

if [[ -n "$PMTILES" ]]; then
  "$PMTILES" verify "$DIST_ROOT/geopolitics.pmtiles"
  "$PMTILES" show "$DIST_ROOT/geopolitics.pmtiles" --metadata
fi

node "$REPO_ROOT/scripts/geopolitics/verify-pmtiles.mjs" \
  "map-data/geopolitics/dist/geopolitics.pmtiles" \
  "$TIPPECANOE_DECODE"
cp "$DIST_ROOT/geopolitics.pmtiles" "$PUBLIC_ARCHIVE"

echo "Built $PUBLIC_ARCHIVE"
