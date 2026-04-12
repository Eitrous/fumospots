<script setup lang="ts">
import type { WorkbenchPanel } from '~~/shared/fumo'

type MobileDrawerState = 'peek' | 'workbench' | 'detail'

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
const mobileDrawerState = ref<MobileDrawerState>('peek')
const mobileDrawerDragOffset = ref(0)
const mobileDrawerDragging = ref(false)
const mobileDrawerPeeking = computed(() => isMobile.value && mobileDrawerState.value === 'peek')
const clientToolbarReady = ref(false)

let viewportQuery: MediaQueryList | null = null
let mobileDrawerPointerId: number | null = null
let mobileDrawerPointerStartY = 0
let mobileDrawerPointerStartState: MobileDrawerState = 'peek'
let mobileDrawerWasDragged = false
let suppressNextMobileDrawerClick = false
let mobileDrawerClickSuppressionTimer: ReturnType<typeof setTimeout> | null = null

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

  return null
})

const workbenchSidebarClass = computed(() => ({
  [`is-${mobileDrawerState.value}`]: isMobile.value,
  'is-dragging': mobileDrawerDragging.value
}))

const mobileDrawerStyle = computed<Record<string, string>>(() => {
  return isMobile.value
    ? { '--mobile-drawer-drag-offset': `${mobileDrawerDragOffset.value}px` }
    : {}
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

const mobileDrawerStateForPanel = (panel: WorkbenchPanel): MobileDrawerState => {
  if (panel === 'post') {
    return 'detail'
  }

  return panel === 'info' ? 'peek' : 'workbench'
}

const resetMobileDrawerDrag = () => {
  mobileDrawerDragOffset.value = 0
  mobileDrawerDragging.value = false
  mobileDrawerPointerId = null
  mobileDrawerPointerStartState = 'peek'
  mobileDrawerWasDragged = false
}

const syncViewportMode = () => {
  isMobile.value = viewportQuery?.matches ?? false

  if (!isMobile.value) {
    mobileDrawerState.value = 'workbench'
    resetMobileDrawerDrag()
    return
  }

  mobileDrawerState.value = mobileDrawerStateForPanel(currentPanel.value)
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
    mobileDrawerState.value = mobileDrawerStateForPanel(panel)
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
  mobileDrawerState.value = 'peek'
  resetMobileDrawerDrag()
  await navigateTo(createWorkbenchLocation('info'))
}

function revealMobileDrawer() {
  if (!isMobile.value) {
    return
  }

  mobileDrawerState.value = mobileDrawerStateForPanel(currentPanel.value) === 'detail'
    ? 'detail'
    : 'workbench'
}

async function handleSignOut() {
  await auth.signOut()
  await navigateTo('/')
  mobileDrawerState.value = 'peek'
  resetMobileDrawerDrag()
}

async function triggerPrimaryAction() {
  const action = primaryToolbarAction.value

  if (!action || primaryActionDisabled.value || primaryActionLoading.value) {
    return
  }

  await action.run()
}

const isInteractiveDrawerTarget = (target: EventTarget | null) => {
  return target instanceof Element && Boolean(target.closest(
    'a, button, input, select, textarea, summary, [contenteditable="true"]'
  ))
}

const shouldStartMobileDrawerDrag = (event: PointerEvent) => {
  if (!isMobile.value || (event.pointerType === 'mouse' && event.button !== 0)) {
    return false
  }

  if (isInteractiveDrawerTarget(event.target)) {
    return false
  }

  if (mobileDrawerState.value === 'peek') {
    return true
  }

  return event.target instanceof Element && Boolean(event.target.closest('.workbench-sidebar__chrome'))
}

const clampMobileDrawerDragOffset = (deltaY: number) => {
  if (mobileDrawerPointerStartState === 'peek') {
    return Math.max(-220, Math.min(28, deltaY))
  }

  if (mobileDrawerPointerStartState === 'detail') {
    return Math.max(-18, Math.min(260, deltaY))
  }

  return Math.max(-56, Math.min(220, deltaY))
}

const suppressMobileDrawerClick = () => {
  suppressNextMobileDrawerClick = true

  if (mobileDrawerClickSuppressionTimer) {
    clearTimeout(mobileDrawerClickSuppressionTimer)
  }

  mobileDrawerClickSuppressionTimer = setTimeout(() => {
    suppressNextMobileDrawerClick = false
    mobileDrawerClickSuppressionTimer = null
  }, 160)
}

function handleMobileDrawerPointerDown(event: PointerEvent) {
  if (!shouldStartMobileDrawerDrag(event)) {
    return
  }

  mobileDrawerPointerId = event.pointerId
  mobileDrawerPointerStartY = event.clientY
  mobileDrawerPointerStartState = mobileDrawerState.value
  mobileDrawerWasDragged = false
  mobileDrawerDragging.value = true
  mobileDrawerDragOffset.value = 0
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function handleMobileDrawerPointerMove(event: PointerEvent) {
  if (mobileDrawerPointerId !== event.pointerId || !mobileDrawerDragging.value) {
    return
  }

  const deltaY = event.clientY - mobileDrawerPointerStartY
  mobileDrawerWasDragged = mobileDrawerWasDragged || Math.abs(deltaY) > 6
  mobileDrawerDragOffset.value = clampMobileDrawerDragOffset(deltaY)
}

async function finishMobileDrawerDrag(event: PointerEvent) {
  if (mobileDrawerPointerId !== event.pointerId || !mobileDrawerDragging.value) {
    return
  }

  const deltaY = event.clientY - mobileDrawerPointerStartY
  const startState = mobileDrawerPointerStartState
  const wasDragged = mobileDrawerWasDragged

  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  }

  resetMobileDrawerDrag()

  if (wasDragged) {
    suppressMobileDrawerClick()
  }

  if (startState === 'peek' && deltaY < -48) {
    revealMobileDrawer()
    return
  }

  if (startState !== 'peek' && deltaY > 72) {
    await closeMobileSheet()
  }
}

function handleMobileDrawerPointerUp(event: PointerEvent) {
  void finishMobileDrawerDrag(event)
}

async function handleMobileDrawerPointerCancel(event: PointerEvent) {
  if (mobileDrawerPointerId === event.pointerId) {
    resetMobileDrawerDrag()
  }
}

function handleMobileDrawerClick(event: MouseEvent) {
  if (!mobileDrawerPeeking.value) {
    return
  }

  if (suppressNextMobileDrawerClick) {
    suppressNextMobileDrawerClick = false
    return
  }

  if (isInteractiveDrawerTarget(event.target)) {
    return
  }

  revealMobileDrawer()
}

function handleMobileDrawerKeydown() {
  if (mobileDrawerPeeking.value) {
    revealMobileDrawer()
  }
}

function handleMobileDrawerEscape() {
  if (isMobile.value && mobileDrawerState.value === 'workbench' && currentPanel.value === 'info') {
    void closeMobileSheet()
  }
}

watch(
  () => currentPanel.value,
  (panel) => {
    if (!import.meta.client || !isMobile.value) {
      return
    }

    mobileDrawerState.value = mobileDrawerStateForPanel(panel)
    resetMobileDrawerDrag()
  },
  { immediate: true }
)

onMounted(() => {
  clientToolbarReady.value = true
  viewportQuery = window.matchMedia('(max-width: 980px)')
  syncViewportMode()
  viewportQuery.addEventListener('change', syncViewportMode)

  if (isMobile.value) {
    mobileDrawerState.value = mobileDrawerStateForPanel(currentPanel.value)
  }
})

onBeforeUnmount(() => {
  viewportQuery?.removeEventListener('change', syncViewportMode)

  if (mobileDrawerClickSuppressionTimer) {
    clearTimeout(mobileDrawerClickSuppressionTimer)
  }
})
</script>

<template>
  <main class="workbench-page">
    <aside
      class="workbench-sidebar"
      :class="workbenchSidebarClass"
    >
      <div
        class="workbench-sidebar__surface"
        :style="mobileDrawerStyle"
        @click="handleMobileDrawerClick"
        @keydown.esc="handleMobileDrawerEscape"
        @pointerdown="handleMobileDrawerPointerDown"
        @pointermove="handleMobileDrawerPointerMove"
        @pointerup="handleMobileDrawerPointerUp"
        @pointercancel="handleMobileDrawerPointerCancel"
      >
        <div class="workbench-sidebar__chrome">
          <div class="workbench-sidebar__header" :class="{ 'is-detail': isDetailPanel }">
            <div
              v-if="!isDetailPanel"
              class="workbench-brand"
              :role="mobileDrawerPeeking ? 'button' : undefined"
              :tabindex="mobileDrawerPeeking ? 0 : undefined"
              :aria-label="mobileDrawerPeeking ? t('common.openPanel') : t('common.brand')"
              @keydown.enter.stop.prevent="handleMobileDrawerKeydown"
              @keydown.space.stop.prevent="handleMobileDrawerKeydown"
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

            <div
              class="workbench-tools"
            >
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
                v-if="clientToolbarReady && auth.ready.value && auth.viewer.value && auth.isAdmin.value"
                class="workbench-icon-button"
                to="/admin/review"
                :title="t('common.review')"
                :aria-label="t('common.review')"
              >
                <i class="button-icon fa-solid fa-shield-halved" aria-hidden="true" />
                <span class="sr-only">{{ t('common.review') }}</span>
              </NuxtLink>

              <button
                v-if="clientToolbarReady && auth.ready.value && auth.viewer.value"
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
                v-else-if="clientToolbarReady && auth.ready.value && currentPanel !== 'login'"
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

          <!-- <div class="workbench-sidebar__meta">
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
          </div> -->
        </div>

        <Transition name="workbench-panel-fade" mode="out-in">
          <div
            :key="panelKey"
            class="workbench-sidebar__body"
            :inert="mobileDrawerPeeking"
            :aria-hidden="mobileDrawerPeeking ? 'true' : undefined"
          >
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
  </main>
</template>
