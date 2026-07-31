import { MAP_DARK_STYLE_URL, MAP_DEFAULT_STYLE_URL } from './shared/fumo'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-04-10',
  devtools: { enabled: true },
  modules: ['@nuxtjs/i18n', '@vercel/analytics', '@vercel/speed-insights'],
  css: [
    '~/assets/css/main.css'
  ],
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'zh-CN',
    baseUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    langDir: 'locales',
    locales: [
      {
        code: 'zh-CN',
        language: 'zh-CN',
        name: '简体中文',
        file: 'zh-CN.json'
      },
      {
        code: 'en',
        language: 'en-US',
        name: 'English',
        file: 'en.json'
      },
      {
        code: 'ja',
        language: 'ja-JP',
        name: '日本語',
        file: 'ja.json'
      }
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'fumo_spots_locale',
      alwaysRedirect: false,
      fallbackLocale: 'zh-CN'
    }
  },
  runtimeConfig: {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2Bucket: process.env.R2_BUCKET || 'fumo',
    r2Endpoint: process.env.R2_ENDPOINT,
    r2PublicBaseUrl: process.env.R2_PUBLIC_BASE_URL || '',
    r2SignedUrlTtlSeconds: process.env.R2_SIGNED_URL_TTL_SECONDS || String(60 * 30),
    geocodeBaseUrl: process.env.GEOCODE_BASE_URL || 'https://nominatim.openstreetmap.org',
    geocodeUserAgent: process.env.GEOCODE_USER_AGENT || 'fumotravel/1.0',
    securityCspReportEnabled: process.env.SECURITY_CSP_REPORT_ENABLED === 'true',
    securityAlertsEnabled: process.env.SECURITY_ALERTS_ENABLED === 'true',
    securityAlertWebhookUrl: process.env.SECURITY_ALERT_WEBHOOK_URL,
    securityAlertWebhookToken: process.env.SECURITY_ALERT_WEBHOOK_TOKEN,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY,
      emailPasswordAuthEnabled:
        process.env.NUXT_PUBLIC_EMAIL_PASSWORD_AUTH_ENABLED || 'true',
      emailLinkAuthEnabled:
        process.env.NUXT_PUBLIC_EMAIL_LINK_AUTH_ENABLED || 'false',
      mapStyleUrl: process.env.NUXT_PUBLIC_MAP_STYLE_URL || MAP_DEFAULT_STYLE_URL,
      mapDarkStyleUrl: process.env.NUXT_PUBLIC_MAP_DARK_STYLE_URL || MAP_DARK_STYLE_URL,
      pmtilesUrl: process.env.NUXT_PUBLIC_PM_TILES_URL || '',
      cloudflareWebAnalyticsToken:
      process.env.NUXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN || ''
    }
  }
})
