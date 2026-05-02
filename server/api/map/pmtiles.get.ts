import { getRequestHeader, sendWebResponse } from 'h3'

const RANGE_PATTERN = /^bytes=\d+-\d*$/

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const pmtilesUrl = String(config.public.pmtilesUrl || '').trim()

  if (!pmtilesUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'NUXT_PUBLIC_PM_TILES_URL is not configured'
    })
  }

  const range = getRequestHeader(event, 'range')
  if (!range || !RANGE_PATTERN.test(range)) {
    throw createError({
      statusCode: 416,
      statusMessage: 'PMTiles range request required'
    })
  }

  const upstream = await fetch(pmtilesUrl, {
    headers: {
      Range: range
    }
  })

  if (upstream.status !== 206) {
    throw createError({
      statusCode: upstream.status || 502,
      statusMessage: `PMTiles upstream returned ${upstream.status || 'an invalid response'}`
    })
  }

  const headers = new Headers(upstream.headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', upstream.headers.get('cache-control') || 'public, max-age=31536000, immutable')
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')

  return sendWebResponse(event, new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  }))
})
