import { getQuery } from 'h3'
import { createAdminServerClient, requireAdminUser, signStorageObjects } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)

  const requestedStatus = String(getQuery(event).status || 'pending')
  const status = ['pending', 'approved', 'rejected'].includes(requestedStatus)
    ? requestedStatus
    : 'pending'

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
      review_note,
      user_id,
      profiles!posts_user_id_fkey (
        username,
        avatar_url
      )
    `)
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const imageUrls = await signStorageObjects(event, (data || []).map((row: any) => row.image_path))
  const thumbUrls = await signStorageObjects(event, (data || []).map((row: any) => row.thumb_path))

  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    imageUrl: row.image_path ? imageUrls.get(row.image_path) ?? null : null,
    thumbUrl: row.thumb_path ? thumbUrls.get(row.thumb_path) ?? null : null,
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
    reviewNote: row.review_note,
    author: {
      id: row.user_id,
      username: row.profiles?.username ?? 'unknown',
      avatarUrl: row.profiles?.avatar_url ?? null
    }
  }))
})
