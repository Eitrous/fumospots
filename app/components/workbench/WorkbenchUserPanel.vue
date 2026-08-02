<script setup lang="ts">
import type { PublicUserPage, UserPostSummary } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

const props = defineProps<{
  username: string
}>()

const auth = useAuthState()
const { t } = useI18n()
const { formatDateTime } = useFormatters()
const { getUserPage, invalidateUserPage } = useUserPageCache()

const userPage = ref<PublicUserPage | null>(null)
const loading = ref(true)
const errorMessage = useErrorNoticeState()
const isEditingUsername = ref(false)
const usernameDraft = ref('')
const usernameError = useErrorNoticeState()
const savingUsername = ref(false)
let loadSequence = 0

const displayUsername = computed(() => userPage.value?.profile.username || props.username)
const canEditUsername = computed(() => Boolean(userPage.value?.isSelf))

const statusLabel = (post: UserPostSummary) => {
  if (post.hasPendingRevision) {
    return t('user.pendingRevision')
  }

  return t(`user.status.${post.status}`)
}

const startUsernameEdit = () => {
  if (!canEditUsername.value || savingUsername.value) {
    return
  }

  usernameError.value = ''
  usernameDraft.value = displayUsername.value
  isEditingUsername.value = true
}

const cancelUsernameEdit = () => {
  if (savingUsername.value) {
    return
  }

  usernameError.value = ''
  usernameDraft.value = displayUsername.value
  isEditingUsername.value = false
}

const submitUsernameUpdate = async () => {
  if (!canEditUsername.value || savingUsername.value) {
    return
  }

  const nextUsername = usernameDraft.value.trim()
  usernameError.value = ''

  if (!nextUsername) {
    usernameError.value = t('user.errors.usernameRequired')
    return
  }

  const previousUsername = displayUsername.value
  if (nextUsername === previousUsername) {
    isEditingUsername.value = false
    return
  }

  if (!auth.authHeaders.value.Authorization) {
    usernameError.value = t('submit.errors.sessionExpired')
    return
  }

  savingUsername.value = true

  try {
    await $fetch('/api/profile/setup', {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: {
        username: nextUsername
      }
    })

    await auth.refreshViewer()
    invalidateUserPage(previousUsername)
    invalidateUserPage(nextUsername)

    if (userPage.value) {
      userPage.value = {
        ...userPage.value,
        profile: {
          ...userPage.value.profile,
          username: nextUsername
        }
      }
    }

    usernameDraft.value = nextUsername
    isEditingUsername.value = false

    await navigateTo(createWorkbenchLocation('user', {
      username: nextUsername
    }), { replace: true })
  } catch (error) {
    usernameError.value = normalizeApiErrorMessage(error, t('user.errors.saveFailed'))
  } finally {
    savingUsername.value = false
  }
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
    errorMessage.value = normalizeApiErrorMessage(error, t('user.errors.loadFailed'))
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

watch(displayUsername, (username) => {
  if (!isEditingUsername.value) {
    usernameDraft.value = username
  }
}, { immediate: true })

onMounted(() => {
  void auth.init()
})
</script>

<template>
  <section class="workbench-panel workbench-panel--user">
    <div class="workbench-user__head">
      <span class="eyebrow">{{ t('user.eyebrow') }}</span>

      <div class="workbench-user__identity">
        <template v-if="isEditingUsername && canEditUsername">
          <label for="workbench-user-username-input" class="sr-only">{{ t('user.editUsername') }}</label>
          <input
            id="workbench-user-username-input"
            v-model="usernameDraft"
            class="field-input workbench-user__username-input"
            maxlength="24"
            :disabled="savingUsername"
            :aria-label="t('user.editUsername')"
            @keydown.enter.prevent="submitUsernameUpdate"
            @keydown.esc.prevent="cancelUsernameEdit"
          >

          <div class="workbench-user__identity-actions">
            <button
              class="workbench-icon-button"
              type="button"
              :title="t('user.saveUsername')"
              :aria-label="t('user.saveUsername')"
              :disabled="savingUsername || !usernameDraft.trim()"
              @click="submitUsernameUpdate"
            >
              <i class="button-icon fa-solid" :class="savingUsername ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
              <span class="sr-only">{{ t('user.saveUsername') }}</span>
            </button>

            <button
              class="workbench-icon-button"
              type="button"
              :title="t('user.cancelEditUsername')"
              :aria-label="t('user.cancelEditUsername')"
              :disabled="savingUsername"
              @click="cancelUsernameEdit"
            >
              <i class="button-icon fa-solid fa-xmark" aria-hidden="true" />
              <span class="sr-only">{{ t('user.cancelEditUsername') }}</span>
            </button>
          </div>
        </template>

        <template v-else>
          <h2 class="workbench-panel__title workbench-panel__title--poster">
            @{{ displayUsername }}
          </h2>

          <button
            v-if="canEditUsername"
            class="workbench-icon-button workbench-user__edit-username"
            type="button"
            :title="t('user.editUsername')"
            :aria-label="t('user.editUsername')"
            @click="startUsernameEdit"
          >
            <i class="button-icon fa-solid fa-pen-to-square" aria-hidden="true" />
            <span class="sr-only">{{ t('user.editUsername') }}</span>
          </button>
        </template>
      </div>
    </div>

    <section class="workbench-stack-section workbench-user__posts">
      <div class="workbench-stack-section__head workbench-user__posts-head">
        <strong>{{ t('user.postsTitle') }}</strong>
        <div v-if="userPage" class="workbench-user__posts-stats">
          <span class="status-inline">
            {{ t('user.visibleCount', { count: userPage.posts.length }) }}
          </span>
          <span class="workbench-user__total-likes">
            <svg xmlns="http://www.w3.org/2000/svg" width="1.4em" height="1.4em" viewBox="0 0 640 640">
              <path d="M0 0h640v640H0z" fill="none" />
              <path fill="currentColor" d="m305 151.1l15 20.7l15-20.7C360 116.5 400.2 96 442.9 96C516.4 96 576 155.6 576 229.1v2.6c0 112.2-139.9 242.5-212.9 298.2c-12.4 9.4-27.6 14.1-43.1 14.1s-30.8-4.6-43.1-14.1C203.9 474.2 64 343.9 64 231.7v-2.6C64 155.6 123.6 96 197.1 96c42.7 0 82.9 20.5 107.9 55.1" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 640 640">
              <path d="M0 0h640v640H0z" fill="none" />
              <path fill="currentColor" d="M183.1 137.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L275.2 320L137.9 457.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l137.3-137.4l137.4 137.3c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L365.8 320l137.3-137.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L320.5 274.7z" />
            </svg>
            <span>{{ userPage.totalLikeCount }}</span>
          </span>
        </div>
      </div>

      <p v-if="loading" class="support-copy">{{ t('user.loading') }}</p>

      <div v-else-if="userPage?.posts.length" class="workbench-user-post-list">
        <article v-for="post in userPage.posts" :key="post.id" class="workbench-user-post-row">
          <NuxtLink class="workbench-user-post-row__media" :to="createWorkbenchLocation('post', { postId: post.id })">
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

      <div v-else-if="errorMessage" class="empty-state empty-state--inline">
        <button
          class="ghost-button"
          type="button"
          :title="t('common.retry')"
          @click="loadUserPage"
        >
          <i class="button-icon fa-solid fa-rotate-right" aria-hidden="true" />
          <span>{{ t('common.retry') }}</span>
        </button>
      </div>

      <div v-else class="empty-state empty-state--inline">
        <h2>{{ t('user.emptyTitle') }}</h2>
        <p>{{ t('user.emptyDescription') }}</p>
      </div>
    </section>
  </section>
</template>

<style scoped>
.workbench-user__identity {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.45rem;
}

.workbench-user__identity .workbench-panel__title {
  min-width: 0;
}

.workbench-user__username-input {
  min-width: 0;
  width: 100%;
  max-width: 20rem;
}

.workbench-user__identity-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}

.workbench-user__identity-actions .workbench-icon-button,
.workbench-user__edit-username {
  width: 2.3rem;
  height: 2.3rem;
  border-radius: 0.65rem;
}

.workbench-user__posts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.workbench-user__posts-stats {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-left: auto;
  text-align: right;
}

.workbench-user__total-likes {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.1rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .workbench-user__identity {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.55rem;
  }

  .workbench-user__identity-actions {
    justify-self: end;
  }
}
</style>
