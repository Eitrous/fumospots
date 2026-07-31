import {
  createAdminServerClient,
  createPublicServerClient
} from '~~/server/utils/supabase'
import { setPublicApiCacheControl } from '~~/server/utils/cacheControl'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'
import type { PublicMapCountResponse } from '~~/shared/fumo'

export default defineEventHandler(async (event): Promise<PublicMapCountResponse> => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const supabase = createPublicServerClient(event)
  const adminSupabase = createAdminServerClient(event)
  const [
    { count: postCount, error: postCountError },
    { count: registeredUserCount, error: registeredUserCountError }
  ] = await Promise.all([
    supabase
      .from('public_approved_posts')
      .select('id', { count: 'exact', head: true }),
    adminSupabase
      .from('profiles')
      .select('id, posts!posts_user_id_fkey!inner(id)', { count: 'exact', head: true })
  ])

  if (postCountError || registeredUserCountError) {
    throw createError({
      statusCode: 500,
      statusMessage: postCountError?.message || registeredUserCountError?.message || 'Failed to load map stats.'
    })
  }

  setPublicApiCacheControl(event)

  return {
    count: postCount || 0,
    registeredUserCount: registeredUserCount || 0
  }
})
