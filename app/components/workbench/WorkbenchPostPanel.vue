<script setup lang="ts">
import type { PostLikePayload, PostLikeResponse, PublicPostDetail, RegionScope } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

const props = defineProps<{
  postId: number
}>()

const { t, locale } = useI18n()
const auth = useAuthState()
const { formatDateTime, formatLatLng } = useFormatters()
const { getPostDetail, updatePostDetailLike } = usePostDetailCache()

const loading = ref(true)
const errorMessage = ref('')
const likeDialogMessage = ref('')
const post = ref<PublicPostDetail | null>(null)
const selectedPhotoIndex = ref(0)
const heroImageReady = ref(false)
const heroImageFailed = ref(false)
const liking = ref(false)
const imageViewerOpen = ref(false)
const viewerImageReady = ref(false)
const viewerImageFailed = ref(false)
const imageViewerCloseButton = ref<HTMLButtonElement | null>(null)
const likeDialogCloseButton = ref<HTMLButtonElement | null>(null)
const previouslyFocusedElement = ref<HTMLElement | null>(null)
const likeDialogPreviouslyFocusedElement = ref<HTMLElement | null>(null)
let loadSequence = 0

const displayPhotos = computed(() => {
  if (!post.value) {
    return []
  }

  if (post.value.photos.length) {
    return post.value.photos
  }

  return post.value.imageUrl
    ? [{
        imageUrl: post.value.imageUrl,
        thumbUrl: post.value.thumbUrl
      }]
    : []
})

const selectedPhoto = computed(() => {
  return displayPhotos.value[selectedPhotoIndex.value] || displayPhotos.value[0] || null
})

const selectedPhotoUrl = computed(() => {
  return selectedPhoto.value?.imageUrl || null
})

const hasMultiplePhotos = computed(() => displayPhotos.value.length > 1)
const canGoPrevious = computed(() => selectedPhotoIndex.value > 0)
const canGoNext = computed(() => selectedPhotoIndex.value < displayPhotos.value.length - 1)
const canOpenImageViewer = computed(() => Boolean(selectedPhotoUrl.value && heroImageReady.value && !heroImageFailed.value))
const viewerId = computed(() => auth.viewer.value?.userId ?? null)
const likeButtonLabel = computed(() => {
  return post.value?.likedByViewer ? t('post.unlike') : t('post.like')
})
const likeIconClass = computed(() => {
  if (liking.value) {
    return 'fa-solid fa-spinner fa-spin'
  }

  return post.value?.likedByViewer ? 'fa-solid fa-heart' : 'fa-regular fa-heart'
})
const likeDialogOpen = computed(() => Boolean(likeDialogMessage.value))

const authorPath = computed(() => {
  return post.value
    ? createWorkbenchLocation('user', { username: post.value.author.username })
    : createWorkbenchLocation('info')
})

const regionScopeForPost = (cityName: string | null = null): RegionScope | null => {
  if (!post.value?.regionName) {
    return null
  }

  return {
    countryName: post.value.countryName,
    regionName: post.value.regionName,
    cityName
  }
}

const regionPath = () => {
  const scope = regionScopeForPost()
  return scope
    ? createWorkbenchLocation('region', {
        regionScope: scope,
        regionSort: 'created'
      })
    : createWorkbenchLocation('info')
}

const cityPath = () => {
  const scope = regionScopeForPost(post.value?.cityName || null)
  return scope && scope.cityName
    ? createWorkbenchLocation('region', {
        regionScope: scope,
        regionSort: 'created'
      })
    : createWorkbenchLocation('info')
}

const backgroundImageStyle = (imageUrl: string) => ({
  backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")`
})

const loadPost = async () => {
  const currentLoad = ++loadSequence
  loading.value = true
  errorMessage.value = ''
  closeLikeDialog()

  if (!auth.ready.value) {
    return
  }

  try {
    const nextPost = await getPostDetail(props.postId, {
      headers: auth.authHeaders.value,
      viewerId: viewerId.value
    })
    if (currentLoad !== loadSequence) {
      return
    }

    post.value = nextPost
    selectedPhotoIndex.value = 0
  } catch (error) {
    if (currentLoad !== loadSequence) {
      return
    }

    post.value = null
    selectedPhotoIndex.value = 0
    errorMessage.value = normalizeApiErrorMessage(error, t('post.errors.loadFailed'))
  } finally {
    if (currentLoad === loadSequence) {
      loading.value = false
    }
  }
}

const selectPhoto = (index: number) => {
  if (index < 0 || index >= displayPhotos.value.length) {
    return
  }

  selectedPhotoIndex.value = index
}

const goPreviousPhoto = () => {
  if (!canGoPrevious.value) {
    return
  }

  selectedPhotoIndex.value -= 1
}

const goNextPhoto = () => {
  if (!canGoNext.value) {
    return
  }

  selectedPhotoIndex.value += 1
}

const openImageViewer = () => {
  if (!canOpenImageViewer.value) {
    return
  }

  if (document.activeElement instanceof HTMLElement) {
    previouslyFocusedElement.value = document.activeElement
  }

  viewerImageReady.value = false
  viewerImageFailed.value = false
  imageViewerOpen.value = true
  void nextTick(() => {
    imageViewerCloseButton.value?.focus()
  })
}

const closeImageViewer = () => {
  if (!imageViewerOpen.value) {
    return
  }

  imageViewerOpen.value = false
  viewerImageReady.value = false
  viewerImageFailed.value = false
  void nextTick(() => {
    previouslyFocusedElement.value?.focus()
    previouslyFocusedElement.value = null
  })
}

const openLikeDialog = (message: string) => {
  if (!message) {
    return
  }

  if (document.activeElement instanceof HTMLElement) {
    likeDialogPreviouslyFocusedElement.value = document.activeElement
  }

  likeDialogMessage.value = message
  void nextTick(() => {
    likeDialogCloseButton.value?.focus()
  })
}

const closeLikeDialog = () => {
  if (!likeDialogMessage.value) {
    return
  }

  likeDialogMessage.value = ''
  void nextTick(() => {
    likeDialogPreviouslyFocusedElement.value?.focus()
    likeDialogPreviouslyFocusedElement.value = null
  })
}

const toggleLike = async () => {
  closeLikeDialog()
  await auth.init()

  if (!post.value) {
    return
  }

  if (!auth.session.value?.access_token) {
    openLikeDialog(t('post.errors.loginToLike'))
    return
  }

  liking.value = true

  try {
    const response = await $fetch<PostLikeResponse>(`/api/posts/${post.value.id}/like`, {
      method: 'PUT',
      headers: auth.authHeaders.value,
      body: {
        liked: !post.value.likedByViewer
      } satisfies PostLikePayload
    })

    post.value = {
      ...post.value,
      likeCount: response.likeCount,
      likedByViewer: response.likedByViewer
    }
    updatePostDetailLike(response.postId, response, viewerId.value)
  } catch (error) {
    openLikeDialog(normalizeApiErrorMessage(error, t('post.errors.likeFailed')))
  } finally {
    liking.value = false
  }
}

const handleHeroImageLoad = (event: Event) => {
  const image = event.target as HTMLImageElement
  if (image.currentSrc && image.currentSrc !== selectedPhotoUrl.value) {
    return
  }

  heroImageReady.value = true
  heroImageFailed.value = false
}

const handleHeroImageError = () => {
  heroImageReady.value = false
  heroImageFailed.value = true
}

const handleViewerImageLoad = (event: Event) => {
  const image = event.target as HTMLImageElement
  if (image.currentSrc && image.currentSrc !== selectedPhotoUrl.value) {
    return
  }

  viewerImageReady.value = true
  viewerImageFailed.value = false
}

const handleViewerImageError = () => {
  viewerImageReady.value = false
  viewerImageFailed.value = true
}

const handleViewerKeydown = (event: KeyboardEvent) => {
  if (!imageViewerOpen.value) {
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeImageViewer()
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goPreviousPhoto()
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    goNextPhoto()
  }
}

const handleLikeDialogKeydown = (event: KeyboardEvent) => {
  if (!likeDialogOpen.value || event.key !== 'Escape') {
    return
  }

  event.preventDefault()
  closeLikeDialog()
}

watch(selectedPhotoUrl, () => {
  heroImageReady.value = false
  heroImageFailed.value = false
  viewerImageReady.value = false
  viewerImageFailed.value = false

  if (!selectedPhotoUrl.value) {
    closeImageViewer()
  }
}, { immediate: true })

watch(imageViewerOpen, (isOpen) => {
  if (typeof window === 'undefined') {
    return
  }

  if (isOpen) {
    window.addEventListener('keydown', handleViewerKeydown)
    return
  }

  window.removeEventListener('keydown', handleViewerKeydown)
})

watch(likeDialogOpen, (isOpen) => {
  if (typeof window === 'undefined') {
    return
  }

  if (isOpen) {
    window.addEventListener('keydown', handleLikeDialogKeydown)
    return
  }

  window.removeEventListener('keydown', handleLikeDialogKeydown)
})

watch(
  () => [props.postId, auth.ready.value, auth.authHeaders.value.Authorization || '', locale.value] as const,
  () => {
    closeImageViewer()
    void loadPost()
  },
  { immediate: true }
)

onMounted(() => {
  void auth.init()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleViewerKeydown)
    window.removeEventListener('keydown', handleLikeDialogKeydown)
  }
})
</script>

<template>
  <section class="workbench-panel workbench-panel--detail">
    <template v-if="loading">
      <div class="workbench-detail-skeleton" role="status" :aria-label="t('post.loadingTitle')">
        <div class="workbench-detail-skeleton__hero" aria-hidden="true">
          <span class="workbench-skeleton-shape workbench-skeleton-shape--hero"></span>
        </div>

        <div class="workbench-detail-skeleton__body" aria-hidden="true">
          <div class="workbench-detail-skeleton__titlebar">
            <span class="workbench-skeleton-shape workbench-skeleton-shape--title"></span>
            <span class="workbench-skeleton-shape workbench-skeleton-shape--icon"></span>
          </div>

          <div class="workbench-detail-skeleton__lines">
            <span class="workbench-skeleton-shape workbench-skeleton-shape--line"></span>
            <span class="workbench-skeleton-shape workbench-skeleton-shape--line workbench-skeleton-shape--line-short"></span>
            <span class="workbench-skeleton-shape workbench-skeleton-shape--line"></span>
            <span class="workbench-skeleton-shape workbench-skeleton-shape--line workbench-skeleton-shape--line-mid"></span>
          </div>

          <div class="workbench-detail-skeleton__note">
            <span class="workbench-skeleton-shape workbench-skeleton-shape--label"></span>
            <span class="workbench-skeleton-shape workbench-skeleton-shape--paragraph"></span>
            <span class="workbench-skeleton-shape workbench-skeleton-shape--paragraph workbench-skeleton-shape--paragraph-short"></span>
          </div>
        </div>

        <span class="sr-only">{{ t('post.loadingTitle') }}</span>
      </div>
    </template>

    <template v-else-if="post">
      <div
        v-if="selectedPhotoUrl"
        class="workbench-detail-hero"
        :class="{ 'is-loading': !heroImageReady && !heroImageFailed, 'is-ready': heroImageReady }"
      >
        <div
          v-if="heroImageReady"
          class="workbench-detail-hero__backdrop"
          :style="backgroundImageStyle(selectedPhotoUrl)"
          aria-hidden="true"
        />
        <div
          v-if="!heroImageReady"
          class="workbench-detail-hero__placeholder"
          aria-live="polite"
        >
          <span
            v-if="!heroImageFailed"
            class="workbench-progress-ring workbench-progress-ring--hero"
            aria-hidden="true"
          ></span>
          <i
            v-else
            class="fa-solid fa-image"
            aria-hidden="true"
          />
          <span class="sr-only">{{ heroImageFailed ? t('post.unavailableTitle') : t('post.loadingTitle') }}</span>
        </div>
        <img
          v-show="!heroImageFailed"
          :key="selectedPhotoUrl"
          class="workbench-detail-hero__image"
          :class="{ 'is-ready': heroImageReady, 'is-zoomable': canOpenImageViewer }"
          :src="selectedPhotoUrl"
          :alt="post.title"
          role="button"
          :tabindex="canOpenImageViewer ? 0 : -1"
          :aria-label="t('post.openPhotoViewer')"
          @click="openImageViewer"
          @keydown.enter.prevent="openImageViewer"
          @keydown.space.prevent="openImageViewer"
          @load="handleHeroImageLoad"
          @error="handleHeroImageError"
        />
        <template v-if="hasMultiplePhotos">
          <div class="workbench-detail-hero__nav-zone workbench-detail-hero__nav-zone--previous">
            <button
              class="workbench-detail-hero__nav-button"
              type="button"
              :aria-label="t('post.previousPhoto')"
              :disabled="!canGoPrevious"
              @click="goPreviousPhoto"
            >
              <i class="fa-solid fa-chevron-left" aria-hidden="true" />
            </button>
          </div>
          <div class="workbench-detail-hero__nav-zone workbench-detail-hero__nav-zone--next">
            <button
              class="workbench-detail-hero__nav-button"
              type="button"
              :aria-label="t('post.nextPhoto')"
              :disabled="!canGoNext"
              @click="goNextPhoto"
            >
              <i class="fa-solid fa-chevron-right" aria-hidden="true" />
            </button>
          </div>
        </template>
      </div>

      <div class="workbench-detail-body">
        <div class="workbench-detail-titlebar">
          <h2 class="workbench-panel__title workbench-panel__title--poster">{{ post.title }}</h2>
          <div class="workbench-detail-like">
            <button
              class="workbench-icon-button workbench-detail-like__button"
              :class="{ 'is-liked': post.likedByViewer }"
              type="button"
              :title="likeButtonLabel"
              :aria-label="likeButtonLabel"
              :aria-pressed="post.likedByViewer"
              :disabled="liking"
              @click="toggleLike"
            >
              <i class="button-icon" :class="likeIconClass" aria-hidden="true" />
              <span class="sr-only">{{ likeButtonLabel }}</span>
            </button>
            <span
              class="workbench-detail-like__count"
              :aria-label="t('post.likeCount', { count: post.likeCount ?? 0 })"
            >
              {{ post.likeCount ?? 0 }}
            </span>
          </div>
        </div>

        <div class="workbench-detail-lines">
          <p>
            <i class="button-icon fa-solid fa-user" aria-hidden="true" />
            <NuxtLink class="workbench-detail-link" :to="authorPath">
              @{{ post.author.username }}
            </NuxtLink>
          </p>
          <p>
            <i class="button-icon fa-solid fa-location-dot" aria-hidden="true" />
            <span v-if="[post.countryName, post.regionName, post.cityName].filter(Boolean).length" class="support-copy">
              <template v-if="post.countryName">
                <span>{{ post.countryName }}</span>
              </template>
              <template v-if="post.regionName">
                <span v-if="post.countryName"> / </span>
                <NuxtLink class="workbench-detail-link" :to="regionPath()">
                  {{ post.regionName }}
                </NuxtLink>
              </template>
              <template v-if="post.cityName">
                <span v-if="post.countryName || post.regionName"> / </span>
                <NuxtLink
                  v-if="post.regionName"
                  class="workbench-detail-link"
                  :to="cityPath()"
                >
                  {{ post.cityName }}
                </NuxtLink>
                <span v-else>{{ post.cityName }}</span>
              </template>
            </span>
            <span>{{ post.placeName || t('post.unnamedPlaceName') }}</span>
          </p>
          <p v-if="post.privacyMode === 'exact'">
            <i class="button-icon fa-solid fa-crosshairs" aria-hidden="true" />
            <span class="support-copy">{{ formatLatLng(post.publicLocation) }}</span>
          </p>
          <p>
            <i class="button-icon fa-solid fa-clock" aria-hidden="true" />
            <span>{{ formatDateTime(post.capturedAt) }}</span>
          </p>
        </div>

        <div class="workbench-detail-grid">
          <div v-if="post.body" class="workbench-detail-section field-grid">
            <strong>{{ t('post.authorNote') }}</strong>
            <p class="support-copy">{{ post.body }}</p>
          </div>

          <div class="workbench-detail-section field-grid"/>
        </div>
      </div>
    </template>

    <div v-else class="empty-state empty-state--inline">
      <h2>{{ t('post.unavailableTitle') }}</h2>
      <p v-if="errorMessage">{{ errorMessage }}</p>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="likeDialogOpen"
      class="workbench-like-dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="t('post.likeNotice')"
      @click.self="closeLikeDialog"
    >
      <div class="workbench-like-dialog__panel">
        <i class="workbench-like-dialog__icon fa-solid fa-circle-info" aria-hidden="true" />
        <p>{{ likeDialogMessage }}</p>
        <button
          ref="likeDialogCloseButton"
          class="workbench-icon-button workbench-like-dialog__close"
          type="button"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="closeLikeDialog"
        >
          <i class="button-icon fa-solid fa-xmark" aria-hidden="true" />
          <span class="sr-only">{{ t('common.close') }}</span>
        </button>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="imageViewerOpen && selectedPhotoUrl && post"
      class="workbench-photo-viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="post.title"
      @click.self="closeImageViewer"
    >
      <button
        ref="imageViewerCloseButton"
        class="workbench-photo-viewer__close"
        type="button"
        :aria-label="t('post.closePhotoViewer')"
        @click="closeImageViewer"
      >
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>

      <button
        v-if="hasMultiplePhotos"
        class="workbench-photo-viewer__nav workbench-photo-viewer__nav--previous"
        type="button"
        :aria-label="t('post.previousPhoto')"
        :disabled="!canGoPrevious"
        @click="goPreviousPhoto"
      >
        <i class="fa-solid fa-chevron-left" aria-hidden="true" />
      </button>

      <div class="workbench-photo-viewer__stage">
        <div
          v-if="!viewerImageReady"
          class="workbench-photo-viewer__placeholder"
          aria-live="polite"
        >
          <span
            v-if="!viewerImageFailed"
            class="workbench-progress-ring workbench-progress-ring--viewer"
            aria-hidden="true"
          ></span>
          <i
            v-else
            class="fa-solid fa-image"
            aria-hidden="true"
          />
          <span class="sr-only">{{ viewerImageFailed ? t('post.unavailableTitle') : t('post.loadingTitle') }}</span>
        </div>
        <img
          v-show="!viewerImageFailed"
          :key="`viewer-${selectedPhotoUrl}`"
          class="workbench-photo-viewer__image"
          :class="{ 'is-ready': viewerImageReady }"
          :src="selectedPhotoUrl"
          :alt="post.title"
          @load="handleViewerImageLoad"
          @error="handleViewerImageError"
        >
      </div>

      <button
        v-if="hasMultiplePhotos"
        class="workbench-photo-viewer__nav workbench-photo-viewer__nav--next"
        type="button"
        :aria-label="t('post.nextPhoto')"
        :disabled="!canGoNext"
        @click="goNextPhoto"
      >
        <i class="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>
