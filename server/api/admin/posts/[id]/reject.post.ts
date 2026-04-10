import { readBody } from 'h3'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)
  const id = Number(event.context.params?.id)
  const body = await readBody<{ reviewNote?: string }>(event)

  if (Number.isNaN(id)) {
    throw createError({
      statusCode: 400,
      statusMessage: '无效的投稿 ID'
    })
  }

  const supabase = createAdminServerClient(event)
  const { data, error } = await supabase
    .from('posts')
    .update({
      status: 'rejected',
      review_note: body.reviewNote?.trim() || null,
      approved_at: null,
      approved_by: null
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
