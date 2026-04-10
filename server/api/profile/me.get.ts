import { ensureProfile, requireAuthenticatedUser } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthenticatedUser(event)
  const profile = await ensureProfile(event, user)

  return {
    userId: user.id,
    email: user.email ?? null,
    profile
  }
})
