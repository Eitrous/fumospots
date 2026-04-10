<script setup lang="ts">
import type { AdminReviewPost } from '~~/shared/fumo'

definePageMeta({
  middleware: ['require-auth', 'require-admin']
})

const auth = useAuthState()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters()

const posts = ref<AdminReviewPost[]>([])
const selectedId = ref<number | null>(null)
const reviewNote = ref('')
const loading = ref(true)
const submitting = ref(false)
const feedbackMessage = ref('')
const errorMessage = ref('')

const selectedPost = computed(() => {
  return posts.value.find((post) => post.id === selectedId.value) || null
})

watch(selectedPost, (post) => {
  reviewNote.value = post?.reviewNote || ''
}, { immediate: true })

const loadPosts = async () => {
  if (!auth.authHeaders.value.Authorization) {
    return
  }

  loading.value = true

  try {
    posts.value = await $fetch<AdminReviewPost[]>('/api/admin/posts', {
      headers: auth.authHeaders.value,
      query: { status: 'pending' }
    })
    selectedId.value = posts.value[0]?.id ?? null
    feedbackMessage.value = ''
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '待审核列表加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [auth.ready.value, auth.isAdmin.value],
  ([ready, isAdmin]) => {
    if (ready && isAdmin) {
      void loadPosts()
    }
  },
  { immediate: true }
)

const submitReview = async (action: 'approve' | 'reject') => {
  if (!selectedPost.value) {
    return
  }

  submitting.value = true

  try {
    await $fetch(`/api/admin/posts/${selectedPost.value.id}/${action}`, {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: {
        reviewNote: reviewNote.value
      }
    })

    const handledId = selectedPost.value.id
    posts.value = posts.value.filter((post) => post.id !== handledId)
    selectedId.value = posts.value[0]?.id ?? null
    feedbackMessage.value = action === 'approve'
      ? '这条投稿已经通过审核并发布到地图。'
      : '这条投稿已经驳回。'
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '审核操作失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="panel panel--page">
      <span class="eyebrow">Admin Review</span>
      <h1 class="page-title">审核待发布的旅途照片。</h1>
      <p class="lede">左侧挑选待审核投稿，右侧查看原图、精确/公开位置和作者留言，再决定是否发布到公开地图。</p>
    </section>

    <section class="review-layout">
      <aside class="panel panel--page review-list">
        <template v-if="loading">
          <span class="status-inline">正在加载待审核投稿…</span>
        </template>

        <template v-else-if="posts.length">
          <button
            v-for="post in posts"
            :key="post.id"
            :class="{ 'is-active': selectedId === post.id }"
            type="button"
            @click="selectedId = post.id"
          >
            <strong>{{ post.title }}</strong>
            <p>@{{ post.author.username }}</p>
            <p>{{ post.placeName || '未填写地点' }}</p>
            <p>{{ formatDateTime(post.createdAt) }}</p>
          </button>
        </template>

        <div v-else class="empty-state">
          <h2>现在没有待审核内容</h2>
          <p>等新的投稿进入待审核队列后，这里会自动成为你的工作台。</p>
        </div>
      </aside>

      <section class="panel panel--page review-detail">
        <template v-if="selectedPost">
          <div v-if="selectedPost.imageUrl" class="review-detail__hero">
            <img :src="selectedPost.imageUrl" :alt="selectedPost.title">
          </div>

          <span class="eyebrow">Reviewing #{{ selectedPost.id }}</span>
          <h2>{{ selectedPost.title }}</h2>
          <div class="detail-meta">
            <span class="status-inline">@{{ selectedPost.author.username }}</span>
            <span class="status-inline">{{ selectedPost.placeName || '未命名地点' }}</span>
            <span class="status-inline">{{ privacyModeLabel(selectedPost.privacyMode) }}</span>
          </div>

          <p class="support-copy">{{ selectedPost.body || '作者没有留下额外留言。' }}</p>

          <div class="field-grid field-grid--two">
            <div class="panel panel--page">
              <strong>坐标对照</strong>
              <p class="support-copy">精确位置：{{ formatLatLng(selectedPost.exactLocation) }}</p>
              <p class="support-copy">公开位置：{{ formatLatLng(selectedPost.publicLocation) }}</p>
              <p class="support-copy">拍摄时间：{{ formatDateTime(selectedPost.capturedAt) }}</p>
            </div>

            <div class="panel panel--page">
              <strong>公开地图预览</strong>
              <LocationPreviewMap
                :exact-location="selectedPost.exactLocation"
                :public-location="selectedPost.publicLocation"
                :show-exact="true"
                :compact="true"
              />
            </div>
          </div>

          <label class="field-label">
            <span>审核备注</span>
            <textarea
              v-model="reviewNote"
              class="field-textarea"
              placeholder="可以写给作者的备注，或管理员内部说明。"
            />
          </label>

          <div class="inline-actions">
            <button class="button button--secondary" type="button" :disabled="submitting" @click="submitReview('approve')">
              {{ submitting ? '处理中…' : '通过并发布' }}
            </button>
            <button class="button button--danger" type="button" :disabled="submitting" @click="submitReview('reject')">
              驳回
            </button>
          </div>
        </template>

        <div v-else class="empty-state">
          <h2>从左侧选择一条投稿</h2>
          <p>通过后它会立即进入公开地图；驳回则保留在后台，不会泄露到前台。</p>
        </div>

        <p v-if="feedbackMessage" class="success-banner">{{ feedbackMessage }}</p>
        <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
      </section>
    </section>
  </main>
</template>
