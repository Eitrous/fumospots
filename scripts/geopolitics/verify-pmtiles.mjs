import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { open, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PMTiles } from '../../vendor/pmtiles.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const archivePath = resolve(repoRoot, process.argv[2] || 'map-data/geopolitics/dist/geopolitics.pmtiles')
const tippecanoeDecodePath = process.argv[3] ? resolve(process.argv[3]) : ''
const reportPath = resolve(repoRoot, 'map-data/geopolitics/dist/build-report.json')
const boundaryCoveragePath = resolve(repoRoot, 'map-data/geopolitics/generated/boundary_coverage.json')

class NodeFileSource {
  constructor(path) {
    this.path = path
  }

  getKey() {
    return this.path
  }

  async getBytes(offset, length) {
    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return { data: buffer.subarray(0, bytesRead).buffer }
    } finally {
      await handle.close()
    }
  }
}

const archive = new PMTiles(new NodeFileSource(archivePath))
const header = await archive.getHeader()
const metadata = await archive.getMetadata()
const expectedLayers = [
  'admin0_boundary',
  'admin1_boundary',
  'disputed_boundary',
  'maritime_boundary',
  'country_label',
  'region_label',
  'official_place_label'
]
const actualLayers = (metadata.vector_layers || []).map((layer) => layer.id)
const missingLayers = expectedLayers.filter((layer) => !actualLayers.includes(layer))

if (header.minZoom !== 0 || header.maxZoom !== 12) {
  throw new Error(`Unexpected PMTiles zoom range ${header.minZoom}-${header.maxZoom}`)
}
if (missingLayers.length) {
  throw new Error(`PMTiles metadata is missing source layers: ${missingLayers.join(', ')}`)
}

let tibetPerimeterPresentAtZoom0 = null
let cnViewSameCountryInternationalSourcesPresentAtZoom0 = null
let hongKongMacaoUseAdmin1BoundariesAtZoom6 = null
let correctedPoliticalLabelsPresentInTiles = null
let repairedRegionalBoundariesPresentInTiles = null
if (tippecanoeDecodePath) {
  const decodeTile = (layers, zoom, x, y, label) => {
    const decoded = spawnSync(tippecanoeDecodePath, [
      ...layers.flatMap((layer) => ['-l', layer]),
      archivePath,
      String(zoom),
      String(x),
      String(y)
    ], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    if (decoded.status !== 0) {
      throw new Error(`tippecanoe-decode failed for ${label}: ${decoded.stderr.trim()}`)
    }
    return JSON.parse(decoded.stdout)
  }

  const decoded = spawnSync(tippecanoeDecodePath, [
    '-l',
    'admin0_boundary',
    archivePath,
    '0',
    '0',
    '0'
  ], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  if (decoded.status !== 0) {
    throw new Error(`tippecanoe-decode failed: ${decoded.stderr.trim()}`)
  }

  const tile = JSON.parse(decoded.stdout)
  const admin0Layer = tile.features?.find((feature) => feature.properties?.layer === 'admin0_boundary')
  const actualSourceIds = new Set((admin0Layer?.features || []).map(
    (feature) => String(feature.properties?.source_ne_id || '')
  ))
  const boundaryCoverage = JSON.parse(await readFile(boundaryCoveragePath, 'utf8'))
  const requiredSourceIds = boundaryCoverage.requiredSameCountryAdmin0SourceIds
  const missingSourceIds = requiredSourceIds.filter((sourceId) => !actualSourceIds.has(sourceId))
  if (missingSourceIds.length) {
    throw new Error(`zoom-0 PMTiles tile is missing CN-view international sources: ${missingSourceIds.join(', ')}`)
  }
  cnViewSameCountryInternationalSourcesPresentAtZoom0 = true
  tibetPerimeterPresentAtZoom0 = true

  const hongKongMacaoDecoded = spawnSync(tippecanoeDecodePath, [
    '-l',
    'admin1_boundary',
    '-l',
    'disputed_boundary',
    archivePath,
    '6',
    '52',
    '27'
  ], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  if (hongKongMacaoDecoded.status !== 0) {
    throw new Error(`tippecanoe-decode failed for Hong Kong/Macao: ${hongKongMacaoDecoded.stderr.trim()}`)
  }

  const hongKongMacaoTile = JSON.parse(hongKongMacaoDecoded.stdout)
  const admin1Features = hongKongMacaoTile.features
    ?.find((feature) => feature.properties?.layer === 'admin1_boundary')
    ?.features || []
  const disputedFeatures = hongKongMacaoTile.features
    ?.find((feature) => feature.properties?.layer === 'disputed_boundary')
    ?.features || []
  const admin1SourceIds = new Set(admin1Features.map(
    (feature) => String(feature.properties?.source_ne_id || '')
  ))
  const requiredMapUnitSourceIds = ['1746705295', '1746708389']
  const missingMapUnitSourceIds = requiredMapUnitSourceIds.filter(
    (sourceId) => !admin1SourceIds.has(sourceId)
  )
  const disputedHongKongMacaoFeatures = disputedFeatures.filter((feature) => [
    feature.properties?.left_code,
    feature.properties?.right_code
  ].some((code) => code === 'HKG' || code === 'MAC'))
  if (missingMapUnitSourceIds.length || disputedHongKongMacaoFeatures.length) {
    throw new Error(
      `zoom-6 PMTiles tile misclassifies Hong Kong/Macao boundaries; missing admin1: ${missingMapUnitSourceIds.join(', ') || 'none'}, disputed: ${disputedHongKongMacaoFeatures.length}`
    )
  }
  hongKongMacaoUseAdmin1BoundariesAtZoom6 = true

  const hongKongMacaoLabelsTile = decodeTile(
    ['country_label', 'region_label'],
    5,
    26,
    13,
    'Hong Kong/Macao labels'
  )
  const hongKongMacaoCountryCodes = new Set((hongKongMacaoLabelsTile.features
    ?.find((feature) => feature.properties?.layer === 'country_label')
    ?.features || []).map((feature) => feature.properties?.code))
  const hongKongMacaoRegionCodes = new Set((hongKongMacaoLabelsTile.features
    ?.find((feature) => feature.properties?.layer === 'region_label')
    ?.features || []).map((feature) => feature.properties?.code))
  if (
    hongKongMacaoCountryCodes.has('HKG')
    || hongKongMacaoCountryCodes.has('MAC')
    || !hongKongMacaoRegionCodes.has('HKG')
    || !hongKongMacaoRegionCodes.has('MAC')
  ) {
    throw new Error('zoom-5 PMTiles tile does not use region labels for Hong Kong and Macao')
  }

  const taipeiLabelsTile = decodeTile(
    ['region_label', 'official_place_label'],
    6,
    53,
    27,
    'Taipei labels'
  )
  const taipeiRegionFeatures = taipeiLabelsTile.features
    ?.find((feature) => feature.properties?.layer === 'region_label')
    ?.features.filter((feature) => feature.properties?.wikidata === 'Q1867') || []
  const taipeiCityFeatures = taipeiLabelsTile.features
    ?.find((feature) => feature.properties?.layer === 'official_place_label')
    ?.features.filter((feature) => feature.properties?.wikidata === 'Q1867') || []
  if (
    taipeiRegionFeatures.length
    || taipeiCityFeatures.length !== 1
    || taipeiCityFeatures[0].properties?.label_kind !== 'city'
    || taipeiCityFeatures[0].properties?.capital !== 'no'
  ) {
    throw new Error('zoom-6 PMTiles tile does not represent Taipei as an ordinary city')
  }
  correctedPoliticalLabelsPresentInTiles = true

  const bhutanBoundaryTiles = [53, 54].map((y) => decodeTile(
    ['admin0_boundary'],
    7,
    96,
    y,
    `Bhutan boundary connectors y=${y}`
  ))
  const bhutanBoundaryIds = new Set(bhutanBoundaryTiles.flatMap((tile) => (
    tile.features
      ?.find((feature) => feature.properties?.layer === 'admin0_boundary')
      ?.features || []
  )).map((feature) => String(feature.properties?.id || '')))
  const requiredBhutanConnectorPrefixes = [
    'cn-south-tibet-bhutan-north-connector',
    'cn-south-tibet-bhutan-south-connector'
  ]
  if (requiredBhutanConnectorPrefixes.some((prefix) => (
    ![...bhutanBoundaryIds].some((id) => id.startsWith(prefix))
  ))) {
    throw new Error('zoom-7 PMTiles tile is missing a Bhutan boundary connector')
  }

  const ladakhBoundaryTile = decodeTile(
    ['disputed_boundary'],
    6,
    45,
    25,
    'Ladakh–Pakistan disputed boundary'
  )
  const ladakhBoundaryFeatures = ladakhBoundaryTile.features
    ?.find((feature) => feature.properties?.layer === 'disputed_boundary')
    ?.features || []
  if (!ladakhBoundaryFeatures.some((feature) => (
    String(feature.properties?.source_ne_id || '') === '1746708603'
    && feature.properties?.kind === 'indefinite'
  ))) {
    throw new Error('zoom-6 PMTiles tile is missing the Ladakh–Pakistan indeterminant frontier')
  }
  repairedRegionalBoundariesPresentInTiles = true
}

const bytes = await readFile(archivePath)
const report = JSON.parse(await readFile(reportPath, 'utf8'))
report.archive = {
  file: basename(archivePath),
  bytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  minzoom: header.minZoom,
  maxzoom: header.maxZoom,
  bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
  sourceLayers: actualLayers,
  cnViewSameCountryInternationalSourcesPresentAtZoom0,
  tibetPerimeterPresentAtZoom0,
  hongKongMacaoUseAdmin1BoundariesAtZoom6,
  correctedPoliticalLabelsPresentInTiles,
  repairedRegionalBoundariesPresentInTiles
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(`[geopolitics] verified ${basename(archivePath)} (${bytes.byteLength} bytes)`)
