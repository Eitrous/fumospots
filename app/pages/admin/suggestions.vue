<script setup lang="ts">
import type { AdminSuggestionItem } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

definePageMeta({
  layout: 'admin',
  middleware: ['require-admin']
})

const auth = useAuthState()
const { formatDateTime } = useFormatters({ locale: 'zh-CN' })

const suggestions = ref<AdminSuggestionItem[]>([])
const loading = ref(true)
const errorMessage = useErrorNoticeState()

const displayAuthor = (item: AdminSuggestionItem) => {
  if (item.author.username) {
    return `@${item.author.username}`
  }

  return `用户 ${item.author.id.slice(0, 8)}`
}

const loadSuggestions = async () => {
  if (!auth.authHeaders.value.Authorization) {
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    suggestions.value = await $fetch<AdminSuggestionItem[]>('/api/admin/suggestions', {
      headers: auth.authHeaders.value
    })
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, '建议列表加载失败。')
  } finally {
    loading.value = false
  }
}

watch(
  () => [auth.ready.value, auth.isAdmin.value],
  ([ready, isAdmin]) => {
    if (ready && isAdmin) {
      void loadSuggestions()
    }
  },
  { immediate: true }
)
</script>

<template>
  <main class="admin-shell admin-suggestions-page">
    <section class="admin-page-head">
      <div>
        <h1 class="admin-page-title">用户建议</h1>
        <p class="admin-page-kicker">
          {{ loading ? '正在加载建议' : `共 ${suggestions.length} 条建议` }}
        </p>
      </div>

      <button
        class="admin-icon-button"
        type="button"
        :title="loading ? '正在刷新' : '刷新建议列表'"
        :aria-label="loading ? '正在刷新' : '刷新建议列表'"
        :disabled="loading"
        @click="loadSuggestions"
      >
        <i
          class="button-icon fa-solid"
          :class="loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'"
          aria-hidden="true"
        />
        <span class="sr-only">刷新建议列表</span>
      </button>
    </section>

    <section class="admin-panel admin-suggestion-panel">
      <ul v-if="suggestions.length" class="admin-suggestion-list">
        <li
          v-for="item in suggestions"
          :key="item.id"
          class="admin-suggestion-item"
        >
          <div class="admin-suggestion-item__meta">
            <strong>{{ displayAuthor(item) }}</strong>
            <span>{{ formatDateTime(item.createdAt) }}</span>
          </div>

          <p>{{ item.content }}</p>
        </li>
      </ul>

      <p v-else-if="!loading && !errorMessage" class="admin-status">暂无建议。</p>
      <p v-else-if="loading" class="admin-status">正在加载建议...</p>
      <button
        v-else
        class="admin-text-button"
        type="button"
        @click="loadSuggestions"
      >
        <i class="button-icon fa-solid fa-rotate-right" aria-hidden="true" />
        <span>重试</span>
      </button>
    </section>
  </main>
</template>
