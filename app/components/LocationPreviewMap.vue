<script setup lang="ts">
import type { Marker } from 'maplibre-gl'
import type { LatLng, PrivacyMode } from '~~/shared/fumo'
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM } from '~~/shared/fumo'
import { resolveHostedMapStyleUrl } from '~~/shared/mapStyle'
import { applyTaiwanProvinceLabelPolicy } from '~~/app/composables/useMapPoliticalLabels'

const props = withDefaults(defineProps<{
  exactLocation?: LatLng | null
  publicLocation?: LatLng | null
  privacyMode?: PrivacyMode
  showExact?: boolean
  compact?: boolean
}>(), {
  exactLocation: null,
  publicLocation: null,
  privacyMode: 'exact',
  showExact: false,
  compact: false
})

const { t, locale } = useI18n()
const { isDark } = useTheme()
const config = useRuntimeConfig()
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<import('maplibre-gl').Map | null>(null)
const taiwanProvinceLabel = computed(() => t('map.taiwanProvinceLabel'))

let maplibregl: typeof import('maplibre-gl') | null = null
let publicMarker: Marker | null = null
let exactMarker: Marker | null = null

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

const syncMarkers = () => {
  if (!maplibregl || !mapRef.value) {
    return
  }

  if (props.publicLocation) {
    if (!publicMarker) {
      publicMarker = new maplibregl.Marker({
        element: markerElement('map-pin map-pin--public', t('common.publicLocation'))
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

  if (props.showExact && props.exactLocation) {
    if (!exactMarker) {
      exactMarker = new maplibregl.Marker({
        element: markerElement('map-pin map-pin--exact', t('common.exactLocation'))
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
}

const fitBoundsToMarkers = () => {
  if (!maplibregl || !mapRef.value) {
    return
  }

  const points = [props.publicLocation]
  if (props.showExact) {
    points.push(props.exactLocation ?? null)
  }

  const validPoints = points.filter(Boolean) as LatLng[]

  if (!validPoints.length) {
    mapRef.value.jumpTo({
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM
    })
    return
  }

  if (validPoints.length === 1) {
    mapRef.value.easeTo({
      center: [validPoints[0].lng, validPoints[0].lat],
      zoom: 8
    })
    return
  }

  const bounds = new maplibregl.LngLatBounds()
  for (const point of validPoints) {
    bounds.extend([point.lng, point.lat])
  }

  mapRef.value.fitBounds(bounds, {
    padding: 48,
    maxZoom: 10
  })
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
    syncMarkers()
    fitBoundsToMarkers()
  })
})

onMounted(async () => {
  if (!mapEl.value) {
    return
  }

  maplibregl = await import('maplibre-gl')

  mapRef.value = new maplibregl.Map({
    container: mapEl.value,
    style: getMapStyleUrl(),
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM
  })

  mapRef.value.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  mapRef.value.on('load', () => {
    applyPoliticalLabels()
    syncMarkers()
    fitBoundsToMarkers()
  })
})

watch(
  () => [props.exactLocation, props.publicLocation, props.showExact, locale.value],
  () => {
    applyPoliticalLabels()
    syncMarkers()
    fitBoundsToMarkers()
  },
  { deep: true }
)

onBeforeUnmount(() => {
  publicMarker?.remove()
  exactMarker?.remove()
  mapRef.value?.remove()
})
</script>

<template>
  <div class="picker-stage" :class="{ 'picker-stage--compact': compact }">
    <div ref="mapEl" class="picker-canvas" />
  </div>
</template>
