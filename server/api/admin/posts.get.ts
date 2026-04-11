import { getQuery, type H3Event } from 'h3'
import type { AdminReviewPost } from '~~/shared/fumo'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'
import { getOrderedPhotoRows, signPhotoRows, type PhotoRow } from '~~/server/utils/posts'

const mapReviewRow = async (
  event: H3Event,
  row: any,
  options: {
    reviewKey: string
    reviewKind: AdminReviewPost['reviewKind']
    revisionId: number | null
    postId: number
    photoRows: PhotoRow[]
  }
): Promise<AdminReviewPost> => {
  const photos = await signPhotoRows(event, options.photoRows)
  const coverPhoto = photos[0] || {
    imageUrl: null,
    thumbUrl: null
  }

  return {
    reviewKey: options.reviewKey,
    reviewKind: options.reviewKind,
    revisionId: options.revisionId,
    id: options.postId,
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
    reviewNote: row.review_note,
    author: {
      id: row.user_id,
      username: row.profiles?.username ?? 'unknown',
      avatarUrl: row.profiles?.avatar_url ?? null
    }
  }
}

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)

  const requestedStatus = String(getQuery(event).status || 'pending')
  const status = ['pending', 'approved', 'rejected'].includes(requestedStatus)
    ? requestedStatus
    : 'pending'

  const supabase = createAdminServerClient(event)
  const { data: postRows, error: postsError } = await supabase
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
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(50)

  if (postsError) {
    throw createError({
      statusCode: 500,
      statusMessage: postsError.message
    })
  }

  const { data: revisionRows, error: revisionsError } = await supabase
    .from('post_revisions')
    .select(`
      id,
      post_id,
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
      post_revision_photos (
        image_path,
        thumb_path,
        sort_order
      ),
      profiles!post_revisions_user_id_fkey (
        username,
        avatar_url
      )
    `)
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(50)

  if (revisionsError) {
    throw createError({
      statusCode: 500,
      statusMessage: revisionsError.message
    })
  }

  const postItems = await Promise.all((postRows || []).map((row: any) => mapReviewRow(
    event,
    row,
    {
      reviewKey: `post-${row.id}`,
      reviewKind: 'post',
      revisionId: null,
      postId: row.id,
      photoRows: getOrderedPhotoRows(row.post_photos as PhotoRow[], row)
    }
  )))

  const revisionItems = await Promise.all((revisionRows || []).map((row: any) => mapReviewRow(
    event,
    row,
    {
      reviewKey: `revision-${row.id}`,
      reviewKind: 'revision',
      revisionId: row.id,
      postId: row.post_id,
      photoRows: getOrderedPhotoRows(row.post_revision_photos as PhotoRow[], row)
    }
  )))

  return [...postItems, ...revisionItems]
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .slice(0, 50)
})
