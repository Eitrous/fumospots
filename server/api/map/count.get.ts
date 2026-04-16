import { createPublicServerClient } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const supabase = createPublicServerClient(event)
  const { count, error } = await supabase
    .from('public_approved_posts')
    .select('id', { count: 'exact', head: true })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return {
    count: count || 0
  }
})
