import { getQuery, type H3Event } from 'h3'
import type { PublicMapPointPage } from '~~/shared/fumo'
import { setPublicApiCacheControl } from '~~/server/utils/cacheControl'
import { createPublicServerClient } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type MapPostRow = {
  id: number
  public_lat: number
  public_lng: number
  user_id?: string | null
}

const MAP_POSTS_BATCH_SIZE = 500
const MAP_POST_OWNER_BATCH_SIZE = 500
const CHARACTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const parseAfterId = (value: unknown) => {
  if (value == null) {
    return 0
  }

  const rawValue = typeof value === 'number' ? String(value) : value
  if (
    typeof rawValue !== 'string'
    || !/^\d+$/.test(rawValue)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Map post cursor is invalid.'
    })
  }

  const afterId = Number(rawValue)
  if (!Number.isSafeInteger(afterId) || afterId < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Map post cursor is invalid.'
    })
  }

  return afterId
}

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

const fetchMapPosts = async (
  event: H3Event,
  characterSlugs: string[],
  afterId: number
) => {
  const supabase = createPublicServerClient(event)
  const result = characterSlugs.length
    ? await supabase
        .rpc('get_public_map_posts', {
          requested_character_slugs: characterSlugs
        })
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(MAP_POSTS_BATCH_SIZE + 1)
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
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(MAP_POSTS_BATCH_SIZE + 1)

  const { data, error } = result

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const rows = (data || []) as MapPostRow[]
  const hasNextPage = rows.length > MAP_POSTS_BATCH_SIZE
  const pageRows = rows.slice(0, MAP_POSTS_BATCH_SIZE)

  const ownerByPostId = new Map<number, string>()

  if (characterSlugs.length) {
    for (let index = 0; index < pageRows.length; index += MAP_POST_OWNER_BATCH_SIZE) {
      const postIds = pageRows
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

  const features = pageRows.map((row) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.public_lng, row.public_lat]
    },
    properties: {
      id: row.id,
      userId: row.user_id || ownerByPostId.get(row.id) || ''
    }
  })) satisfies PublicMapPointPage['features']

  const nextAfterId = hasNextPage
    ? pageRows.at(-1)?.id ?? null
    : null

  return {
    type: 'FeatureCollection',
    features,
    nextAfterId
  } satisfies PublicMapPointPage
}

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const query = getQuery(event)
  const characterSlugs = parseCharacterSlugs(query.characters)
  const afterId = parseAfterId(query.afterId)
  const response = await fetchMapPosts(event, characterSlugs, afterId)

  setPublicApiCacheControl(event)

  return response
})
