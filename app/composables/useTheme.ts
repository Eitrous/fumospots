import { useCookie, useHead } from '#app'
import { computed } from 'vue'

export type Theme = 'light' | 'dark'

export const useTheme = () => {
  const cookie = useCookie<Theme | undefined>('fumo_theme', {
    watch: true
  })

  if (import.meta.client && !cookie.value) {
    const initialTheme = document.documentElement.getAttribute('data-theme')

    if (initialTheme === 'dark' || initialTheme === 'light') {
      cookie.value = initialTheme
    } else {
      cookie.value = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
  }

  const isDark = computed(() => cookie.value === 'dark')

  const toggleTheme = () => {
    cookie.value = isDark.value ? 'light' : 'dark'
  }

  // Bind the theme to the HTML tag's data-theme attribute for CSS targeting
  useHead(() => ({
    htmlAttrs: cookie.value
      ? {
          'data-theme': cookie.value
        }
      : {}
  }))

  return {
    theme: cookie,
    isDark,
    toggleTheme
  }
}
