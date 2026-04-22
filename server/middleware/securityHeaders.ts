import { setResponseHeader, type H3Event } from 'h3'
import { MAP_DARK_STYLE_URL, MAP_DEFAULT_STYLE_URL } from '~~/shared/fumo'

const getOrigin = (value: string | undefined) => {
  if (!value) {
    return null
  }

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const unique = (values: Array<string | null | undefined>) => {
  return [...new Set(values.filter(Boolean) as string[])]
}

const buildCsp = (event: H3Event) => {
  const config = useRuntimeConfig(event)
  const supabaseOrigin = getOrigin(config.public.supabaseUrl)
  const mapStyleOrigin = getOrigin(config.public.mapStyleUrl)
  const mapDarkStyleOrigin = getOrigin(config.public.mapDarkStyleUrl)
  const pmtilesOrigin = getOrigin(config.public.pmtilesUrl)
  const defaultMapOrigin = getOrigin(MAP_DEFAULT_STYLE_URL)
  const darkMapOrigin = getOrigin(MAP_DARK_STYLE_URL)

  const imageSources = unique([
    "'self'",
    'data:',
    'blob:',
    supabaseOrigin,
    'https://*.supabase.co',
    mapStyleOrigin,
    mapDarkStyleOrigin,
    defaultMapOrigin,
    darkMapOrigin
  ])

  const connectSources = unique([
    "'self'",
    supabaseOrigin,
    'https://*.supabase.co',
    'wss://*.supabase.co',
    pmtilesOrigin,
    mapStyleOrigin,
    mapDarkStyleOrigin,
    defaultMapOrigin,
    darkMapOrigin,
    ...(import.meta.dev ? ['http://localhost:*', 'ws://localhost:*'] : [])
  ])

  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(import.meta.dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", ...imageSources],
    ["font-src", "'self'", 'data:'],
    ["connect-src", ...connectSources],
    ["worker-src", "'self'", 'blob:'],
    ["child-src", 'blob:'],
    ["frame-src", "'none'"],
    ["manifest-src", "'self'"],
    ["report-uri", '/api/security/csp-report']
  ]

  return directives.map((directive) => directive.join(' ')).join('; ')
}

export default defineEventHandler((event) => {
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin')
  setResponseHeader(
    event,
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)'
  )
  setResponseHeader(event, 'Content-Security-Policy-Report-Only', buildCsp(event))

  if (!import.meta.dev) {
    setResponseHeader(event, 'Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }
})
