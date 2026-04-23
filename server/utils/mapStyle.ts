import { getRequestURL } from 'h3'
import type { H3Event } from 'h3'
import { layers, namedFlavor } from '~~/vendor/protomapsBasemaps.mjs'
import type { MapStyleTheme } from '~~/shared/mapStyle'
import { normalizeMapStyleLanguage } from '~~/shared/mapStyle'

const MAP_ASSET_BASE_PATH = '/map-assets'
const MAP_SOURCE_NAME = 'protomaps'
const MAP_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> &copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
const LIGHT_BACKGROUND_COLOR = '#f1f0ec'
const LIGHT_EARTH_COLOR = '#f1f1f1'
const LIGHT_BUILDING_COLOR = '#dad6cf'
const LIGHT_WATER_COLOR = '#d4dbe1'
const LIGHT_OCEAN_LABEL_COLOR = '#7e8a96'
const DARK_EARTH_COLOR = '#0b0b0b'
const DARK_BUILDING_COLOR = '#2a2a2a'
const DARK_WATER_COLOR = '#313941'
const DARK_OCEAN_LABEL_COLOR = '#8694a0'
const BUILDING_FILL_OPACITY = 0.64

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
  paint?: Record<string, unknown>
  [key: string]: unknown
}

const toAbsoluteMapAssetUrl = (event: H3Event, path: string) => {
  const requestUrl = getRequestURL(event)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return `${requestUrl.origin}${normalizedPath}`
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

export const buildHostedMapStyle = (
  event: H3Event,
  theme: MapStyleTheme,
  locale: string | null | undefined
) => {
  const config = useRuntimeConfig(event)
  const pmtilesUrl = String(config.public.pmtilesUrl || '').trim()

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
    glyphs: toAbsoluteMapAssetUrl(event, `${MAP_ASSET_BASE_PATH}/fonts/{fontstack}/{range}.pbf`),
    sprite: toAbsoluteMapAssetUrl(event, `${MAP_ASSET_BASE_PATH}/sprites/v4/${spriteFlavorName}`),
    sources: {
      [MAP_SOURCE_NAME]: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: MAP_ATTRIBUTION
      }
    },
    layers: applyBuildingLayerOverrides(styleLayers)
  }
}
