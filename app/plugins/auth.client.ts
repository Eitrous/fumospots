export default defineNuxtPlugin(async () => {
  const auth = useAuthState()
  await auth.init()
})
