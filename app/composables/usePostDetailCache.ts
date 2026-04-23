import type { PostLikeResponse, PublicPostDetail } from '~~/shared/fumo'

export const POST_DETAIL_CACHE_TTL_MS = 10 * 60 * 1000
export const MAX_POST_DETAIL_CACHE_ITEMS = 50

type CachedPostDetail = {
  post: PublicPostDetail
  lastAccessedAt: number
  expiresAt: number
}

type PostDetailRequestOptions = {
  headers?: Record<string, string>
  viewerId?: string | null
}

const pendingPostDetailRequests = new Map<string, Promise<PublicPostDetail>>()

const cacheKeyPrefixForPost = (postId: number) => `${postId}::`
const normalizeLocaleKey = (value: string | null | undefined) => value?.trim().toLowerCase() || 'default'
const cacheKeyForPost = (
  postId: number,
  viewerId: string | null = null,
  localeCode: string | null = null
) => {
  return `${cacheKeyPrefixForPost(postId)}${viewerId || 'public'}::${normalizeLocaleKey(localeCode)}`
}

export const usePostDetailCache = () => {
  const { locale } = useI18n()
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

  const setPostDetail = (key: string, post: PublicPostDetail) => {
    const now = Date.now()
    cache.value = {
      ...cache.value,
      [key]: {
        post,
        lastAccessedAt: now,
        expiresAt: now + POST_DETAIL_CACHE_TTL_MS
      }
    }
    trimPostDetailCache()
  }

  const getCachedPostDetail = (key: string) => {
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

    return cached.post
  }

  const getPostDetail = async (postId: number, options: PostDetailRequestOptions = {}) => {
    pruneExpiredPostDetails()

    const localeCode = locale.value || null
    const key = cacheKeyForPost(postId, options.viewerId ?? null, localeCode)
    const cached = getCachedPostDetail(key)
    if (cached) {
      return cached
    }

    const pendingRequest = pendingPostDetailRequests.get(key)
    if (pendingRequest) {
      return pendingRequest
    }

    const request = $fetch<PublicPostDetail>(`/api/posts/${postId}`, {
      headers: {
        ...(options.headers || {}),
        ...(localeCode ? { 'accept-language': localeCode } : {})
      }
    })
      .then((post) => {
        setPostDetail(key, post)
        return post
      })
      .finally(() => {
        pendingPostDetailRequests.delete(key)
      })

    pendingPostDetailRequests.set(key, request)
    return request
  }

  const prefetchPostDetail = (postId: number, options: PostDetailRequestOptions = {}) => {
    const key = cacheKeyForPost(postId, options.viewerId ?? null, locale.value || null)
    void getPostDetail(postId, options).catch(() => {
      pendingPostDetailRequests.delete(key)
    })
  }

  const invalidatePostDetail = (postId: number) => {
    const keyPrefix = cacheKeyPrefixForPost(postId)
    const next = { ...cache.value }

    for (const key of Object.keys(next)) {
      if (key.startsWith(keyPrefix)) {
        delete next[key]
      }
    }

    for (const key of pendingPostDetailRequests.keys()) {
      if (key.startsWith(keyPrefix)) {
        pendingPostDetailRequests.delete(key)
      }
    }

    cache.value = next
  }

  const updatePostDetailLike = (
    postId: number,
    like: PostLikeResponse,
    viewerId: string | null = null
  ) => {
    const keyPrefix = cacheKeyPrefixForPost(postId)
    const viewerKey = cacheKeyForPost(postId, viewerId)
    const next = { ...cache.value }
    let changed = false
    const now = Date.now()

    for (const [key, item] of Object.entries(next)) {
      if (!key.startsWith(keyPrefix)) {
        continue
      }

      next[key] = {
        ...item,
        post: {
          ...item.post,
          likeCount: like.likeCount,
          likedByViewer: key === viewerKey ? like.likedByViewer : item.post.likedByViewer
        },
        lastAccessedAt: now
      }
      changed = true
    }

    if (changed) {
      cache.value = next
    }
  }

  return {
    getPostDetail,
    prefetchPostDetail,
    invalidatePostDetail,
    updatePostDetailLike
  }
}
