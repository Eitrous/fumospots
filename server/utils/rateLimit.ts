import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import {
  createError,
  getRequestHeader,
  getRequestIP,
  setResponseHeader,
  type H3Event
} from 'h3'

type RateLimitKey =
  | 'geocodeIp'
  | 'geocodeGlobal'
  | 'mapIp'
  | 'likeIp'
  | 'likeUser'
  | 'likePostUser'
  | 'submitIp'
  | 'submitUser'

type RateLimiterSet = Record<RateLimitKey, Ratelimit>

const RATE_LIMIT_PREFIX = 'fumo:ratelimit'
const REQUEST_IP_FALLBACK = 'unknown'
const RATE_LIMIT_TIMEOUT_MS = 1000

let limiters: RateLimiterSet | null = null
let warnedMissingRedis = false

const hasUpstashConfig = () => {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

const getLimiters = () => {
  if (!hasUpstashConfig()) {
    return null
  }

  if (limiters) {
    return limiters
  }

  const redis = Redis.fromEnv()
  const options = {
    redis,
    timeout: RATE_LIMIT_TIMEOUT_MS
  }

  limiters = {
    geocodeIp: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:geocode:ip`,
      limiter: Ratelimit.slidingWindow(20, '1 m')
    }),
    geocodeGlobal: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:geocode:global`,
      limiter: Ratelimit.slidingWindow(1, '1 s')
    }),
    mapIp: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:map:ip`,
      limiter: Ratelimit.slidingWindow(180, '1 m')
    }),
    likeIp: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:like:ip`,
      limiter: Ratelimit.slidingWindow(120, '1 m')
    }),
    likeUser: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:like:user`,
      limiter: Ratelimit.slidingWindow(40, '1 m')
    }),
    likePostUser: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:like:post-user`,
      limiter: Ratelimit.slidingWindow(12, '1 m')
    }),
    submitIp: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:submit:ip`,
      limiter: Ratelimit.slidingWindow(30, '1 h')
    }),
    submitUser: new Ratelimit({
      ...options,
      prefix: `${RATE_LIMIT_PREFIX}:submit:user`,
      limiter: Ratelimit.slidingWindow(10, '1 h')
    })
  }

  return limiters
}

export const getRateLimitIdentifier = (event: H3Event) => {
  return (
    getRequestIP(event, { xForwardedFor: true })
    || getRequestHeader(event, 'x-real-ip')
    || REQUEST_IP_FALLBACK
  )
}

export const isPublicNominatimBaseUrl = (baseUrl: string | undefined) => {
  if (!baseUrl) {
    return false
  }

  try {
    return new URL(baseUrl).hostname === 'nominatim.openstreetmap.org'
  } catch {
    return false
  }
}

const setRateLimitHeaders = (
  event: H3Event,
  result: Awaited<ReturnType<Ratelimit['limit']>>
) => {
  const resetInSeconds = Math.max(0, Math.ceil((result.reset - Date.now()) / 1000))

  setResponseHeader(event, 'X-RateLimit-Limit', String(result.limit))
  setResponseHeader(event, 'X-RateLimit-Remaining', String(Math.max(0, result.remaining)))
  setResponseHeader(event, 'X-RateLimit-Reset', String(Math.ceil(result.reset / 1000)))

  if (!result.success) {
    setResponseHeader(event, 'Retry-After', String(resetInSeconds))
  }
}

export const enforceRateLimit = async (
  event: H3Event,
  key: RateLimitKey,
  identifier: string
) => {
  const activeLimiters = getLimiters()

  if (!activeLimiters) {
    if (import.meta.dev) {
      if (!warnedMissingRedis) {
        warnedMissingRedis = true
        console.warn('Upstash Redis rate limiting is disabled because UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing.')
      }
      return
    }

    throw createError({
      statusCode: 503,
      statusMessage: 'Rate limiting is not configured.'
    })
  }

  const result = await activeLimiters[key].limit(identifier)
  setRateLimitHeaders(event, result)

  if (!result.success) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests. Please try again later.'
    })
  }
}

