import { readBody } from 'h3'
import type { SubmitPostPayload } from '~~/shared/fumo'
import {
  createPublicServerClient,
  ensureProfile,
  requireAuthenticatedUser
} from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'
import { notifyTelegramNewSubmission } from '~~/server/utils/telegramNotification'
import {
  normalizePostPayload,
  photoPayloadsToRows,
  postPayloadToRow
} from '~~/server/utils/posts'
import { ensureStoragePathsWebp, rewritePhotoPathsWithMap } from '~~/server/utils/imageWebp'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'submitIp', getRateLimitIdentifier(event))

  const body = await readBody<SubmitPostPayload>(event)
  const { accessToken, user } = await requireAuthenticatedUser(event)
  await enforceRateLimit(event, 'submitUser', user.id)

  const profile = await ensureProfile(event, user, accessToken)

  if (!profile.username) {
    throw createError({
      statusCode: 412,
      statusMessage: 'Please set an author ID first.'
    })
  }

  const supabase = createPublicServerClient(event, accessToken)
  const payload = normalizePostPayload(body, user.id)
  const conversionResult = await ensureStoragePathsWebp(
    event,
    payload.photos.flatMap((photo) => [photo.imagePath, photo.thumbPath]),
    {
      upsert: true,
      continueOnError: false,
      maxConcurrency: 2
    }
  )
  const webpPayload = {
    ...payload,
    photos: rewritePhotoPathsWithMap(payload.photos, conversionResult.pathMap)
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      ...postPayloadToRow(webpPayload),
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
    .insert(photoPayloadsToRows(webpPayload.photos, 'post_id', data.id))

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

  await notifyTelegramNewSubmission(event)

  setResponseStatus(event, 201)
  return data
})
