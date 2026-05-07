import { setHeader, type H3Event } from 'h3'
import type { PublicMapPointCollection } from '~~/shared/fumo'
import { createPublicServerClient } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type MapPostRow = {
  id: number
  public_lat: number
  public_lng: number
}

const MAP_POSTS_PAGE_SIZE = 1000

const fetchMapPosts = async (event: H3Event) => {
  const supabase = createPublicServerClient(event)
  const rows: MapPostRow[] = []

  while (true) {
    const from = rows.length
    const to = from + MAP_POSTS_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('public_approved_posts')
      .select(`
        id,
        public_lat,
        public_lng
      `)
      .not('public_lat', 'is', null)
      .not('public_lng', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message
      })
    }

    const page = (data || []) as MapPostRow[]
    rows.push(...page)

    if (page.length < MAP_POSTS_PAGE_SIZE) {
      break
    }
  }

  const features = rows.map((row) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.public_lng, row.public_lat]
    },
    properties: {
      id: row.id
    }
  })) satisfies PublicMapPointCollection['features']

  return {
    type: 'FeatureCollection',
    features
  } satisfies PublicMapPointCollection
}

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const response = await fetchMapPosts(event)

  setHeader(event, 'Cache-Control', 'no-store')

  return response
})
