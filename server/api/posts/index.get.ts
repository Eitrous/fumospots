import { getQuery } from 'h3'
import type { PublicPostsPageResponse } from '~~/shared/fumo'
import { setPublicApiCacheControl } from '~~/server/utils/cacheControl'
import { createPublicServerClient, signStorageObjects } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type PublicPostListRow = {
  id: number
  title: string
  image_path: string
  thumb_path: string | null
  place_name: string | null
  created_at: string | null
}

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 60
const SORT_VALUES = new Set(['asc', 'desc'])

const parsePositiveInteger = (value: unknown, fallback: number) => {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const parseOffset = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

const parseSortOrder = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value

  return typeof raw === 'string' && SORT_VALUES.has(raw) ? raw : 'desc'
}

export default defineEventHandler(async (event): Promise<PublicPostsPageResponse> => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const query = getQuery(event)
  const limit = Math.min(parsePositiveInteger(query.limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const offset = parseOffset(query.offset)
  const sortOrder = parseSortOrder(query.sort)
  const supabase = createPublicServerClient(event)
  const from = offset
  const to = offset + limit - 1

  const { data, error, count } = await supabase
    .from('public_approved_posts')
    .select(`
      id,
      title,
      image_path,
      thumb_path,
      place_name,
      created_at
    `, {
      count: 'exact'
    })
    .order('created_at', {
      ascending: sortOrder === 'asc',
      nullsFirst: false
    })
    .range(from, to)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const rows = (data || []) as PublicPostListRow[]
  const coverPathById = new Map<number, string>()

  for (const row of rows) {
    coverPathById.set(row.id, row.thumb_path || row.image_path)
  }

  const coverUrls = await signStorageObjects(event, [...coverPathById.values()], 60 * 30)
  const postCount = count ?? rows.length
  const nextOffset = offset + rows.length < postCount ? offset + rows.length : null

  setPublicApiCacheControl(event)

  return {
    postCount,
    nextOffset,
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      thumbUrl: coverUrls.get(coverPathById.get(row.id) || '') ?? null,
      placeName: row.place_name,
      createdAt: row.created_at
    }))
  }
})
