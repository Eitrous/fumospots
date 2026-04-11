<script setup lang="ts">
import type { WorkbenchPanel } from '~~/shared/fumo'

const { t } = useI18n()
const { isDark, toggleTheme } = useTheme()

useSeoMeta({
  title: () => t('seo.title'),
  description: () => t('seo.description')
})

const route = useRoute()
const router = useRouter()
const auth = useAuthState()
const toolbarController = provideWorkbenchToolbarActionController()
const { prefetchPostDetail } = usePostDetailCache()

const isMobile = ref(false)
const mobileSheetOpen = ref(false)

let viewportQuery: MediaQueryList | null = null

const workbenchState = computed(() => resolveWorkbenchState(route.query))
const currentPanel = computed(() => workbenchState.value.panel)
const selectedPostId = computed(() => workbenchState.value.postId)
const selectedUsername = computed(() => workbenchState.value.username)
const nextPath = computed(() => workbenchState.value.nextPath)
const submitPath = computed(() => router.resolve(createWorkbenchLocation('submit')).fullPath)
const isDetailPanel = computed(() => currentPanel.value === 'post')
const panelKey = computed(() => {
  return (currentPanel.value === 'post' || currentPanel.value === 'edit')
    ? `${currentPanel.value}-${selectedPostId.value}`
    : currentPanel.value === 'user'
      ? `user-${selectedUsername.value}`
    : currentPanel.value
})

const brandWords = computed(() => {
  const parts = t('common.brand').split(' ')
  const top = parts[0] || t('common.brand')
  const bottom = parts.slice(1).join(' ') || top
  return {
    top,
    bottom
  }
})

const viewerHandle = computed(() => {
  const username = auth.viewer.value?.profile.username
  return username ? `@${username}` : t('common.authorIdUnset')
})

const leadingAction = computed(() => {
  if (currentPanel.value === 'post') {
    return null
  }

  if (currentPanel.value !== 'info') {
    return {
      label: t('common.backToMapOverview'),
      icon: 'fa-arrow-left',
      run: openInfoPanel
    }
  }

  if (isMobile.value) {
    return {
      label: mobileSheetOpen.value ? t('common.closePanel') : t('common.openPanel'),
      icon: mobileSheetOpen.value ? 'fa-xmark' : 'fa-chevron-up',
      run: toggleMobileSheet
    }
  }

  return null
})

const defaultPrimaryAction = computed(() => ({
  label: t('common.submit'),
  icon: 'fa-paper-plane',
  run: openSubmitPanel,
  disabled: false,
  loading: false
}))

const primaryToolbarAction = computed(() => {
  return toolbarController.currentAction.value || defaultPrimaryAction.value
})

const primaryActionLabel = computed(() => {
  return resolveToolbarValue(primaryToolbarAction.value?.label, t('common.submit'))
})

const primaryActionDisabled = computed(() => {
  return resolveToolbarValue(primaryToolbarAction.value?.disabled, false)
})

const primaryActionLoading = computed(() => {
  return resolveToolbarValue(primaryToolbarAction.value?.loading, false)
})

const primaryActionIcon = computed(() => {
  if (primaryActionLoading.value) {
    return 'fa-spinner fa-spin'
  }

  return resolveToolbarValue(primaryToolbarAction.value?.icon, 'fa-paper-plane')
})

const syncViewportMode = () => {
  isMobile.value = viewportQuery?.matches ?? false

  if (!isMobile.value) {
    mobileSheetOpen.value = true
  }
}

async function openPanel(
  panel: WorkbenchPanel,
  options: {
    postId?: number | null
    next?: string | null
    revealMobile?: boolean
  } = {}
) {
  await navigateTo(createWorkbenchLocation(panel, {
    postId: options.postId,
    next: options.next
  }))

  if (import.meta.client && isMobile.value && options.revealMobile !== false) {
    mobileSheetOpen.value = true
  }
}

async function openInfoPanel() {
  await openPanel('info')
}

async function openLoginPanel(target = submitPath.value) {
  await openPanel('login', {
    next: target
  })
}

async function openSubmitPanel() {
  await auth.init()

  if (!auth.user.value) {
    await openLoginPanel(submitPath.value)
    return
  }

  if (!auth.hasUsername.value) {
    await openPanel('onboarding', {
      next: submitPath.value
    })
    return
  }

  await openPanel('submit')
}

async function handleMarkerSelection(postId: number) {
  prefetchPostDetail(postId)

  await openPanel('post', {
    postId
  })
}

async function closeMobileSheet() {
  mobileSheetOpen.value = false
  await navigateTo(createWorkbenchLocation('info'))
}

async function toggleMobileSheet() {
  if (!isMobile.value) {
    return
  }

  if (mobileSheetOpen.value) {
    await closeMobileSheet()
    return
  }

  mobileSheetOpen.value = true
}

async function handleSignOut() {
  await auth.signOut()
  await navigateTo('/')
  mobileSheetOpen.value = false
}

async function triggerPrimaryAction() {
  const action = primaryToolbarAction.value

  if (!action || primaryActionDisabled.value || primaryActionLoading.value) {
    return
  }

  await action.run()
}

watch(
  () => currentPanel.value,
  (panel) => {
    if (!import.meta.client || !isMobile.value) {
      return
    }

    if (panel !== 'info') {
      mobileSheetOpen.value = true
    }
  },
  { immediate: true }
)

onMounted(() => {
  viewportQuery = window.matchMedia('(max-width: 980px)')
  syncViewportMode()
  viewportQuery.addEventListener('change', syncViewportMode)

  if (isMobile.value && currentPanel.value !== 'info') {
    mobileSheetOpen.value = true
  }
})

onBeforeUnmount(() => {
  viewportQuery?.removeEventListener('change', syncViewportMode)
})
</script>

<template>
  <main class="workbench-page">
    <aside
      class="workbench-sidebar"
      :class="{ 'is-open': !isMobile || mobileSheetOpen }"
    >
      <div class="workbench-sidebar__surface">
        <div class="workbench-sidebar__chrome">
          <div class="workbench-sidebar__header" :class="{ 'is-detail': isDetailPanel }">
            <div
              v-if="!isDetailPanel"
              class="workbench-brand"
              :aria-label="t('common.brand')"
            >
              <span class="workbench-brand__word workbench-brand__word--top">{{ brandWords.top }}</span>
              <span class="workbench-brand__word workbench-brand__word--bottom">{{ brandWords.bottom }}</span>
            </div>
            <button
              v-else
              class="workbench-brand workbench-brand--exit"
              type="button"
              :title="t('post.exitDetail')"
              :aria-label="t('post.exitDetail')"
              @click="openInfoPanel"
            >
              <i class="button-icon fa-solid fa-arrow-left" aria-hidden="true" />
              <span class="sr-only">{{ t('post.exitDetail') }}</span>
            </button>

            <div class="workbench-tools">
              <button
                v-if="leadingAction"
                class="workbench-icon-button"
                type="button"
                :title="leadingAction.label"
                :aria-label="leadingAction.label"
                @click="leadingAction.run"
              >
                <i class="button-icon fa-solid" :class="leadingAction.icon" aria-hidden="true" />
                <span class="sr-only">{{ leadingAction.label }}</span>
              </button>

              <button
                class="workbench-icon-button"
                type="button"
                :title="isDark ? t('common.toggleThemeToLight') : t('common.toggleThemeToDark')"
                :aria-label="isDark ? t('common.toggleThemeToLight') : t('common.toggleThemeToDark')"
                @click="toggleTheme"
              >
                <i class="button-icon fa-solid" :class="isDark ? 'fa-sun' : 'fa-moon'" aria-hidden="true" />
                <span class="sr-only">{{ isDark ? t('common.toggleThemeToLight') : t('common.toggleThemeToDark') }}</span>
              </button>

              <LocaleSwitcher />

              <NuxtLink
                v-if="auth.ready.value && auth.viewer.value && auth.isAdmin.value"
                class="workbench-icon-button"
                to="/admin/review"
                :title="t('common.review')"
                :aria-label="t('common.review')"
              >
                <i class="button-icon fa-solid fa-shield-halved" aria-hidden="true" />
                <span class="sr-only">{{ t('common.review') }}</span>
              </NuxtLink>

              <button
                v-if="auth.ready.value && auth.viewer.value"
                class="workbench-icon-button"
                type="button"
                :title="t('common.signOut')"
                :aria-label="t('common.signOut')"
                @click="handleSignOut"
              >
                <i class="button-icon fa-solid fa-right-from-bracket" aria-hidden="true" />
                <span class="sr-only">{{ t('common.signOut') }}</span>
              </button>

              <button
                v-else-if="auth.ready.value && currentPanel !== 'login'"
                class="workbench-icon-button"
                type="button"
                :title="t('common.login')"
                :aria-label="t('common.login')"
                @click="openLoginPanel()"
              >
                <i class="button-icon fa-solid fa-right-to-bracket" aria-hidden="true" />
                <span class="sr-only">{{ t('common.login') }}</span>
              </button>

              <button
                class="workbench-icon-button workbench-icon-button--primary"
                type="button"
                :title="primaryActionLabel"
                :aria-label="primaryActionLabel"
                :disabled="primaryActionDisabled"
                @click="triggerPrimaryAction"
              >
                <i class="button-icon fa-solid" :class="primaryActionIcon" aria-hidden="true" />
                <span class="sr-only">{{ primaryActionLabel }}</span>
              </button>
            </div>
          </div>

          <div class="workbench-sidebar__meta">
            <p
              v-if="auth.ready.value && auth.viewer.value"
              class="workbench-sidebar__status"
            >
              {{ viewerHandle }}
            </p>
            <p
              v-else-if="auth.ready.value"
              class="workbench-sidebar__status"
            >
              {{ t('common.brandTagline') }}
            </p>
            <p v-else class="workbench-sidebar__status">
              {{ t('common.loadingAuth') }}
            </p>
          </div>
        </div>

        <Transition name="workbench-panel-fade" mode="out-in">
          <div :key="panelKey" class="workbench-sidebar__body">
            <WorkbenchInfoPanel v-if="currentPanel === 'info'" />

            <WorkbenchLoginPanel
              v-else-if="currentPanel === 'login'"
              :next-path="nextPath"
            />

            <WorkbenchOnboardingPanel
              v-else-if="currentPanel === 'onboarding'"
              :next-path="nextPath"
            />

            <WorkbenchSubmitPanel v-else-if="currentPanel === 'submit'" />

            <WorkbenchSubmitPanel
              v-else-if="currentPanel === 'edit' && selectedPostId"
              mode="edit"
              :post-id="selectedPostId"
            />

            <WorkbenchUserPanel
              v-else-if="currentPanel === 'user' && selectedUsername"
              :username="selectedUsername"
            />

            <WorkbenchPostPanel
              v-else-if="currentPanel === 'post' && selectedPostId"
              :post-id="selectedPostId"
            />

            <WorkbenchInfoPanel v-else />
          </div>
        </Transition>
      </div>
    </aside>

    <section class="workbench-map-shell">
      <WorldMap
        :selected-post-id="selectedPostId"
        @select-post="handleMarkerSelection"
      />
    </section>

    <button
      v-if="isMobile && mobileSheetOpen"
      class="workbench-sheet-backdrop"
      type="button"
      :aria-label="t('common.closePanel')"
      @click="closeMobileSheet"
    />
  </main>
</template>
