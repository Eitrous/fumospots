import type { SpriteSpecification, StyleSpecification } from 'maplibre-gl'
import {
  applySouthTibetRegionLabelPolicyToStyle,
  applyTaiwanProvinceLabelPolicyToStyle
} from '~~/app/composables/useMapPoliticalLabels'

const MAP_ASSET_PATH_PREFIX = '/map-assets/'

type FetchHostedMapStyleOptions = {
  signal?: AbortSignal
  southTibetRegionLabel?: string | null
  taiwanProvinceLabel?: string | null
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

    if (!rawPathAndQuery.startsWith(MAP_ASSET_PATH_PREFIX)) {
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
    return sprite.map((item: SpriteSpecification) => ({
      ...item,
      url: resolveCurrentOriginMapAssetUrl(item.url)
    }))
  }

  return sprite
}

export const resolveHostedMapStyleAssetUrls = (style: StyleSpecification) => {
  return {
    ...style,
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
  const resolvedStyle = resolveHostedMapStyleAssetUrls(style)

  if (typeof options.taiwanProvinceLabel === 'string') {
    applyTaiwanProvinceLabelPolicyToStyle(resolvedStyle, options.taiwanProvinceLabel)
  }

  if (typeof options.southTibetRegionLabel === 'string') {
    applySouthTibetRegionLabelPolicyToStyle(resolvedStyle, options.southTibetRegionLabel)
  }

  return resolvedStyle
}
