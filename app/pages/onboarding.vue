<script setup lang="ts">
definePageMeta({
  middleware: ['require-auth']
})

const route = useRoute()
const auth = useAuthState()

const username = ref('')
const saving = ref(false)
const errorMessage = ref('')

const nextPath = computed(() => {
  return typeof route.query.next === 'string' ? route.query.next : '/submit'
})

const suggestUsername = () => {
  const email = auth.viewer.value?.email || ''
  const local = email.split('@')[0]?.toLowerCase() || 'fumo_traveler'
  return local.replace(/[^a-z0-9_-]+/g, '_').slice(0, 24)
}

watch(
  () => [auth.ready.value, auth.viewer.value?.profile.username],
  () => {
    if (!auth.ready.value) {
      return
    }

    if (auth.hasUsername.value) {
      void navigateTo(nextPath.value, { replace: true })
      return
    }

    if (!username.value) {
      username.value = suggestUsername()
    }
  },
  { immediate: true }
)

const submitUsername = async () => {
  errorMessage.value = ''

  if (!username.value.trim()) {
    errorMessage.value = '请输入作者 ID'
    return
  }

  saving.value = true

  try {
    await $fetch('/api/profile/setup', {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: {
        username: username.value.trim()
      }
    })

    await auth.refreshViewer()
    await navigateTo(nextPath.value, { replace: true })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存作者 ID 失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="page-shell">
    <div class="auth-panel panel panel--page">
      <span class="eyebrow">Author ID</span>
      <h1 class="page-title">给自己定一个会出现在地图上的作者 ID。</h1>
      <p class="lede">
        这个 ID 会显示在每张公开照片的详情里。建议用 3-24 位字母、数字、下划线或短横线。
      </p>

      <label class="field-label">
        <span>作者 ID</span>
        <input
          v-model="username"
          class="field-input"
          maxlength="24"
          placeholder="marisa_fumo_trip"
          @keyup.enter="submitUsername"
        >
      </label>

      <p class="field-hint">
        示例：`reimu_tabi`、`fumo-map-01`、`alice_photo`
      </p>

      <div class="inline-actions">
        <button class="button" type="button" :disabled="saving" @click="submitUsername">
          {{ saving ? '保存中…' : '完成设置' }}
        </button>
      </div>

      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
    </div>
  </main>
</template>
