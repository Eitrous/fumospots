import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

export const useSupabaseBrowserClient = () => {
  if (!import.meta.client) {
    throw new Error('Supabase browser client can only run on the client.')
  }

  if (browserClient) {
    return browserClient
  }

  const config = useRuntimeConfig()

  browserClient = createClient(
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

  return browserClient
}
