import { readBody } from 'h3'
import { MAX_PHOTO_UPLOAD_BYTES, MAX_POST_PHOTOS } from '~~/shared/fumo'
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
  IMMUTABLE_STORAGE_CACHE_CONTROL
} from '~~/server/utils/storage'

type SignUploadInput = {
  path?: unknown
  contentType?: unknown
  size?: unknown
}

type SignUploadBody = SignUploadInput & {
  targets?: unknown
}

type ValidatedSignUploadInput = {
  path: string
  contentType: string
  size: number
}

const MAX_SIGNED_UPLOAD_TARGETS = MAX_POST_PHOTOS * 2

const normalizeUploadSize = (value: unknown) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

const validateSignUploadInput = (
  value: unknown,
  userId: string
): ValidatedSignUploadInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload target is invalid.'
    })
  }

  const input = value as SignUploadInput
  const path = normalizeStoragePathInput(input.path)
  const contentType = normalizeContentType(input.contentType)
  if (!isAllowedPhotoContentType(contentType) || !isOwnedPhotoUploadPath(path, userId, contentType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Storage path is invalid.'
    })
  }

  const size = normalizeUploadSize(input.size)
  if (!size || size < 1 || size > MAX_PHOTO_UPLOAD_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload size is invalid.'
    })
  }

  return {
    path,
    contentType,
    size
  }
}

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'uploadSignIp', getRateLimitIdentifier(event))

  const { user } = await requireAuthenticatedUser(event)
  const body = await readBody<SignUploadBody>(event)
  const batchInputs = body?.targets
  const isBatchRequest = batchInputs !== undefined
  const inputs = isBatchRequest ? batchInputs : [body]
  if (
    !Array.isArray(inputs)
    || !inputs.length
    || inputs.length > MAX_SIGNED_UPLOAD_TARGETS
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `Upload targets must contain between 1 and ${MAX_SIGNED_UPLOAD_TARGETS} items.`
    })
  }

  const validatedInputs = inputs.map((input) => {
    return validateSignUploadInput(input, user.id)
  })
  const uniquePaths = new Set(validatedInputs.map((input) => input.path))
  if (uniquePaths.size !== validatedInputs.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload target paths must be unique.'
    })
  }

  await enforceRateLimit(
    event,
    'uploadSignUser',
    user.id,
    validatedInputs.length
  )

  const targets = await Promise.all(validatedInputs.map(async (input) => {
    const uploadUrl = await createSignedUploadUrl(event, input.path, {
      contentLength: input.size,
      contentType: input.contentType,
      preventOverwrite: true
    })

    return {
      path: input.path,
      method: 'PUT' as const,
      uploadUrl,
      contentType: input.contentType,
      size: input.size,
      headers: {
        'Cache-Control': IMMUTABLE_STORAGE_CACHE_CONTROL,
        'Content-Type': input.contentType,
        'If-None-Match': '*'
      }
    }
  }))

  if (isBatchRequest) {
    return {
      targets
    }
  }

  return targets[0]!
})
