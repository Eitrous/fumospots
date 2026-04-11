import { getRouterParam, readBody } from 'h3'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

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

  const supabase = createAdminServerClient(event)
  const { data, error } = await supabase
    .from('post_revisions')
    .update({
      status: 'rejected',
      review_note: body.reviewNote?.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: error ? 500 : 404,
      statusMessage: error?.message || 'Revision not found or already handled.'
    })
  }

  return { success: true }
})
