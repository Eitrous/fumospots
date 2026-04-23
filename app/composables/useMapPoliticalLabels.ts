import type { Map as MapLibreMap } from 'maplibre-gl'

const TAIWAN_ISO_A2 = 'TW'
const TAIWAN_WIKIDATA_ID = 'Q865'
const TAIWAN_ENGLISH_NAME = 'Taiwan'
const TAIWAN_HANS_NAME = '台湾'
const TAIWAN_HANT_NAME = '臺灣'
const TAIWAN_COUNTRY_MATCH_FILTER: unknown[] = [
  'any',
  ['==', 'iso_a2', TAIWAN_ISO_A2],
  ['==', 'country_code_iso3166_1_alpha_2', TAIWAN_ISO_A2],
  ['==', 'wikidata', TAIWAN_WIKIDATA_ID],
  ['==', 'name:en', TAIWAN_ENGLISH_NAME],
  ['==', 'name:zh-Hans', TAIWAN_HANS_NAME],
  ['==', 'name:zh-Hant', TAIWAN_HANT_NAME],
  ['==', 'name:ja', TAIWAN_HANS_NAME],
  ['in', 'name', TAIWAN_ENGLISH_NAME, TAIWAN_HANS_NAME, TAIWAN_HANT_NAME]
]
const TAIWAN_EXCLUDE_FILTER: unknown[] = [
  'all',
  ['!=', 'iso_a2', TAIWAN_ISO_A2],
  ['!=', 'country_code_iso3166_1_alpha_2', TAIWAN_ISO_A2],
  ['!=', 'wikidata', TAIWAN_WIKIDATA_ID],
  ['!=', 'name:en', TAIWAN_ENGLISH_NAME],
  ['!=', 'name:zh-Hans', TAIWAN_HANS_NAME],
  ['!=', 'name:zh-Hant', TAIWAN_HANT_NAME],
  ['!=', 'name:ja', TAIWAN_HANS_NAME],
  ['!in', 'name', TAIWAN_ENGLISH_NAME, TAIWAN_HANS_NAME, TAIWAN_HANT_NAME]
]
const PLACE_SOURCE_LAYERS = ['place', 'places']

export const TAIWAN_PROVINCE_LAYER_ID = 'fumo-political-taiwan-province-label'

type RawStyleLayer = {
  id: string
  type?: string
  source?: string
  'source-layer'?: string
  filter?: unknown
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
  minzoom?: number
  maxzoom?: number
}

const warnedMessages = new Set<string>()

const warnOnce = (code: string, message: string) => {
  if (warnedMessages.has(code)) {
    return
  }

  warnedMessages.add(code)
  console.warn(message)
}

const isArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value)
}

const isPropertyReference = (value: unknown, propertyNames: string[]) => {
  if (typeof value === 'string') {
    return propertyNames.includes(value)
  }

  return isArray(value)
    && value[0] === 'get'
    && typeof value[1] === 'string'
    && propertyNames.includes(value[1])
}

const includesPlacePropertyValue = (
  filter: unknown,
  propertyNames: string[],
  values: string[]
): boolean => {
  if (!isArray(filter)) {
    return false
  }

  const operator = filter[0]
  const key = filter[1]

  if (
    (operator === '==' || operator === '!=')
    && isPropertyReference(key, propertyNames)
    && typeof filter[2] === 'string'
    && values.includes(filter[2])
  ) {
    return true
  }

  if ((operator === 'in' || operator === '!in') && isPropertyReference(key, propertyNames)) {
    return filter.slice(2).some((value) => typeof value === 'string' && values.includes(value))
  }

  for (const item of filter) {
    if (includesPlacePropertyValue(item, propertyNames, values)) {
      return true
    }
  }

  return false
}

const isTaiwanCountryCondition = (filter: unknown): boolean => {
  if (!isArray(filter)) {
    return false
  }

  if (
    filter[0] === '=='
    && (
      (filter[1] === 'iso_a2' && filter[2] === TAIWAN_ISO_A2)
      || (filter[1] === 'country_code_iso3166_1_alpha_2' && filter[2] === TAIWAN_ISO_A2)
      || (filter[1] === 'wikidata' && filter[2] === TAIWAN_WIKIDATA_ID)
      || (filter[1] === 'name:en' && filter[2] === TAIWAN_ENGLISH_NAME)
      || (filter[1] === 'name:zh-Hans' && filter[2] === TAIWAN_HANS_NAME)
      || (filter[1] === 'name:zh-Hant' && filter[2] === TAIWAN_HANT_NAME)
      || (filter[1] === 'name:ja' && filter[2] === TAIWAN_HANS_NAME)
    )
  ) {
    return true
  }

  if (
    filter[0] === 'in'
    && filter[1] === 'name'
    && filter.slice(2).some((value) => (
      value === TAIWAN_ENGLISH_NAME
      || value === TAIWAN_HANS_NAME
      || value === TAIWAN_HANT_NAME
    ))
  ) {
    return true
  }

  return filter.some(isTaiwanCountryCondition)
}

const hasTaiwanExcludeCondition = (filter: unknown): boolean => {
  if (!isArray(filter)) {
    return false
  }

  if (
    filter[0] === 'all'
    && filter.some((item) => (
      isArray(item)
      && (
        (item[0] === '!=' && item[1] === 'iso_a2' && item[2] === TAIWAN_ISO_A2)
        || (
          item[0] === '!='
          && item[1] === 'country_code_iso3166_1_alpha_2'
          && item[2] === TAIWAN_ISO_A2
        )
        || (item[0] === '!=' && item[1] === 'wikidata' && item[2] === TAIWAN_WIKIDATA_ID)
        || (item[0] === '!=' && item[1] === 'name:en' && item[2] === TAIWAN_ENGLISH_NAME)
        || (item[0] === '!=' && item[1] === 'name:zh-Hans' && item[2] === TAIWAN_HANS_NAME)
        || (item[0] === '!=' && item[1] === 'name:zh-Hant' && item[2] === TAIWAN_HANT_NAME)
        || (item[0] === '!=' && item[1] === 'name:ja' && item[2] === TAIWAN_HANS_NAME)
        || (
          item[0] === '!in'
          && item[1] === 'name'
          && item.slice(2).some((value) => (
            value === TAIWAN_ENGLISH_NAME
            || value === TAIWAN_HANS_NAME
            || value === TAIWAN_HANT_NAME
          ))
        )
      )
    ))
  ) {
    return true
  }

  for (const item of filter) {
    if (hasTaiwanExcludeCondition(item)) {
      return true
    }
  }

  return false
}

const getStyleLayers = (map: MapLibreMap): RawStyleLayer[] => {
  const style = map.getStyle()
  if (!style?.layers) {
    return []
  }

  return style.layers as RawStyleLayer[]
}

const usesPlaceSourceLayer = (layer: RawStyleLayer) => {
  return Boolean(layer['source-layer'] && PLACE_SOURCE_LAYERS.includes(layer['source-layer']))
}

const findCountryLabelLayers = (layers: RawStyleLayer[]) => {
  return layers.filter((layer) => {
    return layer.type === 'symbol'
      && usesPlaceSourceLayer(layer)
      && (
        includesPlacePropertyValue(layer.filter, ['class'], ['country'])
        || includesPlacePropertyValue(layer.filter, ['kind', 'pmap:kind'], ['country'])
      )
  })
}

const findStateLabelLayer = (layers: RawStyleLayer[]) => {
  return layers.find((layer) => {
    return layer.type === 'symbol'
      && usesPlaceSourceLayer(layer)
      && (
        includesPlacePropertyValue(layer.filter, ['class'], ['state'])
        || includesPlacePropertyValue(layer.filter, ['kind', 'pmap:kind'], ['state', 'region'])
      )
  })
}

const withTaiwanExcluded = (filter: unknown) => {
  if (hasTaiwanExcludeCondition(filter)) {
    return filter
  }

  if (!filter) {
    return ['all', TAIWAN_EXCLUDE_FILTER]
  }

  return ['all', filter, TAIWAN_EXCLUDE_FILTER]
}

const applyCountryLayerFilters = (map: MapLibreMap, countryLayers: RawStyleLayer[]) => {
  for (const layer of countryLayers) {
    const currentFilter = map.getFilter(layer.id) ?? layer.filter
    const nextFilter = withTaiwanExcluded(currentFilter)

    if (nextFilter === currentFilter) {
      continue
    }

    try {
      map.setFilter(layer.id, nextFilter as any)
    } catch {
      warnOnce(
        `set-filter-${layer.id}`,
        `[map political labels] Failed to update country filter for layer: ${layer.id}`
      )
    }
  }
}

const createTaiwanProvinceLayer = (
  countryLayer: RawStyleLayer,
  stateLayer: RawStyleLayer | undefined,
  label: string
) => {
  const source = stateLayer?.source || countryLayer.source
  const sourceLayer = stateLayer?.['source-layer'] || countryLayer['source-layer']

  if (!source || !sourceLayer) {
    return null
  }

  const baseLayout = (stateLayer?.layout || countryLayer.layout || {}) as Record<string, unknown>
  const basePaint = (stateLayer?.paint || countryLayer.paint || {}) as Record<string, unknown>

  return {
    id: TAIWAN_PROVINCE_LAYER_ID,
    type: 'symbol',
    source,
    'source-layer': sourceLayer,
    minzoom: stateLayer?.minzoom ?? 5,
    maxzoom: stateLayer?.maxzoom ?? 10,
    filter: countryLayer.filter
      ? ['all', countryLayer.filter, TAIWAN_COUNTRY_MATCH_FILTER]
      : TAIWAN_COUNTRY_MATCH_FILTER,
    layout: {
      ...baseLayout,
      'text-field': label,
      'text-transform': 'none'
    },
    paint: {
      ...basePaint
    }
  }
}

export const updateTaiwanProvinceLabel = (map: MapLibreMap, label: string) => {
  if (!map.getLayer(TAIWAN_PROVINCE_LAYER_ID)) {
    return
  }

  try {
    map.setLayoutProperty(TAIWAN_PROVINCE_LAYER_ID, 'text-field', label)
    map.setLayoutProperty(TAIWAN_PROVINCE_LAYER_ID, 'text-transform', 'none')
  } catch {
    warnOnce('set-layout-taiwan-label', '[map political labels] Failed to update Taiwan province label text')
  }
}

export const applyTaiwanProvinceLabelPolicy = (map: MapLibreMap, label: string) => {
  const styleLayers = getStyleLayers(map)
  if (!styleLayers.length) {
    return
  }

  const countryLayers = findCountryLabelLayers(styleLayers)
  if (!countryLayers.length) {
    if (map.getLayer(TAIWAN_PROVINCE_LAYER_ID)) {
      updateTaiwanProvinceLabel(map, label)
    }
    warnOnce('country-layers-missing', '[map political labels] Country label layers not found in current style')
    return
  }

  applyCountryLayerFilters(map, countryLayers)

  if (map.getLayer(TAIWAN_PROVINCE_LAYER_ID)) {
    updateTaiwanProvinceLabel(map, label)
    return
  }

  const stateLayer = findStateLabelLayer(styleLayers)
  const targetLayer = createTaiwanProvinceLayer(countryLayers[0], stateLayer, label)

  if (!targetLayer) {
    warnOnce('taiwan-layer-source-missing', '[map political labels] Cannot create Taiwan layer due to missing source metadata')
    return
  }

  const beforeId = stateLayer?.id

  try {
    if (beforeId && map.getLayer(beforeId)) {
      map.addLayer(targetLayer as any, beforeId)
    } else {
      map.addLayer(targetLayer as any)
    }
  } catch {
    warnOnce('add-layer-taiwan', '[map political labels] Failed to inject Taiwan province layer')
    return
  }

  updateTaiwanProvinceLabel(map, label)
}
