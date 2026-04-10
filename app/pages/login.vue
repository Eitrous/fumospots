<script setup lang="ts">
const route = useRoute()
const auth = useAuthState()

const email = ref('')
const sending = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const nextPath = computed(() => {
  return typeof route.query.next === 'string' ? route.query.next : '/submit'
})

const redirectAfterLogin = async () => {
  if (!auth.ready.value || !auth.user.value) {
    return
  }

  if (!auth.hasUsername.value) {
    await navigateTo({
      path: '/onboarding',
      query: { next: nextPath.value }
    }, { replace: true })
    return
  }

  await navigateTo(nextPath.value, { replace: true })
}

watch(
  () => [auth.ready.value, auth.user.value?.id, auth.hasUsername.value],
  () => {
    void redirectAfterLogin()
  },
  { immediate: true }
)

const sendMagicLink = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!email.value.trim()) {
    errorMessage.value = '请输入邮箱地址'
    return
  }

  sending.value = true

  try {
    await auth.sendMagicLink(email.value.trim(), nextPath.value)
    successMessage.value = '登录链接已经发送到你的邮箱，打开邮件里的链接即可回到站点。'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '发送登录链接失败'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <main class="page-shell">
    <div class="auth-panel panel panel--page">
      <span class="eyebrow">Magic Link Login</span>
      <h1 class="page-title">先登录，再让你的 Fumo 正式出发。</h1>
      <p class="lede">
        首次登录后我们会请你设置一个公开作者 ID。之后投稿、审核状态和你的照片都会围绕这个 ID 展示。
      </p>

      <label class="field-label">
        <span>邮箱地址</span>
        <input
          v-model="email"
          class="field-input"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          @keyup.enter="sendMagicLink"
        >
      </label>

      <div class="inline-actions">
        <button class="button" type="button" :disabled="sending" @click="sendMagicLink">
          {{ sending ? '发送中…' : '发送登录链接' }}
        </button>
        <NuxtLink class="text-button" to="/">先回地图看看</NuxtLink>
      </div>

      <p class="field-hint">
        邮件会跳转回当前站点。如果已经登录，会自动继续你刚才要前往的页面。
      </p>

      <p v-if="successMessage" class="success-banner">{{ successMessage }}</p>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
    </div>
  </main>
</template>
