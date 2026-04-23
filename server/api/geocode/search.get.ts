import { getQuery } from 'h3'
import {
  fetchSearchGeocodeEntries,
  getPreferredGeocodeAcceptLanguage,
  normalizeGeocodeResult
} from '~~/server/utils/geocode'
import {
  enforceRateLimit,
  getRateLimitIdentifier,
  isPublicNominatimBaseUrl
} from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const q = String(getQuery(event).q || '').trim()
  const acceptLanguage = getPreferredGeocodeAcceptLanguage(event)

  if (!q) {
    return []
  }

  if (q.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: '搜索关键词至少需要 2 个字符'
    })
  }

  await enforceRateLimit(event, 'geocodeIp', getRateLimitIdentifier(event))
  if (isPublicNominatimBaseUrl(config.geocodeBaseUrl)) {
    await enforceRateLimit(event, 'geocodeGlobal', 'nominatim')
  }

  try {
    const results = await fetchSearchGeocodeEntries(event, q, {
      limit: 6,
      acceptLanguage
    })

    return results.map((result) => normalizeGeocodeResult(result, acceptLanguage))
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: '地理编码服务暂时不可用'
    })
  }
})
