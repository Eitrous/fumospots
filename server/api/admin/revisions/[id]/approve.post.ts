import { getRouterParam, readBody } from 'h3'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'
import {
  getOrderedPhotoRows,
  photoPayloadsToRows,
  type PhotoRow
} from '~~/server/utils/posts'
import { deleteStorageObjects } from '~~/server/utils/storage'
import { characterIdsToRows, getCharacterIdsFromRelations } from '~~/server/utils/characters'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody<{ reviewNote?: string }>(event)

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid revision id.'
    })
  }

  const reviewNote = body.reviewNote?.trim() || null
  const supabase = createAdminServerClient(event)
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
      ),
      post_revision_characters (
        character_id
      )
    `)
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (revisionError || !revision) {
    throw createError({
      statusCode: revisionError ? 500 : 404,
      statusMessage: revisionError?.message || 'Revision not found.'
    })
  }

  const { data: currentPost, error: currentPostError } = await supabase
    .from('posts')
    .select(`
      id,
      image_path,
      thumb_path,
      post_photos (
        image_path,
        thumb_path,
        sort_order
      )
    `)
    .eq('id', revision.post_id)
    .single()

  if (currentPostError || !currentPost) {
    throw createError({
      statusCode: 404,
      statusMessage: currentPostError?.message || 'Post not found.'
    })
  }

  const revisionPhotos = getOrderedPhotoRows(revision.post_revision_photos as PhotoRow[], revision)
  const revisionCharacterIds = getCharacterIdsFromRelations(revision.post_revision_characters)
  const currentPhotos = getOrderedPhotoRows(currentPost.post_photos as PhotoRow[], currentPost)

  if (!revisionPhotos.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Revision has no photos.'
    })
  }

  const { error: updatePostError } = await supabase
    .from('posts')
    .update({
      title: revision.title,
      body: revision.body,
      image_path: revision.image_path,
      thumb_path: revision.thumb_path,
      captured_at: revision.captured_at,
      exact_lat: revision.exact_lat,
      exact_lng: revision.exact_lng,
      public_lat: revision.public_lat,
      public_lng: revision.public_lng,
      privacy_mode: revision.privacy_mode,
      place_name: revision.place_name,
      country_name: revision.country_name,
      region_name: revision.region_name,
      city_name: revision.city_name,
      status: 'approved',
      review_note: reviewNote,
      approved_at: new Date().toISOString(),
      approved_by: user.id
    })
    .eq('id', revision.post_id)

  if (updatePostError) {
    throw createError({
      statusCode: 500,
      statusMessage: updatePostError.message
    })
  }

  const { error: deletePhotosError } = await supabase
    .from('post_photos')
    .delete()
    .eq('post_id', revision.post_id)

  if (deletePhotosError) {
    throw createError({
      statusCode: 500,
      statusMessage: deletePhotosError.message
    })
  }

  const { error: insertPhotosError } = await supabase
    .from('post_photos')
    .insert(photoPayloadsToRows(
      revisionPhotos.map((photo) => ({
        imagePath: photo.image_path,
        thumbPath: photo.thumb_path
      })),
      'post_id',
      revision.post_id
    ))

  if (insertPhotosError) {
    throw createError({
      statusCode: 500,
      statusMessage: insertPhotosError.message
    })
  }

  if (revisionCharacterIds.length) {
    const { error: deleteCharactersError } = await supabase
      .from('post_characters')
      .delete()
      .eq('post_id', revision.post_id)

    if (deleteCharactersError) {
      throw createError({
        statusCode: 500,
        statusMessage: deleteCharactersError.message
      })
    }

    const { error: insertCharactersError } = await supabase
      .from('post_characters')
      .insert(characterIdsToRows(revisionCharacterIds, 'post_id', revision.post_id))

    if (insertCharactersError) {
      throw createError({
        statusCode: 500,
        statusMessage: insertCharactersError.message
      })
    }
  }

  const { error: updateRevisionError } = await supabase
    .from('post_revisions')
    .update({
      status: 'approved',
      review_note: reviewNote,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id
    })
    .eq('id', id)
    .eq('status', 'pending')

  if (updateRevisionError) {
    throw createError({
      statusCode: 500,
      statusMessage: updateRevisionError.message
    })
  }

  const livePhotoPaths = new Set(
    revisionPhotos.flatMap((photo) => [photo.image_path, photo.thumb_path].filter(Boolean) as string[])
  )
  const stalePhotoPaths = [
    ...new Set(
      currentPhotos.flatMap((photo) => [photo.image_path, photo.thumb_path].filter(Boolean) as string[])
    )
  ].filter((path) => !livePhotoPaths.has(path))

  if (stalePhotoPaths.length) {
    try {
      await deleteStorageObjects(event, stalePhotoPaths)
    } catch {
      // Cleanup failures should not block moderation success.
    }
  }

  return { success: true }
})
