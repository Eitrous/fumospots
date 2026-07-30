import type { SupabaseClient } from '@supabase/supabase-js'

let browserClientPromise: Promise<SupabaseClient> | null = null

export const useSupabaseBrowserClient = async () => {
  if (!import.meta.client) {
    throw new Error('Supabase browser client can only run on the client.')
  }

  if (browserClientPromise) {
    return browserClientPromise
  }

  const config = useRuntimeConfig()

  browserClientPromise = import('@supabase/supabase-js')
    .then(({ createClient }) => {
      return createClient(
        config.public.supabaseUrl,
        config.public.supabaseAnonKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      )
    })
    .catch((error) => {
      browserClientPromise = null
      throw error
    })

  return browserClientPromise
}
