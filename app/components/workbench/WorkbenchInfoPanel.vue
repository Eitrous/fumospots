<script setup lang="ts">
import type { PublicMapCountResponse } from '~~/shared/fumo'

const { locale, t } = useI18n()
const {
  data: mapCount,
  pending: mapCountPending,
  error: mapCountError
} = await useFetch<PublicMapCountResponse>('/api/map/count', {
  key: 'home-post-count'
})

const emit = defineEmits<{
  openFeedback: []
}>()

const publicPostCount = computed(() => Math.max(0, Number(mapCount.value?.count ?? 0)))
const registeredUserCount = computed(() => Math.max(0, Number(mapCount.value?.registeredUserCount ?? 0)))
const formatStatCount = (value: number) => {
  if (mapCountPending.value || mapCountError.value) {
    return '--'
  }

  return new Intl.NumberFormat(locale.value).format(value)
}
const formattedPublicPostCount = computed(() => formatStatCount(publicPostCount.value))
const formattedRegisteredUserCount = computed(() => formatStatCount(registeredUserCount.value))

const homeStats = computed(() => [
  {
    key: 'posts',
    label: t('workbench.stats.publicPosts'),
    value: formattedPublicPostCount.value
  },
  {
    key: 'users',
    label: t('workbench.stats.registeredUsers'),
    value: formattedRegisteredUserCount.value
  }
])

const openFeedback = () => {
  emit('openFeedback')
}
</script>

<template>
  <section class="workbench-panel workbench-panel--home workbench-panel--home-stats">
    <div class="workbench-home-stats" aria-live="polite">
      <div
        v-for="metric in homeStats"
        :key="metric.key"
        class="workbench-home-stats__item"
      >
        <strong
          class="workbench-home-stats__value"
          :aria-label="`${metric.value} ${metric.label}`"
        >
          <span aria-hidden="true">{{ metric.value }}</span>
        </strong>
        <p class="workbench-home-stats__label">
          {{ metric.label }}
        </p>
      </div>
      <p v-if="mapCountError" class="workbench-home-stats__status">
        {{ t('workbench.stats.loadFailed') }}
      </p>
    </div>

    <a
      class="workbench-home-stats__blog-link"
      href="https://blog.0x-3f.com/2026/04/12/fumospots_manual/"
      target="_blank"
      rel="noopener noreferrer"
      title="Blog"
      aria-label="Blog"
    >
      <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
      <span class="sr-only">Blog</span>
    </a>

    <button
      class="workbench-home-stats__feedback-link"
      type="button"
      :title="t('suggestions.quickAction')"
      :aria-label="t('suggestions.quickAction')"
      @click="openFeedback"
    >
      <i class="fa-regular fa-comment-dots" aria-hidden="true" />
      <span class="sr-only">{{ t('suggestions.quickAction') }}</span>
    </button>
  </section>
</template>
