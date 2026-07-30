export default defineNuxtPlugin(() => {
  const auth = useAuthState()
  void auth.init()
})
