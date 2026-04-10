<script setup lang="ts">
import type { GeoJSONSource, Map as MapLibreMap, Marker, Popup } from 'maplibre-gl'
import type { PublicMapCollection, PublicMapFeatureProperties } from '~~/shared/fumo'
import {
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_STYLE_URL,
  MAP_DEFAULT_ZOOM,
  MAP_THUMBNAIL_ZOOM
} from '~~/shared/fumo'

const config = useRuntimeConfig()
const mapEl = ref<HTMLDivElement | null>(null)
const mapRef = shallowRef<MapLibreMap | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const visibleCount = ref(0)

let maplibregl: typeof import('maplibre-gl') | null = null
let activePopup: Popup | null = null
const thumbnailMarkers = new Map<number, Marker>()

const shouldUseThumbnails = () => {
  return Boolean(mapRef.value && mapRef.value.getZoom() >= MAP_THUMBNAIL_ZOOM)
}

const normalizeProperties = (raw: Record<string, unknown>): PublicMapFeatureProperties => {
  return {
    id: Number(raw.id),
    title: String(raw.title || '未命名投稿'),
    placeName: raw.placeName ? String(raw.placeName) : null,
    username: String(raw.username || 'unknown'),
    thumbUrl: raw.thumbUrl ? String(raw.thumbUrl) : null,
    privacyMode: raw.privacyMode === 'approx' ? 'approx' : 'exact',
    capturedAt: raw.capturedAt ? String(raw.capturedAt) : null
  }
}

const buildPopupContent = (props: PublicMapFeatureProperties) => {
  const wrapper = document.createElement('article')
  wrapper.className = 'map-popup'

  if (props.thumbUrl) {
    const image = document.createElement('img')
    image.className = 'map-popup__thumb'
    image.src = props.thumbUrl
    image.alt = props.title
    wrapper.append(image)
  }

  const title = document.createElement('h3')
  title.className = 'map-popup__title'
  title.textContent = props.title
  wrapper.append(title)

  const author = document.createElement('p')
  author.className = 'map-popup__meta'
  author.textContent = `作者 @${props.username}`
  wrapper.append(author)

  if (props.placeName) {
    const place = document.createElement('p')
    place.className = 'map-popup__meta'
    place.textContent = props.placeName
    wrapper.append(place)
  }

  const action = document.createElement('a')
  action.className = 'text-button'
  action.href = `/posts/${props.id}`
  action.textContent = '查看详情'
  wrapper.append(action)

  return wrapper
}

const openPopup = (
  coordinates: [number, number],
  props: PublicMapFeatureProperties
) => {
  if (!mapRef.value || !maplibregl) {
    return
  }

  activePopup?.remove()
  activePopup = new maplibregl.Popup({
    offset: 18,
    closeButton: false
  })
    .setLngLat(coordinates)
    .setDOMContent(buildPopupContent(props))
    .addTo(mapRef.value)
}

const fetchGeoJson = async () => {
  if (!mapRef.value) {
    return null
  }

  const bounds = mapRef.value.getBounds()
  return await $fetch<PublicMapCollection>('/api/map/posts', {
    query: {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
      zoom: mapRef.value.getZoom().toFixed(2)
    }
  })
}

const clearThumbnailMarkers = () => {
  thumbnailMarkers.forEach((marker) => marker.remove())
  thumbnailMarkers.clear()
}

const syncThumbnailMarkers = () => {
  if (!mapRef.value || !maplibregl) {
    return
  }

  if (!shouldUseThumbnails()) {
    clearThumbnailMarkers()
    return
  }

  const renderedFeatures = mapRef.value.queryRenderedFeatures(undefined, {
    layers: ['unclustered-point']
  })

  const nextIds = new Set<number>()

  for (const feature of renderedFeatures) {
    if (feature.geometry.type !== 'Point' || !feature.properties) {
      continue
    }

    const props = normalizeProperties(feature.properties)
    const coordinates = feature.geometry.coordinates as [number, number]
    nextIds.add(props.id)

    if (!thumbnailMarkers.has(props.id)) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'map-thumb-marker'

      if (props.thumbUrl) {
        const image = document.createElement('img')
        image.src = props.thumbUrl
        image.alt = props.title
        el.append(image)
      } else {
        const fallback = document.createElement('span')
        fallback.textContent = 'Fumo'
        el.append(fallback)
      }

      el.addEventListener('click', () => {
        openPopup(coordinates, props)
      })

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom'
      })

      marker.setLngLat(coordinates).addTo(mapRef.value)
      thumbnailMarkers.set(props.id, marker)
    } else {
      thumbnailMarkers.get(props.id)?.setLngLat(coordinates)
    }
  }

  thumbnailMarkers.forEach((marker, id) => {
    if (!nextIds.has(id)) {
      marker.remove()
      thumbnailMarkers.delete(id)
    }
  })
}

const refreshSource = async () => {
  if (!mapRef.value) {
    return
  }

  loading.value = true

  try {
    const geojson = await fetchGeoJson()
    if (!geojson) {
      return
    }

    visibleCount.value = geojson.features.length
    const source = mapRef.value.getSource('posts') as GeoJSONSource | null
    source?.setData(geojson)
    syncThumbnailMarkers()
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地图数据加载失败'
  } finally {
    loading.value = false
  }
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

  mapRef.value.addControl(new maplibregl.NavigationControl(), 'top-right')

  mapRef.value.on('load', async () => {
    const geojson = await fetchGeoJson()

    mapRef.value?.addSource('posts', {
      type: 'geojson',
      data: geojson || {
        type: 'FeatureCollection',
        features: []
      },
      cluster: true,
      clusterMaxZoom: 10,
      clusterRadius: 48
    })

    mapRef.value?.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'posts',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 18, 12, 22, 36, 28, 88, 34],
        'circle-color': '#ff6b57',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff7f1'
      }
    })

    mapRef.value?.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'posts',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 12
      },
      paint: {
        'text-color': '#fff7f1'
      }
    })

    mapRef.value?.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'posts',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 7,
        'circle-color': '#0f7c82',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff7f1'
      }
    })

    mapRef.value?.on('mouseenter', 'clusters', () => {
      if (mapRef.value) {
        mapRef.value.getCanvas().style.cursor = 'pointer'
      }
    })

    mapRef.value?.on('mouseleave', 'clusters', () => {
      if (mapRef.value) {
        mapRef.value.getCanvas().style.cursor = ''
      }
    })

    mapRef.value?.on('mouseenter', 'unclustered-point', () => {
      if (mapRef.value && !shouldUseThumbnails()) {
        mapRef.value.getCanvas().style.cursor = 'pointer'
      }
    })

    mapRef.value?.on('mouseleave', 'unclustered-point', () => {
      if (mapRef.value) {
        mapRef.value.getCanvas().style.cursor = ''
      }
    })

    mapRef.value?.on('click', 'clusters', async (event) => {
      const features = mapRef.value?.queryRenderedFeatures(event.point, {
        layers: ['clusters']
      })
      const cluster = features?.[0]
      const clusterId = cluster?.properties?.cluster_id

      if (clusterId == null || !mapRef.value) {
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
      if (!feature || feature.geometry.type !== 'Point' || !feature.properties) {
        return
      }

      const props = normalizeProperties(feature.properties)
      openPopup(feature.geometry.coordinates as [number, number], props)
    })

    mapRef.value?.on('moveend', () => {
      void refreshSource()
    })

    syncThumbnailMarkers()
    loading.value = false
  })
})

onBeforeUnmount(() => {
  activePopup?.remove()
  clearThumbnailMarkers()
  mapRef.value?.remove()
})
</script>

<template>
  <div class="map-stage">
    <div ref="mapEl" class="map-canvas" />

    <div class="map-overlay-status">
      <div class="map-status-card">
        <strong>{{ loading ? '地图正在展开…' : `当前视野内 ${visibleCount} 张照片` }}</strong>
        <p>
          {{ errorMessage || '拖拽或缩放地图可以按视野范围重新加载投稿。' }}
        </p>
      </div>
    </div>
  </div>
</template>
