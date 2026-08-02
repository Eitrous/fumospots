import type { PublicPostDetail } from '~~/shared/fumo'
import {
  createPublicServerClient,
  getOptionalAuthenticatedUser
} from '~~/server/utils/supabase'
import {
  getPreferredGeocodeAcceptLanguage,
  normalizeLocationScopeForLocale
} from '~~/server/utils/geocode'
import { getOrderedPhotoRows, signPhotoRows, type PhotoRow } from '~~/server/utils/posts'
import { mapCharacterRelations } from '~~/server/utils/characters'

export default defineEventHandler(async (event): Promise<PublicPostDetail> => {
  const id = Number(event.context.params?.id)

  if (Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }

  const supabase = createPublicServerClient(event)
  const acceptLanguage = getPreferredGeocodeAcceptLanguage(event)

  const authPromise = getOptionalAuthenticatedUser(event)
  const postPromise = supabase
    .from('public_approved_posts')
    .select(`
      id,
      user_id,
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
      created_at
    `)
    .eq('id', id)
    .single()
  const [{ data, error }, auth] = await Promise.all([postPromise, authPromise])

  if (error || !data) {
    throw createError({
      statusCode: 404,
      statusMessage: error?.message || 'Post not found'
    })
  }

  const signedPhotosPromise = supabase
    .from('public_approved_post_photos')
    .select('image_path, thumb_path, sort_order')
    .eq('post_id', id)
    .order('sort_order', { ascending: true })
    .then(async ({ data: photoData, error: photosError }) => {
      if (photosError) {
        throw createError({
          statusCode: 500,
          statusMessage: photosError.message
        })
      }

      return await signPhotoRows(event, getOrderedPhotoRows(photoData as PhotoRow[], data), 60 * 60)
    })

  const profilePromise = supabase
    .from('public_profiles')
    .select('username, avatar_url')
    .eq('id', data.user_id)
    .maybeSingle()

  const likeCountPromise = supabase
    .from('public_approved_post_like_counts')
    .select('like_count')
    .eq('post_id', id)
    .maybeSingle()

  const charactersPromise = supabase
    .from('post_characters')
    .select(`
      character_id,
      characters (
        id,
        slug,
        name_en,
        name_zh,
        name_ja
      )
    `)
    .eq('post_id', id)
    .order('character_id', { ascending: true })

  const viewerLikePromise = auth
    ? createPublicServerClient(event, auth.accessToken)
      .from('post_likes')
      .select('post_id')
      .eq('post_id', id)
      .eq('user_id', auth.user.id)
      .limit(1)
    : Promise.resolve({ data: null, error: null })

  const [
    photos,
    { data: profile, error: profileError },
    { data: likeCount, error: likeCountError },
    { data: viewerLikes, error: viewerLikeError },
    { data: characterRelations, error: charactersError }
  ] = await Promise.all([
    signedPhotosPromise,
    profilePromise,
    likeCountPromise,
    viewerLikePromise,
    charactersPromise
  ])

  if (profileError) {
    throw createError({
      statusCode: 500,
      statusMessage: profileError.message
    })
  }

  const coverPhoto = photos[0] || {
    imageUrl: null,
    thumbUrl: null
  }
  const locationScope = normalizeLocationScopeForLocale({
    countryName: data.country_name,
    regionName: data.region_name,
    cityName: data.city_name
  }, acceptLanguage)

  if (likeCountError) {
    throw createError({
      statusCode: 500,
      statusMessage: likeCountError.message
    })
  }

  if (viewerLikeError) {
    throw createError({
      statusCode: 500,
      statusMessage: viewerLikeError.message
    })
  }

  if (charactersError) {
    throw createError({
      statusCode: 500,
      statusMessage: charactersError.message
    })
  }

  const likedByViewer = Boolean(viewerLikes?.length)

  return {
    id: data.id,
    title: data.title,
    body: data.body,
    imageUrl: coverPhoto.imageUrl,
    thumbUrl: coverPhoto.thumbUrl,
    photos,
    likeCount: likeCount?.like_count ?? 0,
    likedByViewer,
    placeName: data.place_name,
    countryName: locationScope.countryName,
    regionName: locationScope.regionName,
    cityName: locationScope.cityName,
    publicLocation: data.public_lat != null && data.public_lng != null
      ? {
          lat: data.public_lat,
          lng: data.public_lng
        }
      : null,
    privacyMode: data.privacy_mode,
    capturedAt: data.captured_at,
    createdAt: data.created_at,
    characters: mapCharacterRelations(characterRelations),
    author: {
      username: profile?.username ?? 'unknown',
      avatarUrl: profile?.avatar_url ?? null
    }
  }
})
