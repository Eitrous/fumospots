<script setup lang="ts">
import type { AdminReviewPost } from '~~/shared/fumo'

definePageMeta({
  layout: 'admin',
  middleware: ['require-auth', 'require-admin']
})

const auth = useAuthState()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters({ locale: 'zh-CN' })
const { invalidatePostDetail } = usePostDetailCache()
const { invalidateUserPage } = useUserPageCache()

const posts = ref<AdminReviewPost[]>([])
const selectedKey = ref<string | null>(null)
const selectedPhotoIndex = ref(0)
const reviewNote = ref('')
const loading = ref(true)
const submitting = ref(false)
const feedbackMessage = ref('')
const errorMessage = ref('')

const selectedPost = computed(() => {
  return posts.value.find((post) => post.reviewKey === selectedKey.value) || null
})

const selectedReviewPhotos = computed(() => {
  if (!selectedPost.value) {
    return []
  }

  if (selectedPost.value.photos.length) {
    return selectedPost.value.photos
  }

  return selectedPost.value.imageUrl
    ? [{
        imageUrl: selectedPost.value.imageUrl,
        thumbUrl: selectedPost.value.thumbUrl
      }]
    : []
})

const selectedReviewPhoto = computed(() => {
  return selectedReviewPhotos.value[selectedPhotoIndex.value] || selectedReviewPhotos.value[0] || null
})

const selectedReviewTypeLabel = computed(() => {
  return selectedPost.value?.reviewKind === 'revision' ? '修改审核' : '新投稿'
})

watch(selectedPost, (post) => {
  reviewNote.value = post?.reviewNote || ''
  selectedPhotoIndex.value = 0
}, { immediate: true })

const selectPhoto = (index: number) => {
  selectedPhotoIndex.value = index
}

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
    selectedKey.value = posts.value[0]?.reviewKey ?? null
    feedbackMessage.value = ''
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '待审核列表加载失败。'
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
  const affectedPostId = selectedPost.value.id
  const affectedUsername = selectedPost.value.author.username
  const handledKey = selectedPost.value.reviewKey

  try {
    const endpoint = selectedPost.value.reviewKind === 'revision'
      ? `/api/admin/revisions/${selectedPost.value.revisionId}/${action}`
      : `/api/admin/posts/${selectedPost.value.id}/${action}`

    await $fetch(endpoint, {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: {
        reviewNote: reviewNote.value
      }
    })

    invalidatePostDetail(affectedPostId)
    invalidateUserPage(affectedUsername)
    posts.value = posts.value.filter((post) => post.reviewKey !== handledKey)
    selectedKey.value = posts.value[0]?.reviewKey ?? null
    feedbackMessage.value = action === 'approve'
      ? '已通过，公开内容会按当前审核项更新。'
      : '已驳回，公开内容不会被修改。'
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '审核操作失败。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="panel panel--page">
      <span class="eyebrow">Admin Review</span>
      <h1 class="page-title">审核待发布内容</h1>
      <p class="lede">左侧选择项目，右侧查看原图、位置、作者和备注。</p>
    </section>

    <section class="review-layout">
      <aside class="panel panel--page review-list">
        <template v-if="loading">
          <span class="status-inline">正在加载待审核内容</span>
        </template>

        <template v-else-if="posts.length">
          <button
            v-for="post in posts"
            :key="post.reviewKey"
            :class="{ 'is-active': selectedKey === post.reviewKey }"
            type="button"
            @click="selectedKey = post.reviewKey"
          >
            <strong>{{ post.title }}</strong>
            <p>@{{ post.author.username }}</p>
            <p>{{ post.reviewKind === 'revision' ? '修改审核' : '新投稿' }}</p>
            <p>{{ post.placeName || '未填写地点' }}</p>
            <p>{{ formatDateTime(post.createdAt) }}</p>
          </button>
        </template>

        <div v-else class="empty-state">
          <h2>现在没有待审核内容</h2>
          <p>新投稿或作品修改进入队列后会出现在这里。</p>
        </div>
      </aside>

      <section class="panel panel--page review-detail">
        <template v-if="selectedPost">
          <div v-if="selectedReviewPhoto?.imageUrl" class="review-detail__hero">
            <img :src="selectedReviewPhoto.imageUrl" :alt="selectedPost.title">
          </div>

          <div v-if="selectedReviewPhotos.length > 1" class="photo-strip photo-strip--review" aria-label="Review photos">
            <button
              v-for="(photo, index) in selectedReviewPhotos"
              :key="`${selectedPost.reviewKey}-${index}`"
              class="photo-strip__button"
              :class="{ 'is-active': selectedPhotoIndex === index }"
              type="button"
              :aria-label="`查看第 ${index + 1} 张照片`"
              @click="selectPhoto(index)"
            >
              <img v-if="photo.thumbUrl || photo.imageUrl" :src="photo.thumbUrl || photo.imageUrl || ''" :alt="selectedPost.title">
              <i v-else class="fa-solid fa-image" aria-hidden="true" />
            </button>
          </div>

          <span class="eyebrow">{{ selectedReviewTypeLabel }} #{{ selectedPost.id }}</span>
          <h2>{{ selectedPost.title }}</h2>
          <div class="detail-meta">
            <span class="status-inline">@{{ selectedPost.author.username }}</span>
            <span class="status-inline">{{ selectedPost.placeName || '未命名地点' }}</span>
            <span class="status-inline">{{ privacyModeLabel(selectedPost.privacyMode) }}</span>
          </div>

          <p class="support-copy">{{ selectedPost.body || '作者没有留下额外留言。' }}</p>

          <div class="field-grid field-grid--two">
            <div class="review-info-block">
              <strong>坐标</strong>
              <p class="support-copy">精确位置：{{ formatLatLng(selectedPost.exactLocation) }}</p>
              <p class="support-copy">公开位置：{{ formatLatLng(selectedPost.publicLocation) }}</p>
              <p class="support-copy">拍摄时间：{{ formatDateTime(selectedPost.capturedAt) }}</p>
            </div>

            <div class="review-info-block">
              <strong>位置预览</strong>
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
              placeholder="写给作者或管理员内部查看的备注"
            />
          </label>

          <div class="inline-actions">
            <button
              class="workbench-icon-button workbench-icon-button--primary"
              type="button"
              :disabled="submitting"
              title="通过"
              aria-label="通过"
              @click="submitReview('approve')"
            >
              <i class="button-icon fa-solid" :class="submitting ? 'fa-spinner fa-spin' : 'fa-check'" aria-hidden="true" />
              <span class="sr-only">通过</span>
            </button>
            <button
              class="workbench-icon-button workbench-icon-button--danger"
              type="button"
              :disabled="submitting"
              title="驳回"
              aria-label="驳回"
              @click="submitReview('reject')"
            >
              <i class="button-icon fa-solid fa-xmark" aria-hidden="true" />
              <span class="sr-only">驳回</span>
            </button>
          </div>
        </template>

        <div v-else class="empty-state">
          <h2>从左侧选择一条内容</h2>
          <p>通过后进入公开地图；驳回则保留在后台记录。</p>
        </div>

        <p v-if="feedbackMessage" class="success-banner">{{ feedbackMessage }}</p>
        <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
      </section>
    </section>
  </main>
</template>
