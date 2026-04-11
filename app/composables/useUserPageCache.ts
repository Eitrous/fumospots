import type { PublicUserPage } from '~~/shared/fumo'

export const USER_PAGE_CACHE_TTL_MS = 10 * 60 * 1000
export const MAX_USER_PAGE_CACHE_ITEMS = 50

type CachedUserPage = {
  userPage: PublicUserPage
  lastAccessedAt: number
  expiresAt: number
}

const pendingUserPageRequests = new Map<string, Promise<PublicUserPage>>()

const normalizeUsername = (username: string) => username.trim().toLowerCase()
const cacheKeyForUserPage = (username: string, viewerId: string | null) => {
  return `${normalizeUsername(username)}::${viewerId || 'public'}`
}

export const useUserPageCache = () => {
  const cache = useState<Record<string, CachedUserPage>>('user-page-cache', () => ({}))

  const removeCacheKey = (key: string) => {
    if (!cache.value[key]) {
      return
    }

    const next = { ...cache.value }
    delete next[key]
    cache.value = next
  }

  const pruneExpiredUserPages = (now = Date.now()) => {
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

  const trimUserPageCache = () => {
    const entries = Object.entries(cache.value)
    if (entries.length <= MAX_USER_PAGE_CACHE_ITEMS) {
      return
    }

    const keysToRemove = entries
      .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt)
      .slice(0, entries.length - MAX_USER_PAGE_CACHE_ITEMS)
      .map(([key]) => key)

    const next = { ...cache.value }
    for (const key of keysToRemove) {
      delete next[key]
    }
    cache.value = next
  }

  const setUserPage = (key: string, userPage: PublicUserPage) => {
    const now = Date.now()
    cache.value = {
      ...cache.value,
      [key]: {
        userPage,
        lastAccessedAt: now,
        expiresAt: now + USER_PAGE_CACHE_TTL_MS
      }
    }
    trimUserPageCache()
  }

  const getCachedUserPage = (key: string) => {
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

    return cached.userPage
  }

  const getUserPage = async (
    username: string,
    options: {
      headers?: Record<string, string>
      viewerId?: string | null
    } = {}
  ) => {
    pruneExpiredUserPages()

    const key = cacheKeyForUserPage(username, options.viewerId ?? null)
    const cached = getCachedUserPage(key)
    if (cached) {
      return cached
    }

    const pendingRequest = pendingUserPageRequests.get(key)
    if (pendingRequest) {
      return pendingRequest
    }

    const request = $fetch<PublicUserPage>(`/api/users/${encodeURIComponent(username)}`, {
      headers: options.headers
    })
      .then((userPage) => {
        setUserPage(key, userPage)
        return userPage
      })
      .finally(() => {
        pendingUserPageRequests.delete(key)
      })

    pendingUserPageRequests.set(key, request)
    return request
  }

  const invalidateUserPage = (username: string) => {
    const normalizedUsername = normalizeUsername(username)
    const keyPrefix = `${normalizedUsername}::`
    const next = { ...cache.value }

    for (const key of Object.keys(next)) {
      if (key.startsWith(keyPrefix)) {
        delete next[key]
      }
    }

    for (const key of pendingUserPageRequests.keys()) {
      if (key.startsWith(keyPrefix)) {
        pendingUserPageRequests.delete(key)
      }
    }

    cache.value = next
  }

  return {
    getUserPage,
    invalidateUserPage
  }
}
