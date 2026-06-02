import { setHeader } from 'h3'
import type { PublicLatestPostsResponse } from '~~/shared/fumo'
import { createPublicServerClient, signStorageObjects } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type LatestPostRow = {
  id: number
  title: string
  image_path: string
  thumb_path: string | null
  place_name: string | null
}

const LATEST_POSTS_LIMIT = 4

export default defineEventHandler(async (event): Promise<PublicLatestPostsResponse> => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const supabase = createPublicServerClient(event)
  const { data, error } = await supabase
    .from('public_approved_posts')
    .select(`
      id,
      title,
      image_path,
      thumb_path,
      place_name
    `)
    .order('created_at', { ascending: false })
    .limit(LATEST_POSTS_LIMIT)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const rows = (data || []) as LatestPostRow[]
  const coverPathById = new Map<number, string>()

  for (const row of rows) {
    coverPathById.set(row.id, row.thumb_path || row.image_path)
  }

  const coverUrls = await signStorageObjects(event, [...coverPathById.values()], 60 * 30)

  setHeader(event, 'Cache-Control', 'no-store')

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      thumbUrl: coverUrls.get(coverPathById.get(row.id) || '') ?? null,
      placeName: row.place_name
    }))
  }
})
