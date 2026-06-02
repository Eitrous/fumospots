import type { Map as MapLibreMap } from 'maplibre-gl'

export const BASE_MAP_SOURCE_NAME = 'protomaps'
export const BASE_MAP_HEALTH_CHECK_DELAY_MS = 4200
export const BASE_MAP_HEALTH_CONFIRM_DELAY_MS = 220
export const BASE_MAP_RECOVERY_MAX_ATTEMPTS = 3
export const BASE_MAP_RECOVERY_RETRY_DELAYS_MS = [600, 1800, 4200] as const
export const BASE_MAP_PROBE_LAYER_IDS = [
  'earth',
  'water',
  'landuse_park',
  'roads_major',
  'boundaries_country',
  'places_country'
] as const

type BaseMapErrorEvent = {
  error?: {
    message?: string
  }
  sourceId?: string
}

export const isBaseMapSourceLoaded = (
  map: MapLibreMap | null | undefined,
  sourceName = BASE_MAP_SOURCE_NAME
) => {
  if (!map?.getSource(sourceName)) {
    return false
  }

  try {
    return map.isSourceLoaded(sourceName)
  } catch {
    return false
  }
}

export const getExistingBaseMapProbeLayers = (
  map: MapLibreMap | null | undefined
) => {
  if (!map) {
    return []
  }

  return BASE_MAP_PROBE_LAYER_IDS.filter(layerId => Boolean(map.getLayer(layerId)))
}

export const hasRenderedBaseMapFeatures = (
  map: MapLibreMap | null | undefined
) => {
  if (!map || !map.isStyleLoaded()) {
    return false
  }

  const layers = getExistingBaseMapProbeLayers(map)
  if (!layers.length) {
    return false
  }

  try {
    return map.queryRenderedFeatures({ layers }).length > 0
  } catch {
    return false
  }
}

export const isBaseMapErrorEvent = (event: unknown) => {
  const mapEvent = event as BaseMapErrorEvent
  const message = mapEvent.error?.message || ''

  return (
    mapEvent.sourceId === BASE_MAP_SOURCE_NAME
    || /pmtiles|protomaps|failed to fetch|bad response code|server returned|etag|range/i.test(message)
  )
}
