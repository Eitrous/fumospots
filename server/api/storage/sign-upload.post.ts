import { readBody } from 'h3'
import { MAX_PHOTO_UPLOAD_BYTES } from '~~/shared/fumo'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'
import { requireAuthenticatedUser } from '~~/server/utils/supabase'
import {
  isAllowedPhotoContentType,
  isOwnedPhotoUploadPath,
  normalizeContentType,
  normalizeStoragePathInput
} from '~~/server/utils/storagePath'
import {
  createSignedUploadUrl,
  ensureStorageObjectMissing,
  IMMUTABLE_STORAGE_CACHE_CONTROL
} from '~~/server/utils/storage'

type SignUploadBody = {
  path?: unknown
  contentType?: unknown
  size?: unknown
}

const normalizeUploadSize = (value: unknown) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'uploadSignIp', getRateLimitIdentifier(event))

  const { user } = await requireAuthenticatedUser(event)
  await enforceRateLimit(event, 'uploadSignUser', user.id)

  const body = await readBody<SignUploadBody>(event)

  const path = normalizeStoragePathInput(body?.path)
  const contentType = normalizeContentType(body?.contentType)
  if (!isAllowedPhotoContentType(contentType) || !isOwnedPhotoUploadPath(path, user.id, contentType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Storage path is invalid.'
    })
  }

  const size = normalizeUploadSize(body?.size)
  if (!size || size < 1 || size > MAX_PHOTO_UPLOAD_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload size is invalid.'
    })
  }

  await ensureStorageObjectMissing(event, path)

  const uploadUrl = await createSignedUploadUrl(event, path, {
    contentLength: size,
    contentType,
    preventOverwrite: true
  })
  const headers = {
    'Cache-Control': IMMUTABLE_STORAGE_CACHE_CONTROL,
    'Content-Type': contentType,
    'If-None-Match': '*'
  }

  return {
    path,
    method: 'PUT' as const,
    uploadUrl,
    contentType,
    size,
    headers
  }
})
