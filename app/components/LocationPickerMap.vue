<script setup lang="ts">
import type { Marker } from 'maplibre-gl'
import type { LatLng, PrivacyMode } from '~~/shared/fumo'
import {
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_STYLE_URL,
  MAP_DARK_STYLE_URL,
  MAP_DEFAULT_ZOOM
} from '~~/shared/fumo'
import { applyTaiwanProvinceLabelPolicy } from '~~/app/composables/useMapPoliticalLabels'

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
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<import('maplibre-gl').Map | null>(null)
const taiwanProvinceLabel = computed(() => t('map.taiwanProvinceLabel'))

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

watch(isDark, (dark) => {
  if (!mapRef.value) {
    return
  }

  const style = dark ? MAP_DARK_STYLE_URL : (config.public.mapStyleUrl || MAP_DEFAULT_STYLE_URL)
  mapRef.value.setStyle(style)

  mapRef.value.once('style.load', () => {
    applyPoliticalLabels()
    syncMarkers()
    syncViewport()
  })
})

onMounted(async () => {
  if (!mapEl.value) {
    return
  }

  maplibregl = await import('maplibre-gl')
  const style = isDark.value ? MAP_DARK_STYLE_URL : (config.public.mapStyleUrl || MAP_DEFAULT_STYLE_URL)

  mapRef.value = new maplibregl.Map({
    container: mapEl.value,
    style,
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM
  })

  mapRef.value.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  mapRef.value.on('load', () => {
    applyPoliticalLabels()
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
