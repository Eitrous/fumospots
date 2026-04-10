export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) {
    return
  }

  const auth = useAuthState()
  await auth.init()

  if (!auth.user.value) {
    return navigateTo('/login')
  }

  if (!auth.isAdmin.value) {
    return navigateTo('/')
  }
})
