<script setup lang="ts">
import type { Marker } from 'maplibre-gl'
import type { LatLng, PrivacyMode } from '~~/shared/fumo'
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_STYLE_URL, MAP_DEFAULT_ZOOM } from '~~/shared/fumo'

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

const config = useRuntimeConfig()
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<import('maplibre-gl').Map | null>(null)

let maplibregl: typeof import('maplibre-gl') | null = null
let exactMarker: Marker | null = null
let publicMarker: Marker | null = null

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
        element: markerElement('map-pin map-pin--exact', '精确位置')
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
        element: markerElement('map-pin map-pin--public', '公开位置')
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
    syncViewport()
  })

  mapRef.value.on('click', (event) => {
    emitExactLocation({
      lat: event.lngLat.lat,
      lng: event.lngLat.lng
    })
  })
})

watch(
  () => [props.exactLocation, props.publicLocation, props.privacyMode],
  ([, , privacyMode]) => {
    if (privacyMode === 'exact' && props.exactLocation) {
      emit('update:publicLocation', props.exactLocation)
    }

    syncMarkers()
    syncViewport(true)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  exactMarker?.remove()
  publicMarker?.remove()
  mapRef.value?.remove()
})
</script>

<template>
  <div class="picker-stage">
    <div ref="mapEl" class="picker-canvas" />
  </div>
</template>
