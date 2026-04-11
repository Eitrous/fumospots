import type { PublicPostDetail } from '~~/shared/fumo'

export const POST_DETAIL_CACHE_TTL_MS = 10 * 60 * 1000
export const MAX_POST_DETAIL_CACHE_ITEMS = 50

type CachedPostDetail = {
  post: PublicPostDetail
  lastAccessedAt: number
  expiresAt: number
}

const pendingPostDetailRequests = new Map<number, Promise<PublicPostDetail>>()

const cacheKeyForPost = (postId: number) => String(postId)

export const usePostDetailCache = () => {
  const cache = useState<Record<string, CachedPostDetail>>('post-detail-cache', () => ({}))

  const removeCacheKey = (key: string) => {
    if (!cache.value[key]) {
      return
    }

    const next = { ...cache.value }
    delete next[key]
    cache.value = next
  }

  const pruneExpiredPostDetails = (now = Date.now()) => {
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

  const trimPostDetailCache = () => {
    const entries = Object.entries(cache.value)
    if (entries.length <= MAX_POST_DETAIL_CACHE_ITEMS) {
      return
    }

    const keysToRemove = entries
      .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt)
      .slice(0, entries.length - MAX_POST_DETAIL_CACHE_ITEMS)
      .map(([key]) => key)

    const next = { ...cache.value }
    for (const key of keysToRemove) {
      delete next[key]
    }
    cache.value = next
  }

  const setPostDetail = (postId: number, post: PublicPostDetail) => {
    const now = Date.now()
    cache.value = {
      ...cache.value,
      [cacheKeyForPost(postId)]: {
        post,
        lastAccessedAt: now,
        expiresAt: now + POST_DETAIL_CACHE_TTL_MS
      }
    }
    trimPostDetailCache()
  }

  const getCachedPostDetail = (postId: number) => {
    const now = Date.now()
    const key = cacheKeyForPost(postId)
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

    return cached.post
  }

  const getPostDetail = async (postId: number) => {
    pruneExpiredPostDetails()

    const cached = getCachedPostDetail(postId)
    if (cached) {
      return cached
    }

    const pendingRequest = pendingPostDetailRequests.get(postId)
    if (pendingRequest) {
      return pendingRequest
    }

    const request = $fetch<PublicPostDetail>(`/api/posts/${postId}`)
      .then((post) => {
        setPostDetail(postId, post)
        return post
      })
      .finally(() => {
        pendingPostDetailRequests.delete(postId)
      })

    pendingPostDetailRequests.set(postId, request)
    return request
  }

  const prefetchPostDetail = (postId: number) => {
    void getPostDetail(postId).catch(() => {
      pendingPostDetailRequests.delete(postId)
    })
  }

  const invalidatePostDetail = (postId: number) => {
    pendingPostDetailRequests.delete(postId)
    removeCacheKey(cacheKeyForPost(postId))
  }

  return {
    getPostDetail,
    prefetchPostDetail,
    invalidatePostDetail
  }
}
