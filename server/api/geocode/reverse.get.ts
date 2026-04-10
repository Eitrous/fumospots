import { getHeader, getQuery } from 'h3'
import { normalizeGeocodeResult } from '~~/server/utils/geocode'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const query = getQuery(event)
  const lat = Number(query.lat)
  const lng = Number(query.lng)

  if ([lat, lng].some(Number.isNaN)) {
    throw createError({
      statusCode: 400,
      statusMessage: '坐标不合法'
    })
  }

  try {
    const result = await $fetch<any>(`${config.geocodeBaseUrl}/reverse`, {
      query: {
        lat,
        lon: lng,
        format: 'jsonv2',
        addressdetails: 1
      },
      headers: {
        'User-Agent': config.geocodeUserAgent,
        'Accept-Language': getHeader(event, 'accept-language') || 'zh-CN,en'
      }
    })

    return normalizeGeocodeResult(result)
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: '逆地理编码服务暂时不可用'
    })
  }
})
