import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { H3Event } from 'h3'
import { Readable } from 'node:stream'

type R2ResolvedConfig = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicBaseUrl: string
  signedUrlTtlSeconds: number
}

type SignUploadOptions = {
  contentLength: number
  contentType: string
  preventOverwrite?: boolean
}

type UploadStorageObjectOptions = {
  contentType?: string
  upsert?: boolean
}

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 30
const MIN_SIGNED_URL_TTL_SECONDS = 30
const MAX_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24
const MAX_DELETE_BATCH = 1000

export const IMMUTABLE_STORAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

let cachedClient: S3Client | null = null
let cachedClientKey = ''

const asTrimmedString = (value: unknown) => {
  return typeof value === 'string' ? value.trim() : ''
}

const clampNumber = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value))
}

const toSignedUrlTtlSeconds = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS
  }

  return clampNumber(Math.floor(parsed), MIN_SIGNED_URL_TTL_SECONDS, MAX_SIGNED_URL_TTL_SECONDS)
}

const createServerConfigError = (statusMessage: string) => {
  return createError({
    statusCode: 500,
    statusMessage
  })
}

const resolveR2Config = (event: H3Event): R2ResolvedConfig => {
  const runtimeConfig = useRuntimeConfig(event)

  const accountId = asTrimmedString(runtimeConfig.r2AccountId)
  const endpointFromConfig = asTrimmedString(runtimeConfig.r2Endpoint)
  const endpoint = endpointFromConfig || (accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : '')
  const bucket = asTrimmedString(runtimeConfig.r2Bucket)
  const accessKeyId = asTrimmedString(runtimeConfig.r2AccessKeyId)
  const secretAccessKey = asTrimmedString(runtimeConfig.r2SecretAccessKey)
  const publicBaseUrl = asTrimmedString(runtimeConfig.r2PublicBaseUrl).replace(/\/+$/, '')
  const signedUrlTtlSeconds = toSignedUrlTtlSeconds(runtimeConfig.r2SignedUrlTtlSeconds)

  if (!endpoint) {
    throw createServerConfigError('R2 endpoint is missing. Set R2_ENDPOINT or R2_ACCOUNT_ID.')
  }

  if (!bucket) {
    throw createServerConfigError('R2 bucket is missing. Set R2_BUCKET.')
  }

  if (!accessKeyId || !secretAccessKey) {
    throw createServerConfigError('R2 credentials are missing. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.')
  }

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    signedUrlTtlSeconds
  }
}

const getR2Client = (event: H3Event) => {
  const config = resolveR2Config(event)
  const cacheKey = [config.endpoint, config.accessKeyId, config.bucket].join('|')

  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
    cachedClientKey = cacheKey
  }

  return {
    client: cachedClient,
    config
  }
}

const isNotFoundError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const maybeError = error as {
    name?: unknown
    Code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }

  const statusCode = Number(maybeError.$metadata?.httpStatusCode)
  if (statusCode === 404) {
    return true
  }

  const name = typeof maybeError.name === 'string' ? maybeError.name : ''
  const code = typeof maybeError.Code === 'string' ? maybeError.Code : ''

  return name === 'NotFound' || name === 'NoSuchKey' || code === 'NoSuchKey'
}

const streamToBuffer = async (stream: Readable) => {
  const chunks: Buffer[] = []

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

const webStreamToBuffer = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    if (value) {
      chunks.push(value)
    }
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return Buffer.from(merged)
}

const bodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0)
  }

  if (Buffer.isBuffer(body)) {
    return body
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }

  if (body instanceof Readable) {
    return streamToBuffer(body)
  }

  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer())
  }

  if (
    typeof body === 'object'
    && body
    && 'getReader' in body
    && typeof (body as ReadableStream<Uint8Array>).getReader === 'function'
  ) {
    return webStreamToBuffer(body as ReadableStream<Uint8Array>)
  }

  throw new Error('Unsupported storage body type.')
}

const chunkArray = <T>(items: T[], chunkSize: number) => {
  if (!items.length) {
    return [] as T[][]
  }

  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize))
  }

  return chunks
}

export const createSignedDownloadUrlMap = async (
  event: H3Event,
  paths: Array<string | null | undefined>,
  _expiresIn?: number
) => {
  const uniquePaths = [...new Set(paths.filter(Boolean) as string[])]
  if (!uniquePaths.length) {
    return new Map<string, string>()
  }

  const { config } = getR2Client(event)

  if (!config.publicBaseUrl) {
    throw createServerConfigError('R2 public base URL is missing. Set R2_PUBLIC_BASE_URL.')
  }

  const toPublicObjectUrl = (path: string) => {
    const encodedPath = path
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/')

    return `${config.publicBaseUrl}/${encodedPath}`
  }

  return new Map(uniquePaths.map((path) => [path, toPublicObjectUrl(path)]))
}

export const createSignedUploadUrl = async (
  event: H3Event,
  path: string,
  options: SignUploadOptions
) => {
  const { client, config } = getR2Client(event)
  const ttl = clampNumber(
    config.signedUrlTtlSeconds,
    MIN_SIGNED_URL_TTL_SECONDS,
    MAX_SIGNED_URL_TTL_SECONDS
  )

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: path,
    CacheControl: IMMUTABLE_STORAGE_CACHE_CONTROL,
    ContentLength: options.contentLength,
    ContentType: options.contentType,
    IfNoneMatch: options.preventOverwrite === false ? undefined : '*'
  })

  return getSignedUrl(client, command, {
    expiresIn: ttl,
    signableHeaders: new Set([
      'cache-control',
      'content-length',
      'content-type',
      'if-none-match'
    ])
  })
}

export const ensureStorageObjectMissing = async (event: H3Event, path: string) => {
  const { client, config } = getR2Client(event)

  try {
    await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: path
    }))
  } catch (error) {
    if (isNotFoundError(error)) {
      return
    }

    throw error
  }

  throw createError({
    statusCode: 409,
    statusMessage: 'Storage object already exists.'
  })
}

export const downloadStorageObject = async (event: H3Event, path: string) => {
  const { client, config } = getR2Client(event)

  const response = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: path
  }))

  return {
    buffer: await bodyToBuffer(response.Body),
    contentType: response.ContentType || null
  }
}

export const uploadStorageObject = async (
  event: H3Event,
  path: string,
  payload: Buffer,
  options: UploadStorageObjectOptions = {}
) => {
  const { client, config } = getR2Client(event)
  const upsert = options.upsert ?? true

  if (!upsert) {
    try {
      await client.send(new HeadObjectCommand({
        Bucket: config.bucket,
        Key: path
      }))

      throw new Error(`Object already exists at ${path}.`)
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }
  }

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: path,
    Body: payload,
    CacheControl: IMMUTABLE_STORAGE_CACHE_CONTROL,
    ContentType: options.contentType || 'application/octet-stream'
  }))
}

export const deleteStorageObjects = async (
  event: H3Event,
  paths: Array<string | null | undefined>
) => {
  const uniquePaths = [...new Set(paths.filter(Boolean) as string[])]
  if (!uniquePaths.length) {
    return 0
  }

  const { client, config } = getR2Client(event)
  let deletedCount = 0

  for (const pathsChunk of chunkArray(uniquePaths, MAX_DELETE_BATCH)) {
    const result = await client.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: {
        Objects: pathsChunk.map((path) => ({ Key: path })),
        Quiet: false
      }
    }))

    if (result.Errors?.length) {
      const firstError = result.Errors[0]
      throw new Error(
        `Failed to delete storage objects: ${firstError.Key || 'unknown'} ${firstError.Code || ''}`.trim()
      )
    }

    deletedCount += result.Deleted?.length || 0
  }

  return deletedCount
}
