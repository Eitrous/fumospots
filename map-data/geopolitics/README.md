# Geopolitics PMTiles

This directory owns the map's political geography independently from the
Protomaps basemap. The active worldview is `CN`.

The generated archive contains these vector source layers:

- `admin0_boundary`: globally complete national boundaries
- `admin1_boundary`: globally complete first-level administrative boundaries
- `disputed_boundary`: claims, lines of control, and indefinite boundaries
- `maritime_boundary`: PRC-view maritime indicators
- `country_label`: globally complete country labels
- `region_label`: first-level and special-region labels
- `official_place_label`: reviewed political-view locality overrides

Source archives are downloaded into the ignored `.cache/` directory and are
verified against `manifest.json`. Generated GeoJSON and build reports are also
ignored. The deployable archive is copied to
`public/map-assets/geopolitics.pmtiles`. When no external archive URL is
configured, the map reads it through `/api/map/geopolitics.pmtiles`, whose
single-range response keeps PMTiles requests small in the Node preview server.
Production deployments may instead set `NUXT_PUBLIC_GEOPOLITICS_PM_TILES_URL`
to a Range-capable object-storage or CDN URL.

Build with:

```bash
pnpm map:geopolitics:build
```

The build requires Tippecanoe 2.17 or newer together with
`tippecanoe-decode`. Set `TIPPECANOE_BIN` when it is not installed on `PATH`,
and set `TIPPECANOE_DECODE_BIN` if the decoder is not next to that executable.
The build decodes the zoom-0 national-boundary tile and verifies every
same-country source line classified as an international boundary by the CN
worldview. If the optional PMTiles CLI is available, set `PMTILES_BIN`; the
build also performs an archive metadata check through the vendored PMTiles
JavaScript reader.

The Natural Earth datasets are public domain. The South Tibet overrides retain
their standard-map source and review-number metadata. Public deployment still
requires the project's normal map-review and compliance process.

The CN overrides also own the Tibet/Bhutan and northern Myanmar topology joins,
the Ladakh–Pakistan indeterminant frontier, Hong Kong/Macao region labels, and
Taipei's ordinary-city label classification. These policies are validated in
both normalized GeoJSON and decoded output tiles during every build.
