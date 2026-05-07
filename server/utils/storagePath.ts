import { MAX_POST_PHOTOS } from '~~/shared/fumo'

export const MAX_STORAGE_KEY_LENGTH = 512
export const MAX_STORAGE_PATH_SEGMENT_LENGTH = 128

const MAX_CONTENT_TYPE_LENGTH = 128
const UUID_SEGMENT_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const NEW_POST_FOLDER_PATTERN = new RegExp(`^${UUID_SEGMENT_PATTERN}$`)
const EDIT_POST_FOLDER_PATTERN = new RegExp(`^edit-[1-9]\\d*-${UUID_SEGMENT_PATTERN}$`)
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/
const DANGEROUS_URL_CHARACTER_PATTERN = /[%?#]/
const ORIGINAL_FILENAME_PATTERN = /^original\.([a-z0-9]+)$/

export const ALLOWED_PHOTO_EXTENSIONS_BY_CONTENT_TYPE = {
  'image/avif': new Set(['avif']),
  'image/gif': new Set(['gif']),
  'image/jpeg': new Set(['jpeg', 'jpg']),
  'image/png': new Set(['png']),
  'image/webp': new Set(['webp'])
} as const

export type AllowedPhotoContentType = keyof typeof ALLOWED_PHOTO_EXTENSIONS_BY_CONTENT_TYPE

type PhotoStoragePathKind = 'original' | 'thumb'

const ALLOWED_PHOTO_EXTENSIONS = new Set(
  Object.values(ALLOWED_PHOTO_EXTENSIONS_BY_CONTENT_TYPE)
    .flatMap((extensions) => [...extensions])
)

export const normalizeContentType = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed.length > MAX_CONTENT_TYPE_LENGTH) {
    return ''
  }

  return trimmed
}

export const isAllowedPhotoContentType = (contentType: string): contentType is AllowedPhotoContentType => {
  return contentType in ALLOWED_PHOTO_EXTENSIONS_BY_CONTENT_TYPE
}

export const normalizeStoragePathInput = (value: unknown) => {
  return typeof value === 'string' ? value : ''
}

export const isCanonicalStoragePath = (path: unknown): path is string => {
  if (typeof path !== 'string') {
    return false
  }

  if (
    !path
    || path.length > MAX_STORAGE_KEY_LENGTH
    || path !== path.trim()
    || path.includes('\\')
    || CONTROL_CHARACTER_PATTERN.test(path)
    || DANGEROUS_URL_CHARACTER_PATTERN.test(path)
  ) {
    return false
  }

  const segments = path.split('/')
  return segments.every((segment) => {
    return Boolean(segment)
      && segment.length <= MAX_STORAGE_PATH_SEGMENT_LENGTH
      && segment !== '.'
      && segment !== '..'
  })
}

const isValidPostFolder = (folder: string) => {
  return NEW_POST_FOLDER_PATTERN.test(folder) || EDIT_POST_FOLDER_PATTERN.test(folder)
}

const parsePhotoStoragePath = (path: unknown, userId: string) => {
  if (!isCanonicalStoragePath(path)) {
    return null
  }

  const segments = path.split('/')
  if (segments.length !== 4) {
    return null
  }

  const [ownerId, postFolder, photoFolder, filename] = segments
  if (ownerId !== userId || !isValidPostFolder(postFolder)) {
    return null
  }

  const photoNumber = Number(photoFolder)
  if (
    !Number.isInteger(photoNumber)
    || photoNumber < 1
    || photoNumber > MAX_POST_PHOTOS
    || photoFolder !== String(photoNumber).padStart(2, '0')
  ) {
    return null
  }

  if (filename === 'thumb.webp') {
    return {
      kind: 'thumb' as const,
      extension: 'webp'
    }
  }

  const originalMatch = ORIGINAL_FILENAME_PATTERN.exec(filename)
  if (!originalMatch || !ALLOWED_PHOTO_EXTENSIONS.has(originalMatch[1])) {
    return null
  }

  return {
    kind: 'original' as const,
    extension: originalMatch[1]
  }
}

export const isOwnedPhotoStoragePath = (path: unknown, userId: string): path is string => {
  return Boolean(parsePhotoStoragePath(path, userId))
}

export const isOwnedPhotoImageStoragePath = (path: unknown, userId: string): path is string => {
  return parsePhotoStoragePath(path, userId)?.kind === 'original'
}

export const isOwnedPhotoThumbStoragePath = (path: unknown, userId: string): path is string => {
  return parsePhotoStoragePath(path, userId)?.kind === 'thumb'
}

export const isOwnedPhotoUploadPath = (
  path: unknown,
  userId: string,
  contentType: AllowedPhotoContentType
): path is string => {
  const parsed = parsePhotoStoragePath(path, userId)
  if (!parsed) {
    return false
  }

  if (parsed.kind === 'thumb' && contentType !== 'image/webp') {
    return false
  }

  return ALLOWED_PHOTO_EXTENSIONS_BY_CONTENT_TYPE[contentType].has(parsed.extension)
}

export const isOwnedStoragePath = isOwnedPhotoStoragePath
