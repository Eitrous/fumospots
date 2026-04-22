<script setup lang="ts">
import type { AdminLocationBackfillItem, AdminReviewPost } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

definePageMeta({
  layout: 'admin',
  middleware: ['require-admin']
})

type LocationBackfillStatsResponse = {
  totals: {
    eligiblePosts: number
  }
}

type LocationBackfillItemsResponse = {
  items: AdminLocationBackfillItem[]
  nextCursor: number | null
  hasMore: boolean
}

const LOCATION_BACKFILL_PAGE_SIZE = 50
const LOCATION_BACKFILL_TOP_UP_THRESHOLD = 10

const auth = useAuthState()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters({ locale: 'zh-CN' })
const { invalidatePostDetail } = usePostDetailCache()
const { invalidateUserPage } = useUserPageCache()
const { invalidateRegionPages } = useRegionPageCache()

const posts = ref<AdminReviewPost[]>([])
const selectedKey = ref<string | null>(null)
const selectedPhotoIndex = ref(0)
const reviewNote = ref('')
const loading = ref(true)
const submitting = ref(false)
const feedbackMessage = ref('')
const errorMessage = ref('')

const locationBackfillStats = ref<LocationBackfillStatsResponse | null>(null)
const locationBackfillStatsLoading = ref(false)
const locationBackfillItems = ref<AdminLocationBackfillItem[]>([])
const locationBackfillLoading = ref(false)
const locationBackfillLoadingMore = ref(false)
const locationBackfillSaving = ref(false)
const locationBackfillErrorMessage = ref('')
const locationBackfillFeedbackMessage = ref('')
const locationBackfillNextCursor = ref<number | null>(null)
const locationBackfillHasMore = ref(false)
const selectedBackfillId = ref<number | null>(null)
const selectedBackfillPhotoIndex = ref(0)
const backfillCountryName = ref('')
const backfillRegionName = ref('')
const backfillCityName = ref('')

const getAuthHeadersOrThrow = () => {
  const headers = auth.authHeaders.value
  if (!headers.Authorization) {
    throw new Error('缺少登录令牌，请重新登录管理员账号。')
  }

  return headers
}

const formatScopeLabel = (
  countryName: string | null | undefined,
  regionName: string | null | undefined,
  cityName: string | null | undefined
) => {
  const parts = [countryName, regionName, cityName]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(' / ') : '未填写地区字段'
}

const selectedPost = computed(() => {
  return posts.value.find(post => post.reviewKey === selectedKey.value) || null
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

const selectedBackfillItem = computed(() => {
  return locationBackfillItems.value.find(item => item.id === selectedBackfillId.value) || null
})

const selectedBackfillPhotos = computed(() => {
  if (!selectedBackfillItem.value) {
    return []
  }

  if (selectedBackfillItem.value.photos.length) {
    return selectedBackfillItem.value.photos
  }

  return selectedBackfillItem.value.imageUrl
    ? [{
        imageUrl: selectedBackfillItem.value.imageUrl,
        thumbUrl: selectedBackfillItem.value.thumbUrl
      }]
    : []
})

const selectedBackfillPhoto = computed(() => {
  return selectedBackfillPhotos.value[selectedBackfillPhotoIndex.value] || selectedBackfillPhotos.value[0] || null
})

const backfillSaveDisabled = computed(() => {
  return locationBackfillSaving.value
    || !selectedBackfillItem.value
    || !backfillRegionName.value.trim()
})

watch(selectedPost, (post) => {
  reviewNote.value = post?.reviewNote || ''
  selectedPhotoIndex.value = 0
}, { immediate: true })

watch(selectedBackfillItem, (item) => {
  selectedBackfillPhotoIndex.value = 0
  backfillCountryName.value = item?.countryName || ''
  backfillRegionName.value = item?.regionName || ''
  backfillCityName.value = item?.cityName || ''
}, { immediate: true })

const selectPhoto = (index: number) => {
  selectedPhotoIndex.value = index
}

const selectBackfillPhoto = (index: number) => {
  selectedBackfillPhotoIndex.value = index
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
    errorMessage.value = normalizeApiErrorMessage(error, '待审核列表加载失败。')
  } finally {
    loading.value = false
  }
}

const loadLocationBackfillStats = async (options: { preserveErrorMessage?: boolean } = {}) => {
  if (!auth.authHeaders.value.Authorization) {
    return
  }

  locationBackfillStatsLoading.value = true

  try {
    locationBackfillStats.value = await $fetch<LocationBackfillStatsResponse>('/api/admin/location-backfill/stats', {
      headers: getAuthHeadersOrThrow()
    })

    if (!options.preserveErrorMessage) {
      locationBackfillErrorMessage.value = ''
    }
  } catch (error) {
    locationBackfillErrorMessage.value = normalizeApiErrorMessage(error, '地区字段队列统计加载失败。')
  } finally {
    locationBackfillStatsLoading.value = false
  }
}

const loadLocationBackfillItems = async (options: {
  append?: boolean
  preserveErrorMessage?: boolean
} = {}) => {
  if (!auth.authHeaders.value.Authorization) {
    return
  }

  const append = options.append === true

  if (append) {
    if (locationBackfillLoadingMore.value || !locationBackfillHasMore.value) {
      return
    }

    locationBackfillLoadingMore.value = true
  } else {
    if (locationBackfillLoading.value) {
      return
    }

    locationBackfillLoading.value = true
  }

  try {
    const response = await $fetch<LocationBackfillItemsResponse>('/api/admin/location-backfill/items', {
      headers: getAuthHeadersOrThrow(),
      query: {
        limit: LOCATION_BACKFILL_PAGE_SIZE,
        afterId: append ? locationBackfillNextCursor.value ?? undefined : undefined
      }
    })

    const mergedItems = append
      ? [...locationBackfillItems.value, ...response.items.filter(item => !locationBackfillItems.value.some(existing => existing.id === item.id))]
      : response.items

    locationBackfillItems.value = mergedItems
    locationBackfillNextCursor.value = response.nextCursor
    locationBackfillHasMore.value = response.hasMore

    if (!selectedBackfillId.value || !mergedItems.some(item => item.id === selectedBackfillId.value)) {
      selectedBackfillId.value = mergedItems[0]?.id ?? null
    }

    if (!options.preserveErrorMessage) {
      locationBackfillErrorMessage.value = ''
    }
  } catch (error) {
    locationBackfillErrorMessage.value = normalizeApiErrorMessage(error, '地区字段队列加载失败。')
  } finally {
    if (append) {
      locationBackfillLoadingMore.value = false
    } else {
      locationBackfillLoading.value = false
    }
  }
}

const refreshLocationBackfillQueue = async () => {
  locationBackfillFeedbackMessage.value = ''
  await Promise.all([
    loadLocationBackfillStats(),
    loadLocationBackfillItems()
  ])
}

const removeLocationBackfillItem = (id: number) => {
  const index = locationBackfillItems.value.findIndex(item => item.id === id)
  if (index < 0) {
    return
  }

  const nextItems = locationBackfillItems.value.filter(item => item.id !== id)
  const nextSelectedId = nextItems[index]?.id ?? nextItems[index - 1]?.id ?? null

  locationBackfillItems.value = nextItems
  if (selectedBackfillId.value === id) {
    selectedBackfillId.value = nextSelectedId
  }
}

const maybeTopUpLocationBackfillItems = async () => {
  if (locationBackfillItems.value.length >= LOCATION_BACKFILL_TOP_UP_THRESHOLD || !locationBackfillHasMore.value) {
    return
  }

  await loadLocationBackfillItems({ append: true, preserveErrorMessage: true })
}

const saveLocationBackfill = async () => {
  if (!selectedBackfillItem.value || backfillSaveDisabled.value) {
    return
  }

  locationBackfillSaving.value = true
  locationBackfillFeedbackMessage.value = ''
  locationBackfillErrorMessage.value = ''

  const item = selectedBackfillItem.value

  try {
    await $fetch(`/api/admin/location-backfill/${item.id}`, {
      method: 'POST',
      headers: getAuthHeadersOrThrow(),
      body: {
        countryName: backfillCountryName.value,
        regionName: backfillRegionName.value,
        cityName: backfillCityName.value
      }
    })

    invalidatePostDetail(item.id)
    invalidateUserPage(item.author.username)
    invalidateRegionPages()
    removeLocationBackfillItem(item.id)

    if (locationBackfillStats.value) {
      locationBackfillStats.value = {
        totals: {
          eligiblePosts: Math.max(0, locationBackfillStats.value.totals.eligiblePosts - 1)
        }
      }
    }

    locationBackfillFeedbackMessage.value = '地区字段已保存。'
    await maybeTopUpLocationBackfillItems()
  } catch (error) {
    locationBackfillErrorMessage.value = normalizeApiErrorMessage(error, '地区字段保存失败。')
  } finally {
    locationBackfillSaving.value = false
  }
}

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
    invalidateRegionPages()
    posts.value = posts.value.filter(post => post.reviewKey !== handledKey)
    selectedKey.value = posts.value[0]?.reviewKey ?? null
    feedbackMessage.value = action === 'approve'
      ? '已通过，公开内容会按当前审核项更新。'
      : '已驳回，公开内容不会被修改。'
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, '审核操作失败。')
  } finally {
    submitting.value = false
  }
}

watch(
  () => [auth.ready.value, auth.isAdmin.value],
  ([ready, isAdmin]) => {
    if (ready && isAdmin) {
      void loadPosts()
      void loadLocationBackfillStats()
      void loadLocationBackfillItems()
    }
  },
  { immediate: true }
)
</script>

<template>
  <main class="page-shell">
    <section class="panel panel--page">
      <span class="eyebrow">Admin Review</span>
      <h1 class="page-title">审核待发布内容</h1>
      <p class="lede">左侧选择项目，右侧查看原图、位置、作者和备注。</p>
    </section>

    <section class="panel panel--page admin-migration-tool">
      <div class="admin-migration-tool__head">
        <div class="admin-migration-tool__copy">
          <span class="eyebrow">Maintenance</span>
          <h2 class="admin-migration-tool__title">手动地区回填</h2>
          <p class="support-copy">这里只显示已发布且从未产生过修改记录的原稿，管理员逐条补全地区字段。</p>
        </div>

        <div class="inline-actions">
          <button
            class="workbench-icon-button"
            type="button"
            :disabled="locationBackfillStatsLoading || locationBackfillLoading || locationBackfillSaving"
            title="刷新地区回填队列"
            aria-label="刷新地区回填队列"
            @click="refreshLocationBackfillQueue"
          >
            <i
              class="button-icon fa-solid"
              :class="locationBackfillStatsLoading || locationBackfillLoading ? 'fa-spinner fa-spin' : 'fa-rotate-right'"
              aria-hidden="true"
            />
            <span class="sr-only">刷新地区回填队列</span>
          </button>

          <button
            class="workbench-icon-button workbench-icon-button--primary"
            type="button"
            :disabled="backfillSaveDisabled"
            title="保存地区字段"
            aria-label="保存地区字段"
            @click="saveLocationBackfill"
          >
            <i
              class="button-icon fa-solid"
              :class="locationBackfillSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"
              aria-hidden="true"
            />
            <span class="sr-only">保存地区字段</span>
          </button>
        </div>
      </div>

      <div class="admin-migration-tool__stats" aria-live="polite">
        <p>
          <span>剩余候选</span>
          <strong>{{ locationBackfillStatsLoading ? '...' : (locationBackfillStats?.totals.eligiblePosts ?? '-') }}</strong>
        </p>
        <p>
          <span>当前已载入</span>
          <strong>{{ locationBackfillLoading ? '...' : locationBackfillItems.length }}</strong>
        </p>
        <p>
          <span>后续批次</span>
          <strong>{{ locationBackfillHasMore ? '可继续加载' : '已到底' }}</strong>
        </p>
      </div>

      <section class="review-layout review-layout--backfill">
        <aside class="panel panel--page review-list backfill-list">
          <template v-if="locationBackfillLoading">
            <span class="status-inline">正在加载地区回填队列...</span>
          </template>

          <template v-else-if="locationBackfillItems.length">
            <button
              v-for="item in locationBackfillItems"
              :key="item.id"
              :class="{ 'is-active': selectedBackfillId === item.id }"
              type="button"
              @click="selectedBackfillId = item.id"
            >
              <strong>{{ item.title }}</strong>
              <p>@{{ item.author.username }}</p>
              <p>{{ item.placeName || '未填写地点名称' }}</p>
              <p>{{ formatScopeLabel(item.countryName, item.regionName, item.cityName) }}</p>
              <p>{{ formatDateTime(item.createdAt) }}</p>
            </button>
          </template>

          <div v-else class="empty-state">
            <h2>当前没有待回填条目</h2>
            <p>已发布且未修改的原稿处理完之后，这里会保持为空。</p>
          </div>
        </aside>

        <section class="panel panel--page review-detail backfill-detail">
          <template v-if="selectedBackfillItem">
            <div v-if="selectedBackfillPhoto?.imageUrl" class="review-detail__hero">
              <img :src="selectedBackfillPhoto.imageUrl" :alt="selectedBackfillItem.title">
            </div>

            <div
              v-if="selectedBackfillPhotos.length > 1"
              class="photo-strip photo-strip--review"
              aria-label="Backfill photos"
            >
              <button
                v-for="(photo, index) in selectedBackfillPhotos"
                :key="`${selectedBackfillItem.id}-${index}`"
                class="photo-strip__button"
                :class="{ 'is-active': selectedBackfillPhotoIndex === index }"
                type="button"
                :aria-label="`查看第 ${index + 1} 张照片`"
                @click="selectBackfillPhoto(index)"
              >
                <img
                  v-if="photo.thumbUrl || photo.imageUrl"
                  :src="photo.thumbUrl || photo.imageUrl || ''"
                  :alt="selectedBackfillItem.title"
                >
                <i v-else class="fa-solid fa-image" aria-hidden="true" />
              </button>
            </div>

            <span class="eyebrow">Location Backfill #{{ selectedBackfillItem.id }}</span>
            <h2>{{ selectedBackfillItem.title }}</h2>
            <div class="detail-meta">
              <span class="status-inline">@{{ selectedBackfillItem.author.username }}</span>
              <span class="status-inline">{{ selectedBackfillItem.placeName || '未命名地点' }}</span>
              <span class="status-inline">{{ privacyModeLabel(selectedBackfillItem.privacyMode) }}</span>
            </div>

            <p class="support-copy">{{ selectedBackfillItem.body || '作者没有留下额外文字。' }}</p>

            <div class="field-grid field-grid--two">
              <div class="review-info-block">
                <strong>坐标与时间</strong>
                <p class="support-copy">精确位置：{{ formatLatLng(selectedBackfillItem.exactLocation) }}</p>
                <p class="support-copy">公开位置：{{ formatLatLng(selectedBackfillItem.publicLocation) }}</p>
                <p class="support-copy">拍摄时间：{{ formatDateTime(selectedBackfillItem.capturedAt) }}</p>
                <p class="support-copy">提交时间：{{ formatDateTime(selectedBackfillItem.createdAt) }}</p>
              </div>

              <div class="review-info-block">
                <strong>位置预览</strong>
                <LocationPreviewMap
                  :exact-location="selectedBackfillItem.exactLocation"
                  :public-location="selectedBackfillItem.publicLocation"
                  :show-exact="true"
                  :compact="true"
                />
              </div>
            </div>

            <div class="field-grid field-grid--two">
              <label class="field-label">
                <span>国家</span>
                <input
                  v-model="backfillCountryName"
                  class="field-input"
                  type="text"
                  placeholder="可留空"
                >
              </label>

              <label class="field-label">
                <span>地区</span>
                <input
                  v-model="backfillRegionName"
                  class="field-input"
                  type="text"
                  placeholder="必填"
                >
              </label>
            </div>

            <label class="field-label">
              <span>城市 / 区县</span>
              <input
                v-model="backfillCityName"
                class="field-input"
                type="text"
                placeholder="可留空"
              >
            </label>

            <p class="support-copy backfill-detail__hint">
              保存时会把空字符串写成空值，只更新当前原稿的 `country / region / city`。
            </p>
          </template>

          <div v-else class="empty-state">
            <h2>从左侧选择一条原稿</h2>
            <p>保存后当前条目会从队列移除，并自动切到下一条。</p>
          </div>

          <p v-if="locationBackfillLoadingMore" class="status-inline">正在加载更多候选...</p>
          <p v-if="locationBackfillFeedbackMessage" class="success-banner">{{ locationBackfillFeedbackMessage }}</p>
          <p v-if="locationBackfillErrorMessage" class="error-banner">{{ locationBackfillErrorMessage }}</p>
        </section>
      </section>
    </section>

    <section class="review-layout">
      <aside class="panel panel--page review-list">
        <template v-if="loading">
          <span class="status-inline">正在加载待审核内容...</span>
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

          <p class="support-copy">{{ selectedPost.body || '作者没有留下额外备注。' }}</p>

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

<style scoped>
.review-layout--backfill {
  min-height: auto;
}

.backfill-list {
  min-height: 24rem;
}

.backfill-detail {
  min-height: 24rem;
}

.backfill-detail__hint {
  margin: 0;
  padding-top: 0.9rem;
  border-top: 1px solid rgba(29, 23, 18, 0.08);
}

html[data-theme="dark"] .backfill-detail__hint {
  border-color: var(--border);
}
</style>
