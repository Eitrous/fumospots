import { getRequestHeader, sendRedirect, setHeader } from 'h3'

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

  setHeader(event, 'Cache-Control', 'public, max-age=86400')

  return sendRedirect(event, pmtilesUrl, 307)
})
