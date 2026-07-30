import { setHeader, type H3Event } from 'h3'

export const PUBLIC_API_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'

export const setPublicApiCacheControl = (event: H3Event) => {
  setHeader(event, 'Cache-Control', PUBLIC_API_CACHE_CONTROL)
}
