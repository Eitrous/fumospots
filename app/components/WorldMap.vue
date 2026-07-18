<script setup lang="ts">
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapSourceDataEvent } from 'maplibre-gl'
import type {
  GeoBounds,
  PublicMapPointCollection,
  PublicMapPreviewItem,
  PublicMapPreviewResponse,
  RegionScope
} from '~~/shared/fumo'
import {
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM
} from '~~/shared/fumo'
import { resolveHostedMapStyleUrl } from '~~/shared/mapStyle'
import { applyTaiwanProvinceLabelPolicy } from '~~/app/composables/useMapPoliticalLabels'
import {
  BASE_MAP_HEALTH_CHECK_DELAY_MS,
  BASE_MAP_HEALTH_CONFIRM_DELAY_MS,
  BASE_MAP_RECOVERY_MAX_ATTEMPTS,
  BASE_MAP_RECOVERY_RETRY_DELAYS_MS,
  BASE_MAP_SOURCE_NAME,
  hasRenderedBaseMapFeatures as hasVisibleBaseMapFeatures,
  isBaseMapErrorEvent,
  isBaseMapSourceLoaded as isSharedBaseMapSourceLoaded
} from '~~/app/composables/useBaseMapHealth'

const props = withDefaults(defineProps<{
  selectedPostId?: number | null
  highlightRegionScope?: RegionScope | null
}>(), {
  selectedPostId: null,
  highlightRegionScope: null
})

type RegionHighlightProperties = {
  scopeKey: string
}

type RegionHighlightCollection = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  RegionHighlightProperties
>

type DisplayPointProperties = {
  display_key?: string
  id?: number
  marker_opacity?: number
  marker_scale?: number
  point_count?: number
  point_count_abbreviated?: string
  cluster_group_id?: string
  cluster_mode?: 'zoom' | 'preview'
}

type DisplayPointCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  DisplayPointProperties
>

type RawPointFeature = PublicMapPointCollection['features'][number]

type ScreenPointMember = {
  adjustedLng: number
  feature: RawPointFeature
  id: number
  lat: number
  lng: number
  x: number
  y: number
}

type CollisionNode = {
  adjustedLng: number
  collisionRadiusPx: number
  lat: number
  rawMembers: ScreenPointMember[]
  x: number
  y: number
}

type DisplayClusterState = {
  bounds: [[number, number], [number, number]]
  center: [number, number]
  key: string
  memberIds: number[]
  mode: 'zoom' | 'preview'
  screenMembers: ScreenPointMember[]
  screenPoint: {
    x: number
    y: number
  }
}

const emit = defineEmits<{
  'select-post': [postId: number]
  'fly-completed': []
}>()


const { t, locale } = useI18n()
const { isDark } = useTheme()
const config = useRuntimeConfig()
const { getPostDetail } = usePostDetailCache()
const { getRegionGeometry } = useRegionGeometryCache()
useMapResourceHints()

const MOBILE_BREAKPOINT = 980
const LOW_ZOOM_PMTILES_CACHE_MAX_ZOOM = 4
const MAX_PREVIEW_FETCH_ITEMS = 100
const BASEMAP_TILE_LOADING_MAX_MS = 5000
const BASEMAP_TILE_LOADING_INTERACTION_SETTLE_MS = 1200
const CLUSTER_BUBBLE_STROKE_WIDTH_PX = 2
const CLUSTER_ZOOM_FIT_DURATION_MS = 620
const CLUSTER_ZOOM_BREAKOUT_MARGIN = 0.1
const CLUSTER_ZOOM_BREAKOUT_STEP = 0.25
const CLUSTER_ZOOM_STEP = 0.85
const MARKER_APPEAR_DURATION_MS = 240
const MARKER_APPEAR_START_OPACITY = 0.62
const MARKER_APPEAR_START_SCALE = 0.35
const MARKER_COLLISION_GAP_PX = 4
const POINT_MARKER_FILL_RADIUS_PX = 7
const POINT_MARKER_OUTER_RADIUS_PX = POINT_MARKER_FILL_RADIUS_PX + CLUSTER_BUBBLE_STROKE_WIDTH_PX
const PREVIEW_SHEET_CLOSE_THRESHOLD_PX = 92
const REGION_FIT_DURATION_MS = 720
const REGION_FIT_MAX_ZOOM = 10
const SELECTED_POST_FAR_DISTANCE_DEGREES = 26
const SELECTED_POST_FAR_FOCUS_DURATION_MS = 3200
const SELECTED_POST_FOCUS_DURATION_MS = 1600
const SELECTED_POST_FOCUS_MIN_ZOOM = 6.8
const SELECTED_POST_FOCUS_OVERVIEW_ZOOM = 4.2
const DESKTOP_PREVIEW_ANCHOR_GAP_PX = 20
const DESKTOP_PREVIEW_MARGIN_PX = 12
const DESKTOP_PREVIEW_OFFSET_PX = 14
const DESKTOP_PREVIEW_WIDTH_PX = 288
const SAME_COORDINATE_EPSILON = 0.000001

const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<MapLibreMap | null>(null)
const mapLoadingRequests = ref(0)
const baseMapTileLoadingRequests = ref(0)
const isMapLoading = computed(() => mapLoadingRequests.value > 0 || baseMapTileLoadingRequests.value > 0)
const taiwanProvinceLabel = computed(() => t('map.taiwanProvinceLabel'))
const viewportWidth = ref(import.meta.client ? window.innerWidth : MOBILE_BREAKPOINT + 1)
const isMobileViewport = computed(() => viewportWidth.value <= MOBILE_BREAKPOINT)
const collection = shallowRef<PublicMapPointCollection>({
  type: 'FeatureCollection',
  features: []
})
const displayCollection = shallowRef<DisplayPointCollection>({
  type: 'FeatureCollection',
  features: []
})
const regionHighlightCollection = shallowRef<RegionHighlightCollection>({
  type: 'FeatureCollection',
  features: []
})
const activeRegionBounds = shallowRef<GeoBounds | null>(null)
const activePreviewGroupKey = ref('')
const activePreviewAnchor = shallowRef<{ x: number, y: number } | null>(null)
const activePreviewMemberIds = ref<number[]>([])
const previewItems = ref<PublicMapPreviewItem[]>([])
const previewLoading = ref(false)
const previewError = ref('')
const previewSheetDragOffset = ref(0)
const previewSheetDragging = ref(false)
const previewSurfaceClass = computed(() => ({
  'is-dark': isDark.value
}))

const hasActivePreview = computed(() => Boolean(activePreviewGroupKey.value))
const previewListLabel = computed(() => t('map.previewListLabel'))

const desktopPreviewStyle = computed(() => {
  if (isMobileViewport.value || !activePreviewAnchor.value || !mapEl.value) {
    return {}
  }

  const anchorX = activePreviewAnchor.value.x
  const anchorY = activePreviewAnchor.value.y
  const width = mapEl.value.clientWidth
  const height = mapEl.value.clientHeight
  const maxHeight = Math.max(180, Math.min(height - (DESKTOP_PREVIEW_MARGIN_PX * 2), 448))
  const maxLeft = Math.max(DESKTOP_PREVIEW_MARGIN_PX, width - DESKTOP_PREVIEW_MARGIN_PX - DESKTOP_PREVIEW_WIDTH_PX)
  const maxTop = Math.max(DESKTOP_PREVIEW_MARGIN_PX, height - DESKTOP_PREVIEW_MARGIN_PX - maxHeight)
  const centeredSideTop = clamp(
    anchorY - (maxHeight / 2),
    DESKTOP_PREVIEW_MARGIN_PX,
    maxTop
  )

  const placements = [
    {
      left: anchorX + DESKTOP_PREVIEW_ANCHOR_GAP_PX,
      top: centeredSideTop
    },
    {
      left: anchorX - DESKTOP_PREVIEW_ANCHOR_GAP_PX - DESKTOP_PREVIEW_WIDTH_PX,
      top: centeredSideTop
    },
    {
      left: anchorX + DESKTOP_PREVIEW_ANCHOR_GAP_PX,
      top: anchorY + DESKTOP_PREVIEW_OFFSET_PX
    },
    {
      left: anchorX - DESKTOP_PREVIEW_ANCHOR_GAP_PX - DESKTOP_PREVIEW_WIDTH_PX,
      top: anchorY + DESKTOP_PREVIEW_OFFSET_PX
    },
    {
      left: anchorX + DESKTOP_PREVIEW_ANCHOR_GAP_PX,
      top: anchorY - DESKTOP_PREVIEW_OFFSET_PX - maxHeight
    },
    {
      left: anchorX - DESKTOP_PREVIEW_ANCHOR_GAP_PX - DESKTOP_PREVIEW_WIDTH_PX,
      top: anchorY - DESKTOP_PREVIEW_OFFSET_PX - maxHeight
    }
  ]

  for (const placement of placements) {
    if (
      placement.left >= DESKTOP_PREVIEW_MARGIN_PX
      && placement.left <= maxLeft
      && placement.top >= DESKTOP_PREVIEW_MARGIN_PX
      && placement.top <= maxTop
    ) {
      return {
        left: `${placement.left}px`,
        maxHeight: `${maxHeight}px`,
        top: `${placement.top}px`
      }
    }
  }

  return {
    left: `${clamp(anchorX + DESKTOP_PREVIEW_ANCHOR_GAP_PX, DESKTOP_PREVIEW_MARGIN_PX, maxLeft)}px`,
    maxHeight: `${maxHeight}px`,
    top: `${centeredSideTop}px`
  }
})

const mobilePreviewSheetStyle = computed(() => {
  return {
    '--preview-sheet-drag-offset': `${previewSheetDragOffset.value}px`
  }
})

let maplibregl: typeof import('maplibre-gl') | null = null

let selectedPostFocusSequence = 0
let regionHighlightSequence = 0
let refreshSourceSequence = 0
let mapStyleSequence = 0
let previewRequestSequence = 0
let pendingRegionFitKey: string | null = null
let mapInteractionsBound = false
let initialSourceLoaded = false
let initialSourceLoadScheduled = false
let mapPostsAbortController: AbortController | null = null
let mapResizeObserver: ResizeObserver | null = null
let mapResizeFrame: number | null = null
let mapRuntimeSyncFrame: number | null = null
let mapDisplaySyncFrame: number | null = null
let markerAppearAnimationFrame: number | null = null
let baseMapHealthCheckTimer: number | null = null
let baseMapRecoveryTimer: number | null = null
let baseMapTileLoadingFallbackTimer: number | null = null
let baseMapTileLoadingInteractionTimer: number | null = null
let baseMapTileLoadingInteractionActive = false
let baseMapReady = false
let baseMapRecoveryAttempts = 0
let lowZoomWarmupAbortController: AbortController | null = null
let pendingStyleSourceRefresh = false
let previewSheetPointerId: number | null = null
let previewSheetPointerStartY = 0
let previewOpenedAt = 0
let displayClusterStateByKey = new Map<string, DisplayClusterState>()
let displayFeatureKeys = new Set<string>()
const markerAppearStartByKey = new Map<string, number>()
const previewGroupCache = new Map<string, PublicMapPreviewItem[]>()

const getMapStyleUrl = (dark = isDark.value) => {
  return resolveHostedMapStyleUrl({
    theme: dark ? 'dark' : 'light',
    locale: locale.value,
    lightStyleUrl: config.public.mapStyleUrl,
    darkStyleUrl: config.public.mapDarkStyleUrl
  })
}

useHead(() => ({
  link: [
    {
      key: 'map-style-preload',
      rel: 'preload',
      as: 'fetch',
      href: getMapStyleUrl(),
      crossorigin: ''
    }
  ]
}))

const emptyCollection: PublicMapPointCollection = {
  type: 'FeatureCollection',
  features: []
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

const easeOutCubic = (progress: number) => {
  return 1 - Math.pow(1 - progress, 3)
}

const normalizeLongitude = (lng: number) => {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

const normalizeLongitudeRelativeTo = (lng: number, referenceLng: number) => {
  let adjusted = lng

  while (adjusted - referenceLng > 180) {
    adjusted -= 360
  }

  while (adjusted - referenceLng < -180) {
    adjusted += 360
  }

  return adjusted
}

const getWrappedLongitudeDelta = (from: number, to: number) => {
  return Math.abs(normalizeLongitude(to - from))
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

const formatClusterCount = (count: number) => {
  if (count >= 1000000) {
    return `${Math.round(count / 100000) / 10}M`
  }

  if (count >= 1000) {
    return `${Math.round(count / 100) / 10}K`
  }

  return String(count)
}

const getDisplayFeatureKey = (feature: GeoJSON.Feature<GeoJSON.Point, DisplayPointProperties>) => {
  const pointCount = Number(feature.properties?.point_count)
  const clusterKey = feature.properties?.cluster_group_id

  if (Number.isFinite(pointCount) && pointCount > 0 && typeof clusterKey === 'string' && clusterKey) {
    return `cluster:${clusterKey}`
  }

  const id = Number(feature.properties?.id)
  return Number.isInteger(id) && id > 0 ? `post:${id}` : ''
}

const getMarkerAppearState = (displayKey: string, now: number, isNewFeature: boolean) => {
  if (!displayKey) {
    return {
      opacity: 1,
      scale: 1
    }
  }

  let startAt = markerAppearStartByKey.get(displayKey)

  if (startAt == null && isNewFeature) {
    startAt = now
    markerAppearStartByKey.set(displayKey, startAt)
  }

  if (startAt == null) {
    return {
      opacity: 1,
      scale: 1
    }
  }

  const progress = clamp((now - startAt) / MARKER_APPEAR_DURATION_MS, 0, 1)
  const easedProgress = easeOutCubic(progress)

  if (progress >= 1) {
    markerAppearStartByKey.delete(displayKey)
    return {
      opacity: 1,
      scale: 1
    }
  }

  return {
    opacity: MARKER_APPEAR_START_OPACITY + ((1 - MARKER_APPEAR_START_OPACITY) * easedProgress),
    scale: MARKER_APPEAR_START_SCALE + ((1 - MARKER_APPEAR_START_SCALE) * easedProgress)
  }
}

const scheduleMarkerAppearAnimation = () => {
  if (!import.meta.client || markerAppearAnimationFrame !== null || !markerAppearStartByKey.size) {
    return
  }

  markerAppearAnimationFrame = window.requestAnimationFrame(() => {
    markerAppearAnimationFrame = null

    if (!mapRef.value || !displayCollection.value.features.length || !markerAppearStartByKey.size) {
      return
    }

    const now = performance.now()
    let hasActiveAnimation = false
    let hasFeatureChange = false
    const nextFeatures = displayCollection.value.features.map((feature) => {
      const displayKey = getDisplayFeatureKey(feature)

      if (!displayKey) {
        return feature
      }

      const nextState = getMarkerAppearState(displayKey, now, false)
      if (nextState.scale < 1 || nextState.opacity < 1) {
        hasActiveAnimation = true
      }

      if (
        feature.properties?.marker_scale === nextState.scale
        && feature.properties?.marker_opacity === nextState.opacity
      ) {
        return feature
      }

      hasFeatureChange = true
      return {
        ...feature,
        properties: {
          ...feature.properties,
          marker_opacity: nextState.opacity,
          marker_scale: nextState.scale
        }
      }
    })

    if (hasFeatureChange) {
      displayCollection.value = {
        ...displayCollection.value,
        features: nextFeatures
      }
      const source = mapRef.value.getSource('posts') as GeoJSONSource | null
      source?.setData(displayCollection.value)
    }

    if (hasActiveAnimation) {
      scheduleMarkerAppearAnimation()
    }
  })
}

const startMapLoading = () => {
  mapLoadingRequests.value += 1
}

const finishMapLoading = () => {
  mapLoadingRequests.value = Math.max(0, mapLoadingRequests.value - 1)
}

const clearBaseMapTileLoadingFallbackTimer = () => {
  if (!import.meta.client || baseMapTileLoadingFallbackTimer === null) {
    return
  }

  window.clearTimeout(baseMapTileLoadingFallbackTimer)
  baseMapTileLoadingFallbackTimer = null
}

const clearBaseMapTileLoadingInteractionTimer = () => {
  if (!import.meta.client || baseMapTileLoadingInteractionTimer === null) {
    return
  }

  window.clearTimeout(baseMapTileLoadingInteractionTimer)
  baseMapTileLoadingInteractionTimer = null
}

const clearBaseMapTileLoading = () => {
  clearBaseMapTileLoadingFallbackTimer()
  baseMapTileLoadingRequests.value = 0
}

const resetBaseMapTileLoading = () => {
  baseMapTileLoadingInteractionActive = false
  clearBaseMapTileLoadingInteractionTimer()
  clearBaseMapTileLoading()
}

const isBaseMapTileLoadingEvent = (event: Partial<MapSourceDataEvent>) => {
  return event.sourceId === BASE_MAP_SOURCE_NAME && Boolean(event.tile)
}

const isBaseMapTileSourceIdle = () => {
  if (!mapRef.value?.getSource(BASE_MAP_SOURCE_NAME)) {
    return true
  }

  return isSharedBaseMapSourceLoaded(mapRef.value)
}

const scheduleBaseMapTileLoadingFallback = () => {
  if (!import.meta.client) {
    return
  }

  clearBaseMapTileLoadingFallbackTimer()
  baseMapTileLoadingFallbackTimer = window.setTimeout(() => {
    baseMapTileLoadingFallbackTimer = null
    clearBaseMapTileLoading()
  }, BASEMAP_TILE_LOADING_MAX_MS)
}

const startBaseMapTileLoading = (event: MapSourceDataEvent) => {
  if (!isBaseMapTileLoadingEvent(event)) {
    return
  }

  if (!baseMapTileLoadingInteractionActive) {
    return
  }

  baseMapTileLoadingRequests.value = 1
  scheduleBaseMapTileLoadingFallback()
}

const finishBaseMapTileLoading = (event: Partial<MapSourceDataEvent>) => {
  if (event.sourceId !== BASE_MAP_SOURCE_NAME) {
    return
  }

  if (event.isSourceLoaded || isBaseMapTileSourceIdle()) {
    clearBaseMapTileLoading()
  } else if (baseMapTileLoadingRequests.value > 0) {
    scheduleBaseMapTileLoadingFallback()
  }
}

const syncBaseMapTileLoadingState = () => {
  if (baseMapTileLoadingRequests.value > 0 && isBaseMapTileSourceIdle()) {
    clearBaseMapTileLoading()
  }
}

const handleBaseMapViewportLoadingStart = () => {
  baseMapTileLoadingInteractionActive = true
  clearBaseMapTileLoadingInteractionTimer()
}

const handleBaseMapViewportLoadingEnd = () => {
  if (!import.meta.client) {
    baseMapTileLoadingInteractionActive = false
    clearBaseMapTileLoading()
    return
  }

  clearBaseMapTileLoadingInteractionTimer()
  baseMapTileLoadingInteractionTimer = window.setTimeout(() => {
    baseMapTileLoadingInteractionTimer = null
    baseMapTileLoadingInteractionActive = false
    syncBaseMapTileLoadingState()
  }, BASEMAP_TILE_LOADING_INTERACTION_SETTLE_MS)
}

const clearBaseMapHealthCheckTimer = () => {
  if (!import.meta.client || baseMapHealthCheckTimer === null) {
    return
  }

  window.clearTimeout(baseMapHealthCheckTimer)
  baseMapHealthCheckTimer = null
}

const clearBaseMapRecoveryTimer = () => {
  if (!import.meta.client || baseMapRecoveryTimer === null) {
    return
  }

  window.clearTimeout(baseMapRecoveryTimer)
  baseMapRecoveryTimer = null
}

const prepareBaseMapForStyleLoad = (options: { resetAttempts?: boolean } = {}) => {
  baseMapReady = false
  resetBaseMapTileLoading()
  clearBaseMapHealthCheckTimer()
  clearBaseMapRecoveryTimer()

  if (options.resetAttempts !== false) {
    baseMapRecoveryAttempts = 0
  }
}

const hasRenderedBaseMapFeatures = () => {
  return hasVisibleBaseMapFeatures(mapRef.value)
}

const markBaseMapReadyIfVisible = () => {
  if (baseMapReady) {
    return true
  }

  if (!hasRenderedBaseMapFeatures()) {
    return false
  }

  baseMapReady = true
  baseMapRecoveryAttempts = 0
  clearBaseMapHealthCheckTimer()
  clearBaseMapRecoveryTimer()
  scheduleLowZoomMapWarmup()
  return true
}

const getFeaturePostId = (raw: Record<string, unknown> | null | undefined) => {
  const id = Number(raw?.id)
  return Number.isFinite(id) ? id : null
}

const getClusterGroupId = (raw: Record<string, unknown> | null | undefined) => {
  const groupId = raw?.cluster_group_id
  return typeof groupId === 'string' && groupId ? groupId : ''
}

const updateViewportWidth = () => {
  if (!import.meta.client) {
    return
  }

  viewportWidth.value = window.innerWidth
}

const closeActivePreview = () => {
  activePreviewGroupKey.value = ''
  activePreviewAnchor.value = null
  activePreviewMemberIds.value = []
  previewItems.value = []
  previewLoading.value = false
  previewError.value = ''
  previewSheetDragOffset.value = 0
  previewSheetDragging.value = false
  previewRequestSequence += 1
  teardownPreviewSheetPointerListeners()
}

const canClosePreviewFromSurfaceClick = () => {
  return Date.now() - previewOpenedAt > 180
}

const handlePreviewDismissRequest = () => {
  if (!canClosePreviewFromSurfaceClick()) {
    return
  }

  closeActivePreview()
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

const fetchGeoJson = async (
  signal?: AbortSignal,
  options: { force?: boolean } = {}
) => {
  const query: Record<string, string> = {}

  if (options.force) {
    query.refresh = String(Date.now())
  }

  return await $fetch<PublicMapPointCollection>('/api/map/posts', {
    signal,
    query
  })
}

const fetchInitialMapStyle = async () => {
  const styleUrl = getMapStyleUrl()
  const options = {
    taiwanProvinceLabel: taiwanProvinceLabel.value
  }

  try {
    return await fetchHostedMapStyle(styleUrl, options)
  } catch {
    await new Promise(resolve => window.setTimeout(resolve, 160))
    return await fetchHostedMapStyle(styleUrl, options)
  }
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
    emit('fly-completed')
    return
  }

  const currentSequence = ++selectedPostFocusSequence
  const coordinates = await getSelectedPostCoordinates(postId)

  if (!coordinates || currentSequence !== selectedPostFocusSequence || !mapRef.value) {
    emit('fly-completed')
    return
  }

  const currentZoom = mapRef.value.getZoom()
  const currentCenter = mapRef.value.getCenter()
  const targetZoom = Math.max(currentZoom, SELECTED_POST_FOCUS_MIN_ZOOM)
  const distanceDegrees = Math.max(
    getWrappedLongitudeDelta(currentCenter.lng, coordinates[0]),
    Math.abs(currentCenter.lat - coordinates[1])
  )
  const shouldUseOverviewFlight = (
    distanceDegrees >= SELECTED_POST_FAR_DISTANCE_DEGREES
    && Math.min(currentZoom, targetZoom) > SELECTED_POST_FOCUS_OVERVIEW_ZOOM
  )

  mapRef.value.once('moveend', () => {
    if (currentSequence === selectedPostFocusSequence) {
      emit('fly-completed')
    }
  })

  mapRef.value.flyTo({
    center: coordinates,
    zoom: targetZoom,
    duration: shouldUseOverviewFlight
      ? SELECTED_POST_FAR_FOCUS_DURATION_MS
      : SELECTED_POST_FOCUS_DURATION_MS,
    essential: true,
    ...(shouldUseOverviewFlight ? { minZoom: SELECTED_POST_FOCUS_OVERVIEW_ZOOM } : {})
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
  if (import.meta.client && window.innerWidth <= MOBILE_BREAKPOINT) {
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

const getClusterBreakoutPadding = () => {
  const basePadding = getRegionFitPadding()

  if (!import.meta.client || !mapEl.value) {
    return basePadding
  }

  return {
    top: Math.max(basePadding.top, Math.round(mapEl.value.clientHeight * 0.15)),
    right: Math.max(basePadding.right, Math.round(mapEl.value.clientWidth * 0.15)),
    bottom: Math.max(basePadding.bottom, Math.round(mapEl.value.clientHeight * 0.15)),
    left: Math.max(basePadding.left, Math.round(mapEl.value.clientWidth * 0.15))
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

const isAbortError = (error: unknown) => {
  return error instanceof Error && error.name === 'AbortError'
}

const getClusterBubbleFillRadiusPx = (pointCount: number) => {
  if (pointCount <= 1) {
    return POINT_MARKER_FILL_RADIUS_PX
  }

  const stops = [
    [1, 11],
    [8, 18],
    [25, 28],
    [70, 40],
    [160, 54]
  ] as const

  if (pointCount <= stops[0][0]) {
    return stops[0][1]
  }

  for (let index = 1; index < stops.length; index += 1) {
    const [rightCount, rightRadius] = stops[index]
    const [leftCount, leftRadius] = stops[index - 1]

    if (pointCount <= rightCount) {
      const progress = (pointCount - leftCount) / (rightCount - leftCount)
      return leftRadius + ((rightRadius - leftRadius) * progress)
    }
  }

  return stops[stops.length - 1][1]
}

const getDisplayedMarkerOuterRadiusPx = (pointCount: number) => {
  if (pointCount <= 1) {
    return POINT_MARKER_OUTER_RADIUS_PX
  }

  return getClusterBubbleFillRadiusPx(pointCount) + CLUSTER_BUBBLE_STROKE_WIDTH_PX
}

const collectVisiblePointMembers = () => {
  if (!mapRef.value || !mapEl.value) {
    return [] as ScreenPointMember[]
  }

  const centerLng = mapRef.value.getCenter().lng
  const members: ScreenPointMember[] = []

  for (const feature of collection.value.features) {
    if (feature.geometry.type !== 'Point') {
      continue
    }

    const coordinates = feature.geometry.coordinates
    const lng = Number(coordinates[0])
    const lat = Number(coordinates[1])
    const id = Number(feature.properties?.id)

    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isInteger(id) || id <= 0) {
      continue
    }

    const adjustedLng = normalizeLongitudeRelativeTo(lng, centerLng)
    const projected = mapRef.value.project([adjustedLng, lat])

    members.push({
      adjustedLng,
      feature,
      id,
      lat,
      lng,
      x: projected.x,
      y: projected.y
    })
  }

  return members
}

const createCollisionNodeFromRawMembers = (rawMembers: ScreenPointMember[]): CollisionNode => {
  const memberCount = rawMembers.length

  return {
    adjustedLng: rawMembers.reduce((sum, member) => sum + member.adjustedLng, 0) / memberCount,
    collisionRadiusPx: getDisplayedMarkerOuterRadiusPx(memberCount),
    lat: rawMembers.reduce((sum, member) => sum + member.lat, 0) / memberCount,
    rawMembers,
    x: rawMembers.reduce((sum, member) => sum + member.x, 0) / memberCount,
    y: rawMembers.reduce((sum, member) => sum + member.y, 0) / memberCount
  }
}

const clusterCollisionNodes = (nodes: CollisionNode[], gapPx: number) => {
  if (!nodes.length) {
    return [] as CollisionNode[][]
  }

  const maxCollisionDistance = nodes.reduce((maxDistance, node) => {
    return Math.max(maxDistance, (node.collisionRadiusPx * 2) + gapPx)
  }, 0)
  const cellSize = Math.max(1, maxCollisionDistance)
  const cells = new Map<string, number[]>()
  const cellXByIndex: number[] = []
  const cellYByIndex: number[] = []

  nodes.forEach((node, index) => {
    const cellX = Math.floor(node.x / cellSize)
    const cellY = Math.floor(node.y / cellSize)
    const key = `${cellX}:${cellY}`
    const bucket = cells.get(key) || []
    bucket.push(index)
    cells.set(key, bucket)
    cellXByIndex[index] = cellX
    cellYByIndex[index] = cellY
  })

  const visited = new Array(nodes.length).fill(false)
  const groups: CollisionNode[][] = []

  for (let index = 0; index < nodes.length; index += 1) {
    if (visited[index]) {
      continue
    }

    visited[index] = true
    const queue = [index]
    const group: CollisionNode[] = []

    while (queue.length) {
      const currentIndex = queue.pop()
      if (currentIndex == null) {
        continue
      }

      const current = nodes[currentIndex]
      group.push(current)

      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          const bucket = cells.get(`${cellXByIndex[currentIndex] + xOffset}:${cellYByIndex[currentIndex] + yOffset}`)
          if (!bucket?.length) {
            continue
          }

          for (const candidateIndex of bucket) {
            if (visited[candidateIndex]) {
              continue
            }

            const candidate = nodes[candidateIndex]
            const dx = candidate.x - current.x
            const dy = candidate.y - current.y
            const collisionDistance = current.collisionRadiusPx + candidate.collisionRadiusPx + gapPx

            if ((dx * dx) + (dy * dy) >= (collisionDistance * collisionDistance)) {
              continue
            }

            visited[candidateIndex] = true
            queue.push(candidateIndex)
          }
        }
      }
    }

    groups.push(group)
  }

  return groups
}

const mergeCollisionNodeGroup = (nodes: CollisionNode[]) => {
  return createCollisionNodeFromRawMembers(nodes.flatMap(node => node.rawMembers))
}

const resolveDisplayCollisionGroups = (rawMembers: ScreenPointMember[]) => {
  if (!rawMembers.length) {
    return [] as ScreenPointMember[][]
  }

  let currentNodes = clusterCollisionNodes(
    rawMembers.map(member => ({
      adjustedLng: member.adjustedLng,
      collisionRadiusPx: POINT_MARKER_OUTER_RADIUS_PX,
      lat: member.lat,
      rawMembers: [member],
      x: member.x,
      y: member.y
    })),
    MARKER_COLLISION_GAP_PX
  ).map(group => group.length === 1 ? group[0] : mergeCollisionNodeGroup(group))

  while (true) {
    const nextGroups = clusterCollisionNodes(currentNodes, MARKER_COLLISION_GAP_PX)
    if (nextGroups.every(group => group.length === 1)) {
      return currentNodes.map(node => node.rawMembers)
    }

    currentNodes = nextGroups.map(group => group.length === 1 ? group[0] : mergeCollisionNodeGroup(group))
  }
}

const scaleScreenPointMembers = (members: ScreenPointMember[], scale: number) => {
  return members.map(member => ({
    ...member,
    x: member.x * scale,
    y: member.y * scale
  }))
}

const buildClusterState = (members: ScreenPointMember[]): DisplayClusterState => {
  const sortedIds = members
    .map(member => member.id)
    .slice()
    .sort((left, right) => left - right)
  const key = sortedIds.join(':')
  const centerAdjustedLng = members.reduce((sum, member) => sum + member.adjustedLng, 0) / members.length
  const centerLat = members.reduce((sum, member) => sum + member.lat, 0) / members.length
  const centerX = members.reduce((sum, member) => sum + member.x, 0) / members.length
  const centerY = members.reduce((sum, member) => sum + member.y, 0) / members.length
  const minAdjustedLng = Math.min(...members.map(member => member.adjustedLng))
  const maxAdjustedLng = Math.max(...members.map(member => member.adjustedLng))
  const minLat = Math.min(...members.map(member => member.lat))
  const maxLat = Math.max(...members.map(member => member.lat))

  const sameCoordinates = (
    Math.abs(maxAdjustedLng - minAdjustedLng) <= SAME_COORDINATE_EPSILON
    && Math.abs(maxLat - minLat) <= SAME_COORDINATE_EPSILON
  )

  const mapMaxZoom = mapRef.value?.getMaxZoom() ?? 22
  const currentZoom = mapRef.value?.getZoom() ?? MAP_DEFAULT_ZOOM
  const scaleAtMaxZoom = Math.pow(2, Math.max(0, mapMaxZoom - currentZoom))
  const simulatedMaxZoomGroups = resolveDisplayCollisionGroups(
    scaleScreenPointMembers(members, scaleAtMaxZoom)
  )

  return {
    bounds: [
      [normalizeLongitude(minAdjustedLng), minLat],
      [normalizeLongitude(maxAdjustedLng), maxLat]
    ],
    center: [normalizeLongitude(centerAdjustedLng), centerLat],
    key,
    memberIds: sortedIds,
    mode: sameCoordinates || simulatedMaxZoomGroups.length < 2 ? 'preview' : 'zoom',
    screenMembers: members.map(member => ({ ...member })),
    screenPoint: {
      x: centerX,
      y: centerY
    }
  }
}

const syncDisplaySource = () => {
  if (!mapRef.value) {
    return
  }

  const visibleMembers = collectVisiblePointMembers()
  const previousDisplayKeys = displayFeatureKeys
  const nextDisplayKeys = new Set<string>()
  const now = import.meta.client ? performance.now() : 0
  const nextDisplayCollection: DisplayPointCollection = {
    type: 'FeatureCollection',
    features: []
  }
  const nextClusterStateByKey = new Map<string, DisplayClusterState>()

  if (!visibleMembers.length) {
    displayCollection.value = nextDisplayCollection
    displayClusterStateByKey = nextClusterStateByKey
    const source = mapRef.value.getSource('posts') as GeoJSONSource | null
    source?.setData(nextDisplayCollection)
    closeActivePreview()
    return
  }

  const groups = resolveDisplayCollisionGroups(visibleMembers)

  for (const group of groups) {
    if (group.length === 1) {
      const baseFeature = group[0].feature
      const displayKey = `post:${group[0].id}`
      const markerState = getMarkerAppearState(displayKey, now, !previousDisplayKeys.has(displayKey))
      nextDisplayKeys.add(displayKey)
      nextDisplayCollection.features.push({
        ...baseFeature,
        properties: {
          ...baseFeature.properties,
          display_key: displayKey,
          marker_opacity: markerState.opacity,
          marker_scale: markerState.scale
        }
      })
      continue
    }

    const clusterState = buildClusterState(group)
    const displayKey = `cluster:${clusterState.key}`
    const markerState = getMarkerAppearState(displayKey, now, !previousDisplayKeys.has(displayKey))
    nextDisplayKeys.add(displayKey)
    nextClusterStateByKey.set(clusterState.key, clusterState)
    nextDisplayCollection.features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: clusterState.center
      },
      properties: {
        display_key: displayKey,
        cluster_group_id: clusterState.key,
        cluster_mode: clusterState.mode,
        marker_opacity: markerState.opacity,
        marker_scale: markerState.scale,
        point_count: clusterState.memberIds.length,
        point_count_abbreviated: formatClusterCount(clusterState.memberIds.length)
      }
    })
  }

  displayCollection.value = nextDisplayCollection
  displayClusterStateByKey = nextClusterStateByKey
  displayFeatureKeys = nextDisplayKeys
  for (const displayKey of [...markerAppearStartByKey.keys()]) {
    if (!nextDisplayKeys.has(displayKey)) {
      markerAppearStartByKey.delete(displayKey)
    }
  }
  const source = mapRef.value.getSource('posts') as GeoJSONSource | null
  source?.setData(nextDisplayCollection)
  scheduleMarkerAppearAnimation()

  if (!activePreviewGroupKey.value || !activePreviewMemberIds.value.length) {
    return
  }

  const nextPreviewCluster = displayClusterStateByKey.get(activePreviewGroupKey.value)
  if (nextPreviewCluster) {
    activePreviewAnchor.value = nextPreviewCluster.screenPoint
    return
  }

  const fallbackCluster = [...displayClusterStateByKey.values()].find((clusterState) => {
    if (clusterState.memberIds.length !== activePreviewMemberIds.value.length) {
      return false
    }

    return clusterState.memberIds.every((memberId, index) => {
      return memberId === activePreviewMemberIds.value[index]
    })
  })

  if (fallbackCluster) {
    activePreviewGroupKey.value = fallbackCluster.key
    activePreviewAnchor.value = fallbackCluster.screenPoint
  }
}

const scheduleDisplaySourceSync = () => {
  if (!import.meta.client || mapDisplaySyncFrame !== null) {
    return
  }

  mapDisplaySyncFrame = window.requestAnimationFrame(() => {
    mapDisplaySyncFrame = null
    syncDisplaySource()
  })
}

const refreshSource = async (options: { loadingStarted?: boolean, force?: boolean } = {}) => {
  if (!mapRef.value) {
    return
  }

  const currentSequence = ++refreshSourceSequence
  mapPostsAbortController?.abort()
  const abortController = new AbortController()
  mapPostsAbortController = abortController

  if (!options.loadingStarted) {
    startMapLoading()
  }

  try {
    const geojson = await fetchGeoJson(abortController.signal, { force: options.force })
    const nextCollection = geojson || emptyCollection

    if (
      currentSequence !== refreshSourceSequence
      || abortController.signal.aborted
      || !mapRef.value
    ) {
      return
    }

    collection.value = nextCollection
    previewGroupCache.clear()
    closeActivePreview()
    syncSelectionSource()
    syncDisplaySource()
  } catch (error) {
    if (isAbortError(error)) {
      return
    }

    // Keep map interactive even if a fetch attempt fails.
  } finally {
    if (mapPostsAbortController === abortController) {
      mapPostsAbortController = null
    }
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
  const primaryColor = isDark.value ? '#31a567' : '#248E55'
  const contrastColor = isDark.value ? '#0f120e' : '#f7f3ec'
  const activeHaloColor = isDark.value ? 'rgba(88, 199, 143, 0.24)' : 'rgba(22, 146, 95, 0.2)'

  if (!mapRef.value.getSource(sourceName)) {
    mapRef.value.addSource(sourceName, {
      type: 'geojson',
      data: displayCollection.value
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
          '*',
          ['coalesce', ['get', 'marker_scale'], 1],
          [
            'interpolate',
            ['linear'],
            ['get', 'point_count'],
            1, 11,
            8, 18,
            25, 28,
            70, 40,
            160, 54
          ]
        ],
        'circle-color': primaryColor,
        'circle-opacity': ['coalesce', ['get', 'marker_opacity'], 1],
        'circle-stroke-width': CLUSTER_BUBBLE_STROKE_WIDTH_PX,
        'circle-stroke-color': contrastColor,
        'circle-stroke-opacity': ['coalesce', ['get', 'marker_opacity'], 1]
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
        'text-color': contrastColor,
        'text-opacity': ['coalesce', ['get', 'marker_opacity'], 1]
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
        'circle-radius': ['*', ['coalesce', ['get', 'marker_scale'], 1], POINT_MARKER_FILL_RADIUS_PX],
        'circle-color': primaryColor,
        'circle-opacity': ['coalesce', ['get', 'marker_opacity'], 1],
        'circle-stroke-width': CLUSTER_BUBBLE_STROKE_WIDTH_PX,
        'circle-stroke-color': contrastColor,
        'circle-stroke-opacity': ['coalesce', ['get', 'marker_opacity'], 1]
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

const scheduleMapResize = () => {
  if (!import.meta.client || mapResizeFrame !== null) {
    return
  }

  mapResizeFrame = window.requestAnimationFrame(() => {
    mapResizeFrame = null
    updateViewportWidth()
    mapRef.value?.resize()
    scheduleDisplaySourceSync()
  })
}

const observeMapContainer = () => {
  if (!import.meta.client || !mapEl.value || typeof ResizeObserver === 'undefined') {
    return
  }

  mapResizeObserver?.disconnect()
  mapResizeObserver = new ResizeObserver(() => {
    scheduleMapResize()
  })
  mapResizeObserver.observe(mapEl.value)
}

const getPreviewItemsForGroup = async (clusterState: DisplayClusterState) => {
  const cached = previewGroupCache.get(clusterState.key)
  if (cached) {
    return cached
  }

  const ids = clusterState.memberIds.slice(0, MAX_PREVIEW_FETCH_ITEMS)
  const response = await $fetch<PublicMapPreviewResponse>('/api/map/previews', {
    query: {
      ids: ids.join(',')
    }
  })
  const nextItems = response.items || []
  previewGroupCache.set(clusterState.key, nextItems)
  return nextItems
}

const openClusterPreview = async (clusterState: DisplayClusterState) => {
  const currentSequence = ++previewRequestSequence

  activePreviewGroupKey.value = clusterState.key
  activePreviewAnchor.value = clusterState.screenPoint
  activePreviewMemberIds.value = clusterState.memberIds.slice()
  previewOpenedAt = Date.now()
  previewItems.value = []
  previewError.value = ''
  previewLoading.value = true
  previewSheetDragOffset.value = 0

  try {
    const nextItems = await getPreviewItemsForGroup(clusterState)

    if (
      currentSequence !== previewRequestSequence
      || activePreviewGroupKey.value !== clusterState.key
    ) {
      return
    }

    previewItems.value = nextItems
  } catch {
    if (
      currentSequence !== previewRequestSequence
      || activePreviewGroupKey.value !== clusterState.key
    ) {
      return
    }

    previewError.value = t('map.previewLoadFailed')
  } finally {
    if (
      currentSequence === previewRequestSequence
      && activePreviewGroupKey.value === clusterState.key
    ) {
      previewLoading.value = false
    }
  }
}

const zoomToClusterState = (clusterState: DisplayClusterState) => {
  if (!mapRef.value) {
    return
  }

  const currentZoom = mapRef.value.getZoom()
  const maxZoom = mapRef.value.getMaxZoom() - 0.75
  const minimumTargetZoom = Math.min(maxZoom, currentZoom + CLUSTER_ZOOM_BREAKOUT_STEP)

  let breakoutZoom: number | null = null
  for (
    let targetZoom = minimumTargetZoom;
    targetZoom <= maxZoom + 0.001;
    targetZoom += CLUSTER_ZOOM_BREAKOUT_STEP
  ) {
    const scale = Math.pow(2, targetZoom - currentZoom)
    const simulatedGroups = resolveDisplayCollisionGroups(
      scaleScreenPointMembers(clusterState.screenMembers, scale)
    )

    if (simulatedGroups.length > 1) {
      breakoutZoom = Math.min(maxZoom, targetZoom + CLUSTER_ZOOM_BREAKOUT_MARGIN)
      break
    }
  }

  let targetZoom = breakoutZoom ?? Math.min(maxZoom, currentZoom + CLUSTER_ZOOM_STEP)
  const padding = getClusterBreakoutPadding()
  const camera = mapRef.value.cameraForBounds(clusterState.bounds, { padding })
  const fitCenter = camera.center ?? clusterState.center
  const fitZoom = Number(camera.zoom)

  if (Number.isFinite(fitZoom)) {
    targetZoom = Math.min(targetZoom, fitZoom)
  }

  mapRef.value.easeTo({
    center: fitCenter,
    zoom: targetZoom,
    duration: CLUSTER_ZOOM_FIT_DURATION_MS,
    essential: true
  })
}

const handlePreviewItemSelection = (postId: number) => {
  closeActivePreview()
  emit('select-post', postId)
}

const handleMapClick = async (event: MapMouseEvent) => {
  if (!mapRef.value) {
    return
  }

  const markerFeatures = mapRef.value.queryRenderedFeatures(event.point, {
    layers: ['clusters', 'unclustered-point']
  })

  if (!markerFeatures.length) {
    closeActivePreview()
    return
  }

  const clusterFeature = markerFeatures.find(feature => {
    return feature.layer.id === 'clusters'
  })

  if (clusterFeature) {
    const clusterState = displayClusterStateByKey.get(
      getClusterGroupId(clusterFeature.properties as Record<string, unknown> | undefined)
    )

    if (!clusterState) {
      return
    }

    if (clusterState.mode === 'preview') {
      await openClusterPreview(clusterState)
      return
    }

    closeActivePreview()
    zoomToClusterState(clusterState)
    return
  }

  const pointFeature = markerFeatures.find(feature => {
    return feature.layer.id === 'unclustered-point'
  })
  const postId = getFeaturePostId(pointFeature?.properties as Record<string, unknown> | undefined)

  if (!postId) {
    return
  }

  closeActivePreview()
  emit('select-post', postId)
}

const handleMarkerMouseEnter = () => {
  mapRef.value?.getCanvas().style.setProperty('cursor', 'pointer')
}

const handleMarkerMouseLeave = () => {
  mapRef.value?.getCanvas().style.setProperty('cursor', '')
}

const bindMapInteractions = () => {
  if (!mapRef.value || mapInteractionsBound) {
    return
  }

  mapInteractionsBound = true

  mapRef.value.on('mouseenter', 'clusters', handleMarkerMouseEnter)
  mapRef.value.on('mouseleave', 'clusters', handleMarkerMouseLeave)
  mapRef.value.on('mouseenter', 'unclustered-point', handleMarkerMouseEnter)
  mapRef.value.on('mouseleave', 'unclustered-point', handleMarkerMouseLeave)

  mapRef.value.on('click', handleMapClick)
  mapRef.value.on('dragstart', closeActivePreview)
  mapRef.value.on('zoomstart', closeActivePreview)
  mapRef.value.on('zoomend', scheduleDisplaySourceSync)
}

const unbindMapInteractions = () => {
  if (!mapRef.value || !mapInteractionsBound) {
    return
  }

  mapRef.value.off('mouseenter', 'clusters', handleMarkerMouseEnter)
  mapRef.value.off('mouseleave', 'clusters', handleMarkerMouseLeave)
  mapRef.value.off('mouseenter', 'unclustered-point', handleMarkerMouseEnter)
  mapRef.value.off('mouseleave', 'unclustered-point', handleMarkerMouseLeave)
  mapRef.value.off('click', handleMapClick)
  mapRef.value.off('dragstart', closeActivePreview)
  mapRef.value.off('zoomstart', closeActivePreview)
  mapRef.value.off('zoomend', scheduleDisplaySourceSync)

  mapInteractionsBound = false
}

const scheduleInitialSourceLoad = () => {
  if (!import.meta.client || initialSourceLoadScheduled) {
    return
  }

  initialSourceLoadScheduled = true
  startMapLoading()

  window.requestAnimationFrame(() => {
    void refreshSource({ loadingStarted: true }).finally(() => {
      initialSourceLoaded = true
    })
  })
}

const scheduleLowZoomMapWarmup = () => {
  if (!import.meta.client || lowZoomWarmupAbortController || !baseMapReady) {
    return
  }

  const pmtilesUrl = String(config.public.pmtilesUrl || '').trim()
  if (!pmtilesUrl) {
    return
  }

  const abortController = new AbortController()
  lowZoomWarmupAbortController = abortController

  void warmLowZoomPmtilesCache(pmtilesUrl, {
    maxZoom: LOW_ZOOM_PMTILES_CACHE_MAX_ZOOM,
    signal: abortController.signal
  })
    .catch(() => {
      // The map still works with normal on-demand PMTiles loading if warmup fails.
    })
    .finally(() => {
      if (lowZoomWarmupAbortController === abortController) {
        lowZoomWarmupAbortController = null
      }
    })
}

const resetBaseMapTileProtocol = async () => {
  if (!maplibregl) {
    return
  }

  lowZoomWarmupAbortController?.abort()
  lowZoomWarmupAbortController = null
  await recoverPmtilesProtocol(maplibregl)
}

const scheduleBaseMapHealthCheck = (
  delay = BASE_MAP_HEALTH_CHECK_DELAY_MS,
  options: { recoverOnFailure?: boolean } = {}
) => {
  if (!import.meta.client || !mapRef.value || baseMapReady || baseMapHealthCheckTimer !== null) {
    return
  }

  baseMapHealthCheckTimer = window.setTimeout(() => {
    baseMapHealthCheckTimer = null

    if (markBaseMapReadyIfVisible()) {
      return
    }

    if (options.recoverOnFailure !== false) {
      scheduleBaseMapRecovery()
    }
  }, delay)
}

const reloadBaseMapStyle = async () => {
  if (!mapRef.value || baseMapReady || baseMapRecoveryAttempts >= BASE_MAP_RECOVERY_MAX_ATTEMPTS) {
    return
  }

  const currentSequence = ++mapStyleSequence
  baseMapRecoveryAttempts += 1
  startMapLoading()

  try {
    await resetBaseMapTileProtocol()

    const style = await fetchHostedMapStyle(getMapStyleUrl(), {
      taiwanProvinceLabel: taiwanProvinceLabel.value
    })

    if (currentSequence !== mapStyleSequence || !mapRef.value || baseMapReady) {
      return
    }

    prepareBaseMapForStyleLoad({ resetAttempts: false })
    pendingStyleSourceRefresh = initialSourceLoaded
    unbindMapInteractions()
    mapRef.value.setStyle(style)
    scheduleMapResize()
    scheduleMapRuntimeSync()
    scheduleBaseMapHealthCheck()
  } catch {
    scheduleBaseMapRecovery()
  } finally {
    finishMapLoading()
  }
}

function scheduleBaseMapRecovery() {
  if (
    !import.meta.client
    || !mapRef.value
    || baseMapReady
    || baseMapRecoveryTimer !== null
    || baseMapRecoveryAttempts >= BASE_MAP_RECOVERY_MAX_ATTEMPTS
  ) {
    return
  }

  const delay = BASE_MAP_RECOVERY_RETRY_DELAYS_MS[
    Math.min(baseMapRecoveryAttempts, BASE_MAP_RECOVERY_RETRY_DELAYS_MS.length - 1)
  ]

  baseMapRecoveryTimer = window.setTimeout(() => {
    baseMapRecoveryTimer = null
    void reloadBaseMapStyle()
  }, delay)
}

const handleMapError = (event: unknown) => {
  finishBaseMapTileLoading(event as Partial<MapSourceDataEvent>)

  if (!isBaseMapErrorEvent(event)) {
    return
  }

  scheduleBaseMapRecovery()
}

const handleBaseMapSourceData = (event: MapSourceDataEvent) => {
  finishBaseMapTileLoading(event)

  if (event.sourceId !== BASE_MAP_SOURCE_NAME || !event.isSourceLoaded || baseMapReady) {
    return
  }

  scheduleBaseMapHealthCheck(BASE_MAP_HEALTH_CONFIRM_DELAY_MS, {
    recoverOnFailure: false
  })
}

const handleBaseMapSourceDataAbort = (event: MapSourceDataEvent) => {
  finishBaseMapTileLoading(event)
}

const handleMapIdle = () => {
  resetBaseMapTileLoading()
  scheduleMapResize()
  scheduleMapRuntimeSync()
  markBaseMapReadyIfVisible()
}

const handleMapStyleLoad = () => {
  scheduleMapRuntimeSync()
  scheduleBaseMapHealthCheck()
}

const loadRegionHighlight = async (scope: RegionScope | null) => {
  const currentSequence = ++regionHighlightSequence
  const scopeKey = getRegionScopeKey(scope)

  if (!scope || !scopeKey) {
    clearRegionHighlightSource()
    return
  }

  pendingRegionFitKey = scopeKey

  startMapLoading()
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
  } finally {
    finishMapLoading()
  }
}

const applyPoliticalLabels = () => {
  if (!mapRef.value || !mapRef.value.isStyleLoaded()) {
    return
  }

  applyTaiwanProvinceLabelPolicy(mapRef.value, taiwanProvinceLabel.value)
}

const syncMapRuntimeState = () => {
  if (!mapRef.value || !mapRef.value.isStyleLoaded()) {
    return
  }

  scheduleMapResize()
  applyPoliticalLabels()
  setupMapLayers()
  bindMapInteractions()
  syncRegionHighlightSource()
  syncSelectionSource()
  fitPendingRegionBounds()

  if (pendingStyleSourceRefresh && initialSourceLoaded) {
    pendingStyleSourceRefresh = false
    void refreshSource({ force: true })
  }
}

const scheduleMapRuntimeSync = () => {
  if (!import.meta.client || mapRuntimeSyncFrame !== null) {
    return
  }

  mapRuntimeSyncFrame = window.requestAnimationFrame(() => {
    mapRuntimeSyncFrame = null
    syncMapRuntimeState()
  })
}

const refreshVisibleMapSource = () => {
  if (!import.meta.client || !initialSourceLoaded || document.hidden) {
    return
  }

  void refreshSource({ force: true })
}

const teardownPreviewSheetPointerListeners = () => {
  if (!import.meta.client) {
    return
  }

  window.removeEventListener('pointermove', handlePreviewSheetWindowPointerMove)
  window.removeEventListener('pointerup', handlePreviewSheetWindowPointerUp)
  window.removeEventListener('pointercancel', handlePreviewSheetWindowPointerCancel)
  previewSheetPointerId = null
}

function handlePreviewSheetWindowPointerMove(event: PointerEvent) {
  if (previewSheetPointerId !== event.pointerId) {
    return
  }

  previewSheetDragOffset.value = Math.max(0, event.clientY - previewSheetPointerStartY)
}

function handlePreviewSheetWindowPointerUp(event: PointerEvent) {
  if (previewSheetPointerId !== event.pointerId) {
    return
  }

  const shouldClose = previewSheetDragOffset.value >= PREVIEW_SHEET_CLOSE_THRESHOLD_PX
  previewSheetDragging.value = false
  previewSheetDragOffset.value = 0
  teardownPreviewSheetPointerListeners()

  if (shouldClose) {
    closeActivePreview()
  }
}

function handlePreviewSheetWindowPointerCancel(event: PointerEvent) {
  if (previewSheetPointerId !== event.pointerId) {
    return
  }

  previewSheetDragging.value = false
  previewSheetDragOffset.value = 0
  teardownPreviewSheetPointerListeners()
}

const handlePreviewSheetPointerDown = (event: PointerEvent) => {
  if (!import.meta.client || !isMobileViewport.value) {
    return
  }

  previewSheetPointerId = event.pointerId
  previewSheetPointerStartY = event.clientY
  previewSheetDragOffset.value = 0
  previewSheetDragging.value = true

  window.addEventListener('pointermove', handlePreviewSheetWindowPointerMove)
  window.addEventListener('pointerup', handlePreviewSheetWindowPointerUp)
  window.addEventListener('pointercancel', handlePreviewSheetWindowPointerCancel)
}

const handleWindowResize = () => {
  updateViewportWidth()
  scheduleMapResize()
}

watch([isDark, locale], async ([dark]) => {
  if (!mapRef.value) {
    return
  }

  const currentSequence = ++mapStyleSequence
  startMapLoading()
  try {
    const style = await fetchHostedMapStyle(getMapStyleUrl(dark), {
      taiwanProvinceLabel: taiwanProvinceLabel.value
    })

    if (currentSequence !== mapStyleSequence || !mapRef.value) {
      return
    }

    prepareBaseMapForStyleLoad()
    pendingStyleSourceRefresh = initialSourceLoaded
    unbindMapInteractions()
    mapRef.value.setStyle(style)
    scheduleMapResize()
    scheduleMapRuntimeSync()
    scheduleBaseMapHealthCheck()
  } finally {
    finishMapLoading()
  }
})

onMounted(async () => {
  if (!mapEl.value) {
    return
  }

  updateViewportWidth()
  startMapLoading()
  try {
    maplibregl = await import('maplibre-gl')
    await registerPmtilesProtocol(maplibregl)
    const style = await fetchInitialMapStyle()

    prepareBaseMapForStyleLoad()
    mapRef.value = new maplibregl.Map({
      container: mapEl.value,
      style,
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      cancelPendingTileRequestsWhileZooming: false
    })
    observeMapContainer()
    scheduleMapResize()
    scheduleBaseMapHealthCheck()
  } catch {
    finishMapLoading()
    return
  }

  finishMapLoading()

  window.addEventListener('focus', refreshVisibleMapSource)
  window.addEventListener('resize', handleWindowResize)
  document.addEventListener('visibilitychange', refreshVisibleMapSource)

  mapRef.value.on('style.load', handleMapStyleLoad)
  mapRef.value.on('styledata', scheduleMapRuntimeSync)
  mapRef.value.on('sourcedataloading', startBaseMapTileLoading)
  mapRef.value.on('sourcedata', handleBaseMapSourceData)
  mapRef.value.on('sourcedataabort', handleBaseMapSourceDataAbort)
  mapRef.value.on('error', handleMapError)
  mapRef.value.on('render', syncBaseMapTileLoadingState)
  mapRef.value.on('movestart', handleBaseMapViewportLoadingStart)
  mapRef.value.on('moveend', handleBaseMapViewportLoadingEnd)
  mapRef.value.on('idle', handleMapIdle)

  mapRef.value.on('load', () => {
    scheduleMapRuntimeSync()
    scheduleInitialSourceLoad()
    scheduleLowZoomMapWarmup()
    scheduleBaseMapHealthCheck()

    if (props.selectedPostId) {
      void focusSelectedPost(props.selectedPostId)
    }
  })
})

watch(
  () => props.selectedPostId,
  (selectedPostId) => {
    closeActivePreview()
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
  mapStyleSequence += 1
  refreshSourceSequence += 1
  previewRequestSequence += 1
  mapPostsAbortController?.abort()
  mapPostsAbortController = null
  resetBaseMapTileLoading()
  lowZoomWarmupAbortController?.abort()
  lowZoomWarmupAbortController = null
  teardownPreviewSheetPointerListeners()
  mapResizeObserver?.disconnect()
  mapResizeObserver = null
  if (mapResizeFrame !== null) {
    window.cancelAnimationFrame(mapResizeFrame)
    mapResizeFrame = null
  }
  if (mapRuntimeSyncFrame !== null) {
    window.cancelAnimationFrame(mapRuntimeSyncFrame)
    mapRuntimeSyncFrame = null
  }
  if (mapDisplaySyncFrame !== null) {
    window.cancelAnimationFrame(mapDisplaySyncFrame)
    mapDisplaySyncFrame = null
  }
  if (markerAppearAnimationFrame !== null) {
    window.cancelAnimationFrame(markerAppearAnimationFrame)
    markerAppearAnimationFrame = null
  }
  clearBaseMapHealthCheckTimer()
  clearBaseMapRecoveryTimer()
  window.removeEventListener('focus', refreshVisibleMapSource)
  window.removeEventListener('resize', handleWindowResize)
  document.removeEventListener('visibilitychange', refreshVisibleMapSource)
  unbindMapInteractions()
  mapRef.value?.remove()
})
</script>

<template>
  <div class="map-stage">
    <!--<div
      class="map-background-hint"
      aria-hidden="true"
    >
      {{ t('map.loadFallbackHint') }}
    </div>-->

    <div ref="mapEl" class="map-canvas" />

    <div
      v-if="hasActivePreview && !isMobileViewport"
      class="map-preview-popover"
      :class="previewSurfaceClass"
      :style="desktopPreviewStyle"
      role="dialog"
      aria-modal="false"
      :aria-label="previewListLabel"
      @click.stop
    >
      <div
        class="map-preview-list"
        :class="{ 'is-loading': previewLoading }"
      >
        <p v-if="previewLoading" class="map-preview-state">{{ t('map.previewLoading') }}</p>
        <p v-else-if="previewError" class="map-preview-state">{{ previewError }}</p>
        <p v-else-if="!previewItems.length" class="map-preview-state">{{ t('map.previewEmpty') }}</p>
        <template v-else>
          <button
            v-for="item in previewItems"
            :key="item.id"
            class="map-preview-item"
            type="button"
            @click="handlePreviewItemSelection(item.id)"
          >
            <span class="map-preview-item__thumb">
              <img
                v-if="item.thumbUrl"
                :src="item.thumbUrl"
                :alt="item.title || t('map.untitledPost')"
                decoding="async"
                loading="lazy"
              >
              <i v-else class="fa-solid fa-image" aria-hidden="true" />
            </span>
            <span class="map-preview-item__title">{{ item.title || t('map.untitledPost') }}</span>
          </button>
        </template>
      </div>
    </div>

    <Transition name="map-preview-sheet">
      <div
        v-if="hasActivePreview && isMobileViewport"
        class="map-preview-sheet-backdrop"
        :class="previewSurfaceClass"
        @click="handlePreviewDismissRequest"
      >
        <div
          class="map-preview-sheet"
          :class="[previewSurfaceClass, { 'is-dragging': previewSheetDragging }]"
          :style="mobilePreviewSheetStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="previewListLabel"
          @click.stop
        >
          <div
            class="map-preview-sheet__handle"
            @pointerdown="handlePreviewSheetPointerDown"
          >
            <span />
          </div>

          <div class="map-preview-sheet__body">
            <div class="map-preview-list">
              <p v-if="previewLoading" class="map-preview-state">{{ t('map.previewLoading') }}</p>
              <p v-else-if="previewError" class="map-preview-state">{{ previewError }}</p>
              <p v-else-if="!previewItems.length" class="map-preview-state">{{ t('map.previewEmpty') }}</p>
              <template v-else>
                <button
                  v-for="item in previewItems"
                  :key="item.id"
                  class="map-preview-item"
                  type="button"
                  @click="handlePreviewItemSelection(item.id)"
                >
                  <span class="map-preview-item__thumb">
                    <img
                      v-if="item.thumbUrl"
                      :src="item.thumbUrl"
                      :alt="item.title || t('map.untitledPost')"
                      decoding="async"
                      loading="lazy"
                    >
                    <i v-else class="fa-solid fa-image" aria-hidden="true" />
                  </span>
                  <span class="map-preview-item__title">{{ item.title || t('map.untitledPost') }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>

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

<style scoped>
.map-preview-popover {
  position: absolute;
  z-index: 30;
  width: min(18rem, calc(100% - 1.5rem));
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
}

.map-preview-list {
  display: grid;
  gap: 0;
  overflow-y: auto;
  max-height: inherit;
}

.map-preview-item {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.9rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--ink);
  text-align: left;
}

.map-preview-item:last-child {
  border-bottom: 0;
}

.map-preview-item:hover,
.map-preview-item:focus-visible {
  background: var(--accent);
  color: var(--on-accent);
  outline: 0;
}

.map-preview-item__thumb {
  display: grid;
  width: 4rem;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--bg);
  color: var(--ink-muted);
}

.map-preview-item__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.map-preview-item__title {
  display: block;
  min-width: 0;
  font-size: 0.92rem;
  line-height: 1.45;
}

.map-preview-state {
  margin: 0;
  padding: 1rem;
  color: var(--ink-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.map-preview-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 92;
  display: flex;
  align-items: flex-end;
  background: var(--bg);
}

.map-preview-sheet {
  --preview-sheet-drag-offset: 0px;
  --preview-sheet-enter-offset: 0px;
  width: 100%;
  max-height: min(70svh, 38rem);
  border-top: 1px solid var(--border);
  border-radius: 22px 22px 0 0;
  background: var(--surface);
  color: var(--ink);
  opacity: 1;
  transform: translateY(var(--preview-sheet-enter-offset)) translateY(var(--preview-sheet-drag-offset));
  transition:
    transform 220ms var(--motion-smooth),
    opacity 220ms var(--motion-smooth);
}

.map-preview-sheet.is-dragging {
  transition: none;
}

.map-preview-sheet__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 0 0.45rem;
  touch-action: none;
}

.map-preview-sheet__handle span {
  display: block;
  width: 2.35rem;
  height: 0.22rem;
  border-radius: 999px;
  background: var(--border);
}

.map-preview-sheet__body {
  overflow: hidden;
  padding-bottom: calc(0.9rem + env(safe-area-inset-bottom));
}

.map-preview-sheet__body .map-preview-list {
  max-height: min(62svh, 34rem);
}

.map-preview-sheet-enter-active,
.map-preview-sheet-leave-active {
  transition: opacity 220ms var(--motion-smooth);
}

.map-preview-sheet-enter-active .map-preview-sheet,
.map-preview-sheet-leave-active .map-preview-sheet {
  transition:
    transform 220ms var(--motion-smooth),
    opacity 220ms var(--motion-smooth);
}

.map-preview-sheet-enter-from,
.map-preview-sheet-leave-to {
  opacity: 0;
}

.map-preview-sheet-enter-from .map-preview-sheet,
.map-preview-sheet-leave-to .map-preview-sheet {
  --preview-sheet-enter-offset: 24px;
  opacity: 0;
}
</style>
