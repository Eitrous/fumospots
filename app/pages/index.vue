<script setup lang="ts">
import type { RandomPostResponse, WorkbenchPanel } from '~~/shared/fumo'

type MobileDrawerState = 'peek' | 'workbench' | 'detail'

const { t } = useI18n()
const { isDark, toggleTheme } = useTheme()

useSeoMeta({
  title: () => t('seo.title'),
  description: () => t('seo.description')
})

useHead({
  bodyAttrs: {
    class: 'home-page-body'
  }
})

const route = useRoute()
const router = useRouter()
const auth = useAuthState()
const toolbarController = provideWorkbenchToolbarActionController()
const { prefetchPostDetail } = usePostDetailCache()
const { showNotice: openWorkbenchNotice } = useAppNotice()

const isMobile = ref(false)
const mobileDrawerState = ref<MobileDrawerState>('peek')
const mobileDrawerDragOffset = ref(0)
const mobileDrawerDragging = ref(false)
const mobileDrawerPeeking = computed(() => isMobile.value && mobileDrawerState.value === 'peek')
const clientToolbarReady = ref(false)
const randomPostLoading = ref(false)

let viewportQuery: MediaQueryList | null = null
let mobileDrawerPointerId: number | null = null
let mobileDrawerPointerStartY = 0
let mobileDrawerPointerStartState: MobileDrawerState = 'peek'
let mobileDrawerWasDragged = false
let mobileDrawerStartedFromToolbar = false
let suppressNextMobileDrawerClick = false
let mobileDrawerClickSuppressionTimer: ReturnType<typeof setTimeout> | null = null
let preserveMobileDrawerState = false
let pendingRandomPostFlyComplete = false

const workbenchState = computed(() => resolveWorkbenchState(route.query))
const currentPanel = computed(() => workbenchState.value.panel)
const selectedPostId = computed(() => workbenchState.value.postId)
const selectedUsername = computed(() => workbenchState.value.username)
const selectedRegionScope = computed(() => workbenchState.value.regionScope)
const selectedRegionSort = computed(() => workbenchState.value.regionSort)
const nextPath = computed(() => workbenchState.value.nextPath)
const submitPath = computed(() => router.resolve(createWorkbenchLocation('submit')).fullPath)
const isDetailPanel = computed(() => currentPanel.value === 'post')
const showHomeBrand = computed(() => currentPanel.value === 'info')
const panelKey = computed(() => {
  return (currentPanel.value === 'post' || currentPanel.value === 'edit')
    ? `${currentPanel.value}-${selectedPostId.value}`
    : currentPanel.value === 'user'
      ? `user-${selectedUsername.value}`
    : currentPanel.value === 'region' && selectedRegionScope.value
      ? [
          'region',
          selectedRegionScope.value.countryName || '',
          selectedRegionScope.value.regionName,
          selectedRegionScope.value.cityName || '',
          selectedRegionSort.value
        ].join('-')
    : currentPanel.value
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
      run: goBackPanel
    }
  }

  return null
})

const workbenchSidebarClass = computed(() => ({
  [`is-${mobileDrawerState.value}`]: isMobile.value,
  'is-panel-detail': isMobile.value && isDetailPanel.value,
  'is-dragging': mobileDrawerDragging.value
}))

const mobileDrawerStyle = computed((): Record<string, string> => {
  if (!isMobile.value) {
    return {}
  }

  return {
    '--mobile-drawer-drag-offset': `${mobileDrawerDragOffset.value}px`
  }
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
  mobileDrawerStartedFromToolbar = false
}

const handleSubmissionSuccess = (message: string) => {
  openWorkbenchNotice({
    message,
    icon: 'fa-circle-check',
    tone: 'success'
  })
}

const handleAuthNotice = (message: string) => {
  openWorkbenchNotice({
    message,
    icon: 'fa-envelope'
  })
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

async function goBackPanel() {
  if (import.meta.client && window.history.length > 1) {
    preserveMobileDrawerState = true
    router.back()
    return
  }
  await openInfoPanel()
}

async function openLoginPanel(target = '/') {
  await openPanel('login', {
    next: target
  })
}

async function openSubmitPanel() {
  await auth.init()

  if (!auth.user.value) {
    openWorkbenchNotice({
      message: t('auth.loginRequiredToSubmit'),
      icon: 'fa-right-to-bracket'
    })
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

const getFetchStatusCode = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return null
  }

  const directStatus = Number((error as { statusCode?: unknown }).statusCode)
  if (Number.isInteger(directStatus)) {
    return directStatus
  }

  const responseStatus = Number((error as { response?: { status?: unknown } }).response?.status)
  return Number.isInteger(responseStatus) ? responseStatus : null
}

async function openRandomPost() {
  const currentPostId = selectedPostId.value

  if (randomPostLoading.value) {
    return
  }

  randomPostLoading.value = true

  try {
    const response = await $fetch<RandomPostResponse>('/api/posts/random', {
      query: currentPostId
        ? {
            exclude: currentPostId
          }
        : undefined
    })
    const targetPostId = Number(response.id)

    if (
      !Number.isInteger(targetPostId)
      || targetPostId <= 0
      || (currentPostId && targetPostId === currentPostId)
    ) {
      openWorkbenchNotice({
        message: t('post.errors.randomFailed'),
        icon: 'fa-triangle-exclamation',
        tone: 'error'
      })
      return
    }

    prefetchPostDetail(targetPostId)

    if (isMobile.value) {
      pendingRandomPostFlyComplete = true
      mobileDrawerState.value = 'peek'
    }

    await openPanel('post', {
      postId: targetPostId,
      revealMobile: false
    })
  } catch (error) {
    const statusCode = getFetchStatusCode(error)

    openWorkbenchNotice({
      message: statusCode === 404
        ? t('post.errors.noRandomPost')
        : normalizeApiErrorMessage(error, t('post.errors.randomFailed')),
      icon: statusCode === 404 ? 'fa-circle-info' : 'fa-triangle-exclamation',
      tone: statusCode === 404 ? 'default' : 'error'
    })
  } finally {
    randomPostLoading.value = false
  }
}

async function openSuggestionPage() {
  await auth.init()

  if (!auth.user.value) {
    openWorkbenchNotice({
      message: t('auth.loginRequiredToSuggest'),
      icon: 'fa-right-to-bracket'
    })
    return
  }

  await navigateTo('/suggestions')
}

async function handleMarkerSelection(postId: number) {
  prefetchPostDetail(postId)

  await openPanel('post', {
    postId
  })
}

function closeMobileSheet() {
  mobileDrawerState.value = 'peek'
  resetMobileDrawerDrag()
}

function revealMobileDrawer() {
  if (!isMobile.value) {
    return
  }

  mobileDrawerState.value = mobileDrawerStateForPanel(currentPanel.value) === 'detail'
    ? 'detail'
    : 'workbench'
}

function revealMobileDrawerForMenu() {
  if (mobileDrawerPeeking.value) {
    revealMobileDrawer()
  }
}

async function handleSignOut() {
  await auth.signOut()
  await navigateTo('/')
  mobileDrawerState.value = 'peek'
  resetMobileDrawerDrag()
  openWorkbenchNotice({
    message: t('auth.signedOut'),
    icon: 'fa-right-from-bracket'
  })
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

const isToolbarDrawerTarget = (target: EventTarget | null) => {
  return target instanceof Element && Boolean(target.closest('.workbench-tools'))
}

const shouldStartMobileDrawerDrag = (event: PointerEvent) => {
  if (!isMobile.value || (event.pointerType === 'mouse' && event.button !== 0)) {
    return false
  }

  if (isInteractiveDrawerTarget(event.target) && !isToolbarDrawerTarget(event.target)) {
    return false
  }

  if (mobileDrawerState.value === 'peek') {
    return true
  }

  return event.target instanceof Element && Boolean(event.target.closest('.workbench-sidebar__chrome'))
}

const clampValue = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

const getMobileViewportHeight = () => {
  if (typeof window === 'undefined') {
    return 0
  }

  return window.visualViewport?.height ?? window.innerHeight
}

const getMobileViewportWidth = () => {
  if (typeof window === 'undefined') {
    return 0
  }

  return window.visualViewport?.width ?? window.innerWidth
}

const getMobileDrawerMetrics = () => {
  const viewportHeight = Math.max(0, getMobileViewportHeight())
  const viewportWidth = Math.max(0, getMobileViewportWidth())
  const isCompactViewport = viewportWidth <= 720
  const peekHeight = isCompactViewport
    ? clampValue(viewportWidth * 0.24, 88, 108)
    : clampValue(viewportWidth * 0.22, 84, 112)
  const workbenchHeight = isCompactViewport
    ? viewportHeight * 0.84
    : Math.min(viewportHeight * 0.84, 780)
  const detailHeight = Math.max(peekHeight, viewportHeight - 12)

  return {
    peekHeight,
    workbenchHeight: Math.max(peekHeight, workbenchHeight),
    detailHeight
  }
}

const clampMobileDrawerDragOffset = (deltaY: number) => {
  const { peekHeight, workbenchHeight, detailHeight } = getMobileDrawerMetrics()

  if (mobileDrawerPointerStartState === 'peek') {
    const targetHeight = mobileDrawerStateForPanel(currentPanel.value) === 'detail'
      ? detailHeight
      : workbenchHeight

    return clampValue(deltaY, peekHeight - targetHeight, 28)
  }

  if (mobileDrawerPointerStartState === 'detail') {
    return clampValue(deltaY, -18, detailHeight - peekHeight)
  }

  return clampValue(deltaY, -56, workbenchHeight - peekHeight)
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
  mobileDrawerStartedFromToolbar = isToolbarDrawerTarget(event.target)
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

  if (mobileDrawerStartedFromToolbar && mobileDrawerWasDragged) {
    event.preventDefault()
  }

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

function handleFlyCompleted() {
  if (!import.meta.client || !isMobile.value || !pendingRandomPostFlyComplete) {
    return
  }
  pendingRandomPostFlyComplete = false
  mobileDrawerState.value = mobileDrawerStateForPanel(currentPanel.value)
}

watch(
  () => currentPanel.value,
  (panel) => {
    if (!import.meta.client || !isMobile.value) {
      return
    }

    if (pendingRandomPostFlyComplete) {
      if (panel === 'post') {
        pendingRandomPostFlyComplete = false
      } else {
        resetMobileDrawerDrag()
        return
      }
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
        <div class="workbench-drawer-handle" aria-hidden="true">
          <span />
        </div>

        <div class="workbench-sidebar__chrome">
          <div class="workbench-sidebar__header" :class="{ 'is-detail': isDetailPanel }">
            <button
              v-if="leadingAction"
              class="workbench-icon-button workbench-sidebar__back-button"
              type="button"
              :title="leadingAction.label"
              :aria-label="leadingAction.label"
              @click="leadingAction.run"
            >
              <i class="button-icon fa-solid" :class="leadingAction.icon" aria-hidden="true" />
              <span class="sr-only">{{ leadingAction.label }}</span>
            </button>

            <div
              v-if="showHomeBrand"
              class="workbench-brand"
              :role="mobileDrawerPeeking ? 'button' : undefined"
              :tabindex="mobileDrawerPeeking ? 0 : undefined"
              :aria-label="mobileDrawerPeeking ? t('common.openPanel') : t('common.brand')"
              @keydown.enter.stop.prevent="handleMobileDrawerKeydown"
              @keydown.space.stop.prevent="handleMobileDrawerKeydown"
            >
              <FumospotsBrandLogo
                class="workbench-brand__image"
                role="img"
                :aria-label="t('common.brand')"
                draggable="false"
              />
            </div>
            <div
              v-else-if="isDetailPanel"
              class="workbench-detail-nav"
            >
              <button
                class="workbench-brand workbench-brand--exit"
                type="button"
                :title="t('post.exitDetail')"
                :aria-label="t('post.exitDetail')"
                @click="goBackPanel"
              >
                <i class="button-icon fa-solid fa-arrow-left" aria-hidden="true" />
                <span class="sr-only">{{ t('post.exitDetail') }}</span>
              </button>

              <button
                class="workbench-icon-button workbench-detail-nav__home"
                type="button"
                :title="t('common.home')"
                :aria-label="t('common.home')"
                @click="openInfoPanel"
              >
                <i class="button-icon fa-solid fa-house" aria-hidden="true" />
                <span class="sr-only">{{ t('common.home') }}</span>
              </button>
            </div>

            <div
              class="workbench-tools"
            >
              <button
                class="workbench-icon-button workbench-tools__random"
                type="button"
                :title="t('post.randomPost')"
                :aria-label="t('post.randomPost')"
                :disabled="randomPostLoading"
                @click="openRandomPost"
              >
                <i
                  class="button-icon fa-solid"
                  :class="randomPostLoading ? 'fa-spinner fa-spin' : 'fa-shuffle'"
                  aria-hidden="true"
                />
                <span class="sr-only">{{ t('post.randomPost') }}</span>
              </button>

              <UserMenu
                v-if="clientToolbarReady && auth.ready.value"
                :ready="auth.ready.value"
                :signed-in="Boolean(auth.viewer.value)"
                :label="viewerHandle"
                :username="auth.viewer.value?.profile.username"
                :is-dark="isDark"
                @login="openLoginPanel()"
                @menu-open="revealMobileDrawerForMenu"
                @sign-out="handleSignOut"
                @toggle-theme="toggleTheme"
              />

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
            <WorkbenchInfoPanel
              v-if="currentPanel === 'info'"
              @open-feedback="openSuggestionPage"
            />

            <WorkbenchLoginPanel
              v-else-if="currentPanel === 'login'"
              :next-path="nextPath"
              @notice="handleAuthNotice"
            />

            <WorkbenchOnboardingPanel
              v-else-if="currentPanel === 'onboarding'"
              :next-path="nextPath"
            />

            <WorkbenchSubmitPanel
              v-else-if="currentPanel === 'submit'"
              @submitted="handleSubmissionSuccess"
            />

            <WorkbenchSubmitPanel
              v-else-if="currentPanel === 'edit' && selectedPostId"
              mode="edit"
              :post-id="selectedPostId"
              @submitted="handleSubmissionSuccess"
            />

            <WorkbenchUserPanel
              v-else-if="currentPanel === 'user' && selectedUsername"
              :username="selectedUsername"
            />

            <WorkbenchRegionPanel
              v-else-if="currentPanel === 'region' && selectedRegionScope"
              :scope="selectedRegionScope"
              :sort="selectedRegionSort"
            />

            <WorkbenchPostsPanel
              v-else-if="currentPanel === 'posts'"
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
        :highlight-region-scope="currentPanel === 'region' ? selectedRegionScope : null"
        @select-post="handleMarkerSelection"
        @fly-completed="handleFlyCompleted"
      />
    </section>

  </main>
</template>
