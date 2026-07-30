<script setup lang="ts">
const localeHead = useLocaleHead();
const config = useRuntimeConfig();

const themeInitScript = `(() => {
  try {
    const match = document.cookie.match(/(?:^|;\\s*)fumo_theme=([^;]+)/)
    const savedTheme = match ? decodeURIComponent(match[1]) : ''
    const theme = savedTheme === 'dark' || savedTheme === 'light'
      ? savedTheme
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

    document.documentElement.setAttribute('data-theme', theme)
  } catch {
    // Ignore theme initialization failures and fallback to CSS defaults.
  }
})()`;

useHead(() => ({
  htmlAttrs: localeHead.value.htmlAttrs,
  link: [
    ...(localeHead.value.link || []),
    { rel: "icon", type: "image/png", href: "/favicon.png" },
  ],
  meta: localeHead.value.meta,
  script: [
    {
      key: "theme-init",
      tagPosition: "head",
      children: themeInitScript,
    },
    {
      key: "cloudflare-web-analytics",
      type: "module",
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      tagPosition: "bodyClose",
      "data-cf-beacon": JSON.stringify({
        token: config.public.cloudflareWebAnalyticsToken,
      }),
    },
  ],
}));
</script>

<template>
  <NuxtLayout>
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <AppNotice />
  </NuxtLayout>
</template>
