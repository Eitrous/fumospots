<script setup lang="ts">
import type { AdminCharacterBackfillItem, AdminReviewPost } from '~~/shared/fumo'
import { getCharacterDisplayName } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

definePageMeta({
  layout: 'admin',
  middleware: ['require-admin']
})

type CharacterBackfillStatsResponse = {
  totals: {
    eligiblePosts: number
  }
}

type CharacterBackfillItemsResponse = {
  items: AdminCharacterBackfillItem[]
  nextCursor: number | null
  hasMore: boolean
}

const CHARACTER_BACKFILL_PAGE_SIZE = 50
const CHARACTER_BACKFILL_TOP_UP_THRESHOLD = 10

const auth = useAuthState()
const { formatDateTime, formatLatLng, privacyModeLabel } = useFormatters({ locale: 'zh-CN' })
const { invalidatePostDetail } = usePostDetailCache()
const { invalidateUserPage } = useUserPageCache()
const { invalidateRegionPages } = useRegionPageCache()
const {
  characters,
  loading: charactersLoading,
  error: charactersError,
  loadCharacters
} = useCharacterCatalog()

const posts = ref<AdminReviewPost[]>([])
const selectedKey = ref<string | null>(null)
const selectedPhotoIndex = ref(0)
const reviewNote = ref('')
const loading = ref(true)
const submitting = ref(false)
const feedbackMessage = ref('')
const errorMessage = useErrorNoticeState()

const characterBackfillStats = ref<CharacterBackfillStatsResponse | null>(null)
const characterBackfillStatsLoading = ref(false)
const characterBackfillItems = ref<AdminCharacterBackfillItem[]>([])
const characterBackfillLoading = ref(false)
const characterBackfillLoadingMore = ref(false)
const characterBackfillSaving = ref(false)
const characterBackfillErrorMessage = useErrorNoticeState()
const characterBackfillFeedbackMessage = ref('')
const characterBackfillNextCursor = ref<number | null>(null)
const characterBackfillHasMore = ref(false)
const selectedBackfillId = ref<number | null>(null)
const selectedBackfillPhotoIndex = ref(0)
const backfillCharacterIds = ref<number[]>([])

const getAuthHeadersOrThrow = () => {
  const headers = auth.authHeaders.value
  if (!headers.Authorization) {
    throw new Error('缺少登录令牌，请重新登录管理员账号。')
  }

  return headers
}

const characterName = (character: AdminReviewPost['characters'][number]) => {
  return getCharacterDisplayName(character, 'zh-CN')
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
  return characterBackfillItems.value.find(item => item.id === selectedBackfillId.value) || null
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
  return characterBackfillSaving.value
    || charactersLoading.value
    || !selectedBackfillItem.value
    || !backfillCharacterIds.value.length
})

watch(selectedPost, (post) => {
  reviewNote.value = post?.reviewNote || ''
  selectedPhotoIndex.value = 0
}, { immediate: true })

watch(selectedBackfillItem, () => {
  selectedBackfillPhotoIndex.value = 0
  backfillCharacterIds.value = []
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

const loadCharacterBackfillStats = async (options: { preserveErrorMessage?: boolean } = {}) => {
  if (!auth.authHeaders.value.Authorization) {
    return
  }

  characterBackfillStatsLoading.value = true

  try {
    characterBackfillStats.value = await $fetch<CharacterBackfillStatsResponse>('/api/admin/character-backfill/stats', {
      headers: getAuthHeadersOrThrow()
    })

    if (!options.preserveErrorMessage) {
      characterBackfillErrorMessage.value = ''
    }
  } catch (error) {
    characterBackfillErrorMessage.value = normalizeApiErrorMessage(error, '角色回填队列统计加载失败。')
  } finally {
    characterBackfillStatsLoading.value = false
  }
}

const loadCharacterBackfillItems = async (options: {
  append?: boolean
  preserveErrorMessage?: boolean
} = {}) => {
  if (!auth.authHeaders.value.Authorization) {
    return
  }

  const append = options.append === true

  if (append) {
    if (characterBackfillLoadingMore.value || !characterBackfillHasMore.value) {
      return
    }
    characterBackfillLoadingMore.value = true
  } else {
    if (characterBackfillLoading.value) {
      return
    }
    characterBackfillLoading.value = true
  }

  try {
    const response = await $fetch<CharacterBackfillItemsResponse>('/api/admin/character-backfill/items', {
      headers: getAuthHeadersOrThrow(),
      query: {
        limit: CHARACTER_BACKFILL_PAGE_SIZE,
        afterId: append ? characterBackfillNextCursor.value ?? undefined : undefined
      }
    })

    const mergedItems = append
      ? [...characterBackfillItems.value, ...response.items.filter(item => !characterBackfillItems.value.some(existing => existing.id === item.id))]
      : response.items

    characterBackfillItems.value = mergedItems
    characterBackfillNextCursor.value = response.nextCursor
    characterBackfillHasMore.value = response.hasMore

    if (!selectedBackfillId.value || !mergedItems.some(item => item.id === selectedBackfillId.value)) {
      selectedBackfillId.value = mergedItems[0]?.id ?? null
    }

    if (!options.preserveErrorMessage) {
      characterBackfillErrorMessage.value = ''
    }
  } catch (error) {
    characterBackfillErrorMessage.value = normalizeApiErrorMessage(error, '角色回填队列加载失败。')
  } finally {
    if (append) {
      characterBackfillLoadingMore.value = false
    } else {
      characterBackfillLoading.value = false
    }
  }
}

const refreshCharacterBackfillQueue = async () => {
  characterBackfillFeedbackMessage.value = ''
  await Promise.all([
    loadCharacterBackfillStats(),
    loadCharacterBackfillItems(),
    loadCharacters(true)
  ])
}

const removeCharacterBackfillItem = (id: number) => {
  const index = characterBackfillItems.value.findIndex(item => item.id === id)
  if (index < 0) {
    return
  }

  const nextItems = characterBackfillItems.value.filter(item => item.id !== id)
  const nextSelectedId = nextItems[index]?.id ?? nextItems[index - 1]?.id ?? null
  characterBackfillItems.value = nextItems

  if (selectedBackfillId.value === id) {
    selectedBackfillId.value = nextSelectedId
  }
}

const maybeTopUpCharacterBackfillItems = async () => {
  if (characterBackfillItems.value.length >= CHARACTER_BACKFILL_TOP_UP_THRESHOLD || !characterBackfillHasMore.value) {
    return
  }

  await loadCharacterBackfillItems({ append: true, preserveErrorMessage: true })
}

const saveCharacterBackfill = async () => {
  if (!selectedBackfillItem.value || backfillSaveDisabled.value) {
    return
  }

  characterBackfillSaving.value = true
  characterBackfillFeedbackMessage.value = ''
  characterBackfillErrorMessage.value = ''
  const item = selectedBackfillItem.value

  try {
    await $fetch(`/api/admin/character-backfill/${item.id}`, {
      method: 'POST',
      headers: getAuthHeadersOrThrow(),
      body: {
        characterIds: backfillCharacterIds.value
      }
    })

    removeCharacterBackfillItem(item.id)

    if (characterBackfillStats.value) {
      characterBackfillStats.value = {
        totals: {
          eligiblePosts: Math.max(0, characterBackfillStats.value.totals.eligiblePosts - 1)
        }
      }
    }

    characterBackfillFeedbackMessage.value = '角色标签已保存。'
    await maybeTopUpCharacterBackfillItems()
  } catch (error) {
    characterBackfillErrorMessage.value = normalizeApiErrorMessage(error, '角色标签保存失败。')
  } finally {
    characterBackfillSaving.value = false
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
      void loadCharacterBackfillStats()
      void loadCharacterBackfillItems()
      void loadCharacters().catch(() => {
        // The maintenance panel exposes the catalog retry state.
      })
    }
  },
  { immediate: true }
)
</script>

<template>
  <main class="admin-shell admin-review-page">
    <section class="admin-page-head">
      <div>
        <h1 class="admin-page-title">审核台</h1>
        <p class="admin-page-kicker">
          {{ loading ? '待审核内容加载中' : `待审核 ${posts.length} 项` }}
        </p>
      </div>

      <button
        class="admin-icon-button"
        type="button"
        :disabled="loading || submitting"
        :title="loading ? '正在刷新' : '刷新待审核内容'"
        :aria-label="loading ? '正在刷新' : '刷新待审核内容'"
        @click="loadPosts"
      >
        <i
          class="button-icon fa-solid"
          :class="loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'"
          aria-hidden="true"
        />
        <span class="sr-only">刷新待审核内容</span>
      </button>
    </section>

    <section class="review-layout admin-main-review">
      <aside class="admin-panel review-list">
        <template v-if="loading">
          <span class="admin-status">正在加载待审核内容...</span>
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

      <section class="admin-panel review-detail admin-detail-panel">
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

          <span class="admin-overline">{{ selectedReviewTypeLabel }} #{{ selectedPost.id }}</span>
          <h2>{{ selectedPost.title }}</h2>
          <div class="detail-meta admin-meta-row">
            <span class="admin-meta-item">@{{ selectedPost.author.username }}</span>
            <span class="admin-meta-item">{{ selectedPost.placeName || '未命名地点' }}</span>
            <span class="admin-meta-item">{{ privacyModeLabel(selectedPost.privacyMode) }}</span>
          </div>

          <p class="admin-copy">{{ selectedPost.body || '作者没有留下额外备注。' }}</p>

          <div class="review-character-tags">
            <strong>角色标签</strong>
            <div v-if="selectedPost.characters.length" class="review-character-tags__list">
              <span v-for="character in selectedPost.characters" :key="character.id">
                {{ characterName(character) }}
              </span>
            </div>
            <p v-else class="admin-copy">当前审核项没有角色标签。</p>
          </div>

          <div class="field-grid field-grid--two">
            <div class="review-info-block">
              <strong>坐标</strong>
              <p class="admin-copy">精确位置：{{ formatLatLng(selectedPost.exactLocation) }}</p>
              <p class="admin-copy">公开位置：{{ formatLatLng(selectedPost.publicLocation) }}</p>
              <p class="admin-copy">拍摄时间：{{ formatDateTime(selectedPost.capturedAt) }}</p>
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

          <div class="inline-actions admin-action-row">
            <button
              class="admin-icon-button admin-icon-button--primary"
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
              class="admin-icon-button admin-icon-button--danger"
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
      </section>
    </section>

    <section class="admin-maintenance-section">
      <div class="admin-section-head">
        <div>
          <h2 class="admin-section-title">角色回填</h2>
          <p class="admin-page-kicker">为尚未标注角色的已发布投稿补充标签。</p>
        </div>

        <div class="inline-actions admin-action-row">
          <button
            class="admin-icon-button"
            type="button"
            :disabled="characterBackfillStatsLoading || characterBackfillLoading || characterBackfillSaving"
            title="刷新角色回填队列"
            aria-label="刷新角色回填队列"
            @click="refreshCharacterBackfillQueue"
          >
            <i
              class="button-icon fa-solid"
              :class="characterBackfillStatsLoading || characterBackfillLoading ? 'fa-spinner fa-spin' : 'fa-rotate-right'"
              aria-hidden="true"
            />
            <span class="sr-only">刷新角色回填队列</span>
          </button>

          <button
            class="admin-icon-button admin-icon-button--primary"
            type="button"
            :disabled="backfillSaveDisabled"
            title="保存角色标签"
            aria-label="保存角色标签"
            @click="saveCharacterBackfill"
          >
            <i
              class="button-icon fa-solid"
              :class="characterBackfillSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"
              aria-hidden="true"
            />
            <span class="sr-only">保存角色标签</span>
          </button>
        </div>
      </div>

      <p v-if="characterBackfillErrorMessage" class="error-banner">{{ characterBackfillErrorMessage }}</p>

      <div class="admin-migration-tool__stats" aria-live="polite">
        <p>
          <span>剩余候选</span>
          <strong>{{ characterBackfillStatsLoading ? '...' : (characterBackfillStats?.totals.eligiblePosts ?? '-') }}</strong>
        </p>
        <p>
          <span>当前载入</span>
          <strong>{{ characterBackfillLoading ? '...' : characterBackfillItems.length }}</strong>
        </p>
        <p>
          <span>后续批次</span>
          <strong>{{ characterBackfillHasMore ? '可继续加载' : '已到底' }}</strong>
        </p>
      </div>

      <section class="review-layout review-layout--backfill">
        <aside class="admin-panel review-list backfill-list">
          <template v-if="characterBackfillLoading">
            <span class="admin-status">正在加载角色回填队列...</span>
          </template>

          <template v-else-if="characterBackfillItems.length">
            <button
              v-for="item in characterBackfillItems"
              :key="item.id"
              :class="{ 'is-active': selectedBackfillId === item.id }"
              type="button"
              @click="selectedBackfillId = item.id"
            >
              <strong>{{ item.title }}</strong>
              <p>@{{ item.author.username }}</p>
              <p>{{ item.placeName || '未填写地点名称' }}</p>
              <p>{{ formatDateTime(item.createdAt) }}</p>
            </button>
          </template>

          <div v-else class="empty-state">
            <h2>当前没有待回填条目</h2>
            <p>没有待审修改且尚未标注角色的已发布投稿会出现在这里。</p>
          </div>
        </aside>

        <section class="admin-panel review-detail backfill-detail admin-detail-panel">
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

            <span class="admin-overline">角色回填 #{{ selectedBackfillItem.id }}</span>
            <h2>{{ selectedBackfillItem.title }}</h2>
            <div class="detail-meta admin-meta-row">
              <span class="admin-meta-item">@{{ selectedBackfillItem.author.username }}</span>
              <span class="admin-meta-item">{{ selectedBackfillItem.placeName || '未命名地点' }}</span>
              <span class="admin-meta-item">{{ privacyModeLabel(selectedBackfillItem.privacyMode) }}</span>
            </div>

            <p class="admin-copy">{{ selectedBackfillItem.body || '作者没有留下额外文字。' }}</p>

            <div class="field-grid field-grid--two">
              <div class="review-info-block">
                <strong>坐标与时间</strong>
                <p class="admin-copy">精确位置：{{ formatLatLng(selectedBackfillItem.exactLocation) }}</p>
                <p class="admin-copy">公开位置：{{ formatLatLng(selectedBackfillItem.publicLocation) }}</p>
                <p class="admin-copy">拍摄时间：{{ formatDateTime(selectedBackfillItem.capturedAt) }}</p>
                <p class="admin-copy">提交时间：{{ formatDateTime(selectedBackfillItem.createdAt) }}</p>
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

            <div class="field-label">
              <span>图片中的角色</span>
              <CharacterTagPicker
                v-model="backfillCharacterIds"
                :characters="characters"
                :disabled="charactersLoading || characterBackfillSaving"
              />
              <small class="field-hint">选择所有图片中出现的角色，可多选。</small>
              <button
                v-if="charactersError"
                class="backfill-catalog-retry"
                type="button"
                @click="loadCharacters(true)"
              >
                角色目录加载失败，点击重试
              </button>
            </div>

            <p class="backfill-detail__hint">
              保存后标签立即参与公开地图筛选，当前条目会从队列移除。
            </p>
          </template>

          <div v-else class="empty-state">
            <h2>从左侧选择一条原稿</h2>
            <p>补齐角色并保存后会自动切到下一条。</p>
          </div>

          <p v-if="characterBackfillLoadingMore" class="admin-status">正在加载更多候选...</p>
          <p v-if="characterBackfillFeedbackMessage" class="success-banner">{{ characterBackfillFeedbackMessage }}</p>
        </section>
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
  padding-top: 0.75rem;
  border-top: 1px solid #dedede;
  color: #666;
  font-size: 0.9rem;
  line-height: 1.6;
}

.review-character-tags {
  display: grid;
  gap: 0.65rem;
}

.review-character-tags__list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.review-character-tags__list span {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  font-size: 0.8rem;
}

.backfill-catalog-retry {
  width: fit-content;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--danger);
  font: inherit;
  font-size: 0.82rem;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
</style>
