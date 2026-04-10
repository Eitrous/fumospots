import { readBody } from 'h3'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminUser(event)
  const id = Number(event.context.params?.id)
  const body = await readBody<{ reviewNote?: string }>(event)

  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: '无效的投稿 ID'
    })
  }

  const reviewNote = body.reviewNote?.trim() || null
  const supabase = createAdminServerClient(event)

  const { data, error } = await supabase
    .from('posts')
    .update({
      status: 'approved',
      review_note: reviewNote,
      approved_at: new Date().toISOString(),
      approved_by: user.id
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: error ? 500 : 404,
      statusMessage: error?.message || '投稿不存在或已被处理'
    })
  }

  return { success: true }
})
