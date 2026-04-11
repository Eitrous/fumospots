<script setup lang="ts">
import type { PublicPostDetail } from '~~/shared/fumo'

const props = defineProps<{
  postId: number
}>()

const { t } = useI18n()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters()
const { getPostDetail } = usePostDetailCache()

const loading = ref(true)
const errorMessage = ref('')
const post = ref<PublicPostDetail | null>(null)
const selectedPhotoIndex = ref(0)
const heroImageReady = ref(false)
const heroImageFailed = ref(false)
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

const authorPath = computed(() => {
  return post.value
    ? createWorkbenchLocation('user', { username: post.value.author.username })
    : createWorkbenchLocation('info')
})

const backgroundImageStyle = (imageUrl: string) => ({
  backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")`
})

const loadPost = async () => {
  const currentLoad = ++loadSequence
  loading.value = true
  errorMessage.value = ''

  try {
    const nextPost = await getPostDetail(props.postId)
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
    errorMessage.value = error instanceof Error ? error.message : t('post.errors.loadFailed')
  } finally {
    if (currentLoad === loadSequence) {
      loading.value = false
    }
  }
}

const selectPhoto = (index: number) => {
  selectedPhotoIndex.value = index
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

watch(selectedPhotoUrl, () => {
  heroImageReady.value = false
  heroImageFailed.value = false
}, { immediate: true })

watch(
  () => props.postId,
  () => {
    void loadPost()
  },
  { immediate: true }
)
</script>

<template>
  <section class="workbench-panel workbench-panel--detail">
    <template v-if="loading">
      <div class="empty-state empty-state--inline">
        <h2>{{ t('post.loadingTitle') }}</h2>
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
          <i
            class="fa-solid"
            :class="heroImageFailed ? 'fa-image' : 'fa-spinner fa-spin'"
            aria-hidden="true"
          />
          <span class="sr-only">{{ heroImageFailed ? t('post.unavailableTitle') : t('post.loadingTitle') }}</span>
        </div>
        <img
          v-show="!heroImageFailed"
          :key="selectedPhotoUrl"
          class="workbench-detail-hero__image"
          :class="{ 'is-ready': heroImageReady }"
          :src="selectedPhotoUrl"
          :alt="post.title"
          @load="handleHeroImageLoad"
          @error="handleHeroImageError"
        />
      </div>

      <div class="workbench-detail-body">
        <span class="eyebrow">{{ t('post.eyebrow') }}</span>
        <h2 class="workbench-panel__title workbench-panel__title--poster">{{ post.title }}</h2>

        <div v-if="displayPhotos.length > 1" class="photo-strip" aria-label="Post photos">
          <button
            v-for="(photo, index) in displayPhotos"
            :key="`${post.id}-${index}`"
            class="photo-strip__button"
            :class="{ 'is-active': selectedPhotoIndex === index }"
            type="button"
            :aria-label="`View photo ${index + 1}`"
            @click="selectPhoto(index)"
          >
            <img v-if="photo.thumbUrl || photo.imageUrl" :src="photo.thumbUrl || photo.imageUrl || ''" :alt="post.title">
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
          </button>
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
            <span>{{ post.placeName || t('post.unnamedPlaceName') }}</span>
          </p>
          <p>
            <i class="button-icon fa-solid fa-crosshairs" aria-hidden="true" />
            <span>{{ privacyModeLabel(post.privacyMode) }}</span>
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

          <div class="workbench-detail-section field-grid">
            <strong>{{ t('post.locationInfo') }}</strong>
            <p v-if="post.placeName" class="support-copy">{{ post.placeName }}</p>
            <p v-if="[post.cityName, post.regionName, post.countryName].filter(Boolean).length" class="support-copy">
              {{ [post.cityName, post.regionName, post.countryName].filter(Boolean).join(' / ') }}
            </p>
            <p class="support-copy">{{ t('post.publicCoordinates', { value: formatLatLng(post.publicLocation) }) }}</p>
            <p class="support-copy">{{ t('post.capturedAt', { value: formatDateTime(post.capturedAt) }) }}</p>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty-state empty-state--inline">
      <h2>{{ t('post.unavailableTitle') }}</h2>
      <p v-if="errorMessage">{{ errorMessage }}</p>
    </div>
  </section>
</template>
