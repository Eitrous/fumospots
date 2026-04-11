import type { H3Event } from 'h3'
import type { SubmitPostPayload } from '~~/shared/fumo'
import {
  MAX_BODY_LENGTH,
  MAX_POST_PHOTOS,
  MAX_TITLE_LENGTH
} from '~~/shared/fumo'
import { signStorageObjects } from '~~/server/utils/supabase'

export type PhotoRow = {
  image_path: string
  thumb_path: string | null
  sort_order: number
}

export type NormalizedPostPayload = {
  title: string
  body: string | null
  photos: SubmitPostPayload['photos']
  capturedAt: string | null
  exactLocation: SubmitPostPayload['exactLocation']
  publicLocation: SubmitPostPayload['publicLocation']
  privacyMode: SubmitPostPayload['privacyMode']
  placeName: string | null
  countryName: string | null
  regionName: string | null
  cityName: string | null
}

const isValidLatLng = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const maybe = value as { lat?: unknown; lng?: unknown }
  return typeof maybe.lat === 'number'
    && typeof maybe.lng === 'number'
    && maybe.lat >= -90
    && maybe.lat <= 90
    && maybe.lng >= -180
    && maybe.lng <= 180
}

export const isOwnedStoragePath = (path: unknown, userId: string) => {
  return typeof path === 'string'
    && path.length > userId.length + 1
    && path.startsWith(`${userId}/`)
}

export const normalizePostPayload = (
  body: SubmitPostPayload,
  userId: string
): NormalizedPostPayload => {
  const title = body.title?.trim()
  const normalizedBody = body.body?.trim() || null
  const photos = Array.isArray(body.photos) ? body.photos : []

  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Title is required and must be 80 characters or fewer.'
    })
  }

  if (normalizedBody && normalizedBody.length > MAX_BODY_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Body must be 1000 characters or fewer.'
    })
  }

  if (photos.length < 1 || photos.length > MAX_POST_PHOTOS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Please submit between 1 and ${MAX_POST_PHOTOS} photos.`
    })
  }

  const storagePaths = new Set<string>()
  for (const photo of photos) {
    if (!isOwnedStoragePath(photo?.imagePath, userId)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Image path is invalid.'
      })
    }

    if (photo.thumbPath && !isOwnedStoragePath(photo.thumbPath, userId)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Thumbnail path is invalid.'
      })
    }

    for (const path of [photo.imagePath, photo.thumbPath].filter(Boolean) as string[]) {
      if (storagePaths.has(path)) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Photo paths must be unique.'
        })
      }

      storagePaths.add(path)
    }
  }

  if (body.privacyMode !== 'exact' && body.privacyMode !== 'approx') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Privacy mode is invalid.'
    })
  }

  if (!isValidLatLng(body.exactLocation) || !isValidLatLng(body.publicLocation)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Location is invalid.'
    })
  }

  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : null
  if (body.capturedAt && Number.isNaN(capturedAt?.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Capture time is invalid.'
    })
  }

  return {
    title,
    body: normalizedBody,
    photos,
    capturedAt: capturedAt?.toISOString() || null,
    exactLocation: body.exactLocation,
    publicLocation: body.privacyMode === 'exact' ? body.exactLocation : body.publicLocation,
    privacyMode: body.privacyMode,
    placeName: body.placeName?.trim() || null,
    countryName: body.countryName || null,
    regionName: body.regionName || null,
    cityName: body.cityName || null
  }
}

export const postPayloadToRow = (payload: NormalizedPostPayload) => {
  const coverPhoto = payload.photos[0]

  return {
    title: payload.title,
    body: payload.body,
    image_path: coverPhoto.imagePath,
    thumb_path: coverPhoto.thumbPath || null,
    captured_at: payload.capturedAt,
    exact_lat: payload.exactLocation.lat,
    exact_lng: payload.exactLocation.lng,
    public_lat: payload.publicLocation.lat,
    public_lng: payload.publicLocation.lng,
    privacy_mode: payload.privacyMode,
    place_name: payload.placeName,
    country_name: payload.countryName,
    region_name: payload.regionName,
    city_name: payload.cityName
  }
}

export const photoPayloadsToRows = (
  photos: SubmitPostPayload['photos'],
  parentIdName: 'post_id' | 'revision_id',
  parentId: number
) => {
  return photos.map((photo, index) => ({
    [parentIdName]: parentId,
    image_path: photo.imagePath,
    thumb_path: photo.thumbPath || null,
    sort_order: index
  }))
}

export const getOrderedPhotoRows = (
  rows: PhotoRow[] | null | undefined,
  fallback?: {
    image_path?: string | null
    thumb_path?: string | null
  }
) => {
  const photoRows = (rows || [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)

  if (!photoRows.length && fallback?.image_path) {
    photoRows.push({
      image_path: fallback.image_path,
      thumb_path: fallback.thumb_path || null,
      sort_order: 0
    })
  }

  return photoRows
}

export const signPhotoRows = async (
  event: H3Event,
  photoRows: PhotoRow[],
  expiresIn = 60 * 30
) => {
  const imageUrls = await signStorageObjects(event, photoRows.map((photo) => photo.image_path), expiresIn)
  const thumbUrls = await signStorageObjects(event, photoRows.map((photo) => photo.thumb_path), expiresIn)

  return photoRows.map((photo) => ({
    imageUrl: imageUrls.get(photo.image_path) ?? null,
    thumbUrl: photo.thumb_path ? thumbUrls.get(photo.thumb_path) ?? null : null
  }))
}

export const signEditablePhotoRows = async (
  event: H3Event,
  photoRows: PhotoRow[],
  expiresIn = 60 * 60
) => {
  const signed = await signPhotoRows(event, photoRows, expiresIn)

  return photoRows.map((photo, index) => ({
    ...signed[index],
    imagePath: photo.image_path,
    thumbPath: photo.thumb_path
  }))
}
