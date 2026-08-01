import type { H3Event } from 'h3'
import { layers, namedFlavor } from '~~/vendor/protomapsBasemaps.mjs'
import type { MapStyleTheme } from '~~/shared/mapStyle'
import { normalizeMapStyleLanguage } from '~~/shared/mapStyle'
import {
  SOUTH_TIBET_COUNTY_LABEL_MIN_ZOOM,
  SOUTH_TIBET_NON_STANDARD_TILE_PLACE_NAMES,
  SOUTH_TIBET_OFFICIAL_LABEL_COLLECTION,
  SOUTH_TIBET_STANDARD_MAP_SOURCE_URL,
  SOUTH_TIBET_VILLAGE_LABEL_MIN_ZOOM
} from '~~/shared/southTibetMapData'
import { SOUTH_TIBET_OFFICIAL_COUNTRY_BOUNDARIES } from '~~/shared/southTibetBoundaryData'
import { SOUTH_TIBET_LABEL_EXCLUSION_AREA } from '~~/shared/southTibetLabelExclusionData'

const MAP_ASSET_BASE_PATH = '/map-assets'
const MAP_SOURCE_NAME = 'protomaps'
const MAP_POLITICAL_LABEL_SOURCE_NAME = 'fumo-political-labels'
const MAP_POLITICAL_BOUNDARY_SOURCE_NAME = 'fumo-political-boundaries'
const MAP_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> &copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
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
const SOUTH_TIBET_BREAKAWAY_CODE = 'B00'
const SOUTH_TIBET_COUNTRY_BOUNDARY_LAYER_ID = 'fumo-political-south-tibet-country-boundary'
const SOUTH_TIBET_COUNTY_LABEL_LAYER_ID = 'fumo-political-south-tibet-county-labels'
const SOUTH_TIBET_STANDARD_PLACE_LABEL_LAYER_ID = 'fumo-political-south-tibet-standard-place-labels'

// From z6 onward the PMTiles archive drops brk_a3 and splits the B00 boundary
// into tile-local country/region features. Those generalized features retain
// disputed=true and sort_rank=288. This area fully contains their z6-z12
// geometry while excluding unrelated disputes elsewhere.
const SOUTH_TIBET_DISPUTED_BOUNDARY_AREA = {
  type: 'Polygon',
  coordinates: [[
    [90.5, 26.3],
    [98.5, 26.3],
    [98.5, 29.8],
    [90.5, 29.8],
    [90.5, 26.3]
  ]]
}

// The low-zoom B00 feature and its high-zoom generalized descendants are all
// removed before the official standard-map country boundary is drawn.
const SOUTH_TIBET_BREAKAWAY_BOUNDARY_FILTER: unknown[] = [
  '==',
  ['get', 'brk_a3'],
  SOUTH_TIBET_BREAKAWAY_CODE
]
const SOUTH_TIBET_GENERALIZED_DISPUTED_BOUNDARY_FILTER: unknown[] = [
  'all',
  ['==', ['get', 'disputed'], true],
  ['==', ['get', 'sort_rank'], 288],
  [
    'in',
    ['get', 'kind'],
    ['literal', ['country', 'unrecognized_country', 'region']]
  ],
  ['within', SOUTH_TIBET_DISPUTED_BOUNDARY_AREA]
]
// Planetiler sometimes groups several disconnected admin lines into one
// MultiLineString. A feature that contains one segment outside the exact
// polygon therefore fails `within` even when its other segments are former
// Arunachal subdivisions inside South Tibet. These IDs are the residual
// region/county features audited across z8-z12 in the current PMTiles archive.
// Higher zooms vary the final two ID digits for the same source family, so the
// filter uses the stable ID prefix. The audit-area check keeps those archive-
// specific families local even if a prefix is reused elsewhere.
const SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_IDS = [
  35184417762240,
  35184417762480,
  35184417762940,
  35184417762960,
  35184417763190,
  35184417763200,
  35184417800740,
  35184522442470,
  35184522446470,
  35184522449230,
  35184522475570,
  35184522476900,
  35184522477350,
  35184522477500,
  35184522477540,
  35184522543370,
  35184522555530,
  35184575837400,
  35184575837410,
  35184576508400,
  35184576508410,
  35184661422360,
  35184665568850,
  35184665568870,
  35184771259120,
  35185057771150,
  35185057780680,
  35185097243390,
  35185097342027,
  35185097427780,
  35185097427810,
  35185097427840,
  35185097543330,
  35185097543340,
  35185097543345,
  35185098256590,
  35185098256600,
  35185098261970,
  35185098283430,
  35185098283440,
  35185098283450,
  35185098703670,
  35185098710350,
  35185098912430,
  35185098912440,
  35185099166280,
  35185099166300,
  35185099172300,
  35185099174600,
  35185099213564,
  35185099223270,
  35185099330750,
  35185099330760,
  35185099344910,
  35185099361940,
  35185099386310,
  35185099390450,
  35185099390464,
  35185099393900,
  35185099393920,
  35185099397230,
  35185099397235,
  35185099401460,
  35185099401470,
  35185236128739,
  35185261058932,
  35185099166310,
  35185261058930,
  35185261129140,
  35185099172310,
  35185097427811,
  35185097543334,
  35184522449252,
  35185099223220,
  35185099223279,
  35185098710360,
  35185058261320,
  35185099344920,
  35185099361950,
  35185099393917,
  35185099393918,
  35185827823460,
  35185099386326,
  35184909487687,
  35185099186301,
  35185099166295,
  35185261058933,
  35185262857640,
  35185097543343,
  35185098261973,
  35185098261975,
  35185099223276,
  35185098283459,
  35185098710367,
  35184529751150,
  35185099393926,
  35185099401483,
  35185099401474,
  35185827823470,
  35185827823468,
  35185827823466,
  35185099386321,
  35185099330756,
  35185099330762,
  35185374217150
]
const SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_ID_PREFIXES = [
  ...new Set(SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_IDS.map((id) => Math.floor(id / 100)))
]
const SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_AUDIT_AREA = {
  type: 'Polygon',
  coordinates: [[
    [91.3, 26.35],
    [97.75, 26.35],
    [97.75, 29.7],
    [91.3, 29.7],
    [91.3, 26.35]
  ]]
}
// Four z8 county features are grouped across the southern edge of their large
// source tiles, so their full geometry reaches farther south than the general
// audit area. Keep that necessary enlargement restricted to those exact IDs.
const SOUTH_TIBET_Z8_GROUPED_ADMIN_BOUNDARY_IDS = [
  35184417762960,
  35184522446470,
  35185097243390,
  35185097543330
]
const SOUTH_TIBET_Z8_GROUPED_ADMIN_BOUNDARY_AREA = {
  type: 'Polygon',
  coordinates: [[
    [91.3, 25.7],
    [94.3, 25.7],
    [94.3, 27.15],
    [91.3, 27.15],
    [91.3, 25.7]
  ]]
}
const SOUTH_TIBET_RESIDUAL_INTERNAL_ADMIN_BOUNDARY_FILTER: unknown[] = [
  'any',
  [
    'all',
    [
      'in',
      ['floor', ['/', ['to-number', ['id']], 100]],
      ['literal', SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_ID_PREFIXES]
    ],
    ['within', SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_AUDIT_AREA]
  ],
  [
    'all',
    ['in', ['id'], ['literal', SOUTH_TIBET_Z8_GROUPED_ADMIN_BOUNDARY_IDS]],
    ['within', SOUTH_TIBET_Z8_GROUPED_ADMIN_BOUNDARY_AREA]
  ]
]
// At z8+ the former Arunachal subdivisions are ordinary region/county lines,
// not disputed lines. Fully-contained features are removed spatially; audited
// cross-boundary MultiLineStrings are removed by the localized ID fallback.
const SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_FILTER: unknown[] = [
  'all',
  [
    'in',
    ['get', 'kind'],
    ['literal', ['region', 'county']]
  ],
  [
    'any',
    ['within', SOUTH_TIBET_LABEL_EXCLUSION_AREA],
    SOUTH_TIBET_RESIDUAL_INTERNAL_ADMIN_BOUNDARY_FILTER
  ]
]
const SOUTH_TIBET_COUNTY_FEATURE_FILTER: unknown[] = [
  'any',
  ['in', 'wikidata', 'Q14292389', 'Q10317821', 'Q1028177', 'Q167842'],
  ['in', 'name', '错那镇', '错那市', '隆子县', '墨脱县', '察隅县']
]
const SOUTH_TIBET_STANDARD_PLACE_FEATURE_FILTER: unknown[] = [
  'in',
  'name',
  ...SOUTH_TIBET_NON_STANDARD_TILE_PLACE_NAMES
]
// The z5 country line used only to close the label-selection polygon slightly
// generalizes this Bhutanese border town onto the eastern side of the line.
const SOUTH_TIBET_LABEL_AREA_NEIGHBOR_EXCEPTION_FILTER: unknown[] = [
  '==',
  ['get', 'name'],
  'Jomotsangkha'
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

const toBoundaryFilterExpression = (filter: unknown, fallback: unknown[]) => {
  if (
    Array.isArray(filter)
    && ['==', '!=', '<', '<=', '>', '>='].includes(String(filter[0]))
    && typeof filter[1] === 'string'
  ) {
    return [filter[0], ['get', filter[1]], filter[2]]
  }

  return fallback
}

const excludeBoundaryFeatureExpression = (filter: unknown, excludedFilter: unknown[]) => {
  return ['all', filter, ['!', excludedFilter]]
}

export const applySouthTibetBoundaryOverrides = (styleLayers: MapStyleLayer[]) => {
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

  if (!countryLayer || !ordinaryBoundaryLayer) {
    return styleLayers
  }

  const nextLayers = styleLayers
    .filter((layer) => (
      layer.id !== SOUTH_TIBET_COUNTRY_BOUNDARY_LAYER_ID
    ))
    .map((layer) => {
      if (layer.id === countryLayer.id) {
        return {
          ...layer,
          filter: excludeBoundaryFeatureExpression(
            excludeBoundaryFeatureExpression(
              toBoundaryFilterExpression(
                layer.filter,
                ['<=', ['get', 'kind_detail'], 2]
              ),
              SOUTH_TIBET_BREAKAWAY_BOUNDARY_FILTER
            ),
            SOUTH_TIBET_GENERALIZED_DISPUTED_BOUNDARY_FILTER
          )
        }
      }

      if (layer.id === ordinaryBoundaryLayer.id) {
        return {
          ...layer,
          filter: excludeBoundaryFeatureExpression(
            excludeBoundaryFeatureExpression(
              excludeBoundaryFeatureExpression(
                toBoundaryFilterExpression(
                  layer.filter,
                  ['>', ['get', 'kind_detail'], 2]
                ),
                SOUTH_TIBET_BREAKAWAY_BOUNDARY_FILTER
              ),
              SOUTH_TIBET_GENERALIZED_DISPUTED_BOUNDARY_FILTER
            ),
            SOUTH_TIBET_INTERNAL_ADMIN_BOUNDARY_FILTER
          )
        }
      }

      return layer
    })

  const officialBoundaryLayerBase = { ...countryLayer }
  delete officialBoundaryLayerBase['source-layer']
  delete officialBoundaryLayerBase.filter
  const countryBoundaryLayer: MapStyleLayer = {
    ...officialBoundaryLayerBase,
    id: SOUTH_TIBET_COUNTRY_BOUNDARY_LAYER_ID,
    source: MAP_POLITICAL_BOUNDARY_SOURCE_NAME
  }
  const insertionIndex = nextLayers.findIndex((layer) => layer.id === ordinaryBoundaryLayer.id)
  nextLayers.splice(
    insertionIndex >= 0 ? insertionIndex + 1 : nextLayers.length,
    0,
    countryBoundaryLayer
  )

  return nextLayers
}

export const applySouthTibetPlaceLabelOverrides = (styleLayers: MapStyleLayer[]) => {
  const localityLayer = styleLayers.find((layer) => (
    layer.id === 'places_locality'
    && layer.type === 'symbol'
    && layer['source-layer'] === 'places'
  ))

  if (!localityLayer) {
    return styleLayers
  }

  const nextLayers = styleLayers
    .filter((layer) => (
      layer.id !== SOUTH_TIBET_COUNTY_LABEL_LAYER_ID
      && layer.id !== SOUTH_TIBET_STANDARD_PLACE_LABEL_LAYER_ID
    ))
    .map((layer) => {
      if (layer.id !== localityLayer.id) {
        return layer
      }

      return {
        ...layer,
        filter: [
          'all',
          toFilterExpression(layer.filter),
          ['!', toFilterExpression(SOUTH_TIBET_COUNTY_FEATURE_FILTER)],
          ['!', toFilterExpression(SOUTH_TIBET_STANDARD_PLACE_FEATURE_FILTER)],
          [
            'any',
            ['!', ['within', SOUTH_TIBET_LABEL_EXCLUSION_AREA]],
            SOUTH_TIBET_LABEL_AREA_NEIGHBOR_EXCEPTION_FILTER
          ]
        ]
      }
    })

  const baseLayout = localityLayer.layout || {}
  const officialLabelLayerBase = { ...localityLayer }
  delete officialLabelLayerBase['source-layer']
  const countyLayer: MapStyleLayer = {
    ...officialLabelLayerBase,
    id: SOUTH_TIBET_COUNTY_LABEL_LAYER_ID,
    source: MAP_POLITICAL_LABEL_SOURCE_NAME,
    minzoom: SOUTH_TIBET_COUNTY_LABEL_MIN_ZOOM,
    filter: ['==', 'labelKind', 'county'],
    layout: {
      ...baseLayout,
      'text-field': ['get', 'name'],
      'text-transform': 'none'
    }
  }
  const standardPlaceLayer: MapStyleLayer = {
    ...officialLabelLayerBase,
    id: SOUTH_TIBET_STANDARD_PLACE_LABEL_LAYER_ID,
    source: MAP_POLITICAL_LABEL_SOURCE_NAME,
    minzoom: SOUTH_TIBET_VILLAGE_LABEL_MIN_ZOOM,
    filter: ['==', 'labelKind', 'village'],
    layout: {
      ...baseLayout,
      'text-field': ['get', 'name'],
      'text-transform': 'none'
    }
  }
  const insertionIndex = nextLayers.findIndex((layer) => layer.id === localityLayer.id)

  nextLayers.splice(
    insertionIndex >= 0 ? insertionIndex + 1 : nextLayers.length,
    0,
    countyLayer,
    standardPlaceLayer
  )

  return nextLayers
}

export const buildHostedMapStyle = (
  event: H3Event,
  theme: MapStyleTheme,
  locale: string | null | undefined
) => {
  const config = useRuntimeConfig(event)
  const pmtilesUrl = String(config.public.pmtilesUrl || '').trim()
  const siteUrl = String(config.public.siteUrl || '').trim()
  const fallbackOrigin = siteUrl ? new URL(siteUrl).origin : 'http://localhost:3000'
  const assetOrigin = getRequestOrigin(event, fallbackOrigin)

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

  return {
    version: 8,
    glyphs: toAbsoluteMapAssetUrl(assetOrigin, `${MAP_ASSET_BASE_PATH}/fonts/{fontstack}/{range}.pbf`),
    sprite: toAbsoluteMapAssetUrl(assetOrigin, `${MAP_ASSET_BASE_PATH}/sprites/v4/${spriteFlavorName}`),
    sources: {
      [MAP_SOURCE_NAME]: {
        type: 'vector',
        url: toPmtilesProtocolUrl(pmtilesUrl),
        attribution: MAP_ATTRIBUTION
      },
      [MAP_POLITICAL_LABEL_SOURCE_NAME]: {
        type: 'geojson',
        data: SOUTH_TIBET_OFFICIAL_LABEL_COLLECTION,
        attribution: `<a href="${SOUTH_TIBET_STANDARD_MAP_SOURCE_URL}">西藏自治区自然资源厅标准地图</a>`
      },
      [MAP_POLITICAL_BOUNDARY_SOURCE_NAME]: {
        type: 'geojson',
        data: SOUTH_TIBET_OFFICIAL_COUNTRY_BOUNDARIES,
        attribution: `<a href="${SOUTH_TIBET_STANDARD_MAP_SOURCE_URL}">西藏自治区自然资源厅标准地图</a>`
      }
    },
    layers: applySouthTibetPlaceLabelOverrides(
      applySouthTibetBoundaryOverrides(
        applyBuildingLayerOverrides(styleLayers)
      )
    )
  }
}
