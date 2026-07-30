import type { PublicMapPreviewResponse } from '~~/shared/fumo'
import { setPublicApiCacheControl } from '~~/server/utils/cacheControl'
import { createPublicServerClient, signStorageObjects } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type MapPreviewRow = {
  id: number
  title: string
  image_path: string
  thumb_path: string | null
  captured_at: string | null
  created_at: string | null
}

const MAX_PREVIEW_IDS = 100

const parseIds = (value: unknown) => {
  const raw = typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.join(',')
      : ''

  const ids: number[] = []
  const seen = new Set<number>()

  for (const part of raw.split(',')) {
    const id = Number(part.trim())
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) {
      continue
    }

    ids.push(id)
    seen.add(id)

    if (ids.length >= MAX_PREVIEW_IDS) {
      break
    }
  }

  return ids
}

const sortPreviewRows = (rows: MapPreviewRow[]) => {
  return rows.slice().sort((left, right) => {
    const leftCaptured = left.captured_at || ''
    const rightCaptured = right.captured_at || ''

    if (leftCaptured !== rightCaptured) {
      return rightCaptured.localeCompare(leftCaptured)
    }

    return String(right.created_at || '').localeCompare(String(left.created_at || ''))
  })
}

export default defineEventHandler(async (event): Promise<PublicMapPreviewResponse> => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const ids = parseIds(getQuery(event).ids)
  if (!ids.length) {
    setPublicApiCacheControl(event)
    return {
      items: []
    }
  }

  const supabase = createPublicServerClient(event)
  const { data, error } = await supabase
    .from('public_approved_posts')
    .select(`
      id,
      title,
      image_path,
      thumb_path,
      captured_at,
      created_at
    `)
    .in('id', ids)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const rows = sortPreviewRows((data || []) as MapPreviewRow[])
  const coverPathById = new Map<number, string>()

  for (const row of rows) {
    coverPathById.set(row.id, row.thumb_path || row.image_path)
  }

  const coverUrls = await signStorageObjects(event, [...coverPathById.values()], 60 * 30)

  setPublicApiCacheControl(event)

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      thumbUrl: coverUrls.get(coverPathById.get(row.id) || '') ?? null
    }))
  }
})
