import type { StyleSpecification } from 'maplibre-gl'

const MAP_ASSET_PATH_PREFIX = '/map-assets/'
const LOCAL_GEOPOLITICS_ARCHIVE_PATH = '/api/map/geopolitics.pmtiles'

type FetchHostedMapStyleOptions = {
  signal?: AbortSignal
}

const resolveCurrentOriginMapAssetUrl = (value: string) => {
  if (!import.meta.client || !value) {
    return value
  }

  const trimmed = value.trim()
  const currentOrigin = window.location.origin

  if (trimmed.startsWith(MAP_ASSET_PATH_PREFIX)) {
    return `${currentOrigin}${trimmed}`
  }

  if (trimmed.startsWith(MAP_ASSET_PATH_PREFIX.slice(1))) {
    return `${currentOrigin}/${trimmed}`
  }

  try {
    const url = new URL(trimmed)
    const rawPathAndQuery = trimmed.slice(url.origin.length)

    if (
      !rawPathAndQuery.startsWith(MAP_ASSET_PATH_PREFIX)
      && !rawPathAndQuery.startsWith(LOCAL_GEOPOLITICS_ARCHIVE_PATH)
    ) {
      return value
    }

    return `${currentOrigin}${rawPathAndQuery}`
  } catch {
    return value
  }
}

const resolveSpriteSpecification = (
  sprite: StyleSpecification['sprite']
): StyleSpecification['sprite'] => {
  if (typeof sprite === 'string') {
    return resolveCurrentOriginMapAssetUrl(sprite)
  }

  if (Array.isArray(sprite)) {
    return sprite.map(item => ({
      ...item,
      url: resolveCurrentOriginMapAssetUrl(item.url)
    }))
  }

  return sprite
}

const resolvePmtilesProtocolUrl = (value: string) => {
  const prefix = 'pmtiles://'
  if (!value.startsWith(prefix)) {
    return value
  }

  return `${prefix}${resolveCurrentOriginMapAssetUrl(value.slice(prefix.length))}`
}

const resolveStyleSources = (sources: StyleSpecification['sources']) => {
  return Object.fromEntries(Object.entries(sources).map(([id, source]) => {
    if (!('url' in source) || typeof source.url !== 'string') {
      return [id, source]
    }

    return [id, {
      ...source,
      url: resolvePmtilesProtocolUrl(source.url)
    }]
  })) as StyleSpecification['sources']
}

export const resolveHostedMapStyleAssetUrls = (style: StyleSpecification) => {
  return {
    ...style,
    sources: resolveStyleSources(style.sources),
    glyphs: typeof style.glyphs === 'string'
      ? resolveCurrentOriginMapAssetUrl(style.glyphs)
      : style.glyphs,
    sprite: resolveSpriteSpecification(style.sprite)
  }
}

export const fetchHostedMapStyle = async (
  styleUrl: string,
  options: FetchHostedMapStyleOptions = {}
) => {
  const style = await $fetch<StyleSpecification>(styleUrl, { signal: options.signal })
  return resolveHostedMapStyleAssetUrls(style)
}
