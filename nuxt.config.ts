import { MAP_DEFAULT_STYLE_URL } from './shared/fumo'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-04-10',
  devtools: { enabled: true },
  css: [
    '~/assets/css/main.css',
    'maplibre-gl/dist/maplibre-gl.css'
  ],
  runtimeConfig: {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    geocodeBaseUrl: process.env.GEOCODE_BASE_URL || 'https://nominatim.openstreetmap.org',
    geocodeUserAgent: process.env.GEOCODE_USER_AGENT || 'fumotravel/1.0',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY,
      mapStyleUrl: process.env.NUXT_PUBLIC_MAP_STYLE_URL || MAP_DEFAULT_STYLE_URL
    }
  }
})
