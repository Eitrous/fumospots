<script setup lang="ts">
import type {
  EditablePostDetail,
  GeocodeResult,
  LatLng,
  PrivacyMode,
  SubmitPostPayload
} from '~~/shared/fumo'
import { MAX_POST_PHOTOS } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

type SelectedPhoto = {
  id: string
  file: File | null
  sourceFile: File | null
  name: string
  imagePath: string | null
  thumbPath: string | null
  thumbnailFile: File | null
  imagePreviewUrl: string
  thumbPreviewUrl: string
  revokeImagePreview: boolean
  revokeThumbPreview: boolean
}

type SignedUploadTarget = {
  path: string
  method: 'PUT'
  uploadUrl: string
  contentType: string
}

const props = withDefaults(defineProps<{
  mode?: 'create' | 'edit'
  postId?: number | null
}>(), {
  mode: 'create',
  postId: null
})
const emit = defineEmits<{
  submitted: [message: string]
}>()

const auth = useAuthState()
const { t, locale } = useI18n()
const { formatLatLng } = useFormatters()
const { invalidatePostDetail } = usePostDetailCache()
const { invalidateUserPage } = useUserPageCache()

const isEditMode = computed(() => props.mode === 'edit')
const selectedPhotos = ref<SelectedPhoto[]>([])
const fileInputKey = ref(0)
const photoInputRef = ref<HTMLInputElement | null>(null)

const title = ref('')
const body = ref('')
const placeName = ref('')
const countryName = ref<string | null>(null)
const regionName = ref<string | null>(null)
const cityName = ref<string | null>(null)
const lastAutoPlaceName = ref<string | null>(null)
const privacyMode = ref<PrivacyMode>('exact')
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
const deletingPost = ref(false)
const deleteDialogOpen = ref(false)
const uploadProgressStepCount = ref(0)
const uploadProgressStepDone = ref(0)
const errorMessage = ref('')
const successMessage = ref('')

const uploadProgressPercent = computed(() => {
  if (!uploadProgressStepCount.value) {
    return 0
  }

  return Math.min(100, Math.round((uploadProgressStepDone.value / uploadProgressStepCount.value) * 100))
})

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
  lastAutoPlaceName.value = null
  privacyMode.value = 'exact'
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

const getAdaptiveWebpQuality = (bytes: number) => {
  if (bytes >= 12 * 1024 * 1024) {
    return 0.68
  }

  if (bytes >= 8 * 1024 * 1024) {
    return 0.72
  }

  if (bytes >= 4 * 1024 * 1024) {
    return 0.76
  }

  if (bytes >= 2 * 1024 * 1024) {
    return 0.8
  }

  return 0.84
}

const applyEditablePost = (detail: EditablePostDetail) => {
  title.value = detail.title
  body.value = detail.body || ''
  placeName.value = detail.placeName || ''
  countryName.value = detail.countryName
  regionName.value = detail.regionName
  cityName.value = detail.cityName
  lastAutoPlaceName.value = null
  privacyMode.value = 'exact'
  exactLocation.value = detail.exactLocation
  publicLocation.value = detail.exactLocation
  capturedAt.value = detail.capturedAt ? toDateTimeLocalValue(new Date(detail.capturedAt)) : ''
  searchQuery.value = ''
  searchResults.value = []
  revokePreviewUrls()
  selectedPhotos.value = detail.photos.map((photo, index) => ({
    id: `existing-${index}-${photo.imagePath}`,
    file: null,
    sourceFile: null,
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
      headers: {
        ...auth.authHeaders.value,
        'accept-language': locale.value
      }
    })
    applyEditablePost(detail)
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t('edit.errors.loadFailed'))
  } finally {
    loadingEditable.value = false
  }
}

const createWebpUploadFile = async (file: File) => {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error(t('submit.errors.thumbnailFailed'))
  }

  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', getAdaptiveWebpQuality(file.size))
  })

  if (!blob) {
    throw new Error(t('submit.errors.thumbnailFailed'))
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'original'
  return new File([blob], `${baseName}.webp`, {
    type: 'image/webp'
  })
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

  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', Math.max(0.62, getAdaptiveWebpQuality(file.size) - 0.06))
  })

  if (!blob) {
    throw new Error(t('submit.errors.thumbnailFailed'))
  }

  return new File([blob], 'thumb.webp', {
    type: 'image/webp'
  })
}

const applyPlaceNameFromGeocode = (
  nextPlaceName: string,
  mode: 'always' | 'if-auto'
) => {
  const normalizedPlaceName = nextPlaceName.trim()

  if (mode === 'always') {
    placeName.value = normalizedPlaceName
    lastAutoPlaceName.value = normalizedPlaceName || null
    return
  }

  const currentPlaceName = placeName.value.trim()
  if (!currentPlaceName || (lastAutoPlaceName.value && currentPlaceName === lastAutoPlaceName.value)) {
    placeName.value = normalizedPlaceName
    lastAutoPlaceName.value = normalizedPlaceName || null
  }
}

const applyGeocodeResult = (
  result: GeocodeResult,
  options: {
    placeNameMode?: 'always' | 'if-auto'
  } = {}
) => {
  applyPlaceNameFromGeocode(result.placeName, options.placeNameMode || 'always')
  countryName.value = result.countryName
  regionName.value = result.regionName
  cityName.value = result.cityName
}

const reverseLookupLocation = async (location: LatLng) => {
  reverseLookupPending.value = true

  try {
    const result = await $fetch<GeocodeResult>('/api/geocode/reverse', {
      headers: {
        'accept-language': locale.value
      },
      query: {
        lat: location.lat,
        lng: location.lng
      }
    })

    applyGeocodeResult(result, {
      placeNameMode: 'if-auto'
    })
  } catch {
    // Reverse lookup is only a convenience and should not block location updates.
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
      headers: {
        'accept-language': locale.value
      },
      query: {
        q: searchQuery.value.trim()
      }
    })
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t('submit.errors.searchFailed'))
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

  publicLocation.value = {
    lat: result.lat,
    lng: result.lng
  }

  applyGeocodeResult(result, {
    placeNameMode: 'always'
  })
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
  const exifSource = coverPhoto?.sourceFile || coverPhoto?.file
  if (!exifSource) {
    return
  }

  try {
    await extractExif(exifSource)
  } catch {
    // EXIF is optional; silent fallback keeps the flow moving.
  }
}

const openPhotoPicker = () => {
  if (uploading.value || loadingEditable.value || selectedPhotos.value.length >= MAX_POST_PHOTOS) {
    return
  }

  photoInputRef.value?.click()
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

  for (const [index, file] of acceptedFiles.entries()) {
    const photo: SelectedPhoto = {
      id: crypto.randomUUID(),
      file,
      sourceFile: file,
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

    if (wasEmpty && index === 0) {
      await extractCoverExifIfEmpty()
    }
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
    auth.authHeaders.value.Authorization,
    locale.value
  ],
  ([editing, postId, ready, userId, hasUsername]) => {
    if (editing && postId && ready && userId && hasUsername) {
      void loadEditablePost()
    }
  },
  { immediate: true }
)

watch(
  () => locale.value,
  () => {
    if (!isEditMode.value && exactLocation.value) {
      void reverseLookupLocation(exactLocation.value)
    }
  }
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
    && !deletingPost.value
    && !deleteDialogOpen.value
  )
})

const canRunPlaceSearch = computed(() => {
  return Boolean(searchQuery.value.trim()) && !searching.value
})

const canAddPhoto = computed(() => selectedPhotos.value.length < MAX_POST_PHOTOS)

const resetUploadProgress = () => {
  uploadProgressStepCount.value = 0
  uploadProgressStepDone.value = 0
}

const startUploadProgress = (photos: SelectedPhoto[]) => {
  const uploadSteps = photos.reduce((count, photo) => {
    if (!photo.file) {
      return count
    }

    return count + 2
  }, 0)

  uploadProgressStepCount.value = Math.max(1, uploadSteps + 1)
  uploadProgressStepDone.value = 0
}

const advanceUploadProgress = (step = 1) => {
  if (!uploadProgressStepCount.value) {
    return
  }

  uploadProgressStepDone.value = Math.min(
    uploadProgressStepCount.value,
    uploadProgressStepDone.value + step
  )
}

const requestSignedUploadTarget = async (path: string, contentType: string) => {
  if (!auth.authHeaders.value.Authorization) {
    throw new Error(t('submit.errors.sessionExpired'))
  }

  return await $fetch<SignedUploadTarget>('/api/storage/sign-upload', {
    method: 'POST',
    headers: auth.authHeaders.value,
    body: {
      path,
      contentType
    }
  })
}

const uploadWithSignedUrl = async (target: SignedUploadTarget, file: Blob) => {
  const response = await fetch(target.uploadUrl, {
    method: target.method,
    headers: {
      'Content-Type': target.contentType
    },
    body: file
  })

  if (!response.ok) {
    throw new Error(`Image upload failed (${response.status}).`)
  }
}

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

  const sourceFile = photo.sourceFile || photo.file
  let uploadOriginalFile = sourceFile

  try {
    uploadOriginalFile = await createWebpUploadFile(sourceFile)
  } catch {
    // Server-side fallback conversion still guarantees WebP in persisted paths.
  }

  let thumbnailFile: File | null = null
  try {
    thumbnailFile = await createThumbnail(sourceFile)
  } catch {
    thumbnailFile = null
  }

  const folderName = String(index + 1).padStart(2, '0')
  const safeExtension = uploadOriginalFile.name.split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '') || 'webp'
  const originalPath = `${userId}/${postFolder}/${folderName}/original.${safeExtension}`
  const thumbPath = thumbnailFile
    ? `${userId}/${postFolder}/${folderName}/thumb.webp`
    : null

  const originalTarget = await requestSignedUploadTarget(
    originalPath,
    uploadOriginalFile.type || 'application/octet-stream'
  )
  await uploadWithSignedUrl(originalTarget, uploadOriginalFile)

  uploadedPaths.push(originalPath)
  advanceUploadProgress()

  if (thumbnailFile && thumbPath) {
    const thumbTarget = await requestSignedUploadTarget(thumbPath, 'image/webp')
    await uploadWithSignedUrl(thumbTarget, thumbnailFile)

    uploadedPaths.push(thumbPath)
    advanceUploadProgress()
  } else {
    // Keep progress in sync when thumbnail conversion is skipped/failed.
    advanceUploadProgress()
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

  const postFolder = isEditMode.value && props.postId
    ? `edit-${props.postId}-${crypto.randomUUID()}`
    : crypto.randomUUID()
  const uploadedPaths: string[] = []
  const photosToUpload = selectedPhotos.value.slice()
  startUploadProgress(photosToUpload)

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
      privacyMode: 'exact',
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
    advanceUploadProgress()

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
      emit('submitted', nextSuccessMessage)
    } else {
      if (viewerUsername) {
        invalidateUserPage(viewerUsername)
      }
      successMessage.value = nextSuccessMessage
      resetForm()
      emit('submitted', nextSuccessMessage)
    }
  } catch (error) {
    if (uploadedPaths.length && auth.authHeaders.value.Authorization) {
      try {
        await $fetch('/api/storage/delete', {
          method: 'POST',
          headers: auth.authHeaders.value,
          body: {
            paths: uploadedPaths
          }
        })
      } catch {
        // Ignore cleanup failures and surface the main submit error.
      }
    }

    errorMessage.value = normalizeApiErrorMessage(error, t('submit.errors.submitFailed'))
  } finally {
    uploading.value = false
    resetUploadProgress()
  }
}

const openDeleteDialog = () => {
  if (!isEditMode.value || !props.postId || uploading.value || loadingEditable.value || deletingPost.value) {
    return
  }

  deleteDialogOpen.value = true
}

const closeDeleteDialog = () => {
  if (deletingPost.value) {
    return
  }

  deleteDialogOpen.value = false
}

const deletePost = async () => {
  if (!isEditMode.value || !props.postId || deletingPost.value) {
    return
  }

  if (!auth.authHeaders.value.Authorization) {
    errorMessage.value = t('submit.errors.sessionExpired')
    return
  }

  deletingPost.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const response = await fetch(`/api/posts/${props.postId}/delete`, {
      method: 'POST',
      headers: auth.authHeaders.value
    })

    if (!response.ok) {
      let statusMessage = ''

      try {
        const payload = await response.json() as {
          statusMessage?: unknown
        }

        if (typeof payload.statusMessage === 'string' && payload.statusMessage.trim()) {
          statusMessage = payload.statusMessage.trim()
        }
      } catch {
        // Ignore response body parsing errors and fallback to status text.
      }

      throw {
        statusCode: response.status,
        statusMessage: statusMessage || response.statusText
      }
    }

    const viewerUsername = auth.viewer.value?.profile.username
    invalidatePostDetail(props.postId)
    if (viewerUsername) {
      invalidateUserPage(viewerUsername)
    }

    const nextSuccessMessage = t('edit.deleteSuccess')
    deleteDialogOpen.value = false
    emit('submitted', nextSuccessMessage)
    await navigateTo(createWorkbenchLocation('info'))
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t('edit.errors.deleteFailed'))
  } finally {
    deletingPost.value = false
  }
}

watch(
  () => [isEditMode.value, props.postId],
  () => {
    deleteDialogOpen.value = false
  }
)

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
    <div
      v-if="uploading"
      class="submit-upload-progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="uploadProgressPercent"
      :aria-valuetext="`${uploadProgressPercent}%`"
    >
      <div class="submit-upload-progress__bar">
        <span
          class="submit-upload-progress__fill"
          :style="{ width: `${uploadProgressPercent}%` }"
        />
      </div>
      <span class="submit-upload-progress__text">{{ uploadProgressPercent }}%</span>
    </div>
    <div class="submit-top-tools">
      <a
        class="submit-guide-link"
        href="https://blog.0x-3f.com/2026/04/12/fumospots_manual/#%E6%8A%95%E7%A8%BF%E9%A1%BB%E7%9F%A5"
        target="_blank"
        rel="noopener noreferrer"
      >
        投稿须知
      </a>

      <button
        v-if="isEditMode"
        class="workbench-icon-button workbench-icon-button--danger workbench-delete-trigger"
        type="button"
        :title="t('edit.deleteButton')"
        :aria-label="t('edit.deleteButton')"
        :disabled="uploading || loadingEditable || deletingPost"
        @click="openDeleteDialog"
      >
        <i class="button-icon fa-solid" :class="deletingPost ? 'fa-spinner fa-spin' : 'fa-trash-can'" aria-hidden="true" />
        <span class="sr-only">{{ t('edit.deleteButton') }}</span>
      </button>
    </div>
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
          ref="photoInputRef"
          :key="fileInputKey"
          class="photo-input"
          type="file"
          accept="image/*"
          multiple
          :disabled="uploading || loadingEditable || selectedPhotos.length >= MAX_POST_PHOTOS"
          @change="onFileChange"
        >

        <ul class="photo-preview-list">
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

          <li v-if="canAddPhoto" class="photo-preview-item photo-preview-item--add">
            <button
              class="photo-preview photo-preview--add"
              type="button"
              :aria-label="t('submit.addPhoto')"
              :disabled="uploading || loadingEditable"
              @click="openPhotoPicker"
            >
              <i class="fa-solid fa-plus" aria-hidden="true" />
            </button>
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
      </div>
    </section>

    <section class="workbench-stack-section">

      <div class="field-grid field-grid--two">
        <div class="field-grid">
          <label class="field-label">
            <span>{{ t('submit.searchLabel') }}</span>
            <div class="submit-search-row">
              <input
                v-model="searchQuery"
                class="field-input"
                :placeholder="t('submit.searchPlaceholder')"
                @keyup.enter="runPlaceSearch"
              >
              <button
                class="workbench-icon-button submit-search-row__button"
                type="button"
                :title="searching ? t('submit.searching') : t('submit.searchButton')"
                :aria-label="searching ? t('submit.searching') : t('submit.searchButton')"
                :disabled="!canRunPlaceSearch"
                @click="runPlaceSearch"
              >
                <i
                  class="button-icon fa-solid"
                  :class="searching ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'"
                  aria-hidden="true"
                />
                <span class="sr-only">{{ searching ? t('submit.searching') : t('submit.searchButton') }}</span>
              </button>
            </div>
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

          <p class="field-hint">{{ t('submit.locationFieldsHint') }}</p>

          <div class="field-grid field-grid--two">
            <label class="field-label">
              <span>{{ t('submit.countryLabel') }}</span>
              <input
                :value="countryName || ''"
                class="field-input field-input--readonly"
                :placeholder="t('submit.countryPlaceholder')"
                readonly
                aria-readonly="true"
              >
            </label>
            <label class="field-label">
              <span>{{ t('submit.regionLabel') }}</span>
              <input
                :value="regionName || ''"
                class="field-input field-input--readonly"
                :placeholder="t('submit.regionPlaceholder')"
                readonly
                aria-readonly="true"
              >
            </label>
          </div>

          <label class="field-label">
            <span>{{ t('submit.cityLabel') }}</span>
            <input
              :value="cityName || ''"
              class="field-input field-input--readonly"
              :placeholder="t('submit.cityPlaceholder')"
              readonly
              aria-readonly="true"
            >
          </label>
        </div>
      </div>


      <div class="workbench-stack-section__head">
        <strong>{{ t('submit.locationSectionTitle') }}</strong>
        <div class="picker-coords">
          <div class="picker-coords__group">
            <code>{{ t('submit.exactLocationLabel', { value: formatLatLng(exactLocation) }) }}</code>
          </div>
        </div>
      </div>
      <LocationPickerMap
        class="workbench-submit-map"
        :exact-location="exactLocation"
        :public-location="publicLocation"
        :privacy-mode="privacyMode"
        @update:exact-location="handleExactLocationUpdate"
        @update:public-location="handlePublicLocationUpdate"
      />
    </section>

    <div
      v-if="deleteDialogOpen"
      class="workbench-like-dialog workbench-delete-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('edit.deleteConfirmTitle')"
      @click.self="closeDeleteDialog"
    >
      <div class="workbench-like-dialog__panel workbench-delete-dialog__panel">
        <i class="workbench-like-dialog__icon fa-solid fa-triangle-exclamation" aria-hidden="true" />
        <div class="workbench-delete-dialog__content">
          <p class="workbench-delete-dialog__title">{{ t('edit.deleteConfirmTitle') }}</p>
          <p>{{ t('edit.deleteConfirmMessage') }}</p>
        </div>

        <div class="workbench-delete-dialog__actions">
          <button
            class="workbench-icon-button"
            type="button"
            :aria-label="t('edit.deleteCancel')"
            :title="t('edit.deleteCancel')"
            :disabled="deletingPost"
            @click="closeDeleteDialog"
          >
            <i class="button-icon fa-solid fa-xmark" aria-hidden="true" />
            <span class="sr-only">{{ t('edit.deleteCancel') }}</span>
          </button>

          <button
            class="workbench-icon-button workbench-icon-button--danger"
            type="button"
            :aria-label="t('edit.deleteConfirmAction')"
            :title="t('edit.deleteConfirmAction')"
            :disabled="deletingPost"
            @click="deletePost"
          >
            <i class="button-icon fa-solid" :class="deletingPost ? 'fa-spinner fa-spin' : 'fa-trash-can'" aria-hidden="true" />
            <span class="sr-only">{{ t('edit.deleteConfirmAction') }}</span>
          </button>
        </div>
      </div>
    </div>

    <p v-if="successMessage" class="success-banner">{{ successMessage }}</p>
    <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.submit-top-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  margin-top: 0.6rem;
  margin-bottom: 0.2rem;
}

.submit-guide-link {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  color: var(--accent);
  font-size: 0.92rem;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.submit-guide-link:hover,
.submit-guide-link:focus-visible {
  color: var(--accent-deep);
}

.workbench-delete-trigger {
  flex: 0 0 auto;
  width: 3.4rem;
  height: 2.2rem;
  margin-left: 0;
  border-radius: 0.72rem;
}

.workbench-delete-dialog__panel {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  row-gap: 0.75rem;
}

.workbench-delete-dialog__content {
  min-width: 0;
}

.workbench-delete-dialog__title {
  margin-bottom: 0.25rem;
  font-weight: 700;
}

.workbench-delete-dialog__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--border);
}

.workbench-delete-dialog__actions .workbench-icon-button {
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 0.7rem;
}

.field-input--readonly {
  color: var(--ink-soft);
  cursor: default;
  background: rgba(255, 255, 255, 0.44);
}

.submit-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 0.45rem;
}

.submit-search-row__button {
  width: 3.1rem;
  min-height: 3.25rem;
  border-radius: 18px;
  border: 1px solid rgba(29, 23, 18, 0.08);
  background: rgba(255, 255, 255, 0.56);
  box-shadow: none;
}

.submit-search-row__button:hover,
.submit-search-row__button:focus-visible {
  background: rgba(255, 255, 255, 0.78);
}

.field-input--readonly:focus {
  border-color: var(--border);
  box-shadow: none;
}

html[data-theme="dark"] .submit-search-row__button {
  border-color: var(--border);
  background: rgba(21, 27, 32, 0.66);
}

html[data-theme="dark"] .submit-search-row__button:hover,
html[data-theme="dark"] .submit-search-row__button:focus-visible {
  background: rgba(32, 39, 46, 0.82);
}

html[data-theme="dark"] .field-input--readonly {
  background: rgba(255, 255, 255, 0.03);
}
</style>
