<script setup lang="ts">
type UserMenuView = 'root' | 'language'

const props = defineProps<{
  ready: boolean
  signedIn: boolean
  label: string
  username?: string | null
  isDark: boolean
}>()

const emit = defineEmits<{
  login: []
  menuOpen: []
  signOut: []
  'toggle-theme': []
}>()

const { locale, locales, setLocale, t } = useI18n()
const rootEl = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const activeView = ref<UserMenuView>('root')

const menuLabel = computed(() => props.signedIn ? props.label : t('common.login'))
const themeLabel = computed(() => props.isDark ? t('common.toggleThemeToLight') : t('common.toggleThemeToDark'))
const themeIcon = computed(() => props.isDark ? 'fa-sun' : 'fa-moon')
const localeOptions = computed(() => {
  return locales.value.map((entry) => {
    const code = typeof entry === 'string' ? entry : entry.code

    return {
      code,
      label: t(`common.languageNames.${code}`)
    }
  })
})
const activeLocaleLabel = computed(() => {
  return localeOptions.value.find((option) => option.code === locale.value)?.label || t('common.language')
})

const closeMenu = () => {
  isOpen.value = false
  activeView.value = 'root'
}

const openRootMenu = () => {
  activeView.value = 'root'
}

const openLanguageMenu = () => {
  activeView.value = 'language'
}

const toggleMenu = () => {
  if (!props.ready) {
    return
  }

  const nextOpen = !isOpen.value

  if (!nextOpen) {
    closeMenu()
    return
  }

  activeView.value = 'root'

  if (nextOpen) {
    emit('menuOpen')
  }

  isOpen.value = nextOpen
}

const handleLogin = () => {
  closeMenu()
  emit('login')
}

const handleSignOut = () => {
  closeMenu()
  emit('signOut')
}

const handleToggleTheme = () => {
  emit('toggle-theme')
  closeMenu()
}

const updateLocale = async (value: string) => {
  if (!value || value === locale.value) {
    closeMenu()
    return
  }

  await setLocale(value)
  closeMenu()
}

const handlePointerDown = (event: MouseEvent) => {
  if (!rootEl.value?.contains(event.target as Node)) {
    closeMenu()
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handlePointerDown)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handlePointerDown)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="rootEl" class="user-menu">
    <button
      class="workbench-icon-button"
      type="button"
      :title="menuLabel"
      :aria-label="menuLabel"
      :aria-expanded="isOpen"
      :disabled="!ready"
      aria-haspopup="menu"
      @click="toggleMenu"
    >
      <i class="button-icon fa-solid fa-user" aria-hidden="true" />
      <span class="sr-only">{{ menuLabel }}</span>
    </button>

    <Transition name="locale-menu">
      <div
        v-if="isOpen"
        class="locale-switcher__menu user-menu__menu"
        role="menu"
        :aria-label="menuLabel"
      >
        <template v-if="activeView === 'root'">
          <p
            v-if="signedIn"
            class="user-menu__identity"
          >
            {{ label }}
          </p>

          <button
            class="locale-switcher__option user-menu__option"
            type="button"
            role="menuitem"
            @click="handleToggleTheme"
          >
            <span>{{ themeLabel }}</span>
            <i class="fa-solid" :class="themeIcon" aria-hidden="true" />
          </button>

          <button
            class="locale-switcher__option user-menu__option"
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="activeView === 'language'"
            @click="openLanguageMenu"
          >
            <span>{{ t('common.language') }}</span>
            <span class="user-menu__option-meta">
              <span>{{ activeLocaleLabel }}</span>
              <i class="fa-solid fa-chevron-right" aria-hidden="true" />
            </span>
          </button>

          <NuxtLink
            v-if="signedIn && username"
            class="locale-switcher__option user-menu__option user-menu__link"
            role="menuitem"
            :to="createWorkbenchLocation('user', { username })"
            @click="closeMenu"
          >
            <span>{{ t('user.eyebrow') }}</span>
            <i class="fa-solid fa-address-card" aria-hidden="true" />
          </NuxtLink>

          <button
            v-if="signedIn"
            class="locale-switcher__option user-menu__option"
            type="button"
            role="menuitem"
            @click="handleSignOut"
          >
            <span>{{ t('common.signOut') }}</span>
            <i class="fa-solid fa-right-from-bracket" aria-hidden="true" />
          </button>

          <button
            v-else
            class="locale-switcher__option user-menu__option"
            type="button"
            role="menuitem"
            @click="handleLogin"
          >
            <span>{{ t('common.login') }}</span>
            <i class="fa-solid fa-right-to-bracket" aria-hidden="true" />
          </button>
        </template>

        <template v-else>
          <div class="user-menu__submenu-head" role="presentation">
            <button
              class="workbench-icon-button user-menu__submenu-back"
              type="button"
              :title="t('common.back')"
              :aria-label="t('common.back')"
              role="menuitem"
              @click="openRootMenu"
            >
              <i class="button-icon fa-solid fa-chevron-left" aria-hidden="true" />
              <span class="sr-only">{{ t('common.back') }}</span>
            </button>
            <span class="user-menu__submenu-title">{{ t('common.language') }}</span>
          </div>

          <button
            v-for="option in localeOptions"
            :key="option.code"
            class="locale-switcher__option user-menu__option"
            :class="{ 'is-active': option.code === locale }"
            type="button"
            role="menuitemradio"
            :aria-checked="option.code === locale"
            @click="updateLocale(option.code)"
          >
            <span>{{ option.label }}</span>
            <i
              v-if="option.code === locale"
              class="fa-solid fa-check"
              aria-hidden="true"
            />
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>
