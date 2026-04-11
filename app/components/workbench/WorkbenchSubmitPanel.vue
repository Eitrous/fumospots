<script setup lang="ts">
import type {
  EditablePostDetail,
  GeocodeResult,
  LatLng,
  PrivacyMode,
  SubmitPostPayload
} from '~~/shared/fumo'
import { MAX_POST_PHOTOS, STORAGE_BUCKET } from '~~/shared/fumo'

type SelectedPhoto = {
  id: string
  file: File | null
  name: string
  imagePath: string | null
  thumbPath: string | null
  thumbnailFile: File | null
  imagePreviewUrl: string
  thumbPreviewUrl: string
  revokeImagePreview: boolean
  revokeThumbPreview: boolean
}

const props = withDefaults(defineProps<{
  mode?: 'create' | 'edit'
  postId?: number | null
}>(), {
  mode: 'create',
  postId: null
})

const auth = useAuthState()
const { t } = useI18n()
const { formatLatLng } = useFormatters()
const { invalidatePostDetail } = usePostDetailCache()
const { invalidateUserPage } = useUserPageCache()

const isEditMode = computed(() => props.mode === 'edit')
const selectedPhotos = ref<SelectedPhoto[]>([])
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
const loadingEditable = ref(false)
const uploading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const submitNextPath = computed(() => {
  return isEditMode.value && props.postId
    ? `/?panel=edit&post=${props.postId}`
    : '/?panel=submit'
})

const revokePhotoPreviewUrls = (photo: SelectedPhoto) => {
  if (photo.revokeImagePreview && photo.imagePreviewUrl) {
    URL.revokeObjectURL(photo.imagePreviewUrl)
  }

  if (photo.revokeThumbPreview && photo.thumbPreviewUrl) {
    URL.revokeObjectURL(photo.thumbPreviewUrl)
  }
}

const revokePreviewUrls = () => {
  for (const photo of selectedPhotos.value) {
    revokePhotoPreviewUrls(photo)
  }

  selectedPhotos.value = []
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

const toExistingPhotoName = (imagePath: string, index: number) => {
  const segments = imagePath.split('/').filter(Boolean)
  const folder = segments.length >= 2 ? segments[segments.length - 2] : null
  return folder ? `${folder}/${segments.at(-1) || `photo-${index + 1}`}` : `photo-${index + 1}`
}

const applyEditablePost = (detail: EditablePostDetail) => {
  title.value = detail.title
  body.value = detail.body || ''
  placeName.value = detail.placeName || ''
  countryName.value = detail.countryName
  regionName.value = detail.regionName
  cityName.value = detail.cityName
  privacyMode.value = detail.privacyMode
  exactLocation.value = detail.exactLocation
  publicLocation.value = detail.publicLocation
  capturedAt.value = detail.capturedAt ? toDateTimeLocalValue(new Date(detail.capturedAt)) : ''
  searchQuery.value = ''
  searchResults.value = []
  revokePreviewUrls()
  selectedPhotos.value = detail.photos.map((photo, index) => ({
    id: `existing-${index}-${photo.imagePath}`,
    file: null,
    name: toExistingPhotoName(photo.imagePath, index),
    imagePath: photo.imagePath,
    thumbPath: photo.thumbPath,
    thumbnailFile: null,
    imagePreviewUrl: photo.imageUrl || photo.thumbUrl || '',
    thumbPreviewUrl: photo.thumbUrl || photo.imageUrl || '',
    revokeImagePreview: false,
    revokeThumbPreview: false
  }))
  fileInputKey.value += 1
}

const loadEditablePost = async () => {
  if (!isEditMode.value || !props.postId || !auth.authHeaders.value.Authorization) {
    return
  }

  loadingEditable.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const detail = await $fetch<EditablePostDetail>(`/api/posts/${props.postId}/edit`, {
      headers: auth.authHeaders.value
    })
    applyEditablePost(detail)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('edit.errors.loadFailed')
  } finally {
    loadingEditable.value = false
  }
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
    throw new Error(t('submit.errors.cannotCreateThumbnailCanvas'))
  }

  context.fillStyle = '#fffaf3'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.84)
  })

  if (!blob) {
    throw new Error(t('submit.errors.thumbnailFailed'))
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
    // Reverse lookup is only a convenience and should not block manual input.
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
    errorMessage.value = error instanceof Error ? error.message : t('submit.errors.searchFailed')
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

    if (lat != null && lng != null && !exactLocation.value) {
      handleExactLocationUpdate({
        lat,
        lng
      })
    }

    if (captured instanceof Date && !capturedAt.value) {
      capturedAt.value = toDateTimeLocalValue(captured)
    }
  } finally {
    detectingExif.value = false
  }
}

const extractCoverExifIfEmpty = async () => {
  if (exactLocation.value && capturedAt.value) {
    return
  }

  const coverPhoto = selectedPhotos.value[0]
  if (!coverPhoto?.file) {
    return
  }

  try {
    await extractExif(coverPhoto.file)
  } catch {
    // EXIF is optional; silent fallback keeps the flow moving.
  }
}

const onFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])

  errorMessage.value = ''
  successMessage.value = ''
  input.value = ''

  if (!files.length) {
    return
  }

  const wasEmpty = selectedPhotos.value.length === 0
  const remainingSlots = MAX_POST_PHOTOS - selectedPhotos.value.length
  const acceptedFiles = files.slice(0, Math.max(0, remainingSlots))

  if (acceptedFiles.length < files.length) {
    errorMessage.value = t('submit.errors.tooManyPhotos', { max: MAX_POST_PHOTOS })
  }

  let thumbnailFailed = false
  for (const [index, file] of acceptedFiles.entries()) {
    const photo: SelectedPhoto = {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      imagePath: null,
      thumbPath: null,
      thumbnailFile: null,
      imagePreviewUrl: URL.createObjectURL(file),
      thumbPreviewUrl: '',
      revokeImagePreview: true,
      revokeThumbPreview: false
    }

    selectedPhotos.value.push(photo)

    try {
      photo.thumbnailFile = await createThumbnail(file)
      photo.thumbPreviewUrl = URL.createObjectURL(photo.thumbnailFile)
      photo.revokeThumbPreview = true
    } catch {
      thumbnailFailed = true
    }

    if (wasEmpty && index === 0) {
      await extractCoverExifIfEmpty()
    }
  }

  if (thumbnailFailed && !errorMessage.value) {
    errorMessage.value = t('submit.errors.thumbnailFailed')
  }
}

const removePhoto = (photoId: string) => {
  const index = selectedPhotos.value.findIndex((photo) => photo.id === photoId)
  if (index < 0) {
    return
  }

  const [removed] = selectedPhotos.value.splice(index, 1)
  if (removed) {
    revokePhotoPreviewUrls(removed)
  }

  if (index === 0) {
    void extractCoverExifIfEmpty()
  }

  fileInputKey.value += 1
}

const movePhoto = (photoId: string, direction: -1 | 1) => {
  const index = selectedPhotos.value.findIndex((photo) => photo.id === photoId)
  const nextIndex = index + direction

  if (index < 0 || nextIndex < 0 || nextIndex >= selectedPhotos.value.length) {
    return
  }

  const [photo] = selectedPhotos.value.splice(index, 1)
  if (photo) {
    selectedPhotos.value.splice(nextIndex, 0, photo)
  }

  if (index === 0 || nextIndex === 0) {
    void extractCoverExifIfEmpty()
  }
}

watch(privacyMode, (mode) => {
  if (mode === 'exact' && exactLocation.value) {
    publicLocation.value = exactLocation.value
  }
})

watch(
  () => [auth.ready.value, auth.user.value?.id, auth.hasUsername.value],
  () => {
    if (!auth.ready.value) {
      return
    }

    if (!auth.user.value) {
      void navigateTo(createWorkbenchLocation('login', {
        next: submitNextPath.value
      }), { replace: true })
      return
    }

    if (!auth.hasUsername.value) {
      void navigateTo(createWorkbenchLocation('onboarding', {
        next: submitNextPath.value
      }), { replace: true })
    }
  },
  { immediate: true }
)

watch(
  () => [
    isEditMode.value,
    props.postId,
    auth.ready.value,
    auth.user.value?.id,
    auth.hasUsername.value,
    auth.authHeaders.value.Authorization
  ],
  ([editing, postId, ready, userId, hasUsername]) => {
    if (editing && postId && ready && userId && hasUsername) {
      void loadEditablePost()
    }
  },
  { immediate: true }
)

const canSubmit = computed(() => {
  return Boolean(
    selectedPhotos.value.length
    && title.value.trim()
    && exactLocation.value
    && publicLocation.value
    && auth.viewer.value
    && !loadingEditable.value
    && !uploading.value
  )
})

const uploadPhoto = async (
  photo: SelectedPhoto,
  index: number,
  postFolder: string,
  userId: string,
  uploadedPaths: string[]
) => {
  if (!photo.file && photo.imagePath) {
    return {
      imagePath: photo.imagePath,
      thumbPath: photo.thumbPath
    }
  }

  if (!photo.file) {
    throw new Error(t('submit.errors.selectPhoto'))
  }

  const supabase = useSupabaseBrowserClient()
  const folderName = String(index + 1).padStart(2, '0')
  const safeExtension = photo.name.split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '') || 'jpg'
  const originalPath = `${userId}/${postFolder}/${folderName}/original.${safeExtension}`
  const thumbPath = photo.thumbnailFile
    ? `${userId}/${postFolder}/${folderName}/thumb.jpg`
    : null

  const { error: uploadOriginalError } = await supabase
    .storage
    .from(STORAGE_BUCKET)
    .upload(originalPath, photo.file, {
      upsert: false,
      contentType: photo.file.type || undefined
    })

  if (uploadOriginalError) {
    throw uploadOriginalError
  }

  uploadedPaths.push(originalPath)

  if (photo.thumbnailFile && thumbPath) {
    const { error: uploadThumbError } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(thumbPath, photo.thumbnailFile, {
        upsert: false,
        contentType: 'image/jpeg'
      })

    if (uploadThumbError) {
      throw uploadThumbError
    }

    uploadedPaths.push(thumbPath)
  }

  return {
    imagePath: originalPath,
    thumbPath
  }
}

const submitPost = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!selectedPhotos.value.length) {
    errorMessage.value = t('submit.errors.selectPhoto')
    return
  }

  if (selectedPhotos.value.length > MAX_POST_PHOTOS) {
    errorMessage.value = t('submit.errors.tooManyPhotos', { max: MAX_POST_PHOTOS })
    return
  }

  if (!title.value.trim()) {
    errorMessage.value = t('submit.errors.titleRequired')
    return
  }

  if (!exactLocation.value) {
    errorMessage.value = t('submit.errors.exactRequired')
    return
  }

  if (!publicLocation.value) {
    errorMessage.value = t('submit.errors.publicRequired')
    return
  }

  const viewer = auth.viewer.value
  if (!viewer) {
    errorMessage.value = t('submit.errors.sessionExpired')
    return
  }

  uploading.value = true

  const supabase = useSupabaseBrowserClient()
  const postFolder = isEditMode.value && props.postId
    ? `edit-${props.postId}-${crypto.randomUUID()}`
    : crypto.randomUUID()
  const uploadedPaths: string[] = []
  const photosToUpload = selectedPhotos.value.slice()

  try {
    const photos = []
    for (const [index, photo] of photosToUpload.entries()) {
      photos.push(await uploadPhoto(photo, index, postFolder, viewer.userId, uploadedPaths))
    }

    const payload: SubmitPostPayload = {
      title: title.value.trim(),
      body: body.value.trim() || null,
      photos,
      capturedAt: capturedAt.value ? new Date(capturedAt.value).toISOString() : null,
      exactLocation: exactLocation.value,
      publicLocation: publicLocation.value,
      privacyMode: privacyMode.value,
      placeName: placeName.value.trim(),
      countryName: countryName.value,
      regionName: regionName.value,
      cityName: cityName.value
    }

    await $fetch(isEditMode.value && props.postId ? `/api/posts/${props.postId}/edit` : '/api/posts', {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: payload
    })

    const nextSuccessMessage = isEditMode.value ? t('edit.success') : t('submit.success')
    const viewerUsername = viewer.profile.username

    if (isEditMode.value) {
      if (props.postId) {
        invalidatePostDetail(props.postId)
      }
      if (viewerUsername) {
        invalidateUserPage(viewerUsername)
      }
      await loadEditablePost()
      successMessage.value = nextSuccessMessage
    } else {
      if (viewerUsername) {
        invalidateUserPage(viewerUsername)
      }
      successMessage.value = nextSuccessMessage
      resetForm()
    }
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase
        .storage
        .from(STORAGE_BUCKET)
        .remove(uploadedPaths)
    }

    errorMessage.value = error instanceof Error ? error.message : t('submit.errors.submitFailed')
  } finally {
    uploading.value = false
  }
}

useWorkbenchToolbarAction(computed(() => ({
  label: uploading.value
    ? (isEditMode.value ? t('edit.submitting') : t('submit.submitting'))
    : (isEditMode.value ? t('edit.submitButton') : t('submit.submitButton')),
  icon: isEditMode.value ? 'fa-pen-to-square' : 'fa-paper-plane',
  run: submitPost,
  disabled: !canSubmit.value,
  loading: uploading.value
})))

onBeforeUnmount(() => {
  revokePreviewUrls()
})
</script>

<template>
  <section class="workbench-panel workbench-panel--submit">
    <span class="eyebrow">{{ isEditMode ? t('edit.eyebrow') : t('submit.eyebrow') }}</span>
    <h2 class="workbench-panel__title workbench-panel__title--poster">{{ isEditMode ? t('edit.title') : t('submit.title') }}</h2>
    <p class="workbench-panel__copy workbench-panel__copy--poster">{{ isEditMode ? t('edit.description') : t('submit.description') }}</p>
    <p v-if="loadingEditable" class="status-inline">{{ t('edit.loading') }}</p>

    <section class="workbench-stack-section">
      <div class="workbench-stack-section__head">
        <strong>{{ t('submit.photoSectionTitle') }}</strong>
        <div class="chip-row">
          <span class="status-inline">{{ selectedPhotos.length }}/{{ MAX_POST_PHOTOS }}</span>
          <span v-if="detectingExif" class="status-inline">{{ t('submit.exifReading') }}</span>
          <span v-if="reverseLookupPending" class="status-inline">{{ t('submit.reverseLookup') }}</span>
        </div>
      </div>

      <div class="photo-drop">
        <input
          :key="fileInputKey"
          class="field-input"
          type="file"
          accept="image/*"
          multiple
          :disabled="uploading || loadingEditable || selectedPhotos.length >= MAX_POST_PHOTOS"
          @change="onFileChange"
        >

        <ul v-if="selectedPhotos.length" class="photo-preview-list">
          <li
            v-for="(photo, index) in selectedPhotos"
            :key="photo.id"
            class="photo-preview-item"
          >
            <div class="photo-preview">
              <img v-if="photo.imagePreviewUrl" :src="photo.imagePreviewUrl" :alt="photo.name">
              <i v-else class="fa-solid fa-image" aria-hidden="true" />
              <span class="photo-preview__index">{{ index + 1 }}</span>
              <div class="photo-preview__actions">
                <button
                  class="photo-preview__move"
                  type="button"
                  :aria-label="t('edit.movePhotoEarlier')"
                  :disabled="uploading || loadingEditable || index === 0"
                  @click="movePhoto(photo.id, -1)"
                >
                  <i class="fa-solid fa-arrow-left" aria-hidden="true" />
                </button>
                <button
                  class="photo-preview__move"
                  type="button"
                  :aria-label="t('edit.movePhotoLater')"
                  :disabled="uploading || loadingEditable || index === selectedPhotos.length - 1"
                  @click="movePhoto(photo.id, 1)"
                >
                  <i class="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>
              </div>
              <button
                class="photo-preview__remove"
                type="button"
                :aria-label="t('edit.removePhoto')"
                :disabled="uploading || loadingEditable"
                @click="removePhoto(photo.id)"
              >
                <i class="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <span class="photo-preview-item__name">{{ photo.name }}</span>
          </li>
        </ul>
      </div>

      <div class="field-grid">
        <label class="field-label">
          <span>{{ t('submit.titleLabel') }}</span>
          <input
            v-model="title"
            class="field-input"
            maxlength="80"
            :placeholder="t('submit.titlePlaceholder')"
          >
        </label>

        <label class="field-label">
          <span>{{ t('submit.bodyLabel') }}</span>
          <textarea
            v-model="body"
            class="field-textarea"
            maxlength="1000"
            :placeholder="t('submit.bodyPlaceholder')"
          />
        </label>

        <label class="field-label">
          <span>{{ t('submit.capturedAtLabel') }}</span>
          <input v-model="capturedAt" class="field-input" type="datetime-local">
        </label>

        <div class="privacy-toggle">
          <label class="privacy-pill">
            <input v-model="privacyMode" type="radio" value="approx">
            {{ t('submit.privacyApprox') }}
          </label>
          <label class="privacy-pill">
            <input v-model="privacyMode" type="radio" value="exact">
            {{ t('submit.privacyExact') }}
          </label>
        </div>
      </div>
    </section>

    <section class="workbench-stack-section">
      <div class="workbench-stack-section__head">
        <strong>{{ t('submit.locationSectionTitle') }}</strong>
        <div class="picker-coords">
          <div class="picker-coords__group">
            <code>{{ t('submit.exactLocationLabel', { value: formatLatLng(exactLocation) }) }}</code>
            <code>{{ t('submit.publicLocationLabel', { value: formatLatLng(publicLocation) }) }}</code>
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

    <section class="workbench-stack-section field-grid field-grid--two">
      <div class="field-grid">
        <label class="field-label">
          <span>{{ t('submit.searchLabel') }}</span>
          <input
            v-model="searchQuery"
            class="field-input"
            :placeholder="t('submit.searchPlaceholder')"
            @keyup.enter="runPlaceSearch"
          >
        </label>

        <ul v-if="searchResults.length" class="search-results">
          <li v-for="result in searchResults" :key="`${result.lat}-${result.lng}-${result.displayName}`">
            <div
              class="search-results__item"
              role="button"
              tabindex="0"
              @click="selectSearchResult(result)"
              @keydown.enter.prevent="selectSearchResult(result)"
              @keydown.space.prevent="selectSearchResult(result)"
            >
              <strong>{{ result.placeName }}</strong>
              <span>{{ result.displayName }}</span>
            </div>
          </li>
        </ul>
      </div>

      <div class="field-grid">
        <label class="field-label">
          <span>{{ t('submit.publicPlaceLabel') }}</span>
          <input v-model="placeName" class="field-input" :placeholder="t('submit.publicPlacePlaceholder')">
        </label>

        <div class="field-grid field-grid--two">
          <label class="field-label">
            <span>{{ t('submit.countryLabel') }}</span>
            <input v-model="countryName" class="field-input" :placeholder="t('submit.countryPlaceholder')">
          </label>
          <label class="field-label">
            <span>{{ t('submit.regionLabel') }}</span>
            <input v-model="regionName" class="field-input" :placeholder="t('submit.regionPlaceholder')">
          </label>
        </div>

        <label class="field-label">
          <span>{{ t('submit.cityLabel') }}</span>
          <input v-model="cityName" class="field-input" :placeholder="t('submit.cityPlaceholder')">
        </label>
      </div>
    </section>

    <p v-if="successMessage" class="success-banner">{{ successMessage }}</p>
    <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
  </section>
</template>
