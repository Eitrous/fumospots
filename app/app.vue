<script setup lang="ts">
const localeHead = useLocaleHead()

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
})()`

useHead(() => ({
  htmlAttrs: localeHead.value.htmlAttrs,
  link: localeHead.value.link,
  meta: localeHead.value.meta,
  script: [
    {
      key: 'theme-init',
      tagPosition: 'head',
      children: themeInitScript
    }
  ]
}))
</script>

<template>
  <NuxtLayout>
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </NuxtLayout>
</template>
