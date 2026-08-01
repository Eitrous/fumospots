const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/

const toAbsoluteOrigin = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  if (!trimmed || !ABSOLUTE_URL_PATTERN.test(trimmed)) {
    return null
  }

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

export const useMapResourceHints = () => {
  const config = useRuntimeConfig()
  const requestUrl = useRequestURL()
  const currentOrigin = requestUrl.origin
  const origins = [
    toAbsoluteOrigin(config.public.pmtilesUrl),
    toAbsoluteOrigin(config.public.geopoliticsPmtilesUrl),
    toAbsoluteOrigin(config.public.mapStyleUrl),
    toAbsoluteOrigin(config.public.mapDarkStyleUrl)
  ].filter((origin): origin is string => Boolean(origin) && origin !== currentOrigin)

  if (!origins.length) {
    return
  }

  const uniqueOrigins = [...new Set(origins)]

  useHead({
    link: uniqueOrigins.flatMap((origin) => ([
      {
        key: `map-dns-prefetch-${origin}`,
        rel: 'dns-prefetch',
        href: origin
      },
      {
        key: `map-preconnect-${origin}`,
        rel: 'preconnect',
        href: origin,
        crossorigin: ''
      }
    ]))
  })
}
