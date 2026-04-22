import { getQuery, type H3Event } from 'h3'
import type { AdminLocationBackfillItem } from '~~/shared/fumo'
import { getOrderedPhotoRows, signPhotoRows, type PhotoRow } from '~~/server/utils/posts'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

type LocationBackfillAuthorRow = {
  username: string | null
  avatar_url: string | null
}

type LocationBackfillRow = {
  id: number
  title: string
  body: string | null
  image_path: string
  thumb_path: string | null
  place_name: string | null
  country_name: string | null
  region_name: string | null
  city_name: string | null
  exact_lat: number | null
  exact_lng: number | null
  public_lat: number | null
  public_lng: number | null
  privacy_mode: AdminLocationBackfillItem['privacyMode']
  captured_at: string | null
  created_at: string | null
  user_id: string
  post_photos: PhotoRow[] | null
  profiles: LocationBackfillAuthorRow | null
}

const DEFAULT_LIMIT = 50

const toListLimit = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return DEFAULT_LIMIT
  }

  return Math.max(1, Math.min(DEFAULT_LIMIT, parsed))
}

const toAfterId = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0
  }

  return parsed
}

const mapBackfillRow = async (
  event: H3Event,
  row: LocationBackfillRow
): Promise<AdminLocationBackfillItem> => {
  const photos = await signPhotoRows(event, getOrderedPhotoRows(row.post_photos, row))
  const coverPhoto = photos[0] || {
    imageUrl: null,
    thumbUrl: null
  }

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: coverPhoto.imageUrl,
    thumbUrl: coverPhoto.thumbUrl,
    photos,
    placeName: row.place_name,
    countryName: row.country_name,
    regionName: row.region_name,
    cityName: row.city_name,
    exactLocation: row.exact_lat != null && row.exact_lng != null
      ? { lat: row.exact_lat, lng: row.exact_lng }
      : null,
    publicLocation: row.public_lat != null && row.public_lng != null
      ? { lat: row.public_lat, lng: row.public_lng }
      : null,
    privacyMode: row.privacy_mode,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      username: row.profiles?.username ?? 'unknown',
      avatarUrl: row.profiles?.avatar_url ?? null
    }
  }
}

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)

  const query = getQuery(event)
  const limit = toListLimit(query.limit)
  const afterId = toAfterId(query.afterId)
  const supabase = createAdminServerClient(event)

  const { data, error } = await supabase
    .from('posts')
    .select(`
      id,
      title,
      body,
      image_path,
      thumb_path,
      place_name,
      country_name,
      region_name,
      city_name,
      exact_lat,
      exact_lng,
      public_lat,
      public_lng,
      privacy_mode,
      captured_at,
      created_at,
      user_id,
      post_photos (
        image_path,
        thumb_path,
        sort_order
      ),
      profiles!posts_user_id_fkey (
        username,
        avatar_url
      ),
      post_revisions!left(id)
    `)
    .eq('status', 'approved')
    .is('post_revisions.id', null)
    .gt('id', afterId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const rows = (data || []) as LocationBackfillRow[]
  const items = await Promise.all(rows.map((row) => mapBackfillRow(event, row)))

  return {
    items,
    nextCursor: items.at(-1)?.id ?? null,
    hasMore: items.length === limit
  }
})
