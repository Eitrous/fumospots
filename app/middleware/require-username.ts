export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) {
    return
  }

  const auth = useAuthState()
  await auth.init()

  if (auth.user.value && !auth.hasUsername.value) {
    return navigateTo({
      path: '/onboarding',
      query: { next: to.fullPath }
    })
  }
})
