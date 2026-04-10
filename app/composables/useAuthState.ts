import type { Session, User } from '@supabase/supabase-js'
import type { CurrentViewer } from '~~/shared/fumo'

let listenerBound = false

export const useAuthState = () => {
  const session = useState<Session | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const viewer = useState<CurrentViewer | null>('auth:viewer', () => null)
  const ready = useState<boolean>('auth:ready', () => false)
  const initializing = useState<boolean>('auth:initializing', () => false)

  const hasUsername = computed(() => Boolean(viewer.value?.profile.username))
  const isAdmin = computed(() => viewer.value?.profile.role === 'admin')

  const applySession = async (nextSession: Session | null) => {
    session.value = nextSession
    user.value = nextSession?.user ?? null

    if (!nextSession?.access_token) {
      viewer.value = null
      ready.value = true
      return
    }

    try {
      viewer.value = await $fetch<CurrentViewer>('/api/profile/me', {
        headers: {
          Authorization: `Bearer ${nextSession.access_token}`
        }
      })
    } catch {
      viewer.value = null
    } finally {
      ready.value = true
    }
  }

  const init = async () => {
    if (import.meta.server || ready.value || initializing.value) {
      return
    }

    initializing.value = true
    const supabase = useSupabaseBrowserClient()
    const { data } = await supabase.auth.getSession()

    if (!listenerBound) {
      listenerBound = true
      supabase.auth.onAuthStateChange((_event, nextSession) => {
        void applySession(nextSession ?? null)
      })
    }

    await applySession(data.session ?? null)
    initializing.value = false
  }

  const refreshViewer = async () => {
    if (!import.meta.client) {
      return null
    }

    await init()

    if (!session.value) {
      viewer.value = null
      return null
    }

    await applySession(session.value)
    return viewer.value
  }

  const sendMagicLink = async (email: string, nextPath?: string) => {
    const supabase = useSupabaseBrowserClient()
    const redirectTarget = new URL('/login', window.location.origin)

    if (nextPath) {
      redirectTarget.searchParams.set('next', nextPath)
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectTarget.toString()
      }
    })

    if (error) {
      throw error
    }
  }

  const signOut = async () => {
    const supabase = useSupabaseBrowserClient()
    await supabase.auth.signOut()
    await applySession(null)
  }

  const authHeaders = computed<Record<string, string>>(() => {
    if (!session.value?.access_token) {
      return {}
    }

    return {
      Authorization: `Bearer ${session.value.access_token}`
    }
  })

  return {
    session,
    user,
    viewer,
    ready,
    initializing,
    hasUsername,
    isAdmin,
    authHeaders,
    init,
    refreshViewer,
    sendMagicLink,
    signOut
  }
}
