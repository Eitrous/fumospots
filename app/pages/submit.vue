<script setup lang="ts">
import type { GeocodeResult, LatLng, PrivacyMode, SubmitPostPayload } from '~~/shared/fumo'
import { STORAGE_BUCKET } from '~~/shared/fumo'

definePageMeta({
  middleware: ['require-auth', 'require-username']
})

const auth = useAuthState()

const selectedFile = ref<File | null>(null)
const thumbnailFile = ref<File | null>(null)
const imagePreviewUrl = ref('')
const thumbPreviewUrl = ref('')
const fileInputKey = ref(0)

const title = ref('')
const body = ref('')
const placeName = ref('')
const countryName = ref<string | null>(null)
const regionName = ref<string | null>(null)
const cityName = ref<string | null>(null)
const privacyMode = ref<PrivacyMode>('approx')
const exactLocation = ref<LatLng | null>(null)
const publicLocation = ref<LatLng | null>(null)
const capturedAt = ref('')

const searchQuery = ref('')
const searchResults = ref<GeocodeResult[]>([])
const searching = ref(false)
const detectingExif = ref(false)
const reverseLookupPending = ref(false)
const uploading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const { formatLatLng, privacyModeLabel } = useFormatters()

const revokePreviewUrls = () => {
  if (imagePreviewUrl.value) {
    URL.revokeObjectURL(imagePreviewUrl.value)
  }

  if (thumbPreviewUrl.value) {
    URL.revokeObjectURL(thumbPreviewUrl.value)
  }

  imagePreviewUrl.value = ''
  thumbPreviewUrl.value = ''
}

const resetForm = () => {
  title.value = ''
  body.value = ''
  placeName.value = ''
  countryName.value = null
  regionName.value = null
  cityName.value = null
  privacyMode.value = 'approx'
  exactLocation.value = null
  publicLocation.value = null
  capturedAt.value = ''
  selectedFile.value = null
  thumbnailFile.value = null
  searchQuery.value = ''
  searchResults.value = []
  revokePreviewUrls()
  fileInputKey.value += 1
}

const toDateTimeLocalValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const createThumbnail = async (file: File) => {
  const bitmap = await createImageBitmap(file)
  const longestSide = Math.max(bitmap.width, bitmap.height)
  const scale = Math.min(1, 720 / longestSide)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('无法创建缩略图画布')
  }

  context.fillStyle = '#fffaf3'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.84)
  })

  if (!blob) {
    throw new Error('缩略图生成失败')
  }

  return new File([blob], 'thumb.jpg', {
    type: 'image/jpeg'
  })
}

const applyGeocodeResult = (result: GeocodeResult) => {
  placeName.value = result.placeName
  countryName.value = result.countryName
  regionName.value = result.regionName
  cityName.value = result.cityName
}

const reverseLookupLocation = async (location: LatLng) => {
  reverseLookupPending.value = true

  try {
    const result = await $fetch<GeocodeResult>('/api/geocode/reverse', {
      query: {
        lat: location.lat,
        lng: location.lng
      }
    })

    applyGeocodeResult(result)
  } catch {
    // Reverse lookup failure should not block manual input.
  } finally {
    reverseLookupPending.value = false
  }
}

const handleExactLocationUpdate = (location: LatLng | null) => {
  exactLocation.value = location

  if (!location) {
    return
  }

  publicLocation.value = location

  void reverseLookupLocation(location)
}

const handlePublicLocationUpdate = (location: LatLng | null) => {
  publicLocation.value = location
}

const runPlaceSearch = async () => {
  errorMessage.value = ''

  if (!searchQuery.value.trim()) {
    return
  }

  searching.value = true

  try {
    searchResults.value = await $fetch<GeocodeResult[]>('/api/geocode/search', {
      query: {
        q: searchQuery.value.trim()
      }
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地点搜索失败'
  } finally {
    searching.value = false
  }
}

const selectSearchResult = (result: GeocodeResult) => {
  searchQuery.value = result.displayName
  searchResults.value = []
  exactLocation.value = {
    lat: result.lat,
    lng: result.lng
  }

  if (privacyMode.value === 'exact' || !publicLocation.value) {
    publicLocation.value = {
      lat: result.lat,
      lng: result.lng
    }
  }

  applyGeocodeResult(result)
}

const extractExif = async (file: File) => {
  detectingExif.value = true

  try {
    const { parse } = await import('exifr')
    const exif = await parse(file, {
      pick: ['latitude', 'longitude', 'DateTimeOriginal', 'DateTimeDigitized', 'CreateDate']
    })

    const lat = typeof exif?.latitude === 'number' ? exif.latitude : null
    const lng = typeof exif?.longitude === 'number' ? exif.longitude : null
    const captured = exif?.DateTimeOriginal || exif?.DateTimeDigitized || exif?.CreateDate

    if (lat != null && lng != null) {
      handleExactLocationUpdate({
        lat,
        lng
      })
    }

    if (captured instanceof Date) {
      capturedAt.value = toDateTimeLocalValue(captured)
    }
  } finally {
    detectingExif.value = false
  }
}

const onFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] || null

  errorMessage.value = ''
  successMessage.value = ''
  selectedFile.value = file
  thumbnailFile.value = null
  revokePreviewUrls()

  if (!file) {
    return
  }

  imagePreviewUrl.value = URL.createObjectURL(file)

  try {
    thumbnailFile.value = await createThumbnail(file)
    thumbPreviewUrl.value = URL.createObjectURL(thumbnailFile.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缩略图生成失败'
  }

  try {
    await extractExif(file)
  } catch {
    // EXIF is optional; silent fallback keeps the flow moving.
  }
}

watch(privacyMode, (mode) => {
  if (mode === 'exact' && exactLocation.value) {
    publicLocation.value = exactLocation.value
  }
})

const submitPost = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!selectedFile.value) {
    errorMessage.value = '请先选择要投稿的照片'
    return
  }

  if (!title.value.trim()) {
    errorMessage.value = '请输入标题'
    return
  }

  if (!exactLocation.value) {
    errorMessage.value = '请先在地图上标注精确拍摄位置'
    return
  }

  if (!publicLocation.value) {
    errorMessage.value = '请先确认公开展示的位置'
    return
  }

  const viewer = auth.viewer.value
  if (!viewer) {
    errorMessage.value = '登录状态已失效，请重新登录'
    return
  }

  uploading.value = true

  const supabase = useSupabaseBrowserClient()
  const postFolder = crypto.randomUUID()
  const safeExtension = selectedFile.value.name.split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '') || 'jpg'
  const originalPath = `${viewer.userId}/${postFolder}/original.${safeExtension}`
  const thumbPath = thumbnailFile.value
    ? `${viewer.userId}/${postFolder}/thumb.jpg`
    : null

  try {
    const { error: uploadOriginalError } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(originalPath, selectedFile.value, {
        upsert: false,
        contentType: selectedFile.value.type || undefined
      })

    if (uploadOriginalError) {
      throw uploadOriginalError
    }

    if (thumbnailFile.value && thumbPath) {
      const { error: uploadThumbError } = await supabase
        .storage
        .from(STORAGE_BUCKET)
        .upload(thumbPath, thumbnailFile.value, {
          upsert: false,
          contentType: 'image/jpeg'
        })

      if (uploadThumbError) {
        throw uploadThumbError
      }
    }

    const payload: SubmitPostPayload = {
      title: title.value.trim(),
      body: body.value.trim() || null,
      imagePath: originalPath,
      thumbPath,
      capturedAt: capturedAt.value ? new Date(capturedAt.value).toISOString() : null,
      exactLocation: exactLocation.value,
      publicLocation: publicLocation.value,
      privacyMode: privacyMode.value,
      placeName: placeName.value.trim(),
      countryName: countryName.value,
      regionName: regionName.value,
      cityName: cityName.value
    }

    await $fetch('/api/posts', {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: payload
    })

    successMessage.value = '投稿已提交成功，等待管理员审核后就会出现在地图上。'
    resetForm()
  } catch (error) {
    await supabase
      .storage
      .from(STORAGE_BUCKET)
      .remove([originalPath, thumbPath].filter(Boolean) as string[])

    errorMessage.value = error instanceof Error ? error.message : '投稿失败'
  } finally {
    uploading.value = false
  }
}

onBeforeUnmount(() => {
  revokePreviewUrls()
})
</script>

<template>
  <main class="page-shell">
    <div class="panel panel--page field-grid">
      <span class="eyebrow">Submit A Post</span>
      <h1 class="page-title">上传一张 Fumo 的旅行照片。</h1>
      <p class="lede">
        先选图、再定点、最后决定公开精度。地图展示只会使用公开位置，后台会保留精确坐标供审核参考。
      </p>

      <div class="field-grid field-grid--two">
        <section class="photo-drop">
          <strong>1. 选择照片</strong>
          <p class="support-copy">
            支持从图片 EXIF 自动读取坐标和拍摄时间；如果没有 EXIF，也可以在地图上手动选点。
          </p>

          <input
            :key="fileInputKey"
            class="field-input"
            type="file"
            accept="image/*"
            @change="onFileChange"
          >

          <div class="chip-row">
            <span class="status-inline">
              {{ detectingExif ? '正在读取 EXIF…' : '已支持 EXIF 坐标 / 拍摄时间' }}
            </span>
            <span v-if="reverseLookupPending" class="status-inline">正在解析地点名称…</span>
          </div>

          <div v-if="selectedFile" class="photo-preview">
            <img :src="imagePreviewUrl" :alt="selectedFile.name">
          </div>

          <div v-if="thumbPreviewUrl" class="photo-preview">
            <img :src="thumbPreviewUrl" alt="自动生成的缩略图">
          </div>
        </section>

        <section class="field-grid">
          <label class="field-label">
            <span>标题</span>
            <input
              v-model="title"
              class="field-input"
              maxlength="80"
              placeholder="例如：魔理沙在布拉格旧城广场"
            >
          </label>

          <label class="field-label">
            <span>作者留言</span>
            <textarea
              v-model="body"
              class="field-textarea"
              maxlength="1000"
              placeholder="可以写写这张照片是在什么场景下拍的，或者这只 fumo 当天经历了什么。"
            />
          </label>

          <label class="field-label">
            <span>拍摄时间</span>
            <input v-model="capturedAt" class="field-input" type="datetime-local">
          </label>

          <div class="privacy-toggle">
            <label class="privacy-pill">
              <input v-model="privacyMode" type="radio" value="approx">
              公开近似位置
            </label>
            <label class="privacy-pill">
              <input v-model="privacyMode" type="radio" value="exact">
              公开精确坐标
            </label>
          </div>
          <p class="field-hint">{{ privacyModeLabel(privacyMode) }}</p>
        </section>
      </div>

      <section class="field-grid">
        <div class="picker-toolbar">
          <div>
            <strong>2. 标记地点</strong>
            <p class="support-copy">点击地图设置精确位置；如果选择“近似位置”，再拖动蓝色标记调整公开点位。</p>
          </div>
          <div class="picker-coords">
            <div class="picker-coords__group">
              <code>精确位置 {{ formatLatLng(exactLocation) }}</code>
              <code>公开位置 {{ formatLatLng(publicLocation) }}</code>
            </div>
          </div>
        </div>

        <LocationPickerMap
          :exact-location="exactLocation"
          :public-location="publicLocation"
          :privacy-mode="privacyMode"
          @update:exact-location="handleExactLocationUpdate"
          @update:public-location="handlePublicLocationUpdate"
        />
      </section>

      <section class="field-grid field-grid--two">
        <div class="field-grid">
          <label class="field-label">
            <span>地点搜索</span>
            <div class="inline-actions">
              <input
                v-model="searchQuery"
                class="field-input"
                placeholder="例如：Hakone Shrine, Japan"
                @keyup.enter="runPlaceSearch"
              >
              <button class="ghost-button" type="button" :disabled="searching" @click="runPlaceSearch">
                {{ searching ? '搜索中…' : '搜索地点' }}
              </button>
            </div>
          </label>

          <ul v-if="searchResults.length" class="search-results">
            <li v-for="result in searchResults" :key="`${result.lat}-${result.lng}-${result.displayName}`">
              <button type="button" @click="selectSearchResult(result)">
                <strong>{{ result.placeName }}</strong>
                <span>{{ result.displayName }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div class="field-grid">
          <label class="field-label">
            <span>公开地点名称</span>
            <input v-model="placeName" class="field-input" placeholder="例如：Tokyo, Japan">
          </label>

          <div class="field-grid field-grid--two">
            <label class="field-label">
              <span>国家</span>
              <input v-model="countryName" class="field-input" placeholder="Japan">
            </label>
            <label class="field-label">
              <span>地区 / 州</span>
              <input v-model="regionName" class="field-input" placeholder="Tokyo">
            </label>
          </div>

          <label class="field-label">
            <span>城市 / 景点</span>
            <input v-model="cityName" class="field-input" placeholder="Akihabara">
          </label>
        </div>
      </section>

      <div class="inline-actions">
        <button class="button" type="button" :disabled="uploading" @click="submitPost">
          {{ uploading ? '提交中…' : '提交审核' }}
        </button>
        <NuxtLink class="ghost-button" to="/">回到地图</NuxtLink>
      </div>

      <p v-if="successMessage" class="success-banner">{{ successMessage }}</p>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
    </div>
  </main>
</template>
