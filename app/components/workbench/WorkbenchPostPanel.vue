<script setup lang="ts">
import type { PublicPostDetail } from '~~/shared/fumo'

const props = defineProps<{
  postId: number
}>()

const { t } = useI18n()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters()

const loading = ref(true)
const errorMessage = ref('')
const post = ref<PublicPostDetail | null>(null)

const backgroundImageStyle = (imageUrl: string) => ({
  backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")`
})

const loadPost = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    post.value = await $fetch<PublicPostDetail>(`/api/posts/${props.postId}`)
  } catch (error) {
    post.value = null
    errorMessage.value = error instanceof Error ? error.message : t('post.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

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
      <div v-if="post.imageUrl" class="workbench-detail-hero">
        <div
          class="workbench-detail-hero__backdrop"
          :style="backgroundImageStyle(post.imageUrl)"
          aria-hidden="true"
        />
        <img
          class="workbench-detail-hero__image"
          :src="post.imageUrl"
          :alt="post.title"
        />
      </div>

      <div class="workbench-detail-body">
        <span class="eyebrow">{{ t('post.eyebrow') }}</span>
        <h2 class="workbench-panel__title workbench-panel__title--poster">{{ post.title }}</h2>

        <div class="workbench-detail-lines">
          <p>
            <i class="button-icon fa-solid fa-user" aria-hidden="true" />
            <span>@{{ post.author.username }}</span>
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
