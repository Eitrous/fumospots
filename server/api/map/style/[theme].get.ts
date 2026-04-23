import { getQuery, setHeader } from 'h3'
import { isMapStyleTheme } from '~~/shared/mapStyle'
import { buildHostedMapStyle } from '~~/server/utils/mapStyle'

export default defineEventHandler((event) => {
  const theme = String(event.context.params?.theme || '')

  if (!isMapStyleTheme(theme)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Map style not found'
    })
  }

  const query = getQuery(event)
  const lang = typeof query.lang === 'string' ? query.lang : null

  setHeader(event, 'Cache-Control', 'no-store, max-age=0')

  return buildHostedMapStyle(event, theme, lang)
})
