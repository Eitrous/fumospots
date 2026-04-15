import type { H3Event } from 'h3'
import sharp from 'sharp'
import { STORAGE_BUCKET } from '~~/shared/fumo'
import { createAdminServerClient } from '~~/server/utils/supabase'

export type StoragePathConversionFailure = {
  sourcePath: string
  message: string
}

export type EnsureStoragePathsWebpResult = {
  pathMap: Map<string, string>
  convertedCount: number
  skippedCount: number
  failures: StoragePathConversionFailure[]
}

export type PhotoStoragePathLike = {
  imagePath: string
  thumbPath: string | null
}

type EnsureStoragePathsWebpOptions = {
  upsert?: boolean
  continueOnError?: boolean
  maxConcurrency?: number
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object'
}

const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (isObjectLike(error) && typeof error.message === 'string') {
    return error.message
  }

  return 'Unknown conversion error.'
}

const getWebpQuality = (sourceBytes: number, width?: number, height?: number) => {
  let quality = 84

  if (sourceBytes >= 12 * 1024 * 1024) {
    quality = 68
  } else if (sourceBytes >= 8 * 1024 * 1024) {
    quality = 72
  } else if (sourceBytes >= 4 * 1024 * 1024) {
    quality = 76
  } else if (sourceBytes >= 2 * 1024 * 1024) {
    quality = 80
  }

  if (width && height) {
    const megapixels = (width * height) / 1_000_000
    if (megapixels >= 16) {
      quality -= 6
    } else if (megapixels >= 12) {
      quality -= 4
    } else if (megapixels >= 8) {
      quality -= 2
    }
  }

  return clamp(quality, 60, 90)
}

export const isWebpStoragePath = (path: unknown): path is string => {
  return typeof path === 'string' && /\.webp$/i.test(path)
}

export const toWebpStoragePath = (path: string) => {
  if (isWebpStoragePath(path)) {
    return path
  }

  const trimmed = path.trim()
  if (!trimmed) {
    return path
  }

  const slashIndex = trimmed.lastIndexOf('/')
  const directory = slashIndex >= 0 ? trimmed.slice(0, slashIndex + 1) : ''
  const filename = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed
  const dotIndex = filename.lastIndexOf('.')
  const basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename

  return `${directory}${basename}.webp`
}

const convertSinglePathToWebp = async (
  event: H3Event,
  sourcePath: string,
  options: Required<Pick<EnsureStoragePathsWebpOptions, 'upsert'>>
) => {
  const admin = createAdminServerClient(event)
  const targetPath = toWebpStoragePath(sourcePath)

  const { data: sourceBlob, error: downloadError } = await admin
    .storage
    .from(STORAGE_BUCKET)
    .download(sourcePath)

  if (downloadError || !sourceBlob) {
    throw new Error(downloadError?.message || 'Failed to download source image.')
  }

  const sourceBuffer = Buffer.from(await sourceBlob.arrayBuffer())
  const metadata = await sharp(sourceBuffer, { failOn: 'none' }).metadata()
  const quality = getWebpQuality(sourceBuffer.byteLength, metadata.width, metadata.height)
  const webpBuffer = await sharp(sourceBuffer, { failOn: 'none' })
    .rotate()
    .webp({
      quality,
      effort: 4,
      smartSubsample: true
    })
    .toBuffer()

  const { error: uploadError } = await admin
    .storage
    .from(STORAGE_BUCKET)
    .upload(targetPath, webpBuffer, {
      upsert: options.upsert,
      contentType: 'image/webp'
    })

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload WebP image.')
  }

  return targetPath
}

const mapWithConcurrency = async <T>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<void>
) => {
  let index = 0

  const runners = Array.from({ length: Math.max(1, maxConcurrency) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      await worker(items[current])
    }
  })

  await Promise.all(runners)
}

export const ensureStoragePathsWebp = async (
  event: H3Event,
  inputPaths: Array<string | null | undefined>,
  options: EnsureStoragePathsWebpOptions = {}
): Promise<EnsureStoragePathsWebpResult> => {
  const upsert = options.upsert ?? true
  const continueOnError = options.continueOnError ?? false
  const maxConcurrency = clamp(options.maxConcurrency ?? 2, 1, 6)
  const uniquePaths = [...new Set(inputPaths.filter((path): path is string => Boolean(path)))]
  const pathMap = new Map<string, string>()
  const failures: StoragePathConversionFailure[] = []

  let convertedCount = 0
  let skippedCount = 0

  await mapWithConcurrency(uniquePaths, maxConcurrency, async (sourcePath) => {
    if (isWebpStoragePath(sourcePath)) {
      pathMap.set(sourcePath, sourcePath)
      skippedCount += 1
      return
    }

    try {
      const targetPath = await convertSinglePathToWebp(event, sourcePath, { upsert })
      pathMap.set(sourcePath, targetPath)
      pathMap.set(targetPath, targetPath)
      convertedCount += 1
    } catch (error) {
      const failure = {
        sourcePath,
        message: normalizeErrorMessage(error)
      }

      failures.push(failure)
      if (!continueOnError) {
        throw new Error(`${failure.sourcePath}: ${failure.message}`)
      }
    }
  })

  return {
    pathMap,
    convertedCount,
    skippedCount,
    failures
  }
}

export const rewritePhotoPathsWithMap = <T extends PhotoStoragePathLike>(
  photos: T[],
  pathMap: Map<string, string>
) => {
  return photos.map((photo) => ({
    ...photo,
    imagePath: pathMap.get(photo.imagePath) ?? photo.imagePath,
    thumbPath: photo.thumbPath
      ? (pathMap.get(photo.thumbPath) ?? photo.thumbPath)
      : null
  }))
}