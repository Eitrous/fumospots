import type { PublicRegionPage, RegionScope, RegionSort } from '~~/shared/fumo'

export const REGION_PAGE_CACHE_TTL_MS = 10 * 60 * 1000
export const MAX_REGION_PAGE_CACHE_ITEMS = 50

type CachedRegionPage = {
  regionPage: PublicRegionPage
  lastAccessedAt: number
  expiresAt: number
}

type RegionPageRequestOptions = {
  headers?: Record<string, string>
  viewerId?: string | null
}

const pendingRegionPageRequests = new Map<string, Promise<PublicRegionPage>>()

const normalizeScopeValue = (value: string | null) => value?.trim().toLowerCase() || ''
const normalizeLocaleKey = (value: string | null | undefined) => value?.trim().toLowerCase() || 'default'

const cacheKeyForRegionPage = (
  scope: RegionScope,
  sort: RegionSort,
  viewerId: string | null,
  localeCode: string | null
) => {
  return [
    normalizeScopeValue(scope.countryName),
    normalizeScopeValue(scope.regionName),
    normalizeScopeValue(scope.cityName),
    sort,
    viewerId || 'public',
    normalizeLocaleKey(localeCode)
  ].join('::')
}

export const useRegionPageCache = () => {
  const { locale } = useI18n()
  const cache = useState<Record<string, CachedRegionPage>>('region-page-cache', () => ({}))

  const removeCacheKey = (key: string) => {
    if (!cache.value[key]) {
      return
    }

    const next = { ...cache.value }
    delete next[key]
    cache.value = next
  }

  const pruneExpiredRegionPages = (now = Date.now()) => {
    const next = { ...cache.value }
    let changed = false

    for (const [key, item] of Object.entries(next)) {
      if (item.expiresAt <= now) {
        delete next[key]
        changed = true
      }
    }

    if (changed) {
      cache.value = next
    }
  }

  const trimRegionPageCache = () => {
    const entries = Object.entries(cache.value)
    if (entries.length <= MAX_REGION_PAGE_CACHE_ITEMS) {
      return
    }

    const keysToRemove = entries
      .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt)
      .slice(0, entries.length - MAX_REGION_PAGE_CACHE_ITEMS)
      .map(([key]) => key)

    const next = { ...cache.value }
    for (const key of keysToRemove) {
      delete next[key]
    }
    cache.value = next
  }

  const setRegionPage = (key: string, regionPage: PublicRegionPage) => {
    const now = Date.now()
    cache.value = {
      ...cache.value,
      [key]: {
        regionPage,
        lastAccessedAt: now,
        expiresAt: now + REGION_PAGE_CACHE_TTL_MS
      }
    }
    trimRegionPageCache()
  }

  const getCachedRegionPage = (key: string) => {
    const now = Date.now()
    const cached = cache.value[key]

    if (!cached) {
      return null
    }

    if (cached.expiresAt <= now) {
      removeCacheKey(key)
      return null
    }

    cache.value = {
      ...cache.value,
      [key]: {
        ...cached,
        lastAccessedAt: now
      }
    }

    return cached.regionPage
  }

  const getRegionPage = async (
    scope: RegionScope,
    sort: RegionSort,
    options: RegionPageRequestOptions = {}
  ) => {
    pruneExpiredRegionPages()

    const localeCode = locale.value || null
    const key = cacheKeyForRegionPage(scope, sort, options.viewerId ?? null, localeCode)
    const cached = getCachedRegionPage(key)
    if (cached) {
      return cached
    }

    const pendingRequest = pendingRegionPageRequests.get(key)
    if (pendingRequest) {
      return pendingRequest
    }

    const request = $fetch<PublicRegionPage>('/api/regions/posts', {
      headers: {
        ...(options.headers || {}),
        ...(localeCode ? { 'accept-language': localeCode } : {})
      },
      query: {
        country: scope.countryName || undefined,
        region: scope.regionName,
        city: scope.cityName || undefined,
        sort
      }
    })
      .then((regionPage) => {
        setRegionPage(key, regionPage)
        return regionPage
      })
      .finally(() => {
        pendingRegionPageRequests.delete(key)
      })

    pendingRegionPageRequests.set(key, request)
    return request
  }

  const invalidateRegionPages = () => {
    cache.value = {}
    pendingRegionPageRequests.clear()
  }

  return {
    getRegionPage,
    invalidateRegionPages
  }
}
