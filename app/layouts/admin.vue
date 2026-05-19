<script setup lang="ts">
const route = useRoute()
const auth = useAuthState()

const loginTarget = computed(() => {
  return route.fullPath && route.fullPath !== '/'
    ? route.fullPath
    : '/admin/review'
})

const handleSignOut = async () => {
  await auth.signOut()
  await navigateTo('/')
}
</script>

<template>
  <div class="admin-root">
    <NuxtLoadingIndicator color="#111111" :height="2" />

    <header class="admin-header">
      <NuxtLink class="admin-brand" to="/admin/review">
        Fumo Admin
      </NuxtLink>

      <nav class="admin-nav" aria-label="管理员后台导航">
        <NuxtLink class="admin-nav__link" to="/admin/review">审核台</NuxtLink>
        <NuxtLink class="admin-nav__link" to="/admin/suggestions">建议箱</NuxtLink>
        <NuxtLink class="admin-nav__link" to="/">公开地图</NuxtLink>
      </nav>

      <div class="admin-actions">
        <template v-if="auth.ready.value && auth.viewer.value">
          <span class="admin-user">@{{ auth.viewer.value.profile.username || '未设置作者 ID' }}</span>
          <NuxtLink
            v-if="!auth.hasUsername.value"
            class="admin-text-button"
            :to="{ path: '/', query: { panel: 'onboarding' } }"
          >
            设置作者 ID
          </NuxtLink>
          <button class="admin-text-button" type="button" @click="handleSignOut">
            退出
          </button>
        </template>

        <NuxtLink
          v-else-if="auth.ready.value"
          class="admin-text-button"
          :to="{ path: '/', query: { panel: 'login', next: loginTarget } }"
        >
          登录
        </NuxtLink>

        <span v-else class="admin-user">同步登录状态</span>
      </div>
    </header>

    <slot />
  </div>
</template>
