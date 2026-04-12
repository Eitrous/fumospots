import { readBody } from 'h3'
import type { SubmitPostPayload } from '~~/shared/fumo'
import {
  createAdminServerClient,
  ensureProfile,
  requireAuthenticatedUser
} from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'
import {
  normalizePostPayload,
  photoPayloadsToRows,
  postPayloadToRow
} from '~~/server/utils/posts'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'submitIp', getRateLimitIdentifier(event))

  const body = await readBody<SubmitPostPayload>(event)
  const { user } = await requireAuthenticatedUser(event)
  await enforceRateLimit(event, 'submitUser', user.id)

  const profile = await ensureProfile(event, user)

  if (!profile.username) {
    throw createError({
      statusCode: 412,
      statusMessage: 'Please set an author ID first.'
    })
  }

  const supabase = createAdminServerClient(event)
  const payload = normalizePostPayload(body, user.id)

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      ...postPayloadToRow(payload),
      status: 'pending',
      review_note: null,
      approved_at: null,
      approved_by: null
    })
    .select('id, status')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: 500,
      statusMessage: error?.message || 'Failed to save post.'
    })
  }

  const { error: photosError } = await supabase
    .from('post_photos')
    .insert(photoPayloadsToRows(payload.photos, 'post_id', data.id))

  if (photosError) {
    await supabase
      .from('posts')
      .delete()
      .eq('id', data.id)

    throw createError({
      statusCode: 500,
      statusMessage: photosError.message || 'Failed to save post photos.'
    })
  }

  setResponseStatus(event, 201)
  return data
})
