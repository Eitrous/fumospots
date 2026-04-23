import { MAP_DARK_STYLE_URL, MAP_DEFAULT_STYLE_URL } from '~~/shared/fumo'

export type MapStyleTheme = 'light' | 'dark'

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const MAP_STYLE_REVISION = '20260423-3'

export const isMapStyleTheme = (value: string): value is MapStyleTheme => {
  return value === 'light' || value === 'dark'
}

export const normalizeMapStyleLanguage = (locale: string | null | undefined) => {
  const normalized = (locale || '').trim()

  if (!normalized) {
    return 'zh-Hans'
  }

  if (normalized === 'zh-CN' || normalized.startsWith('zh-Hans')) {
    return 'zh-Hans'
  }

  if (normalized === 'zh-TW' || normalized.startsWith('zh-Hant')) {
    return 'zh-Hant'
  }

  if (normalized.startsWith('ja')) {
    return 'ja'
  }

  return 'en'
}

const withQueryParameter = (url: string, key: string, value: string) => {
  const trimmed = url.trim()
  if (!trimmed) {
    return trimmed
  }

  if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
    const nextUrl = new URL(trimmed)
    nextUrl.searchParams.set(key, value)
    return nextUrl.toString()
  }

  const nextUrl = new URL(trimmed, 'http://localhost')
  nextUrl.searchParams.set(key, value)
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
}

export const resolveHostedMapStyleUrl = (options: {
  theme: MapStyleTheme
  locale: string
  lightStyleUrl?: string | null
  darkStyleUrl?: string | null
}) => {
  const baseUrl = options.theme === 'dark'
    ? (options.darkStyleUrl?.trim() || MAP_DARK_STYLE_URL)
    : (options.lightStyleUrl?.trim() || MAP_DEFAULT_STYLE_URL)

  return withQueryParameter(
    withQueryParameter(baseUrl, 'lang', normalizeMapStyleLanguage(options.locale)),
    'v',
    MAP_STYLE_REVISION
  )
}
