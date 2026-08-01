import type { H3Event } from 'h3'
import { layers, namedFlavor } from '~~/vendor/protomapsBasemaps.mjs'
import type { MapStyleTheme } from '~~/shared/mapStyle'
import {
  MAP_STYLE_REVISION,
  normalizeMapStyleLanguage
} from '~~/shared/mapStyle'
import {
  SOUTH_TIBET_NON_STANDARD_TILE_PLACE_NAMES
} from '~~/shared/southTibetMapData'
import { SOUTH_TIBET_LABEL_EXCLUSION_AREA } from '~~/shared/southTibetLabelExclusionData'

const MAP_ASSET_BASE_PATH = '/map-assets'
const MAP_SOURCE_NAME = 'protomaps'
const MAP_GEOPOLITICS_SOURCE_NAME = 'geopolitics'
const MAP_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> &copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
const MAP_GEOPOLITICS_ATTRIBUTION =
  '<a href="https://www.naturalearthdata.com/">Natural Earth</a>'
const LIGHT_BACKGROUND_COLOR = '#f1f0ec'
const LIGHT_EARTH_COLOR = '#f1f1f1'
const LIGHT_BUILDING_COLOR = '#dad6cf'
const LIGHT_WATER_COLOR = '#d4dbe1'
const LIGHT_OCEAN_LABEL_COLOR = '#7e8a96'
const DARK_EARTH_COLOR = '#0b0b0b'
const DARK_BUILDING_COLOR = '#2a2a2a'
const DARK_WATER_COLOR = '#30363c'
const DARK_OCEAN_LABEL_COLOR = '#8694a0'
const BUILDING_FILL_OPACITY = 0.64
// The z5 country line used only to close the label-selection polygon slightly
// generalizes this Bhutanese border town onto the eastern side of the line.
const SOUTH_TIBET_LABEL_AREA_NEIGHBOR_EXCEPTION_FILTER: unknown[] = [
  '==',
  ['get', 'name'],
  'Jomotsangkha'
]
const GEOPOLITICS_ADMIN0_LAYER_ID = 'geopolitics-admin0-boundary'
const GEOPOLITICS_ADMIN1_LAYER_ID = 'geopolitics-admin1-boundary'
const GEOPOLITICS_DISPUTED_LAYER_ID = 'geopolitics-disputed-boundary'
const GEOPOLITICS_MARITIME_LAYER_ID = 'geopolitics-maritime-boundary'
const GEOPOLITICS_COUNTRY_LABEL_LAYER_ID = 'geopolitics-country-label'
const GEOPOLITICS_REGION_LABEL_LAYER_ID = 'geopolitics-region-label'
const GEOPOLITICS_CITY_LABEL_LAYER_ID = 'geopolitics-official-city-label'
const GEOPOLITICS_COUNTY_LABEL_LAYER_ID = 'geopolitics-official-county-label'
const GEOPOLITICS_VILLAGE_LABEL_LAYER_ID = 'geopolitics-official-village-label'
const POLITICAL_BASE_LOCALITY_WIKIDATA_IDS = ['Q8646', 'Q14773', 'Q1867']
const POLITICAL_BASE_LOCALITY_LABEL_NAMES = [
  'Hong Kong',
  'Hong Kong SAR',
  '香港',
  '香港特别行政区',
  '香港特別行政區',
  'Macao',
  'Macau',
  '澳门',
  '澳門',
  'Taipei',
  'Taipei City',
  '台北',
  '台北市',
  '臺北',
  '臺北市'
]

const LIGHT_GREENSPACE_COLORS = {
  park: '#dbe6d8',
  wood: '#d2ddd0',
  scrub: '#e3e9de',
  landcover: {
    grassland: 'rgba(223, 233, 217, 1)',
    scrub: 'rgba(226, 232, 219, 1)',
    forest: 'rgba(212, 226, 214, 1)'
  }
}

const DARK_GREENSPACE_COLORS = {
  park: '#1f2a21',
  wood: '#1b2520',
  scrub: '#222824',
  landcover: {
    grassland: 'rgba(33, 43, 34, 1)',
    scrub: 'rgba(36, 42, 35, 1)',
    forest: 'rgba(29, 42, 36, 1)'
  }
}

type MapStyleLayer = {
  id?: string
  type?: string
  source?: string
  'source-layer'?: string
  filter?: unknown
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
  minzoom?: number
  maxzoom?: number
  [key: string]: unknown
}

const firstHeaderValue = (value: string | undefined) => {
  return value?.split(',')[0]?.trim() || ''
}

const getRequestHeader = (event: H3Event, name: string) => {
  const value = event.node.req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

const getRequestOrigin = (event: H3Event, fallbackOrigin: string) => {
  const forwardedHost = firstHeaderValue(getRequestHeader(event, 'x-forwarded-host'))
  const host = forwardedHost || firstHeaderValue(getRequestHeader(event, 'host'))
  const forwardedProto = firstHeaderValue(getRequestHeader(event, 'x-forwarded-proto'))
  const proto = forwardedProto || (import.meta.dev ? 'http' : 'https')

  if (host) {
    return `${proto}://${host}`
  }

  return fallbackOrigin
}

const toAbsoluteMapAssetUrl = (origin: string, path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return `${origin}${normalizedPath}`
}

const toPmtilesProtocolUrl = (pmtilesUrl: string) => {
  return `pmtiles://${pmtilesUrl}`
}

const applyBuildingLayerOverrides = (styleLayers: MapStyleLayer[]) => {
  return styleLayers.map((layer) => {
    if (layer.id !== 'buildings' || layer.type !== 'fill') {
      return layer
    }

    return {
      ...layer,
      paint: {
        ...(layer.paint || {}),
        'fill-opacity': BUILDING_FILL_OPACITY
      }
    }
  })
}

const toFilterExpression = (filter: unknown): unknown[] => {
  if (!Array.isArray(filter) || !filter.length) {
    return ['all']
  }

  const [operator, ...operands] = filter
  if (operator === 'all' || operator === 'any') {
    return [operator, ...operands.map(toFilterExpression)]
  }
  if (operator === 'none') {
    return ['!', ['any', ...operands.map(toFilterExpression)]]
  }
  if (
    ['==', '!=', '<', '<=', '>', '>='].includes(String(operator))
    && typeof operands[0] === 'string'
  ) {
    return [operator, ['get', operands[0]], operands[1]]
  }
  if ((operator === 'in' || operator === '!in') && typeof operands[0] === 'string') {
    const expression = ['in', ['get', operands[0]], ['literal', operands.slice(1)]]
    return operator === '!in' ? ['!', expression] : expression
  }

  return filter
}

const localizedNameExpression = (language: string) => {
  const primaryField = language === 'zh-Hans'
    ? 'name_zh_hans'
    : language === 'zh-Hant'
      ? 'name_zh_hant'
      : language === 'ja'
        ? 'name_ja'
        : 'name_en'

  return [
    'coalesce',
    ['get', primaryField],
    ['get', 'name_en'],
    ['get', 'name_zh_hans']
  ]
}

const withoutVectorSourceMetadata = (layer: MapStyleLayer) => {
  const next = { ...layer }
  delete next['source-layer']
  delete next.filter
  return next
}

export const applyGeopoliticsLayers = (
  styleLayers: MapStyleLayer[],
  theme: MapStyleTheme,
  language: string
) => {
  const countryLayer = styleLayers.find((layer) => (
    layer.id === 'boundaries_country'
    && layer.type === 'line'
    && layer['source-layer'] === 'boundaries'
  ))
  const ordinaryBoundaryLayer = styleLayers.find((layer) => (
    layer.id === 'boundaries'
    && layer.type === 'line'
    && layer['source-layer'] === 'boundaries'
  ))
  const localityLayer = styleLayers.find((layer) => (
    layer.id === 'places_locality'
    && layer.type === 'symbol'
    && layer['source-layer'] === 'places'
  ))
  const subplaceLayer = styleLayers.find((layer) => (
    layer.id === 'places_subplace'
    && layer.type === 'symbol'
    && layer['source-layer'] === 'places'
  ))
  const regionLayer = styleLayers.find((layer) => (
    layer.id === 'places_region'
    && layer.type === 'symbol'
    && layer['source-layer'] === 'places'
  ))
  const countryLabelLayer = styleLayers.find((layer) => (
    layer.id === 'places_country'
    && layer.type === 'symbol'
    && layer['source-layer'] === 'places'
  ))

  if (
    !countryLayer
    || !ordinaryBoundaryLayer
    || !localityLayer
    || !subplaceLayer
    || !regionLayer
    || !countryLabelLayer
  ) {
    return styleLayers
  }

  const boundaryColor = theme === 'dark' ? '#4c5053' : '#9ea5ad'
  const disputedColor = theme === 'dark' ? '#65573a' : '#8d6b2e'
  const nameExpression = localizedNameExpression(language)
  const admin1Boundary: MapStyleLayer = {
    ...withoutVectorSourceMetadata(ordinaryBoundaryLayer),
    id: GEOPOLITICS_ADMIN1_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'admin1_boundary',
    minzoom: 2,
    maxzoom: 10
  }
  const admin0Boundary: MapStyleLayer = {
    ...withoutVectorSourceMetadata(countryLayer),
    id: GEOPOLITICS_ADMIN0_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'admin0_boundary',
    paint: {
      ...(countryLayer.paint || {}),
      'line-color': boundaryColor
    }
  }
  const disputedBoundary: MapStyleLayer = {
    ...withoutVectorSourceMetadata(countryLayer),
    id: GEOPOLITICS_DISPUTED_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'disputed_boundary',
    minzoom: 0,
    paint: {
      ...(countryLayer.paint || {}),
      'line-color': disputedColor,
      'line-dasharray': [4, 2],
      'line-opacity': 0.9
    }
  }
  const maritimeBoundary: MapStyleLayer = {
    ...withoutVectorSourceMetadata(countryLayer),
    id: GEOPOLITICS_MARITIME_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'maritime_boundary',
    minzoom: 5,
    paint: {
      ...(countryLayer.paint || {}),
      'line-color': disputedColor,
      'line-dasharray': [2, 2],
      'line-opacity': 0.82
    }
  }
  const countryLabel: MapStyleLayer = {
    ...withoutVectorSourceMetadata(countryLabelLayer),
    id: GEOPOLITICS_COUNTRY_LABEL_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'country_label',
    maxzoom: 9,
    layout: {
      ...(countryLabelLayer.layout || {}),
      'text-field': nameExpression,
      'symbol-sort-key': ['get', 'rank'],
      'text-transform': 'none'
    }
  }
  const regionLabel: MapStyleLayer = {
    ...withoutVectorSourceMetadata(regionLayer),
    id: GEOPOLITICS_REGION_LABEL_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'region_label',
    minzoom: 3,
    maxzoom: 10,
    layout: {
      ...(regionLayer.layout || {}),
      'text-field': nameExpression,
      'symbol-sort-key': ['get', 'rank'],
      'text-transform': 'none'
    }
  }
  const officialPlaceBase = withoutVectorSourceMetadata(localityLayer)
  const cityLabel: MapStyleLayer = {
    ...officialPlaceBase,
    id: GEOPOLITICS_CITY_LABEL_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'official_place_label',
    minzoom: 5,
    filter: ['==', ['get', 'label_kind'], 'city'],
    layout: {
      ...(localityLayer.layout || {}),
      'text-field': nameExpression,
      'text-transform': 'none'
    }
  }
  const countyLabel: MapStyleLayer = {
    ...officialPlaceBase,
    id: GEOPOLITICS_COUNTY_LABEL_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'official_place_label',
    minzoom: 9,
    filter: ['==', ['get', 'label_kind'], 'county'],
    layout: {
      ...(localityLayer.layout || {}),
      'text-field': nameExpression,
      'text-transform': 'none'
    }
  }
  const villageLabel: MapStyleLayer = {
    ...officialPlaceBase,
    id: GEOPOLITICS_VILLAGE_LABEL_LAYER_ID,
    source: MAP_GEOPOLITICS_SOURCE_NAME,
    'source-layer': 'official_place_label',
    minzoom: 11,
    filter: ['==', ['get', 'label_kind'], 'village'],
    layout: {
      ...(localityLayer.layout || {}),
      'text-field': nameExpression,
      'text-transform': 'none'
    }
  }

  const nextLayers: MapStyleLayer[] = []
  for (const layer of styleLayers) {
    if (layer.id === countryLayer.id) {
      nextLayers.push(admin1Boundary, admin0Boundary, disputedBoundary, maritimeBoundary)
      continue
    }
    if (layer.id === ordinaryBoundaryLayer.id) {
      continue
    }
    if (layer.id === regionLayer.id) {
      nextLayers.push(regionLabel)
      continue
    }
    if (layer.id === countryLabelLayer.id) {
      nextLayers.push(countryLabel)
      continue
    }
    if (layer.id === subplaceLayer.id) {
      nextLayers.push({
        ...layer,
        filter: [
          'all',
          toFilterExpression(layer.filter),
          ['!', ['within', SOUTH_TIBET_LABEL_EXCLUSION_AREA]]
        ]
      })
      continue
    }
    if (layer.id === localityLayer.id) {
      nextLayers.push({
        ...layer,
        filter: [
          'all',
          toFilterExpression(layer.filter),
          [
            '!',
            [
              'in',
              ['get', 'name'],
              ['literal', [...SOUTH_TIBET_NON_STANDARD_TILE_PLACE_NAMES]]
            ]
          ],
          [
            '!',
            [
              'any',
              [
                'in',
                ['get', 'wikidata'],
                ['literal', POLITICAL_BASE_LOCALITY_WIKIDATA_IDS]
              ],
              [
                'in',
                ['get', 'name'],
                ['literal', POLITICAL_BASE_LOCALITY_LABEL_NAMES]
              ]
            ]
          ],
          [
            'any',
            ['!', ['within', SOUTH_TIBET_LABEL_EXCLUSION_AREA]],
            SOUTH_TIBET_LABEL_AREA_NEIGHBOR_EXCEPTION_FILTER
          ]
        ]
      }, cityLabel, countyLabel, villageLabel)
      continue
    }

    nextLayers.push(layer)
  }

  return nextLayers
}

export const buildHostedMapStyle = (
  event: H3Event,
  theme: MapStyleTheme,
  locale: string | null | undefined
) => {
  const config = useRuntimeConfig(event)
  const pmtilesUrl = String(config.public.pmtilesUrl || '').trim()
  const configuredGeopoliticsUrl = String(config.public.geopoliticsPmtilesUrl || '').trim()
  const geopoliticsEnabled = String(config.public.geopoliticsEnabled || 'true') !== 'false'
  const siteUrl = String(config.public.siteUrl || '').trim()
  const fallbackOrigin = siteUrl ? new URL(siteUrl).origin : 'http://localhost:3000'
  const assetOrigin = getRequestOrigin(event, fallbackOrigin)
  const geopoliticsUrl = configuredGeopoliticsUrl
    || toAbsoluteMapAssetUrl(
      assetOrigin,
      `/api/map/geopolitics.pmtiles?v=${encodeURIComponent(MAP_STYLE_REVISION)}`
    )

  if (!pmtilesUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'NUXT_PUBLIC_PM_TILES_URL is not configured'
    })
  }

  const flavorName = theme === 'dark' ? 'black' : 'white'
  const spriteFlavorName = theme === 'dark' ? 'dark' : 'light'
  const language = normalizeMapStyleLanguage(locale)
  const baseFlavor = namedFlavor(flavorName)
  const greenspaceColors = theme === 'dark' ? DARK_GREENSPACE_COLORS : LIGHT_GREENSPACE_COLORS
  const customFlavor = {
    ...baseFlavor,
    background: theme === 'dark' ? baseFlavor.background : LIGHT_BACKGROUND_COLOR,
    earth: theme === 'dark' ? DARK_EARTH_COLOR : LIGHT_EARTH_COLOR,
    buildings: theme === 'dark' ? DARK_BUILDING_COLOR : LIGHT_BUILDING_COLOR,
    water: theme === 'dark' ? DARK_WATER_COLOR : LIGHT_WATER_COLOR,
    ocean_label: theme === 'dark' ? DARK_OCEAN_LABEL_COLOR : LIGHT_OCEAN_LABEL_COLOR,
    park_b: greenspaceColors.park,
    wood_b: greenspaceColors.wood,
    scrub_b: greenspaceColors.scrub,
    landcover: baseFlavor.landcover
      ? {
          ...baseFlavor.landcover,
          grassland: greenspaceColors.landcover.grassland,
          scrub: greenspaceColors.landcover.scrub,
          forest: greenspaceColors.landcover.forest
        }
      : baseFlavor.landcover
  }
  const styleLayers = layers(MAP_SOURCE_NAME, customFlavor, {
    lang: language
  }) as MapStyleLayer[]

  const sources: Record<string, unknown> = {
    [MAP_SOURCE_NAME]: {
      type: 'vector',
      url: toPmtilesProtocolUrl(pmtilesUrl),
      attribution: MAP_ATTRIBUTION
    }
  }

  if (geopoliticsEnabled) {
    sources[MAP_GEOPOLITICS_SOURCE_NAME] = {
      type: 'vector',
      url: toPmtilesProtocolUrl(geopoliticsUrl),
      attribution: MAP_GEOPOLITICS_ATTRIBUTION
    }
  }

  return {
    version: 8,
    glyphs: toAbsoluteMapAssetUrl(assetOrigin, `${MAP_ASSET_BASE_PATH}/fonts/{fontstack}/{range}.pbf`),
    sprite: toAbsoluteMapAssetUrl(assetOrigin, `${MAP_ASSET_BASE_PATH}/sprites/v4/${spriteFlavorName}`),
    sources,
    layers: geopoliticsEnabled
      ? applyGeopoliticsLayers(applyBuildingLayerOverrides(styleLayers), theme, language)
      : applyBuildingLayerOverrides(styleLayers)
  }
}
