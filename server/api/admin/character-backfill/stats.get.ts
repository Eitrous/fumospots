import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)
  const supabase = createAdminServerClient(event)
  const { count, error } = await supabase
    .from('admin_character_backfill_posts')
    .select('id', {
      count: 'exact',
      head: true
    })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return {
    totals: {
      eligiblePosts: count ?? 0
    }
  }
})
