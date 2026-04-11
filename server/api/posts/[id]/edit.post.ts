import { getRouterParam, readBody } from 'h3'
import type { EditPostPayload } from '~~/shared/fumo'
import { createAdminServerClient, requireAuthenticatedUser } from '~~/server/utils/supabase'
import {
  normalizePostPayload,
  photoPayloadsToRows,
  postPayloadToRow
} from '~~/server/utils/posts'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid post id.'
    })
  }

  const body = await readBody<EditPostPayload>(event)
  const { user } = await requireAuthenticatedUser(event)
  const payload = normalizePostPayload(body, user.id)
  const supabase = createAdminServerClient(event)
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, user_id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (postError || !post) {
    throw createError({
      statusCode: 404,
      statusMessage: postError?.message || 'Post not found.'
    })
  }

  if (post.status === 'approved') {
    const { data: existingRevision, error: existingRevisionError } = await supabase
      .from('post_revisions')
      .select('id')
      .eq('post_id', id)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingRevisionError) {
      throw createError({
        statusCode: 500,
        statusMessage: existingRevisionError.message
      })
    }

    const revisionRow = {
      ...postPayloadToRow(payload),
      review_note: null,
      reviewed_at: null,
      reviewed_by: null
    }

    const revisionResult = existingRevision
      ? await supabase
          .from('post_revisions')
          .update(revisionRow)
          .eq('id', existingRevision.id)
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .select('id')
          .single()
      : await supabase
          .from('post_revisions')
          .insert({
            post_id: id,
            user_id: user.id,
            ...revisionRow,
            status: 'pending'
          })
          .select('id')
          .single()

    if (revisionResult.error || !revisionResult.data) {
      throw createError({
        statusCode: 500,
        statusMessage: revisionResult.error?.message || 'Failed to save revision.'
      })
    }

    const revisionId = revisionResult.data.id
    const { error: deletePhotosError } = await supabase
      .from('post_revision_photos')
      .delete()
      .eq('revision_id', revisionId)

    if (deletePhotosError) {
      throw createError({
        statusCode: 500,
        statusMessage: deletePhotosError.message
      })
    }

    const { error: photosError } = await supabase
      .from('post_revision_photos')
      .insert(photoPayloadsToRows(payload.photos, 'revision_id', revisionId))

    if (photosError) {
      if (!existingRevision) {
        await supabase
          .from('post_revisions')
          .delete()
          .eq('id', revisionId)
      }

      throw createError({
        statusCode: 500,
        statusMessage: photosError.message || 'Failed to save revision photos.'
      })
    }

    return {
      id,
      revisionId,
      status: 'pending'
    }
  }

  const { data: updatedPost, error: updateError } = await supabase
    .from('posts')
    .update({
      ...postPayloadToRow(payload),
      status: 'pending',
      review_note: null,
      approved_at: null,
      approved_by: null
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status')
    .single()

  if (updateError || !updatedPost) {
    throw createError({
      statusCode: 500,
      statusMessage: updateError?.message || 'Failed to save post.'
    })
  }

  const { error: deletePhotosError } = await supabase
    .from('post_photos')
    .delete()
    .eq('post_id', id)

  if (deletePhotosError) {
    throw createError({
      statusCode: 500,
      statusMessage: deletePhotosError.message
    })
  }

  const { error: photosError } = await supabase
    .from('post_photos')
    .insert(photoPayloadsToRows(payload.photos, 'post_id', id))

  if (photosError) {
    throw createError({
      statusCode: 500,
      statusMessage: photosError.message || 'Failed to save post photos.'
    })
  }

  return updatedPost
})
