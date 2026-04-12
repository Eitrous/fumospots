import { readBody } from 'h3'
import type { PostLikePayload, PostLikeResponse } from '~~/shared/fumo'
import {
  createAdminServerClient,
  ensureProfile,
  requireAuthenticatedUser
} from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event): Promise<PostLikeResponse> => {
  const id = Number(event.context.params?.id)

  if (Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }

  await enforceRateLimit(event, 'likeIp', getRateLimitIdentifier(event))

  const body = await readBody<PostLikePayload>(event)
  if (typeof body?.liked !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Liked value is required.'
    })
  }

  const { user } = await requireAuthenticatedUser(event)
  await enforceRateLimit(event, 'likeUser', user.id)
  await enforceRateLimit(event, 'likePostUser', `${user.id}:${id}`)

  await ensureProfile(event, user)

  const supabase = createAdminServerClient(event)
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id')
    .eq('id', id)
    .eq('status', 'approved')
    .single()

  if (postError || !post) {
    throw createError({
      statusCode: 404,
      statusMessage: postError?.message || 'Post not found.'
    })
  }

  if (body.liked) {
    const { error: likeError } = await supabase
      .from('post_likes')
      .upsert({
        post_id: id,
        user_id: user.id
      }, {
        onConflict: 'post_id,user_id',
        ignoreDuplicates: true
      })

    if (likeError) {
      throw createError({
        statusCode: 500,
        statusMessage: likeError.message
      })
    }
  } else {
    const { error: unlikeError } = await supabase
      .from('post_likes')
      .delete()
      .eq('post_id', id)
      .eq('user_id', user.id)

    if (unlikeError) {
      throw createError({
        statusCode: 500,
        statusMessage: unlikeError.message
      })
    }
  }

  const { count: likeCount, error: countError } = await supabase
    .from('post_likes')
    .select('post_id', { count: 'exact', head: true })
    .eq('post_id', id)

  if (countError) {
    throw createError({
      statusCode: 500,
      statusMessage: countError.message
    })
  }

  return {
    postId: id,
    likeCount: likeCount ?? 0,
    likedByViewer: body.liked
  }
})
