import { createAdminServerClient } from '~~/server/utils/supabase'
import { getOrderedPhotoRows, signPhotoRows, type PhotoRow } from '~~/server/utils/posts'

export default defineEventHandler(async (event) => {
  const id = Number(event.context.params?.id)

  if (Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }

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
      public_lat,
      public_lng,
      privacy_mode,
      captured_at,
      created_at,
      post_photos (
        image_path,
        thumb_path,
        sort_order
      ),
      profiles!posts_user_id_fkey (
        username,
        avatar_url
      )
    `)
    .eq('id', id)
    .eq('status', 'approved')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: 404,
      statusMessage: error?.message || 'Post not found'
    })
  }

  const photoRows = getOrderedPhotoRows(data.post_photos as PhotoRow[], data)
  const photos = await signPhotoRows(event, photoRows, 60 * 60)
  const coverPhoto = photos[0] || {
    imageUrl: null,
    thumbUrl: null
  }

  return {
    id: data.id,
    title: data.title,
    body: data.body,
    imageUrl: coverPhoto.imageUrl,
    thumbUrl: coverPhoto.thumbUrl,
    photos,
    placeName: data.place_name,
    countryName: data.country_name,
    regionName: data.region_name,
    cityName: data.city_name,
    publicLocation: data.public_lat != null && data.public_lng != null
      ? {
          lat: data.public_lat,
          lng: data.public_lng
        }
      : null,
    privacyMode: data.privacy_mode,
    capturedAt: data.captured_at,
    createdAt: data.created_at,
    author: {
      username: data.profiles?.username ?? 'unknown',
      avatarUrl: data.profiles?.avatar_url ?? null
    }
  }
})
