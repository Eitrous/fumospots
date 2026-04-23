<script setup lang="ts">
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type {
  GeoBounds,
  PublicMapCollection,
  PublicMapFeatureProperties,
  RegionScope
} from '~~/shared/fumo'
import {
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM
} from '~~/shared/fumo'
import { resolveHostedMapStyleUrl } from '~~/shared/mapStyle'
import { applyTaiwanProvinceLabelPolicy } from '~~/app/composables/useMapPoliticalLabels'

const props = withDefaults(defineProps<{
  selectedPostId?: number | null
  highlightRegionScope?: RegionScope | null
}>(), {
  selectedPostId: null,
  highlightRegionScope: null
})

type MapBoundsBox = {
  west: number
  south: number
  east: number
  north: number
  coversWorld?: boolean
}

type RegionHighlightProperties = {
  scopeKey: string
}

type RegionHighlightCollection = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  RegionHighlightProperties
>

const emit = defineEmits<{
  'select-post': [postId: number]
}>()

const { t, locale } = useI18n()
const { isDark } = useTheme()
const config = useRuntimeConfig()
const { getPostDetail } = usePostDetailCache()
const { getRegionGeometry } = useRegionGeometryCache()
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<MapLibreMap | null>(null)
const mapLoadingRequests = ref(0)
const isMapLoading = computed(() => mapLoadingRequests.value > 0)
const taiwanProvinceLabel = computed(() => t('map.taiwanProvinceLabel'))
const collection = shallowRef<PublicMapCollection>({
  type: 'FeatureCollection',
  features: []
})
const loadedBounds = shallowRef<MapBoundsBox | null>(null)
const regionHighlightCollection = shallowRef<RegionHighlightCollection>({
  type: 'FeatureCollection',
  features: []
})
const activeRegionBounds = shallowRef<GeoBounds | null>(null)

let maplibregl: typeof import('maplibre-gl') | null = null

const EXPANDED_VIEWPORT_FACTOR = 2
const MIN_LATITUDE = -90
const MAX_LATITUDE = 90
const SELECTED_POST_FOCUS_MIN_ZOOM = 6.8
const REGION_FIT_MAX_ZOOM = 10
const REGION_FIT_DURATION_MS = 720

let selectedPostFocusSequence = 0
let regionHighlightSequence = 0
let pendingRegionFitKey: string | null = null

const getMapStyleUrl = (dark = isDark.value) => {
  return resolveHostedMapStyleUrl({
    theme: dark ? 'dark' : 'light',
    locale: locale.value,
    lightStyleUrl: config.public.mapStyleUrl,
    darkStyleUrl: config.public.mapDarkStyleUrl
  })
}

const emptyCollection: PublicMapCollection = {
  type: 'FeatureCollection',
  features: []
}

const clampLatitude = (lat: number) => Math.min(MAX_LATITUDE, Math.max(MIN_LATITUDE, lat))

const normalizeLongitude = (lng: number) => {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

const normalizeScopeValue = (value: string | null) => value?.trim().toLowerCase() || ''

const getRegionScopeKey = (scope: RegionScope | null | undefined) => {
  if (!scope) {
    return ''
  }

  return [
    normalizeScopeValue(scope.countryName),
    normalizeScopeValue(scope.regionName),
    normalizeScopeValue(scope.cityName)
  ].join('::')
}

const getLongitudeSpan = (west: number, east: number) => {
  const span = east - west
  return span >= 0 ? span : span + 360
}

const getViewportBounds = (): MapBoundsBox | null => {
  if (!mapRef.value) {
    return null
  }

  const bounds = mapRef.value.getBounds()
  const rawWest = bounds.getWest()
  const rawEast = bounds.getEast()
  const width = getLongitudeSpan(rawWest, rawEast)

  if (width >= 360) {
    return {
      west: -180,
      south: clampLatitude(bounds.getSouth()),
      east: 180,
      north: clampLatitude(bounds.getNorth()),
      coversWorld: true
    }
  }

  return {
    west: normalizeLongitude(rawWest),
    south: clampLatitude(bounds.getSouth()),
    east: normalizeLongitude(rawEast),
    north: clampLatitude(bounds.getNorth())
  }
}

const getExpandedViewportBounds = (): MapBoundsBox | null => {
  if (!mapRef.value) {
    return null
  }

  const bounds = mapRef.value.getBounds()
  const rawWest = bounds.getWest()
  const rawEast = bounds.getEast()
  const rawSouth = clampLatitude(bounds.getSouth())
  const rawNorth = clampLatitude(bounds.getNorth())
  const viewportWidth = getLongitudeSpan(rawWest, rawEast)

  if (viewportWidth * EXPANDED_VIEWPORT_FACTOR >= 360) {
    return {
      west: -180,
      south: clampLatitude(((rawSouth + rawNorth) / 2) - ((rawNorth - rawSouth) * EXPANDED_VIEWPORT_FACTOR / 2)),
      east: 180,
      north: clampLatitude(((rawSouth + rawNorth) / 2) + ((rawNorth - rawSouth) * EXPANDED_VIEWPORT_FACTOR / 2)),
      coversWorld: true
    }
  }

  const centerLng = rawWest + (viewportWidth / 2)
  const halfExpandedWidth = viewportWidth * EXPANDED_VIEWPORT_FACTOR / 2
  const centerLat = (rawSouth + rawNorth) / 2
  const halfExpandedHeight = (rawNorth - rawSouth) * EXPANDED_VIEWPORT_FACTOR / 2

  return {
    west: normalizeLongitude(centerLng - halfExpandedWidth),
    south: clampLatitude(centerLat - halfExpandedHeight),
    east: normalizeLongitude(centerLng + halfExpandedWidth),
    north: clampLatitude(centerLat + halfExpandedHeight)
  }
}

const getLongitudeIntervals = (bounds: MapBoundsBox): Array<[number, number]> => {
  if (bounds.coversWorld || (bounds.west <= -180 && bounds.east >= 180)) {
    return [[-180, 180]]
  }

  const west = normalizeLongitude(bounds.west)
  const east = normalizeLongitude(bounds.east)

  if (east < west) {
    return [
      [west, 180],
      [-180, east]
    ]
  }

  return [[west, east]]
}

const isIntervalInside = (inner: [number, number], outer: [number, number]) => {
  const epsilon = 0.000001
  return inner[0] >= outer[0] - epsilon && inner[1] <= outer[1] + epsilon
}

const isBoundsInside = (inner: MapBoundsBox, outer: MapBoundsBox) => {
  const epsilon = 0.000001
  const latInside = inner.south >= outer.south - epsilon && inner.north <= outer.north + epsilon
  const lngInside = getLongitudeIntervals(inner).every((innerInterval) => {
    return getLongitudeIntervals(outer).some((outerInterval) => isIntervalInside(innerInterval, outerInterval))
  })

  return latInside && lngInside
}

const startMapLoading = () => {
  mapLoadingRequests.value += 1
}

const finishMapLoading = () => {
  mapLoadingRequests.value = Math.max(0, mapLoadingRequests.value - 1)
}

const normalizeProperties = (raw: Record<string, unknown>): PublicMapFeatureProperties => {
  return {
    id: Number(raw.id),
    title: String(raw.title || t('map.untitledPost')),
    placeName: raw.placeName ? String(raw.placeName) : null,
    username: String(raw.username || 'unknown'),
    privacyMode: raw.privacyMode === 'approx' ? 'approx' : 'exact',
    capturedAt: raw.capturedAt ? String(raw.capturedAt) : null
  }
}

const buildRegionHighlightCollection = (
  scopeKey: string,
  geometry: GeoJSON.Geometry | null
): RegionHighlightCollection => {
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return {
      type: 'FeatureCollection',
      features: []
    }
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          scopeKey
        },
        geometry
      }
    ]
  }
}

const fetchGeoJson = async (bounds: MapBoundsBox) => {
  return await $fetch<PublicMapCollection>('/api/map/posts', {
    query: {
      west: bounds.west,
      south: bounds.south,
      east: bounds.east,
      north: bounds.north
    }
  })
}

const getSelectedPostCoordinates = async (postId: number): Promise<[number, number] | null> => {
  const selectedFeature = collection.value.features.find((feature) => feature.properties?.id === postId)

  if (selectedFeature?.geometry?.type === 'Point') {
    const coordinates = selectedFeature.geometry.coordinates
    const lng = Number(coordinates[0])
    const lat = Number(coordinates[1])
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return [lng, lat]
    }
  }

  try {
    const detail = await getPostDetail(postId)
    if (detail.publicLocation) {
      return [detail.publicLocation.lng, detail.publicLocation.lat]
    }
  } catch {
    // Keep map interaction smooth even if post detail fetch fails.
  }

  return null
}

const focusSelectedPost = async (postId: number) => {
  if (!mapRef.value || !postId) {
    return
  }

  const currentSequence = ++selectedPostFocusSequence
  const coordinates = await getSelectedPostCoordinates(postId)

  if (!coordinates || currentSequence !== selectedPostFocusSequence || !mapRef.value) {
    return
  }

  mapRef.value.easeTo({
    center: coordinates,
    zoom: Math.max(mapRef.value.getZoom(), SELECTED_POST_FOCUS_MIN_ZOOM),
    duration: 680
  })
}

const syncSelectionSource = () => {
  if (!mapRef.value) {
    return
  }

  const source = mapRef.value.getSource('selected-post') as GeoJSONSource | null
  if (!source) {
    return
  }

  const selectedFeature = collection.value.features.find((feature) => {
    return feature.properties?.id === props.selectedPostId
  })

  source.setData(selectedFeature
    ? {
        type: 'FeatureCollection',
        features: [selectedFeature]
      }
    : emptyCollection)
}

const syncRegionHighlightSource = () => {
  if (!mapRef.value) {
    return
  }

  const source = mapRef.value.getSource('region-highlight') as GeoJSONSource | null
  source?.setData(regionHighlightCollection.value)
}

const clearRegionHighlightSource = () => {
  regionHighlightCollection.value = {
    type: 'FeatureCollection',
    features: []
  }
  activeRegionBounds.value = null
  pendingRegionFitKey = null
  syncRegionHighlightSource()
}

const getRegionFitPadding = () => {
  if (import.meta.client && window.innerWidth <= 980) {
    return {
      top: 56,
      right: 44,
      bottom: Math.max(220, Math.round(window.innerHeight * 0.32)),
      left: 44
    }
  }

  return {
    top: 56,
    right: 56,
    bottom: 56,
    left: 56
  }
}

const fitPendingRegionBounds = () => {
  if (!mapRef.value || !pendingRegionFitKey || !activeRegionBounds.value) {
    return
  }

  mapRef.value.fitBounds(
    [
      [activeRegionBounds.value.west, activeRegionBounds.value.south],
      [activeRegionBounds.value.east, activeRegionBounds.value.north]
    ],
    {
      padding: getRegionFitPadding(),
      maxZoom: REGION_FIT_MAX_ZOOM,
      duration: REGION_FIT_DURATION_MS
    }
  )

  pendingRegionFitKey = null
}

const refreshSource = async () => {
  if (!mapRef.value) {
    return
  }

  const viewportBounds = getViewportBounds()
  if (viewportBounds && loadedBounds.value && isBoundsInside(viewportBounds, loadedBounds.value)) {
    return
  }

  const requestBounds = getExpandedViewportBounds()
  if (!requestBounds) {
    return
  }

  startMapLoading()
  try {
    const geojson = await fetchGeoJson(requestBounds)
    const nextCollection = geojson || emptyCollection

    loadedBounds.value = requestBounds
    collection.value = nextCollection

    const source = mapRef.value.getSource('posts') as GeoJSONSource | null
    source?.setData(nextCollection)
    syncSelectionSource()
  } catch {
    // Keep map interactive even if a fetch attempt fails.
  } finally {
    finishMapLoading()
  }
}

const ensureRegionHighlightLayers = () => {
  if (!mapRef.value) {
    return
  }

  const sourceName = 'region-highlight'
  const beforeId = mapRef.value.getLayer('clusters') ? 'clusters' : undefined
  const fillColor = isDark.value ? 'rgba(88, 199, 143, 0.12)' : 'rgba(22, 146, 95, 0.1)'
  const outlineColor = isDark.value ? 'rgba(88, 199, 143, 0.78)' : 'rgba(22, 146, 95, 0.68)'

  if (!mapRef.value.getSource(sourceName)) {
    mapRef.value.addSource(sourceName, {
      type: 'geojson',
      data: regionHighlightCollection.value
    })
  }

  if (!mapRef.value.getLayer('region-highlight-fill')) {
    mapRef.value.addLayer({
      id: 'region-highlight-fill',
      type: 'fill',
      source: sourceName,
      paint: {
        'fill-color': fillColor,
        'fill-opacity': 1
      }
    }, beforeId)
  }

  if (!mapRef.value.getLayer('region-highlight-outline')) {
    mapRef.value.addLayer({
      id: 'region-highlight-outline',
      type: 'line',
      source: sourceName,
      paint: {
        'line-color': outlineColor,
        'line-width': 2,
        'line-opacity': 0.92
      }
    }, beforeId)
  }
}

const ensurePostLayers = () => {
  if (!mapRef.value) {
    return
  }

  const sourceName = 'posts'
  const primaryColor = isDark.value ? '#58c78f' : '#16925f'
  const contrastColor = isDark.value ? '#0f120e' : '#f7f3ec'
  const activeHaloColor = isDark.value ? 'rgba(88, 199, 143, 0.24)' : 'rgba(22, 146, 95, 0.2)'

  if (!mapRef.value.getSource(sourceName)) {
    mapRef.value.addSource(sourceName, {
      type: 'geojson',
      data: collection.value,
      cluster: true,
      clusterMaxZoom: 10,
      clusterRadius: 16
    })
  }

  if (!mapRef.value.getSource('selected-post')) {
    mapRef.value.addSource('selected-post', {
      type: 'geojson',
      data: emptyCollection
    })
  }

  if (!mapRef.value.getLayer('clusters')) {
    mapRef.value.addLayer({
      id: 'clusters',
      type: 'circle',
      source: sourceName,
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'point_count'],
          1, 11,
          8, 18,
          25, 28,
          70, 40,
          160, 54
        ],
        'circle-color': primaryColor,
        'circle-stroke-width': 2,
        'circle-stroke-color': contrastColor
      }
    })
  }

  if (!mapRef.value.getLayer('cluster-count')) {
    mapRef.value.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: sourceName,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12
      },
      paint: {
        'text-color': contrastColor
      }
    })
  }

  if (!mapRef.value.getLayer('unclustered-point')) {
    mapRef.value.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: sourceName,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 7,
        'circle-color': primaryColor,
        'circle-stroke-width': 2,
        'circle-stroke-color': contrastColor
      }
    })
  }

  if (!mapRef.value.getLayer('selected-post-ring')) {
    mapRef.value.addLayer({
      id: 'selected-post-ring',
      type: 'circle',
      source: 'selected-post',
      paint: {
        'circle-radius': 16,
        'circle-color': activeHaloColor,
        'circle-stroke-width': 3,
        'circle-stroke-color': primaryColor
      }
    })
  }

  if (!mapRef.value.getLayer('selected-post-core')) {
    mapRef.value.addLayer({
      id: 'selected-post-core',
      type: 'circle',
      source: 'selected-post',
      paint: {
        'circle-radius': 8,
        'circle-color': primaryColor,
        'circle-stroke-width': 2,
        'circle-stroke-color': contrastColor
      }
    })
  }
}

const setupMapLayers = () => {
  ensureRegionHighlightLayers()
  ensurePostLayers()
}

const loadRegionHighlight = async (scope: RegionScope | null) => {
  const currentSequence = ++regionHighlightSequence
  const scopeKey = getRegionScopeKey(scope)

  if (!scope || !scopeKey) {
    clearRegionHighlightSource()
    return
  }

  pendingRegionFitKey = scopeKey

  try {
    const regionGeometry = await getRegionGeometry(scope)
    if (currentSequence !== regionHighlightSequence) {
      return
    }

    activeRegionBounds.value = regionGeometry.bbox
    regionHighlightCollection.value = buildRegionHighlightCollection(scopeKey, regionGeometry.geometry)
    syncRegionHighlightSource()

    if (!regionGeometry.bbox) {
      pendingRegionFitKey = null
      return
    }

    fitPendingRegionBounds()
  } catch {
    if (currentSequence !== regionHighlightSequence) {
      return
    }

    clearRegionHighlightSource()
  }
}

const applyPoliticalLabels = () => {
  if (!mapRef.value || !mapRef.value.isStyleLoaded()) {
    return
  }

  applyTaiwanProvinceLabelPolicy(mapRef.value, taiwanProvinceLabel.value)
}

watch([isDark, locale], ([dark]) => {
  if (!mapRef.value) {
    return
  }

  mapRef.value.setStyle(getMapStyleUrl(dark))

  mapRef.value.once('style.load', () => {
    applyPoliticalLabels()
    setupMapLayers()
    syncRegionHighlightSource()
    syncSelectionSource()
  })
})

onMounted(async () => {
  if (!mapEl.value) {
    return
  }

  startMapLoading()
  try {
    maplibregl = await import('maplibre-gl')

    mapRef.value = new maplibregl.Map({
      container: mapEl.value,
      style: getMapStyleUrl(),
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM
    })
  } catch {
    finishMapLoading()
    return
  }

  mapRef.value.on('load', async () => {
    try {
      const requestBounds = getExpandedViewportBounds()
      const geojson = requestBounds ? await fetchGeoJson(requestBounds) : null
      const nextCollection = geojson || emptyCollection

      if (requestBounds) {
        loadedBounds.value = requestBounds
      }

      collection.value = nextCollection

      applyPoliticalLabels()
      setupMapLayers()

      mapRef.value?.on('mouseenter', 'clusters', () => {
        mapRef.value?.getCanvas().style.setProperty('cursor', 'pointer')
      })

      mapRef.value?.on('mouseleave', 'clusters', () => {
        mapRef.value?.getCanvas().style.setProperty('cursor', '')
      })

      mapRef.value?.on('mouseenter', 'unclustered-point', () => {
        mapRef.value?.getCanvas().style.setProperty('cursor', 'pointer')
      })

      mapRef.value?.on('mouseleave', 'unclustered-point', () => {
        mapRef.value?.getCanvas().style.setProperty('cursor', '')
      })

      mapRef.value?.on('click', 'clusters', async (event) => {
        const features = mapRef.value?.queryRenderedFeatures(event.point, {
          layers: ['clusters']
        })
        const cluster = features?.[0]
        const clusterId = cluster?.properties?.cluster_id

        if (
          clusterId == null
          || !mapRef.value
          || !cluster
          || cluster.geometry.type !== 'Point'
        ) {
          return
        }

        const source = mapRef.value.getSource('posts') as GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(clusterId)
        const coordinates = (cluster.geometry as GeoJSON.Point).coordinates as [number, number]

        mapRef.value.easeTo({
          center: coordinates,
          zoom
        })
      })

      mapRef.value?.on('click', 'unclustered-point', (event) => {
        const feature = event.features?.[0]
        if (!feature?.properties) {
          return
        }

        const normalizedProps = normalizeProperties(feature.properties)
        emit('select-post', normalizedProps.id)
      })

      mapRef.value?.on('moveend', () => {
        void refreshSource()
      })

      syncSelectionSource()
      syncRegionHighlightSource()
      fitPendingRegionBounds()

      if (props.selectedPostId) {
        void focusSelectedPost(props.selectedPostId)
      }
    } finally {
      finishMapLoading()
    }
  })
})

watch(
  () => props.selectedPostId,
  (selectedPostId) => {
    syncSelectionSource()

    if (selectedPostId) {
      void focusSelectedPost(selectedPostId)
    }
  }
)

watch(
  () => [
    props.highlightRegionScope?.countryName || '',
    props.highlightRegionScope?.regionName || '',
    props.highlightRegionScope?.cityName || ''
  ],
  () => {
    void loadRegionHighlight(props.highlightRegionScope)
  },
  { immediate: true }
)

watch(
  () => locale.value,
  () => {
    applyPoliticalLabels()
    void loadRegionHighlight(props.highlightRegionScope)
    syncSelectionSource()
    syncRegionHighlightSource()
  }
)

onBeforeUnmount(() => {
  mapRef.value?.remove()
})
</script>

<template>
  <div class="map-stage">
    <div ref="mapEl" class="map-canvas" />
    <Transition name="map-loading-indicator">
      <div
        v-if="isMapLoading"
        class="map-loading-indicator"
        role="status"
        aria-live="polite"
        :aria-label="t('map.loading')"
      >
        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true" />
        <span class="sr-only">{{ t('map.loading') }}</span>
      </div>
    </Transition>
  </div>
</template>
