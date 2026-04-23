import { getRouterParam, type H3Event } from 'h3'
import type { EditablePostDetail } from '~~/shared/fumo'
import { createPublicServerClient, requireAuthenticatedUser } from '~~/server/utils/supabase'
import {
  getPreferredGeocodeAcceptLanguage,
  normalizeLocationScopeForLocale
} from '~~/server/utils/geocode'
import {
  getOrderedPhotoRows,
  signEditablePhotoRows,
  type PhotoRow
} from '~~/server/utils/posts'

const toEditableDetail = async (
  event: H3Event,
  source: any,
  status: EditablePostDetail['status'],
  hasPendingRevision: boolean,
  photoRows: PhotoRow[]
): Promise<EditablePostDetail> => {
  const photos = await signEditablePhotoRows(event, photoRows, 60 * 60)
  const locationScope = normalizeLocationScopeForLocale({
    countryName: source.country_name,
    regionName: source.region_name,
    cityName: source.city_name
  }, getPreferredGeocodeAcceptLanguage(event))

  return {
    id: source.post_id || source.id,
    status,
    hasPendingRevision,
    title: source.title,
    body: source.body,
    photos,
    capturedAt: source.captured_at,
    exactLocation: {
      lat: source.exact_lat,
      lng: source.exact_lng
    },
    publicLocation: {
      lat: source.public_lat,
      lng: source.public_lng
    },
    privacyMode: source.privacy_mode,
    placeName: source.place_name || '',
    countryName: locationScope.countryName,
    regionName: locationScope.regionName,
    cityName: locationScope.cityName
  }
}

export default defineEventHandler(async (event): Promise<EditablePostDetail> => {
  const id = Number(getRouterParam(event, 'id'))

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid post id.'
    })
  }

  const { accessToken, user } = await requireAuthenticatedUser(event)
  const supabase = createPublicServerClient(event, accessToken)
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select(`
      id,
      user_id,
      title,
      body,
      image_path,
      thumb_path,
      captured_at,
      exact_lat,
      exact_lng,
      public_lat,
      public_lng,
      privacy_mode,
      place_name,
      country_name,
      region_name,
      city_name,
      status,
      post_photos (
        image_path,
        thumb_path,
        sort_order
      )
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (postError || !post) {
    throw createError({
      statusCode: 404,
      statusMessage: postError?.message || 'Post not found.'
    })
  }

  const { data: revision, error: revisionError } = await supabase
    .from('post_revisions')
    .select(`
      id,
      post_id,
      title,
      body,
      image_path,
      thumb_path,
      captured_at,
      exact_lat,
      exact_lng,
      public_lat,
      public_lng,
      privacy_mode,
      place_name,
      country_name,
      region_name,
      city_name,
      status,
      post_revision_photos (
        image_path,
        thumb_path,
        sort_order
      )
    `)
    .eq('post_id', id)
    .eq('status', 'pending')
    .maybeSingle()

  if (revisionError) {
    throw createError({
      statusCode: 500,
      statusMessage: revisionError.message
    })
  }

  if (revision) {
    return toEditableDetail(
      event,
      revision,
      post.status,
      true,
      getOrderedPhotoRows(revision.post_revision_photos as PhotoRow[], revision)
    )
  }

  return toEditableDetail(
    event,
    post,
    post.status,
    false,
    getOrderedPhotoRows(post.post_photos as PhotoRow[], post)
  )
})
