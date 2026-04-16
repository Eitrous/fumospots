import type { CurrentViewer } from '~~/shared/fumo'

const ADMIN_AUTH_COOKIE = 'fumo_access_token'

export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) {
    const accessToken = useCookie<string | null>(ADMIN_AUTH_COOKIE).value

    if (!accessToken) {
      return navigateTo('/')
    }

    try {
      const viewer = await $fetch<CurrentViewer>('/api/profile/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (viewer.profile.role !== 'admin') {
        return navigateTo('/')
      }
    } catch {
      return navigateTo('/')
    }

    return
  }

  const auth = useAuthState()
  await auth.init()

  if (!auth.user.value || !auth.isAdmin.value) {
    return navigateTo('/')
  }
})
