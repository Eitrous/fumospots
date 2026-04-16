import type { Session, User } from '@supabase/supabase-js'
import type { CurrentViewer } from '~~/shared/fumo'

let listenerBound = false
type OAuthProvider = 'github' | 'google' | 'azure'
const AUTH_ACCESS_TOKEN_COOKIE = 'fumo_access_token'
const AUTH_ACCESS_TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export const useAuthState = () => {
  const session = useState<Session | null>('auth:session', () => null)
  const user = useState<User | null>('auth:user', () => null)
  const viewer = useState<CurrentViewer | null>('auth:viewer', () => null)
  const ready = useState<boolean>('auth:ready', () => false)
  const initializing = useState<boolean>('auth:initializing', () => false)
  const accessTokenCookie = useCookie<string | null>(AUTH_ACCESS_TOKEN_COOKIE, {
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: AUTH_ACCESS_TOKEN_COOKIE_MAX_AGE
  })

  const hasUsername = computed(() => Boolean(viewer.value?.profile.username))
  const isAdmin = computed(() => viewer.value?.profile.role === 'admin')

  const createLoginRedirectTarget = (nextPath?: string) => {
    const redirectTarget = new URL('/', window.location.origin)
    redirectTarget.searchParams.set('panel', 'login')

    if (nextPath) {
      redirectTarget.searchParams.set('next', nextPath)
    }

    return redirectTarget.toString()
  }

  const applySession = async (nextSession: Session | null) => {
    session.value = nextSession
    user.value = nextSession?.user ?? null
    accessTokenCookie.value = nextSession?.access_token ?? null

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

  const signInWithPassword = async (email: string, password: string) => {
    const supabase = useSupabaseBrowserClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      throw error
    }

    await applySession(data.session ?? null)
    return data
  }

  const signUpWithPassword = async (email: string, password: string) => {
    const supabase = useSupabaseBrowserClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    })

    if (error) {
      throw error
    }

    await applySession(data.session ?? null)
    return data
  }

  const sendMagicLink = async (email: string, nextPath?: string) => {
    const supabase = useSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: createLoginRedirectTarget(nextPath)
      }
    })

    if (error) {
      throw error
    }
  }

  const signInWithOAuthProvider = async (
    provider: OAuthProvider,
    nextPath?: string,
    options?: {
      scopes?: string
    }
  ) => {
    const supabase = useSupabaseBrowserClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: createLoginRedirectTarget(nextPath),
        ...options
      }
    })

    if (error) {
      throw error
    }

    return data
  }

  const signInWithGitHub = async (nextPath?: string) => {
    return signInWithOAuthProvider('github', nextPath)
  }

  const signInWithGoogle = async (nextPath?: string) => {
    return signInWithOAuthProvider('google', nextPath)
  }

  const signInWithMicrosoft = async (nextPath?: string) => {
    return signInWithOAuthProvider('azure', nextPath, {
      scopes: 'email'
    })
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
    signInWithPassword,
    signUpWithPassword,
    sendMagicLink,
    signInWithOAuthProvider,
    signInWithGitHub,
    signInWithGoogle,
    signInWithMicrosoft,
    signOut
  }
}
