<script setup lang="ts">
import type { Marker, MapSourceDataEvent } from 'maplibre-gl'
import type { LatLng, PrivacyMode } from '~~/shared/fumo'
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
  hasRenderedBaseMapFeatures,
  isBaseMapErrorEvent
} from '~~/app/composables/useBaseMapHealth'

const props = withDefaults(defineProps<{
  exactLocation?: LatLng | null
  publicLocation?: LatLng | null
  privacyMode: PrivacyMode
}>(), {
  exactLocation: null,
  publicLocation: null
})

const emit = defineEmits<{
  'update:exactLocation': [LatLng | null]
  'update:publicLocation': [LatLng | null]
}>()

const { t, locale } = useI18n()
const { isDark } = useTheme()
const config = useRuntimeConfig()
useMapResourceHints()

const { targetRef: stageEl, isActivated } = useDeferredVisibility()
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<import('maplibre-gl').Map | null>(null)
const taiwanProvinceLabel = computed(() => t('map.taiwanProvinceLabel'))
const mapLoadFailed = ref(false)

let maplibregl: typeof import('maplibre-gl') | null = null
let exactMarker: Marker | null = null
let publicMarker: Marker | null = null
let mapInitPromise: Promise<void> | null = null
let mapStyleSequence = 0
let baseMapReady = false
let baseMapRecoveryAttempts = 0
let baseMapHealthCheckTimer: number | null = null
let baseMapRecoveryTimer: number | null = null
let mapDisposed = false

const getMapStyleUrl = (dark = isDark.value) => {
  return resolveHostedMapStyleUrl({
    theme: dark ? 'dark' : 'light',
    locale: locale.value,
    lightStyleUrl: config.public.mapStyleUrl,
    darkStyleUrl: config.public.mapDarkStyleUrl
  })
}

const markerElement = (className: string, label: string) => {
  const el = document.createElement('div')
  el.className = className
  el.title = label
  return el
}

const emitExactLocation = (location: LatLng) => {
  emit('update:exactLocation', location)
  emit('update:publicLocation', location)
}

const emitPublicLocation = (location: LatLng) => {
  emit('update:publicLocation', location)
}

const syncMarkers = () => {
  if (!maplibregl || !mapRef.value) {
    return
  }

  if (props.exactLocation) {
    if (!exactMarker) {
      exactMarker = new maplibregl.Marker({
        draggable: true,
        element: markerElement('map-pin map-pin--exact', t('common.exactLocation'))
      })

      exactMarker.on('dragend', () => {
        const next = exactMarker?.getLngLat()
        if (!next) {
          return
        }

        emitExactLocation({
          lat: next.lat,
          lng: next.lng
        })
      })
    }

    exactMarker.getElement().title = t('common.exactLocation')
    exactMarker
      .setLngLat([props.exactLocation.lng, props.exactLocation.lat])
      .addTo(mapRef.value)
  } else {
    exactMarker?.remove()
    exactMarker = null
  }

  const shouldShowPublic = props.privacyMode === 'approx' && props.publicLocation
  if (shouldShowPublic) {
    if (!publicMarker) {
      publicMarker = new maplibregl.Marker({
        draggable: true,
        element: markerElement('map-pin map-pin--public', t('common.publicLocation'))
      })

      publicMarker.on('dragend', () => {
        const next = publicMarker?.getLngLat()
        if (!next) {
          return
        }

        emitPublicLocation({
          lat: next.lat,
          lng: next.lng
        })
      })
    }

    publicMarker.getElement().title = t('common.publicLocation')
    publicMarker
      .setLngLat([props.publicLocation.lng, props.publicLocation.lat])
      .addTo(mapRef.value)
  } else {
    publicMarker?.remove()
    publicMarker = null
  }
}

const centerForSelection = () => {
  if (props.publicLocation) {
    return props.publicLocation
  }

  if (props.exactLocation) {
    return props.exactLocation
  }

  return null
}

const syncViewport = (animated = false) => {
  if (!mapRef.value) {
    return
  }

  const focus = centerForSelection()
  if (!focus) {
    return
  }

  const target = {
    center: [focus.lng, focus.lat] as [number, number],
    zoom: Math.max(mapRef.value.getZoom(), 7)
  }

  if (animated) {
    mapRef.value.easeTo(target)
    return
  }

  mapRef.value.jumpTo(target)
}

const applyPoliticalLabels = () => {
  if (!mapRef.value || !mapRef.value.isStyleLoaded()) {
    return
  }

  applyTaiwanProvinceLabelPolicy(mapRef.value, taiwanProvinceLabel.value)
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

const clearBaseMapTimers = () => {
  clearBaseMapHealthCheckTimer()
  clearBaseMapRecoveryTimer()
}

const prepareBaseMapForStyleLoad = (options: { resetAttempts?: boolean } = {}) => {
  baseMapReady = false
  mapLoadFailed.value = false
  clearBaseMapTimers()

  if (options.resetAttempts !== false) {
    baseMapRecoveryAttempts = 0
  }
}

const syncMapRuntimeState = () => {
  applyPoliticalLabels()
  syncMarkers()
  syncViewport()
}

const markBaseMapReadyIfVisible = () => {
  if (baseMapReady) {
    return true
  }

  if (!hasRenderedBaseMapFeatures(mapRef.value)) {
    return false
  }

  baseMapReady = true
  baseMapRecoveryAttempts = 0
  mapLoadFailed.value = false
  clearBaseMapTimers()
  syncMapRuntimeState()
  return true
}

const markBaseMapFailed = () => {
  if (!baseMapReady) {
    mapLoadFailed.value = true
  }
}

const getBaseMapRecoveryDelay = () => {
  return BASE_MAP_RECOVERY_RETRY_DELAYS_MS[
    Math.min(baseMapRecoveryAttempts, BASE_MAP_RECOVERY_RETRY_DELAYS_MS.length - 1)
  ]
}

const scheduleBaseMapHealthCheck = (
  delay = BASE_MAP_HEALTH_CHECK_DELAY_MS,
  options: { recoverOnFailure?: boolean } = {}
) => {
  if (!import.meta.client || mapDisposed || !mapRef.value || baseMapReady || baseMapHealthCheckTimer !== null) {
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
  if (!mapRef.value || baseMapReady) {
    return
  }

  if (baseMapRecoveryAttempts >= BASE_MAP_RECOVERY_MAX_ATTEMPTS) {
    markBaseMapFailed()
    return
  }

  const currentSequence = ++mapStyleSequence
  baseMapRecoveryAttempts += 1
  mapLoadFailed.value = false

  try {
    if (maplibregl) {
      await recoverPmtilesProtocol(maplibregl)
    }

    const style = await fetchHostedMapStyle(getMapStyleUrl(), {
      taiwanProvinceLabel: taiwanProvinceLabel.value
    })

    if (currentSequence !== mapStyleSequence || !mapRef.value || baseMapReady) {
      return
    }

    prepareBaseMapForStyleLoad({ resetAttempts: false })
    mapRef.value.setStyle(style)
    scheduleBaseMapHealthCheck()
  } catch {
    scheduleBaseMapRecovery()
  }
}

function scheduleBaseMapRecovery() {
  if (!import.meta.client || mapDisposed || baseMapReady || baseMapRecoveryTimer !== null) {
    return
  }

  if (baseMapRecoveryAttempts >= BASE_MAP_RECOVERY_MAX_ATTEMPTS) {
    markBaseMapFailed()
    return
  }

  baseMapRecoveryTimer = window.setTimeout(() => {
    baseMapRecoveryTimer = null

    if (mapRef.value) {
      void reloadBaseMapStyle()
      return
    }

    void initializeMap({ recoveryAttempt: true })
  }, getBaseMapRecoveryDelay())
}

const handleMapError = (event: unknown) => {
  if (!isBaseMapErrorEvent(event)) {
    return
  }

  scheduleBaseMapRecovery()
}

const handleBaseMapSourceData = (event: MapSourceDataEvent) => {
  if (event.sourceId !== BASE_MAP_SOURCE_NAME || !event.isSourceLoaded || baseMapReady) {
    return
  }

  scheduleBaseMapHealthCheck(BASE_MAP_HEALTH_CONFIRM_DELAY_MS, {
    recoverOnFailure: false
  })
}

const handleMapIdle = () => {
  markBaseMapReadyIfVisible()
}

const handleMapStyleLoad = () => {
  syncMapRuntimeState()
  scheduleBaseMapHealthCheck()
}

const retryBaseMap = () => {
  prepareBaseMapForStyleLoad()

  if (mapRef.value) {
    void reloadBaseMapStyle()
    return
  }

  void initializeMap()
}

watch([isDark, locale], async ([dark]) => {
  if (!mapRef.value) {
    return
  }

  const currentSequence = ++mapStyleSequence

  try {
    const style = await fetchHostedMapStyle(getMapStyleUrl(dark), {
      taiwanProvinceLabel: taiwanProvinceLabel.value
    })

    if (currentSequence !== mapStyleSequence || !mapRef.value) {
      return
    }

    prepareBaseMapForStyleLoad()
    mapRef.value.setStyle(style)
    scheduleBaseMapHealthCheck()
  } catch {
    scheduleBaseMapRecovery()
  }
})

const initializeMap = async (options: { recoveryAttempt?: boolean } = {}) => {
  if (!mapEl.value || mapRef.value) {
    return
  }

  if (mapInitPromise) {
    await mapInitPromise
    return
  }

  mapInitPromise = (async () => {
    maplibregl = maplibregl || await import('maplibre-gl')

    if (options.recoveryAttempt) {
      baseMapRecoveryAttempts += 1
      await recoverPmtilesProtocol(maplibregl)
    } else {
      await registerPmtilesProtocol(maplibregl)
    }

    const style = await fetchHostedMapStyle(getMapStyleUrl(), {
      taiwanProvinceLabel: taiwanProvinceLabel.value
    })

    prepareBaseMapForStyleLoad({
      resetAttempts: !options.recoveryAttempt
    })

    mapRef.value = new maplibregl.Map({
      container: mapEl.value as HTMLDivElement,
      style,
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM
    })

    mapRef.value.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    mapRef.value.on('style.load', handleMapStyleLoad)
    mapRef.value.on('sourcedata', handleBaseMapSourceData)
    mapRef.value.on('error', handleMapError)
    mapRef.value.on('idle', handleMapIdle)
    mapRef.value.on('load', handleMapStyleLoad)

    mapRef.value.on('click', (event) => {
      emitExactLocation({
        lat: event.lngLat.lat,
        lng: event.lngLat.lng
      })
    })
    scheduleBaseMapHealthCheck()
  })()
    .catch(() => {
      scheduleBaseMapRecovery()
    })
    .finally(() => {
      mapInitPromise = null
    })

  await mapInitPromise
}

watch(isActivated, (active) => {
  if (!active) {
    return
  }

  void initializeMap()
})

onMounted(() => {
  if (!isActivated.value) {
    return
  }

  void initializeMap()
})

watch(
  () => [props.exactLocation, props.publicLocation, props.privacyMode, locale.value],
  ([, , mode]) => {
    if (mode === 'exact' && props.exactLocation) {
      emit('update:publicLocation', props.exactLocation)
    }

    applyPoliticalLabels()
    syncMarkers()
    syncViewport(true)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  mapDisposed = true
  mapStyleSequence += 1
  clearBaseMapTimers()
  exactMarker?.remove()
  publicMarker?.remove()
  mapRef.value?.remove()
})
</script>

<template>
  <div ref="stageEl" class="picker-stage">
    <div ref="mapEl" class="picker-canvas" />
    <div v-if="mapLoadFailed" class="picker-map-status" role="status">
      <p>{{ t('map.baseMapLoadFailed') }}</p>
      <button type="button" class="picker-map-status__button" @click="retryBaseMap">
        {{ t('map.retryBaseMap') }}
      </button>
    </div>
  </div>
</template>
