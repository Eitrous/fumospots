import type { H3Event } from 'h3'
import { layers, namedFlavor } from '~~/vendor/protomapsBasemaps.mjs'
import type { MapStyleTheme } from '~~/shared/mapStyle'
import { normalizeMapStyleLanguage } from '~~/shared/mapStyle'

const MAP_ASSET_BASE_PATH = '/map-assets'
const MAP_SOURCE_NAME = 'protomaps'
const MAP_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> &copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'

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

  const flavorName = theme === 'dark' ? 'dark' : 'light'
  const language = normalizeMapStyleLanguage(locale)

  return {
    version: 8,
    glyphs: `${MAP_ASSET_BASE_PATH}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${MAP_ASSET_BASE_PATH}/sprites/v4/${flavorName}`,
    sources: {
      [MAP_SOURCE_NAME]: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: MAP_ATTRIBUTION
      }
    },
    layers: layers(MAP_SOURCE_NAME, namedFlavor(flavorName), {
      lang: language
    })
  }
}
