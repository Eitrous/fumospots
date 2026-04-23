<script setup lang="ts">
import type { PublicRegionPage, RegionScope, RegionSort } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

const props = defineProps<{
  scope: RegionScope
  sort: RegionSort
}>()

const auth = useAuthState()
const { t, locale } = useI18n()
const { formatDateTime } = useFormatters()
const { getRegionPage } = useRegionPageCache()

const regionPage = ref<PublicRegionPage | null>(null)
const loading = ref(true)
const errorMessage = ref('')
let loadSequence = 0

const fallbackTitle = computed(() => {
  return [props.scope.cityName, props.scope.regionName, props.scope.countryName].filter(Boolean).join(' / ')
})

const createdSortPath = computed(() => {
  return createWorkbenchLocation('region', {
    regionScope: props.scope,
    regionSort: 'created'
  })
})

const capturedSortPath = computed(() => {
  return createWorkbenchLocation('region', {
    regionScope: props.scope,
    regionSort: 'captured'
  })
})

const displayTime = (capturedAt: string | null, createdAt: string | null) => {
  return formatDateTime(capturedAt || createdAt)
}

const userPath = (username: string) => {
  return createWorkbenchLocation('user', { username })
}

const postPath = (postId: number) => {
  return createWorkbenchLocation('post', { postId })
}

const loadRegionPage = async () => {
  const currentLoad = ++loadSequence

  if (!auth.ready.value) {
    regionPage.value = null
    loading.value = true
    errorMessage.value = ''
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const nextRegionPage = await getRegionPage(props.scope, props.sort, {
      headers: auth.authHeaders.value,
      viewerId: auth.viewer.value?.userId ?? null
    })
    if (currentLoad !== loadSequence) {
      return
    }

    regionPage.value = nextRegionPage
  } catch (error) {
    if (currentLoad !== loadSequence) {
      return
    }

    regionPage.value = null
    errorMessage.value = normalizeApiErrorMessage(error, t('region.errors.loadFailed'))
  } finally {
    if (currentLoad === loadSequence) {
      loading.value = false
    }
  }
}

watch(
  () => [
    props.scope.countryName,
    props.scope.regionName,
    props.scope.cityName,
    props.sort,
    auth.ready.value,
    auth.authHeaders.value.Authorization,
    locale.value
  ],
  () => {
    void loadRegionPage()
  },
  { immediate: true }
)

onMounted(() => {
  void auth.init()
})
</script>

<template>
  <section class="workbench-panel workbench-panel--user workbench-region">
    <div class="workbench-user__head">
      <span class="eyebrow">{{ t('region.eyebrow') }}</span>

      <div class="workbench-region__titlebar">
        <h2 class="workbench-panel__title workbench-panel__title--poster">
          {{ regionPage?.title || fallbackTitle }}
        </h2>

        <div class="workbench-region__sort">
          <NuxtLink
            class="workbench-icon-button"
            :class="{ 'is-active': props.sort === 'created' }"
            :to="createdSortPath"
            :title="t('region.sortCreated')"
            :aria-label="t('region.sortCreated')"
          >
            <i class="button-icon fa-solid fa-clock" aria-hidden="true" />
            <span class="sr-only">{{ t('region.sortCreated') }}</span>
          </NuxtLink>

          <NuxtLink
            class="workbench-icon-button"
            :class="{ 'is-active': props.sort === 'captured' }"
            :to="capturedSortPath"
            :title="t('region.sortCaptured')"
            :aria-label="t('region.sortCaptured')"
          >
            <i class="button-icon fa-solid fa-camera" aria-hidden="true" />
            <span class="sr-only">{{ t('region.sortCaptured') }}</span>
          </NuxtLink>
        </div>
      </div>
    </div>

    <section class="workbench-stack-section workbench-user__posts">
      <div class="workbench-stack-section__head workbench-user__posts-head">
        <strong>{{ t('region.postsTitle') }}</strong>
        <span v-if="regionPage" class="status-inline">
          {{ t('region.visibleCount', { count: regionPage.postCount }) }}
        </span>
      </div>

      <p v-if="loading" class="support-copy">{{ t('region.loading') }}</p>
      <p v-else-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

      <div v-else-if="regionPage?.posts.length" class="workbench-user-post-list">
        <article v-for="post in regionPage.posts" :key="post.id" class="workbench-user-post-row">
          <NuxtLink class="workbench-user-post-row__media" :to="postPath(post.id)">
            <img v-if="post.thumbUrl" :src="post.thumbUrl" :alt="post.title">
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
          </NuxtLink>

          <div class="workbench-user-post-row__body">
            <div class="workbench-user-post-row__title">
              <NuxtLink :to="postPath(post.id)">
                {{ post.title }}
              </NuxtLink>
            </div>
            <p>{{ post.placeName || t('post.unnamedPlaceName') }}</p>
            <p>
              <NuxtLink class="workbench-detail-link" :to="userPath(post.author.username)">
                @{{ post.author.username }}
              </NuxtLink>
            </p>
            <p>{{ displayTime(post.capturedAt, post.createdAt) }}</p>
          </div>
        </article>
      </div>

      <div v-else class="empty-state empty-state--inline">
        <h2>{{ t('region.emptyTitle') }}</h2>
        <p>{{ t('region.emptyDescription') }}</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.workbench-region__titlebar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.75rem;
}

.workbench-region__titlebar .workbench-panel__title {
  min-width: 0;
}

.workbench-region__sort {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.workbench-region__sort .workbench-icon-button.is-active {
  color: var(--accent-deep);
}

@media (max-width: 720px) {
  .workbench-region__titlebar {
    grid-template-columns: minmax(0, 1fr);
  }

  .workbench-region__sort {
    justify-self: end;
  }
}
</style>
