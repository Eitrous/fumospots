<script setup lang="ts">
const route = useRoute()
const auth = useAuthState()

const isSolid = computed(() => route.path !== '/')

const loginTarget = computed(() => {
  return route.fullPath && route.fullPath !== '/login'
    ? route.fullPath
    : '/submit'
})

const handleSignOut = async () => {
  await auth.signOut()
  await navigateTo('/')
}
</script>

<template>
  <header class="site-header" :class="{ 'site-header--solid': isSolid }">
    <NuxtLink class="brand-lockup" to="/">
      <span class="brand-mark">F</span>
      <span class="brand-text">
        <span class="brand-name">Fumo Travel Map</span>
        <span class="brand-tagline">把旅途钉在世界地图上的东方 Project 相册</span>
      </span>
    </NuxtLink>

    <nav class="site-nav" aria-label="主导航">
      <NuxtLink class="site-nav__link" to="/">地图</NuxtLink>
      <NuxtLink class="site-nav__link" to="/submit">投稿</NuxtLink>
      <NuxtLink v-if="auth.isAdmin.value" class="site-nav__link" to="/admin/review">
        审核台
      </NuxtLink>
    </nav>

    <div class="site-actions">
      <template v-if="auth.ready.value && auth.viewer.value">
        <span class="author-pill">@{{ auth.viewer.value.profile.username || '未命名作者' }}</span>
        <NuxtLink
          v-if="!auth.hasUsername.value"
          class="ghost-button"
          to="/onboarding"
        >
          完成作者 ID
        </NuxtLink>
        <button class="ghost-button" type="button" @click="handleSignOut">
          退出
        </button>
      </template>

      <NuxtLink
        v-else-if="auth.ready.value"
        class="ghost-button"
        :to="{ path: '/login', query: { next: loginTarget } }"
      >
        登录
      </NuxtLink>

      <span v-else class="status-inline">正在同步登录状态</span>
    </div>
  </header>
</template>
