<script setup lang="ts">
import type { PublicUserPage, UserPostSummary } from '~~/shared/fumo'

const props = defineProps<{
  username: string
}>()

const auth = useAuthState()
const { t } = useI18n()
const { formatDateTime } = useFormatters()
const { getUserPage } = useUserPageCache()

const userPage = ref<PublicUserPage | null>(null)
const loading = ref(true)
const errorMessage = ref('')
let loadSequence = 0

const statusLabel = (post: UserPostSummary) => {
  if (post.hasPendingRevision) {
    return t('user.pendingRevision')
  }

  return t(`user.status.${post.status}`)
}

const loadUserPage = async () => {
  const currentLoad = ++loadSequence

  if (!props.username) {
    userPage.value = null
    loading.value = false
    return
  }

  if (!auth.ready.value) {
    userPage.value = null
    loading.value = true
    errorMessage.value = ''
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const nextUserPage = await getUserPage(props.username, {
      headers: auth.authHeaders.value,
      viewerId: auth.viewer.value?.userId ?? null
    })
    if (currentLoad !== loadSequence) {
      return
    }

    userPage.value = nextUserPage
  } catch (error) {
    if (currentLoad !== loadSequence) {
      return
    }

    userPage.value = null
    errorMessage.value = error instanceof Error ? error.message : t('user.errors.loadFailed')
  } finally {
    if (currentLoad === loadSequence) {
      loading.value = false
    }
  }
}

watch(
  () => [props.username, auth.ready.value, auth.authHeaders.value.Authorization],
  () => {
    void loadUserPage()
  },
  { immediate: true }
)

onMounted(() => {
  void auth.init()
})
</script>

<template>
  <section class="workbench-panel workbench-panel--user">
    <div class="workbench-user__head">
      <span class="eyebrow">{{ t('user.eyebrow') }}</span>
      <h2 class="workbench-panel__title workbench-panel__title--poster">
        @{{ userPage?.profile.username || username }}
      </h2>
    </div>

    <section class="workbench-stack-section workbench-user__posts">
      <div class="workbench-stack-section__head workbench-user__posts-head">
        <strong>{{ t('user.postsTitle') }}</strong>
        <span v-if="userPage" class="status-inline">
          {{ t('user.visibleCount', { count: userPage.posts.length }) }}
        </span>
      </div>

      <p v-if="loading" class="support-copy">{{ t('user.loading') }}</p>
      <p v-else-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

      <div v-else-if="userPage?.posts.length" class="workbench-user-post-list">
        <article v-for="post in userPage.posts" :key="post.id" class="workbench-user-post-row">
          <NuxtLink class="workbench-user-post-row__media" :to="createWorkbenchLocation('post', { postId: post.id })">
            <img v-if="post.thumbUrl" :src="post.thumbUrl" :alt="post.title">
            <i v-else class="fa-solid fa-image" aria-hidden="true" />
          </NuxtLink>

          <div class="workbench-user-post-row__body">
            <div class="workbench-user-post-row__title">
              <NuxtLink :to="createWorkbenchLocation('post', { postId: post.id })">
                {{ post.title }}
              </NuxtLink>
              <span v-if="userPage.isSelf" class="status-inline">{{ statusLabel(post) }}</span>
            </div>
            <p>{{ post.placeName || t('post.unnamedPlaceName') }}</p>
            <p>{{ formatDateTime(post.capturedAt || post.createdAt) }}</p>
          </div>

          <NuxtLink
            v-if="userPage.isSelf"
            class="workbench-icon-button"
            :to="createWorkbenchLocation('edit', { postId: post.id })"
            :title="t('user.editPost')"
            :aria-label="t('user.editPost')"
          >
            <i class="button-icon fa-solid fa-pen-to-square" aria-hidden="true" />
            <span class="sr-only">{{ t('user.editPost') }}</span>
          </NuxtLink>
        </article>
      </div>

      <div v-else class="empty-state empty-state--inline">
        <h2>{{ t('user.emptyTitle') }}</h2>
        <p>{{ t('user.emptyDescription') }}</p>
      </div>
    </section>
  </section>
</template>
