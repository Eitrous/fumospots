<script setup lang="ts">
import type { Marker } from 'maplibre-gl'
import type { LatLng, PrivacyMode } from '~~/shared/fumo'
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_STYLE_URL, MAP_DEFAULT_ZOOM } from '~~/shared/fumo'

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

const config = useRuntimeConfig()
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<import('maplibre-gl').Map | null>(null)

let maplibregl: typeof import('maplibre-gl') | null = null
let publicMarker: Marker | null = null
let exactMarker: Marker | null = null

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
        element: markerElement('map-pin map-pin--public', '公开位置')
      })
    }

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
        element: markerElement('map-pin map-pin--exact', '精确位置')
      })
    }

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

onMounted(async () => {
  if (!mapEl.value) {
    return
  }

  maplibregl = await import('maplibre-gl')
  const style = config.public.mapStyleUrl || MAP_DEFAULT_STYLE_URL

  mapRef.value = new maplibregl.Map({
    container: mapEl.value,
    style,
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM
  })

  mapRef.value.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  mapRef.value.on('load', () => {
    syncMarkers()
    fitBoundsToMarkers()
  })
})

watch(
  () => [props.exactLocation, props.publicLocation, props.showExact],
  () => {
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
