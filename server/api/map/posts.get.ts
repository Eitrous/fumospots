import { getQuery, type H3Event } from 'h3'
import type { PublicMapPointCollection } from '~~/shared/fumo'
import { setPublicApiCacheControl } from '~~/server/utils/cacheControl'
import { createPublicServerClient } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type MapPostRow = {
  id: number
  public_lat: number
  public_lng: number
  user_id?: string | null
}

const MAP_POSTS_PAGE_SIZE = 1000
const MAP_POST_OWNER_BATCH_SIZE = 500
const CHARACTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const parseCharacterSlugs = (value: unknown) => {
  const values = Array.isArray(value) ? value : [value]
  const slugs = [...new Set(values
    .flatMap(item => typeof item === 'string' ? item.split(',') : [])
    .map(item => item.trim().toLowerCase())
    .filter(Boolean))]

  if (slugs.some(slug => !CHARACTER_SLUG_PATTERN.test(slug))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Character filter is invalid.'
    })
  }

  return slugs
}

const fetchMapPosts = async (event: H3Event, characterSlugs: string[]) => {
  const supabase = createPublicServerClient(event)
  const rows: MapPostRow[] = []

  while (true) {
    const from = rows.length
    const to = from + MAP_POSTS_PAGE_SIZE - 1
    const result = characterSlugs.length
      ? await supabase
          .rpc('get_public_map_posts', {
            requested_character_slugs: characterSlugs
          })
          .range(from, to)
      : await supabase
          .from('public_approved_posts')
          .select(`
            id,
            user_id,
            public_lat,
            public_lng
          `)
          .not('public_lat', 'is', null)
          .not('public_lng', 'is', null)
          .order('id', { ascending: true })
          .range(from, to)

    const { data, error } = result

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

  const ownerByPostId = new Map<number, string>()

  if (characterSlugs.length) {
    for (let index = 0; index < rows.length; index += MAP_POST_OWNER_BATCH_SIZE) {
      const postIds = rows
        .slice(index, index + MAP_POST_OWNER_BATCH_SIZE)
        .map(row => row.id)
      const { data, error } = await supabase
        .from('public_approved_posts')
        .select('id, user_id')
        .in('id', postIds)

      if (error) {
        throw createError({
          statusCode: 500,
          statusMessage: error.message
        })
      }

      for (const row of data || []) {
        ownerByPostId.set(Number(row.id), row.user_id)
      }
    }
  }

  const features = rows.map((row) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.public_lng, row.public_lat]
    },
    properties: {
      id: row.id,
      userId: row.user_id || ownerByPostId.get(row.id) || ''
    }
  })) satisfies PublicMapPointCollection['features']

  return {
    type: 'FeatureCollection',
    features
  } satisfies PublicMapPointCollection
}

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const characterSlugs = parseCharacterSlugs(getQuery(event).characters)
  const response = await fetchMapPosts(event, characterSlugs)

  setPublicApiCacheControl(event)

  return response
})
