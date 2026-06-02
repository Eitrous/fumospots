<script setup lang="ts">
import type { PublicPostListItem, PublicPostsPageResponse } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

const PAGE_SIZE = 42

const { t } = useI18n()
const { formatDateTime } = useFormatters()

const posts = ref<PublicPostListItem[]>([])
const postCount = ref(0)
const nextOffset = ref<number | null>(0)
const sortOrder = ref<'asc' | 'desc'>('desc')
const loading = ref(true)
const loadingMore = ref(false)
const errorMessage = ref('')
const loadMoreErrorMessage = ref('')
let loadSequence = 0

const visibleCount = computed(() => posts.value.length)
const canLoadMore = computed(() => nextOffset.value !== null && !loading.value && !loadingMore.value)
const sortButtonLabel = computed(() => {
  return sortOrder.value === 'desc' ? t('allPosts.sortNewest') : t('allPosts.sortOldest')
})
const sortButtonTitle = computed(() => {
  return sortOrder.value === 'desc' ? t('allPosts.switchToOldest') : t('allPosts.switchToNewest')
})

const postPath = (postId: number) => {
  return createWorkbenchLocation('post', { postId })
}

const applyPage = (page: PublicPostsPageResponse, append: boolean) => {
  posts.value = append ? [...posts.value, ...page.items] : page.items
  postCount.value = page.postCount
  nextOffset.value = page.nextOffset
}

const loadPosts = async (append = false) => {
  const currentLoad = ++loadSequence
  const offset = append ? nextOffset.value : 0

  if (append && offset === null) {
    return
  }

  if (append) {
    loadingMore.value = true
    loadMoreErrorMessage.value = ''
  } else {
    loading.value = true
    errorMessage.value = ''
    loadMoreErrorMessage.value = ''
    nextOffset.value = 0
  }

  try {
    const page = await $fetch<PublicPostsPageResponse>('/api/posts', {
      query: {
        limit: PAGE_SIZE,
        offset: offset || undefined,
        sort: sortOrder.value
      }
    })

    if (currentLoad !== loadSequence) {
      return
    }

    applyPage(page, append)
  } catch (error) {
    if (currentLoad !== loadSequence) {
      return
    }

    const message = normalizeApiErrorMessage(error, t('allPosts.errors.loadFailed'))
    if (append) {
      loadMoreErrorMessage.value = message
    } else {
      errorMessage.value = message
    }
  } finally {
    if (currentLoad === loadSequence) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

const toggleSortOrder = () => {
  if (loading.value || loadingMore.value) {
    return
  }

  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  void loadPosts()
}

onMounted(() => {
  void loadPosts()
})
</script>

<template>
  <section class="workbench-panel workbench-panel--user workbench-posts">
    <div class="workbench-user__head">
      <span class="eyebrow">{{ t('allPosts.eyebrow') }}</span>
      <h2 class="workbench-panel__title workbench-panel__title--poster">
        {{ t('allPosts.title') }}
      </h2>
    </div>

    <section class="workbench-stack-section workbench-user__posts">
      <div class="workbench-posts__toolbar">
        <span
          v-if="loading"
          class="workbench-skeleton-shape workbench-posts__count-skeleton"
          aria-hidden="true"
        />
        <span v-else-if="postCount" class="status-inline">
          {{ t('allPosts.visibleCount', { shown: visibleCount, count: postCount }) }}
        </span>

        <button
          class="workbench-posts__sort-button"
          type="button"
          :title="sortButtonTitle"
          :aria-label="sortButtonTitle"
          :disabled="loading || loadingMore"
          @click="toggleSortOrder"
        >
          <span>{{ sortButtonLabel }}</span>
        </button>
      </div>

      <div
        v-if="loading"
        class="workbench-user-post-list workbench-posts-skeleton"
        role="status"
        :aria-label="t('allPosts.loading')"
      >
        <article
          v-for="index in 8"
          :key="index"
          class="workbench-user-post-row workbench-post-row-skeleton"
          aria-hidden="true"
        >
          <span
            class="workbench-skeleton-shape workbench-post-row-skeleton__media"
          />
          <span class="workbench-post-row-skeleton__body">
            <span
              class="workbench-skeleton-shape workbench-post-row-skeleton__title"
            />
            <span
              class="workbench-skeleton-shape workbench-post-row-skeleton__line"
            />
            <span
              class="workbench-skeleton-shape workbench-post-row-skeleton__line workbench-post-row-skeleton__line-short"
            />
          </span>
        </article>
        <span class="sr-only">{{ t('allPosts.loading') }}</span>
      </div>
      <p v-else-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

      <div v-else-if="posts.length" class="workbench-user-post-list">
        <article v-for="post in posts" :key="post.id" class="workbench-user-post-row">
          <NuxtLink class="workbench-user-post-row__media" :to="postPath(post.id)">
            <img
              v-if="post.thumbUrl"
              :src="post.thumbUrl"
              :alt="post.title"
              decoding="async"
              loading="lazy"
            >
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
          </NuxtLink>

          <div class="workbench-user-post-row__body">
            <div class="workbench-user-post-row__title">
              <NuxtLink :to="postPath(post.id)">
                {{ post.title }}
              </NuxtLink>
            </div>
            <p>{{ post.placeName || t('post.unnamedPlaceName') }}</p>
            <p>{{ formatDateTime(post.createdAt) }}</p>
          </div>
        </article>

        <button
          v-if="nextOffset !== null"
          class="workbench-posts__load-more"
          type="button"
          :disabled="!canLoadMore"
          @click="loadPosts(true)"
        >
          <i
            class="fa-solid"
            :class="loadingMore ? 'fa-spinner fa-spin' : 'fa-plus'"
            aria-hidden="true"
          />
          <span>{{ loadingMore ? t('allPosts.loadingMore') : t('allPosts.loadMore') }}</span>
        </button>

        <p v-if="loadMoreErrorMessage" class="error-banner">
          {{ loadMoreErrorMessage }}
        </p>
      </div>

      <div v-else class="empty-state empty-state--inline">
        <h2>{{ t('allPosts.emptyTitle') }}</h2>
        <p>{{ t('allPosts.emptyDescription') }}</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.workbench-posts__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.workbench-posts__sort-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.25rem;
  padding: 0.5rem 0.72rem;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.34);
  color: var(--ink);
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
  transition:
    border-color 180ms var(--motion-smooth),
    background 180ms var(--motion-smooth),
    color 180ms var(--motion-smooth),
    transform 180ms var(--motion-smooth);
}

.workbench-posts__sort-button:hover,
.workbench-posts__sort-button:focus-visible {
  border-color: rgba(22, 146, 95, 0.34);
  background: rgba(22, 146, 95, 0.08);
  color: var(--accent-deep);
  outline: 0;
}

.workbench-posts__sort-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.workbench-posts__count-skeleton {
  width: min(8.5rem, 44vw);
  height: 0.78rem;
  border-radius: 999px;
}

.workbench-posts__load-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  justify-self: center;
  margin-top: 1rem;
  padding: 0.72rem 1rem;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.34);
  color: var(--ink);
  font-weight: 700;
  transition:
    border-color 180ms var(--motion-smooth),
    background 180ms var(--motion-smooth),
    color 180ms var(--motion-smooth);
}

.workbench-posts__load-more:hover,
.workbench-posts__load-more:focus-visible {
  color: var(--accent-deep);
  outline: 0;
}

.workbench-posts__load-more:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

html[data-theme="dark"] .workbench-posts__load-more {
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.04);
}

html[data-theme="dark"] .workbench-posts__sort-button {
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.04);
}

@media (max-width: 720px) {
  .workbench-posts__toolbar {
    align-items: flex-start;
  }
}
</style>
