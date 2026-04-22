import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)
  const supabase = createAdminServerClient(event)

  const { count, error } = await supabase
    .from('posts')
    .select('id, post_revisions!left(id)', {
      count: 'exact',
      head: true
    })
    .eq('status', 'approved')
    .is('post_revisions.id', null)

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
