import { getHeader, getQuery } from 'h3'
import { normalizeGeocodeResult } from '~~/server/utils/geocode'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const q = String(getQuery(event).q || '').trim()

  if (!q) {
    return []
  }

  if (q.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: '搜索关键词至少需要 2 个字符'
    })
  }

  try {
    const results = await $fetch<any[]>(`${config.geocodeBaseUrl}/search`, {
      query: {
        q,
        format: 'jsonv2',
        addressdetails: 1,
        limit: 6
      },
      headers: {
        'User-Agent': config.geocodeUserAgent,
        'Accept-Language': getHeader(event, 'accept-language') || 'zh-CN,en'
      }
    })

    return results.map(normalizeGeocodeResult)
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: '地理编码服务暂时不可用'
    })
  }
})
