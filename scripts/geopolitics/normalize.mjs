import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { open } from 'shapefile'
import {
  clampZoom,
  cleanString,
  featureCollection,
  lineParts,
  splitLineOutsidePolygon,
  withTippecanoeZoom
} from './geo.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const dataRoot = resolve(repoRoot, 'map-data/geopolitics')
const cacheRoot = resolve(dataRoot, '.cache/unpacked')
const generatedRoot = resolve(dataRoot, 'generated')
const manifest = JSON.parse(await readFile(resolve(dataRoot, 'manifest.json'), 'utf8'))
const sourceById = new Map(manifest.sources.map((source) => [source.id, source]))
const sourceAttribution = 'Natural Earth 5.1 (public domain), CN worldview'

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const readShapefile = async (sourceId) => {
  const source = sourceById.get(sourceId)
  if (!source) {
    throw new Error(`Unknown source ${sourceId}`)
  }

  const base = resolve(cacheRoot, sourceId, source.stem)
  const reader = await open(`${base}.shp`, `${base}.dbf`, { encoding: 'utf-8' })
  const features = []
  while (true) {
    const result = await reader.read()
    if (result.done) {
      return features
    }
    if (result.value.geometry) {
      features.push(result.value)
    }
  }
}

const stringProperty = (properties, key, fallback = '') => {
  const value = cleanString(properties[key])
  return typeof value === 'string' && value ? value : fallback
}

const numberProperty = (properties, key, fallback = 0) => {
  const value = Number(properties[key])
  return Number.isFinite(value) ? value : fallback
}

const effectiveCnClass = (properties) => {
  return stringProperty(properties, 'FCLASS_CN')
    || stringProperty(properties, 'FEATURECLA')
    || stringProperty(properties, 'featurecla')
}

const isUnrecognized = (value) => value.toLowerCase().includes('unrecognized')
const isInternational = (value) => value.toLowerCase().includes('international boundary')
const isMapUnitBoundary = (value) => value.toLowerCase().includes('map unit boundary')
const isSameCountryBoundary = (properties) => {
  const leftCode = stringProperty(properties, 'ADM0_A3_L')
  const rightCode = stringProperty(properties, 'ADM0_A3_R')
  return Boolean(leftCode && rightCode && leftCode === rightCode)
}
const sourceFeatureId = (properties) => cleanString(
  properties.ne_id ?? properties.NE_ID ?? properties.BRK_A3 ?? 'unknown'
)

const LADAKH_PAKISTAN_INDETERMINANT_SOURCE_ID = '1746708603'
const CHINA_MYANMAR_BOUNDARY_SOURCE_ID = '1746707389'
const BHUTAN_CHINA_BOUNDARY_SOURCE_ID = '1746705359'
const CHINA_MYANMAR_OFFICIAL_ENDPOINT = [98.1373517, 28.1456728]

// Natural Earth's China–Myanmar feature contains a north-western section that
// overlaps the reviewed South Tibet boundary at a slightly different position.
// Replace that section with a short endpoint join and keep the source geometry
// from the first non-overlapping vertex south-eastward.
const trimChinaMyanmarOverlap = (feature) => {
  const parts = lineParts(feature.geometry)
  const overlapPart = parts[4]
  const retainedVertexIndex = overlapPart?.findIndex(([longitude, latitude]) => (
    Math.abs(longitude - 98.11869266800005) < 1e-9
    && Math.abs(latitude - 28.140789897000033) < 1e-9
  )) ?? -1

  if (parts.length < 9 || retainedVertexIndex < 0) {
    throw new Error('Natural Earth China–Myanmar boundary topology changed; review the South Tibet trim')
  }

  return {
    ...feature,
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [CHINA_MYANMAR_OFFICIAL_ENDPOINT, ...overlapPart.slice(retainedVertexIndex)],
        ...parts.slice(8)
      ]
    }
  }
}

const boundaryKind = (value) => {
  const normalized = value.toLowerCase()
  if (normalized.includes('line of control')) return 'line_of_control'
  if (normalized.includes('claim')) return 'claim'
  if (normalized.includes('indefinite') || normalized.includes('indeterminant')) return 'indefinite'
  if (normalized.includes('lease')) return 'lease_limit'
  if (normalized.includes('overlay')) return 'overlay_limit'
  if (normalized.includes('disputed')) return 'disputed'
  return 'international'
}

const makeLineFeatures = ({
  sourceFeature,
  layer,
  kind,
  disputed,
  minzoom,
  maxzoom,
  exclusionPolygon,
  exclusionTolerance = 0,
  includeSourceId = false
}) => {
  const properties = sourceFeature.properties
  const sourceId = sourceFeatureId(properties)
  const parts = lineParts(sourceFeature.geometry).flatMap((line) => (
    exclusionPolygon
      ? splitLineOutsidePolygon(line, exclusionPolygon, exclusionTolerance)
      : [line]
  ))

  return parts.map((coordinates, index) => withTippecanoeZoom({
    type: 'Feature',
    id: `${sourceId}-${index + 1}`,
    properties: {
      id: `${sourceId}-${index + 1}`,
      view: 'CN',
      kind,
      disputed,
      rank: numberProperty(properties, 'SCALERANK', 6),
      minzoom,
      maxzoom,
      left_code: stringProperty(properties, 'ADM0_A3_L'),
      right_code: stringProperty(properties, 'ADM0_A3_R'),
      ...(includeSourceId || (layer === 'admin0_boundary' && isSameCountryBoundary(properties))
        ? { source_ne_id: sourceId }
        : {}),
      source_ref: sourceAttribution
    },
    geometry: {
      type: 'LineString',
      coordinates
    }
  }, minzoom, maxzoom, layer))
}

const deduplicateLineSegments = (features) => {
  const seen = new Set()
  const output = []

  for (const feature of features) {
    let partIndex = 0
    for (const line of lineParts(feature.geometry)) {
      let current = []
      const flush = () => {
        if (current.length < 2) {
          current = []
          return
        }
        partIndex += 1
        const id = `${feature.properties.id}-dedup-${partIndex}`
        output.push({
          ...feature,
          id,
          properties: {
            ...feature.properties,
            id
          },
          geometry: {
            type: 'LineString',
            coordinates: current
          }
        })
        current = []
      }

      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1]
        const end = line[index]
        const key = [start, end]
          .map((point) => point.map((value) => Number(value).toFixed(7)).join(','))
          .sort()
          .join('|')

        if (seen.has(key)) {
          flush()
          continue
        }

        seen.add(key)
        if (!current.length) {
          current.push(start)
        }
        current.push(end)
      }
      flush()
    }
  }

  return output
}

const exclusionFeature = await readJson(resolve(dataRoot, 'overrides/cn/south-tibet-exclusion.geojson'))
const exclusionPolygon = exclusionFeature.type === 'Feature'
  ? exclusionFeature.geometry
  : exclusionFeature

const admin0Features = []
const admin1Features = []
const disputedFeatures = []
const requiredSameCountryAdmin0SourceIds = new Set()

for (const feature of await readShapefile('admin0')) {
  const properties = feature.properties
  const classification = effectiveCnClass(properties)
  const sourceId = String(sourceFeatureId(properties))
  const isLadakhPakistanIndeterminant = sourceId === LADAKH_PAKISTAN_INDETERMINANT_SOURCE_ID
  if (!classification || (isUnrecognized(classification) && !isLadakhPakistanIndeterminant)) {
    continue
  }

  if (isLadakhPakistanIndeterminant) {
    const featureClassification = stringProperty(properties, 'FEATURECLA', 'Indeterminant frontier')
    const minzoom = clampZoom(properties.MIN_ZOOM, 3, 0, 12)
    disputedFeatures.push(...makeLineFeatures({
      sourceFeature: feature,
      layer: 'disputed_boundary',
      kind: boundaryKind(featureClassification),
      disputed: true,
      minzoom,
      maxzoom: 12,
      includeSourceId: true
    }))
    continue
  }

  if (isMapUnitBoundary(classification)) {
    const minzoom = clampZoom(properties.MIN_ZOOM, 5, 5, 10)
    admin1Features.push(...makeLineFeatures({
      sourceFeature: feature,
      layer: 'admin1_boundary',
      kind: 'admin1',
      disputed: false,
      minzoom,
      maxzoom: 10,
      exclusionPolygon,
      exclusionTolerance: 0.01,
      includeSourceId: true
    }))
    continue
  }

  const international = isInternational(classification)
  if (international && isSameCountryBoundary(properties)) {
    requiredSameCountryAdmin0SourceIds.add(String(sourceFeatureId(properties)))
  }
  // Natural Earth sometimes stores a recognized international boundary with
  // identical ADM0 codes on both sides when it participates in a territorial
  // claim. The worldview classification, rather than the raw side codes, is
  // authoritative for whether that line belongs in the national-boundary layer.
  if (
    isSameCountryBoundary(properties) && !international
  ) {
    continue
  }

  const kind = boundaryKind(classification)
  const minzoom = clampZoom(properties.MIN_ZOOM, 0, 0, 12)
  const target = international ? admin0Features : disputedFeatures
  const normalizedSourceFeature = sourceId === CHINA_MYANMAR_BOUNDARY_SOURCE_ID
    ? trimChinaMyanmarOverlap(feature)
    : feature
  const skipSouthTibetClipping = sourceId === CHINA_MYANMAR_BOUNDARY_SOURCE_ID
    || sourceId === BHUTAN_CHINA_BOUNDARY_SOURCE_ID
  target.push(...makeLineFeatures({
    sourceFeature: normalizedSourceFeature,
    layer: international ? 'admin0_boundary' : 'disputed_boundary',
    kind,
    disputed: !international,
    minzoom,
    maxzoom: 12,
    exclusionPolygon: skipSouthTibetClipping ? undefined : exclusionPolygon,
    exclusionTolerance: 0.02,
    includeSourceId: sourceId === CHINA_MYANMAR_BOUNDARY_SOURCE_ID
  }))
}

for (const feature of await readShapefile('disputed')) {
  const properties = feature.properties
  const classification = effectiveCnClass(properties)
  const international = isInternational(classification)
  const breakCode = stringProperty(properties, 'BRK_A3')
  if (international && isSameCountryBoundary(properties) && breakCode !== 'B00') {
    requiredSameCountryAdmin0SourceIds.add(String(sourceFeatureId(properties)))
  }
  if (
    !classification
    || isUnrecognized(classification)
    || (isSameCountryBoundary(properties) && !international)
    || breakCode === 'B00'
  ) {
    continue
  }

  // A line promoted to an international boundary by the CN worldview must be
  // present at every country-boundary zoom. Retaining the disputed dataset's
  // original label-oriented MIN_ZOOM (often 5–7) leaves visible gaps when the
  // map is zoomed out.
  const minzoom = international ? 0 : clampZoom(properties.MIN_ZOOM, 3, 0, 12)
  const target = international ? admin0Features : disputedFeatures
  target.push(...makeLineFeatures({
    sourceFeature: feature,
    layer: international ? 'admin0_boundary' : 'disputed_boundary',
    kind: boundaryKind(classification),
    disputed: !international,
    minzoom,
    maxzoom: 12,
    exclusionPolygon,
    exclusionTolerance: 0.02
  }))
}

const officialAdmin0 = await readJson(resolve(dataRoot, 'overrides/cn/south-tibet-admin0-boundary.geojson'))
for (const feature of officialAdmin0.features) {
  const minzoom = clampZoom(feature.properties.minzoom, 0, 0, 12)
  const maxzoom = clampZoom(feature.properties.maxzoom, 12, 0, 12)
  admin0Features.push(withTippecanoeZoom(feature, minzoom, maxzoom, 'admin0_boundary'))
}

const officialAdmin0Connectors = await readJson(resolve(dataRoot, 'overrides/cn/south-tibet-boundary-connectors.geojson'))
for (const feature of officialAdmin0Connectors.features) {
  const minzoom = clampZoom(feature.properties.minzoom, 0, 0, 12)
  const maxzoom = clampZoom(feature.properties.maxzoom, 12, 0, 12)
  admin0Features.push(withTippecanoeZoom(feature, minzoom, maxzoom, 'admin0_boundary'))
}

for (const feature of await readShapefile('admin1')) {
  const classification = effectiveCnClass(feature.properties)
  if (classification && isUnrecognized(classification)) {
    continue
  }

  const minzoom = clampZoom(feature.properties.MIN_ZOOM, 5, 3, 10)
  admin1Features.push(...makeLineFeatures({
    sourceFeature: feature,
    layer: 'admin1_boundary',
    kind: 'admin1',
    disputed: false,
    minzoom,
    maxzoom: 10,
    exclusionPolygon,
    exclusionTolerance: 0.01
  }))
}

const maritimeFeatures = []
for (const feature of await readShapefile('maritime')) {
  const classification = effectiveCnClass(feature.properties)
  if (!classification || isUnrecognized(classification)) {
    continue
  }
  const minzoom = clampZoom(feature.properties.MIN_ZOOM, 5, 0, 12)
  maritimeFeatures.push(...makeLineFeatures({
    sourceFeature: feature,
    layer: 'maritime_boundary',
    kind: 'maritime_claim',
    disputed: true,
    minzoom,
    maxzoom: 12
  }))
}

const countryNameOverrides = {
  CHN: {
    name_zh_hans: '中国',
    name_zh_hant: '中國',
    name_en: 'China',
    name_ja: '中国'
  }
}

const countryLabels = []
const mapUnitRegionLabels = []
for (const feature of await readShapefile('countries')) {
  const properties = feature.properties
  const classification = effectiveCnClass(properties)
  const code = stringProperty(properties, 'ADM0_A3_CN') || stringProperty(properties, 'ADM0_A3')
  const longitude = numberProperty(properties, 'LABEL_X', Number.NaN)
  const latitude = numberProperty(properties, 'LABEL_Y', Number.NaN)
  if (!code || !Number.isFinite(longitude) || !Number.isFinite(latitude) || isUnrecognized(classification)) {
    continue
  }
  if (code === 'TWN' || stringProperty(properties, 'ISO_A2') === 'TW') {
    continue
  }

  const overrides = countryNameOverrides[code] || {}
  const minzoom = clampZoom(properties.MIN_LABEL, 1, 0, 7)
  const maxzoom = clampZoom(properties.MAX_LABEL, 8, minzoom + 1, 9)
  const rank = numberProperty(properties, 'LABELRANK', 6)
  const id = `country-${code}-${cleanString(properties.NE_ID ?? code)}`
  const normalizedLabel = {
    type: 'Feature',
    id,
    properties: {
      id,
      view: 'CN',
      code,
      iso_a2: stringProperty(properties, 'ISO_A2'),
      wikidata: stringProperty(properties, 'WIKIDATAID'),
      rank,
      population_rank: Math.max(1, 12 - rank),
      minzoom,
      maxzoom,
      min_zoom: minzoom,
      sort_key: rank,
      name_zh_hans: overrides.name_zh_hans || stringProperty(properties, 'NAME_ZH', stringProperty(properties, 'NAME')),
      name_zh_hant: overrides.name_zh_hant || stringProperty(properties, 'NAME_ZHT', stringProperty(properties, 'NAME_ZH')),
      name_en: overrides.name_en || stringProperty(properties, 'NAME', stringProperty(properties, 'NAME_EN')),
      name_ja: overrides.name_ja || stringProperty(properties, 'NAME_JA', stringProperty(properties, 'NAME')),
      source_ref: sourceAttribution
    },
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    }
  }

  if (code === 'HKG' || code === 'MAC') {
    const regionId = `region-special-${code}`
    const regionMinzoom = Math.max(4, minzoom)
    const regionMaxzoom = Math.max(regionMinzoom + 1, 10)
    mapUnitRegionLabels.push(withTippecanoeZoom({
      ...normalizedLabel,
      id: regionId,
      properties: {
        ...normalizedLabel.properties,
        id: regionId,
        rank: 7,
        population_rank: 4,
        minzoom: regionMinzoom,
        maxzoom: regionMaxzoom,
        min_zoom: regionMinzoom,
        sort_key: 7
      }
    }, regionMinzoom, regionMaxzoom, 'region_label'))
    continue
  }

  countryLabels.push(withTippecanoeZoom(normalizedLabel, minzoom, maxzoom, 'country_label'))
}

const regionLabelsByCode = new Map()
for (const feature of await readShapefile('region-labels')) {
  const properties = feature.properties
  const code = stringProperty(properties, 'adm1_code') || `region-${cleanString(properties.ne_id)}`
  const originalName = stringProperty(properties, 'name')
  const isSouthTibet = code === 'IND-3299' || stringProperty(properties, 'wikidataid') === 'Q1162'
  const isTaipei = stringProperty(properties, 'wikidataid') === 'Q1867'
  const classification = effectiveCnClass(properties)
  if (isSouthTibet || isTaipei || (classification && isUnrecognized(classification))) {
    continue
  }

  const minzoom = clampZoom(properties.min_zoom, 5, 3, 10)
  const maxzoom = clampZoom(properties.max_label, 11, minzoom + 1, 12)
  const id = `region-${code}`
  const normalized = withTippecanoeZoom({
    type: 'Feature',
    id,
    properties: {
      id,
      view: 'CN',
      code,
      iso_a2: stringProperty(properties, 'iso_a2'),
      wikidata: stringProperty(properties, 'wikidataid'),
      rank: numberProperty(properties, 'labelrank', 7),
      minzoom,
      maxzoom,
      name_zh_hans: stringProperty(properties, 'name_zh', originalName),
      name_zh_hant: stringProperty(properties, 'name_zht', stringProperty(properties, 'name_zh', originalName)),
      name_en: stringProperty(properties, 'name_en', originalName),
      name_ja: stringProperty(properties, 'name_ja', originalName),
      source_ref: sourceAttribution
    },
    geometry: feature.geometry
  }, minzoom, maxzoom, 'region_label')

  const existing = regionLabelsByCode.get(code)
  if (!existing || normalized.properties.minzoom < existing.properties.minzoom) {
    regionLabelsByCode.set(code, normalized)
  }
}

for (const feature of mapUnitRegionLabels) {
  regionLabelsByCode.set(feature.properties.code, feature)
}

regionLabelsByCode.set('CN-TW', withTippecanoeZoom({
  type: 'Feature',
  id: 'region-taiwan-province',
  properties: {
    id: 'region-taiwan-province',
    view: 'CN',
    code: 'CN-TW',
    iso_a2: 'CN',
    wikidata: 'Q865',
    rank: 2,
    minzoom: 4,
    maxzoom: 10,
    name_zh_hans: '台湾省',
    name_zh_hant: '臺灣省',
    name_en: 'TAIWAN PROVINCE\n台湾省',
    name_ja: '台湾省',
    source_ref: 'CN worldview policy'
  },
  geometry: {
    type: 'Point',
    coordinates: [120.95, 23.7]
  }
}, 4, 10, 'region_label'))

const southTibetPlaceLabels = await readJson(resolve(dataRoot, 'overrides/cn/south-tibet-place-labels.geojson'))
const politicalPlaceLabels = await readJson(resolve(dataRoot, 'overrides/cn/place-label-overrides.geojson'))
const normalizedPlaces = [...southTibetPlaceLabels.features, ...politicalPlaceLabels.features].map((feature) => {
  const isCounty = feature.properties.label_kind === 'county'
  const isCity = feature.properties.label_kind === 'city'
  const minzoom = clampZoom(feature.properties.minzoom, isCity ? 5 : isCounty ? 9 : 11, 0, 14)
  const maxzoom = clampZoom(feature.properties.maxzoom, 14, minzoom + 1, 14)
  return withTippecanoeZoom({
    ...feature,
    properties: {
      ...feature.properties,
      kind: 'locality',
      kind_detail: isCity || isCounty ? 'city' : 'town',
      min_zoom: minzoom,
      population_rank: isCity ? 12 : isCounty ? 6 : 1,
      sort_key: isCity ? -1276000 : isCounty ? -1275000 : -1273500,
      capital: 'no'
    }
  }, minzoom, maxzoom, 'official_place_label')
})

await mkdir(generatedRoot, { recursive: true })
const outputs = {
  'admin0_boundary.geojson': featureCollection(deduplicateLineSegments(admin0Features)),
  'admin1_boundary.geojson': featureCollection(admin1Features),
  'disputed_boundary.geojson': featureCollection(disputedFeatures),
  'maritime_boundary.geojson': featureCollection(maritimeFeatures),
  'country_label.geojson': featureCollection(countryLabels),
  'region_label.geojson': featureCollection([...regionLabelsByCode.values()]),
  'official_place_label.geojson': featureCollection(normalizedPlaces)
}

for (const [name, collection] of Object.entries(outputs)) {
  await writeFile(resolve(generatedRoot, name), `${JSON.stringify(collection)}\n`)
  console.log(`[geopolitics] ${name}: ${collection.features.length} features`)
}

await writeFile(resolve(generatedRoot, 'boundary_coverage.json'), `${JSON.stringify({
  view: 'CN',
  requiredSameCountryAdmin0SourceIds: [...requiredSameCountryAdmin0SourceIds].sort()
}, null, 2)}\n`)
