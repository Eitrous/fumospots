import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideOrNearPolygon, lineParts, midpoint } from './geo.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const dataRoot = resolve(repoRoot, 'map-data/geopolitics')
const generatedRoot = resolve(dataRoot, 'generated')
const distRoot = resolve(dataRoot, 'dist')
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const files = [
  'admin0_boundary',
  'admin1_boundary',
  'disputed_boundary',
  'maritime_boundary',
  'country_label',
  'region_label',
  'official_place_label'
]

const collections = Object.fromEntries(await Promise.all(files.map(async (name) => [
  name,
  await readJson(resolve(generatedRoot, `${name}.geojson`))
])))
const boundaryCoverage = await readJson(resolve(generatedRoot, 'boundary_coverage.json'))
const exclusionFeature = await readJson(resolve(dataRoot, 'overrides/cn/south-tibet-exclusion.geojson'))
const exclusionPolygon = exclusionFeature.type === 'Feature' ? exclusionFeature.geometry : exclusionFeature
const errors = []
const pointKey = ([longitude, latitude]) => `${Number(longitude).toFixed(7)},${Number(latitude).toFixed(7)}`

for (const [name, collection] of Object.entries(collections)) {
  if (collection.type !== 'FeatureCollection' || !collection.features.length) {
    errors.push(`${name} is empty or not a FeatureCollection`)
  }
}

if (!collections.admin0_boundary.features.some((feature) => String(feature.properties.id).startsWith('cn-south-tibet-admin0-'))) {
  errors.push('reviewed South Tibet admin0 boundary is missing')
}

const requiredSouthTibetConnectorIds = [
  'cn-south-tibet-bhutan-north-connector',
  'cn-south-tibet-bhutan-south-connector',
  'cn-south-tibet-official-boundary-join'
]
const missingSouthTibetConnectorIds = requiredSouthTibetConnectorIds.filter((id) => (
  !collections.admin0_boundary.features.some((feature) => String(feature.properties.id).startsWith(id))
))
if (missingSouthTibetConnectorIds.length) {
  errors.push(`South Tibet topology connectors are missing: ${missingSouthTibetConnectorIds.join(', ')}`)
}

const admin0VertexOwners = new Map()
for (const feature of collections.admin0_boundary.features) {
  for (const line of lineParts(feature.geometry)) {
    for (const point of line) {
      const key = pointKey(point)
      const owners = admin0VertexOwners.get(key) || new Set()
      owners.add(String(feature.properties.id))
      admin0VertexOwners.set(key, owners)
    }
  }
}
const requiredJoinedAdmin0Points = [
  [91.562854, 27.8148476],
  [91.6283394780001, 27.852693787000035],
  [92.03585982200013, 26.85484771800013],
  [92.141809, 26.8528411],
  [94.2444337, 27.5597984],
  [94.2504361, 27.5620243],
  [98.1373517, 28.1456728]
]
const unjoinedAdmin0Points = requiredJoinedAdmin0Points.filter((point) => (
  (admin0VertexOwners.get(pointKey(point))?.size || 0) < 2
))
if (unjoinedAdmin0Points.length) {
  errors.push(`admin0 topology remains unjoined at: ${unjoinedAdmin0Points.map(pointKey).join(', ')}`)
}

if (collections.admin0_boundary.features.some((feature) => feature.properties.left_code === 'B00' || feature.properties.right_code === 'B00')) {
  errors.push('legacy B00 boundary remains in admin0 output')
}

if (collections.admin0_boundary.features.some((feature) => (
  feature.properties.left_code
  && feature.properties.left_code === feature.properties.right_code
  && feature.properties.kind !== 'international'
))) {
  errors.push('non-international same-country line remains in admin0 output')
}

const requiredTibetBoundarySourceIds = new Set([
  // China–India western-sector segments selected by the CN worldview.
  '1746705401', // B01
  '1746705405', // B02
  '1746705409', // B04
  '1746705543', // B03
  // China–Bhutan connectors selected by the CN worldview.
  '1746705373', // B76
  '1746705535', // B75
  '1746708735',
  '1746708765'
])
const presentAdmin0SourceIds = new Set(collections.admin0_boundary.features.map(
  (feature) => String(feature.properties.source_ne_id || '')
))
const missingGlobalSameCountryAdmin0SourceIds = boundaryCoverage.requiredSameCountryAdmin0SourceIds.filter(
  (sourceId) => !presentAdmin0SourceIds.has(sourceId)
)
if (missingGlobalSameCountryAdmin0SourceIds.length) {
  errors.push(`CN-view same-country international sources are missing: ${missingGlobalSameCountryAdmin0SourceIds.join(', ')}`)
}
const missingTibetBoundarySourceIds = [...requiredTibetBoundarySourceIds].filter(
  (sourceId) => !presentAdmin0SourceIds.has(sourceId)
)
if (missingTibetBoundarySourceIds.length) {
  errors.push(`Tibet perimeter source segments are missing: ${missingTibetBoundarySourceIds.join(', ')}`)
}

const hongKongMacaoSourceIds = new Set(['1746705295', '1746708389'])
const isHongKongMacaoBoundary = (feature) => [
  feature.properties.left_code,
  feature.properties.right_code
].some((code) => code === 'HKG' || code === 'MAC')
const misplacedHongKongMacaoFeatures = [
  ...collections.admin0_boundary.features,
  ...collections.disputed_boundary.features
].filter(isHongKongMacaoBoundary)
if (misplacedHongKongMacaoFeatures.length) {
  errors.push('Hong Kong or Macao map-unit boundary remains in a national/disputed layer')
}
const presentHongKongMacaoAdmin1SourceIds = new Set(collections.admin1_boundary.features.map(
  (feature) => String(feature.properties.source_ne_id || '')
))
const missingHongKongMacaoAdmin1SourceIds = [...hongKongMacaoSourceIds].filter(
  (sourceId) => !presentHongKongMacaoAdmin1SourceIds.has(sourceId)
)
if (missingHongKongMacaoAdmin1SourceIds.length) {
  errors.push(`Hong Kong/Macao admin1 sources are missing: ${missingHongKongMacaoAdmin1SourceIds.join(', ')}`)
}
const delayedTibetBoundarySourceIds = [...requiredTibetBoundarySourceIds].filter((sourceId) => (
  collections.admin0_boundary.features
    .filter((feature) => String(feature.properties.source_ne_id || '') === sourceId)
    .some((feature) => feature.properties.minzoom !== 0 || feature.tippecanoe?.minzoom !== 0)
))
if (delayedTibetBoundarySourceIds.length) {
  errors.push(`Tibet perimeter source segments appear after zoom 0: ${delayedTibetBoundarySourceIds.join(', ')}`)
}

const ladakhPakistanSourceId = '1746708603'
const ladakhPakistanFeatures = collections.disputed_boundary.features.filter((feature) => (
  String(feature.properties.source_ne_id || '') === ladakhPakistanSourceId
))
if (!ladakhPakistanFeatures.length || ladakhPakistanFeatures.some((feature) => (
  feature.properties.kind !== 'indefinite' || feature.properties.disputed !== true
))) {
  errors.push('Ladakh–Pakistan indeterminant frontier is missing or misclassified')
}

const chinaMyanmarSourceId = '1746707389'
const chinaMyanmarFeatures = collections.admin0_boundary.features.filter((feature) => (
  String(feature.properties.source_ne_id || '') === chinaMyanmarSourceId
))
if (!chinaMyanmarFeatures.length) {
  errors.push('trimmed China–Myanmar boundary is missing')
}
const residualNorthernMyanmarOverlap = chinaMyanmarFeatures.some((feature) => (
  lineParts(feature.geometry).some((line) => line.some(([longitude, latitude]) => (
    longitude < 98.1 && latitude > 28.1
  )))
))
if (residualNorthernMyanmarOverlap) {
  errors.push('overlapping Natural Earth boundary remains in northern Myanmar')
}

for (const feature of collections.admin1_boundary.features) {
  for (const line of lineParts(feature.geometry)) {
    for (let index = 1; index < line.length; index += 1) {
      if (isInsideOrNearPolygon(midpoint(line[index - 1], line[index]), exclusionPolygon, 0.005)) {
        errors.push(`admin1 segment remains inside South Tibet exclusion area: ${feature.properties.id}`)
        break
      }
    }
  }
}

const countryNames = collections.country_label.features.flatMap((feature) => [
  feature.properties.name_zh_hans,
  feature.properties.name_en,
  feature.properties.name_ja
])
if (countryNames.some((name) => /Taiwan|台湾|臺灣/.test(String(name)))) {
  errors.push('Taiwan remains in country_label')
}
if (collections.country_label.features.some((feature) => ['HKG', 'MAC'].includes(feature.properties.code))) {
  errors.push('Hong Kong or Macao remains in country_label')
}
const specialRegionCodes = new Set(collections.region_label.features.map((feature) => feature.properties.code))
if (!specialRegionCodes.has('HKG') || !specialRegionCodes.has('MAC')) {
  errors.push('Hong Kong or Macao is missing from region_label')
}

if (collections.country_label.features.some((feature) => (
  !Number.isFinite(feature.properties.population_rank)
  || !Number.isFinite(feature.properties.min_zoom)
  || !Number.isFinite(feature.properties.sort_key)
))) {
  errors.push('country label is missing Protomaps-compatible rank fields')
}

const regionText = JSON.stringify(collections.region_label)
if (regionText.includes('藏南地区') || regionText.includes('藏南地區') || regionText.includes('阿鲁纳恰尔邦')) {
  errors.push('separate South Tibet or Arunachal region label remains')
}
if (!regionText.includes('西藏自治区')) {
  errors.push('Tibet Autonomous Region label is missing')
}
if (!regionText.includes('台湾省')) {
  errors.push('Taiwan province region label is missing')
}

const taipeiRegionFeatures = collections.region_label.features.filter((feature) => (
  feature.properties.wikidata === 'Q1867'
))
const taipeiCityFeatures = collections.official_place_label.features.filter((feature) => (
  feature.properties.wikidata === 'Q1867'
))
if (taipeiRegionFeatures.length || taipeiCityFeatures.length !== 1) {
  errors.push('Taipei is not represented exclusively by one ordinary city label')
} else if (
  taipeiCityFeatures[0].properties.label_kind !== 'city'
  || taipeiCityFeatures[0].properties.kind !== 'locality'
  || taipeiCityFeatures[0].properties.capital !== 'no'
) {
  errors.push('Taipei city label still uses non-city or capital properties')
}

for (const feature of collections.official_place_label.features) {
  const expected = feature.properties.label_kind === 'city'
    ? 5
    : feature.properties.label_kind === 'county'
      ? 9
      : 11
  if (feature.properties.minzoom < expected || feature.tippecanoe?.minzoom < expected) {
    errors.push(`place label appears too early: ${feature.properties.name_zh_hans}`)
  }
  if (
    !Number.isFinite(feature.properties.population_rank)
    || !Number.isFinite(feature.properties.min_zoom)
    || !Number.isFinite(feature.properties.sort_key)
  ) {
    errors.push(`place label is missing Protomaps-compatible rank fields: ${feature.properties.name_zh_hans}`)
  }
}

const exactSegments = new Set()
let duplicateSegments = 0
for (const feature of collections.admin0_boundary.features) {
  for (const line of lineParts(feature.geometry)) {
    for (let index = 1; index < line.length; index += 1) {
      const pair = [line[index - 1], line[index]].map((point) => point.map((value) => Number(value).toFixed(6)).join(',')).sort().join('|')
      if (exactSegments.has(pair)) {
        duplicateSegments += 1
      }
      exactSegments.add(pair)
    }
  }
}
if (duplicateSegments > 0) {
  errors.push(`admin0 output contains ${duplicateSegments} exact duplicate segments`)
}

const sourceDigest = createHash('sha256')
for (const name of files) {
  sourceDigest.update(await readFile(resolve(generatedRoot, `${name}.geojson`)))
}

const report = {
  schemaVersion: 1,
  view: 'CN',
  generatedAt: new Date().toISOString(),
  generatedSha256: sourceDigest.digest('hex'),
  layers: Object.fromEntries(Object.entries(collections).map(([name, collection]) => [name, collection.features.length])),
  checks: {
    reviewedSouthTibetBoundary: true,
    noInvalidSameCountryAdmin0Lines: !errors.includes('non-international same-country line remains in admin0 output'),
    completeCnViewSameCountryInternationalSources: missingGlobalSameCountryAdmin0SourceIds.length === 0,
    hongKongMacaoUseAdmin1Boundaries: misplacedHongKongMacaoFeatures.length === 0
      && missingHongKongMacaoAdmin1SourceIds.length === 0,
    joinedSouthTibetBoundaryTopology: missingSouthTibetConnectorIds.length === 0
      && unjoinedAdmin0Points.length === 0,
    completeTibetPerimeterSources: missingTibetBoundarySourceIds.length === 0,
    allZoomTibetPerimeterSources: delayedTibetBoundarySourceIds.length === 0,
    ladakhPakistanDisputedBoundary: ladakhPakistanFeatures.length > 0,
    noNorthernMyanmarOverlap: !residualNorthernMyanmarOverlap,
    noSouthTibetAdmin1Segments: !errors.some((error) => error.startsWith('admin1 segment')),
    noTaiwanCountryLabel: !errors.includes('Taiwan remains in country_label'),
    hongKongMacaoUseRegionLabels: !errors.some((error) => error.includes('Hong Kong or Macao') && error.includes('label')),
    noSeparateSouthTibetRegionLabel: !errors.some((error) => error.includes('separate South Tibet')),
    taipeiUsesOrdinaryCityLabel: !errors.some((error) => error.startsWith('Taipei')),
    compatibleLabelRankFields: !errors.some((error) => error.includes('Protomaps-compatible rank fields')),
    delayedOfficialPlaces: !errors.some((error) => error.startsWith('place label appears too early')),
    duplicateAdmin0Segments: duplicateSegments
  },
  errors
}

await writeFile(resolve(distRoot, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`)

if (errors.length) {
  for (const error of errors) {
    console.error(`[geopolitics] ${error}`)
  }
  process.exitCode = 1
} else {
  console.log('[geopolitics] normalized data validation passed')
}
