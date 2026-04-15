import { readBody } from 'h3'
import {
  ensureStoragePathsWebp,
  isWebpStoragePath
} from '~~/server/utils/imageWebp'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

type ConvertBody = {
  batchSize?: number
  dryRun?: boolean
  cursor?: {
    postsAfterId?: number
    revisionsAfterId?: number
  }
}

type CoverRow = {
  id: number
  image_path: string
  thumb_path: string | null
}

type PhotoRow = {
  image_path: string
  thumb_path: string | null
  sort_order: number
}

type PostPhotoRow = PhotoRow & {
  post_id: number
}

type RevisionPhotoRow = PhotoRow & {
  revision_id: number
}

const clampBatchSize = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 30
  }

  return Math.max(1, Math.min(200, Math.round(value)))
}

const toCursorValue = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.floor(value)
}

const needsConversion = (path: string | null | undefined) => {
  return Boolean(path && !isWebpStoragePath(path))
}

const collectConvertiblePaths = (
  ...rows: Array<Array<{ image_path: string; thumb_path: string | null }>>
) => {
  return rows
    .flat()
    .flatMap((row) => [row.image_path, row.thumb_path])
    .filter((path): path is string => needsConversion(path))
}

const mapRowToWebpPaths = (
  row: { image_path: string; thumb_path: string | null },
  pathMap: Map<string, string>
) => {
  const imagePath = pathMap.get(row.image_path) ?? row.image_path
  const thumbPath = row.thumb_path
    ? (pathMap.get(row.thumb_path) ?? row.thumb_path)
    : null

  return {
    imagePath,
    thumbPath,
    changed: imagePath !== row.image_path || thumbPath !== row.thumb_path
  }
}

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)
  const body = await readBody<ConvertBody>(event)
  const dryRun = Boolean(body?.dryRun)
  const batchSize = clampBatchSize(body?.batchSize)
  const postsAfterId = toCursorValue(body?.cursor?.postsAfterId)
  const revisionsAfterId = toCursorValue(body?.cursor?.revisionsAfterId)
  const supabase = createAdminServerClient(event)

  const { data: approvedPosts, error: approvedPostsError } = await supabase
    .from('posts')
    .select('id, image_path, thumb_path')
    .eq('status', 'approved')
    .gt('id', postsAfterId)
    .order('id', { ascending: true })
    .limit(batchSize)

  if (approvedPostsError) {
    throw createError({
      statusCode: 500,
      statusMessage: approvedPostsError.message
    })
  }

  const { data: pendingRevisions, error: pendingRevisionsError } = await supabase
    .from('post_revisions')
    .select('id, image_path, thumb_path')
    .eq('status', 'pending')
    .gt('id', revisionsAfterId)
    .order('id', { ascending: true })
    .limit(batchSize)

  if (pendingRevisionsError) {
    throw createError({
      statusCode: 500,
      statusMessage: pendingRevisionsError.message
    })
  }

  const postIds = (approvedPosts || []).map((row) => row.id)
  const revisionIds = (pendingRevisions || []).map((row) => row.id)

  let approvedPostPhotos: PostPhotoRow[] = []
  if (postIds.length) {
    const { data, error } = await supabase
      .from('post_photos')
      .select('post_id, image_path, thumb_path, sort_order')
      .in('post_id', postIds)

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message
      })
    }

    approvedPostPhotos = (data || []) as PostPhotoRow[]
  }

  let pendingRevisionPhotos: RevisionPhotoRow[] = []
  if (revisionIds.length) {
    const { data, error } = await supabase
      .from('post_revision_photos')
      .select('revision_id, image_path, thumb_path, sort_order')
      .in('revision_id', revisionIds)

    if (error) {
      throw createError({
        statusCode: 500,
        statusMessage: error.message
      })
    }

    pendingRevisionPhotos = (data || []) as RevisionPhotoRow[]
  }

  const conversionResult = await ensureStoragePathsWebp(
    event,
    collectConvertiblePaths(
      (approvedPosts || []) as CoverRow[],
      approvedPostPhotos,
      (pendingRevisions || []) as CoverRow[],
      pendingRevisionPhotos
    ),
    {
      upsert: true,
      continueOnError: true,
      maxConcurrency: 2
    }
  )

  const postCoverUpdates = ((approvedPosts || []) as CoverRow[])
    .map((row) => ({ row, mapped: mapRowToWebpPaths(row, conversionResult.pathMap) }))
    .filter((entry) => entry.mapped.changed)

  const postPhotoUpdates = approvedPostPhotos
    .map((row) => ({ row, mapped: mapRowToWebpPaths(row, conversionResult.pathMap) }))
    .filter((entry) => entry.mapped.changed)

  const revisionCoverUpdates = ((pendingRevisions || []) as CoverRow[])
    .map((row) => ({ row, mapped: mapRowToWebpPaths(row, conversionResult.pathMap) }))
    .filter((entry) => entry.mapped.changed)

  const revisionPhotoUpdates = pendingRevisionPhotos
    .map((row) => ({ row, mapped: mapRowToWebpPaths(row, conversionResult.pathMap) }))
    .filter((entry) => entry.mapped.changed)

  const updateFailures: Array<{ scope: string; key: string; message: string }> = []
  const updatedCounts = {
    postCovers: 0,
    postPhotos: 0,
    revisionCovers: 0,
    revisionPhotos: 0
  }

  if (!dryRun) {
    for (const entry of postCoverUpdates) {
      const { error } = await supabase
        .from('posts')
        .update({
          image_path: entry.mapped.imagePath,
          thumb_path: entry.mapped.thumbPath
        })
        .eq('id', entry.row.id)

      if (error) {
        updateFailures.push({
          scope: 'posts',
          key: String(entry.row.id),
          message: error.message
        })
        continue
      }

      updatedCounts.postCovers += 1
    }

    for (const entry of postPhotoUpdates) {
      const { error } = await supabase
        .from('post_photos')
        .update({
          image_path: entry.mapped.imagePath,
          thumb_path: entry.mapped.thumbPath
        })
        .eq('post_id', entry.row.post_id)
        .eq('sort_order', entry.row.sort_order)

      if (error) {
        updateFailures.push({
          scope: 'post_photos',
          key: `${entry.row.post_id}:${entry.row.sort_order}`,
          message: error.message
        })
        continue
      }

      updatedCounts.postPhotos += 1
    }

    for (const entry of revisionCoverUpdates) {
      const { error } = await supabase
        .from('post_revisions')
        .update({
          image_path: entry.mapped.imagePath,
          thumb_path: entry.mapped.thumbPath
        })
        .eq('id', entry.row.id)

      if (error) {
        updateFailures.push({
          scope: 'post_revisions',
          key: String(entry.row.id),
          message: error.message
        })
        continue
      }

      updatedCounts.revisionCovers += 1
    }

    for (const entry of revisionPhotoUpdates) {
      const { error } = await supabase
        .from('post_revision_photos')
        .update({
          image_path: entry.mapped.imagePath,
          thumb_path: entry.mapped.thumbPath
        })
        .eq('revision_id', entry.row.revision_id)
        .eq('sort_order', entry.row.sort_order)

      if (error) {
        updateFailures.push({
          scope: 'post_revision_photos',
          key: `${entry.row.revision_id}:${entry.row.sort_order}`,
          message: error.message
        })
        continue
      }

      updatedCounts.revisionPhotos += 1
    }
  }

  const lastPostId = approvedPosts?.at(-1)?.id ?? postsAfterId
  const lastRevisionId = pendingRevisions?.at(-1)?.id ?? revisionsAfterId

  return {
    dryRun,
    batchSize,
    processed: {
      approvedPosts: approvedPosts?.length ?? 0,
      approvedPostPhotos: approvedPostPhotos.length,
      pendingRevisions: pendingRevisions?.length ?? 0,
      pendingRevisionPhotos: pendingRevisionPhotos.length
    },
    wouldUpdate: {
      postCovers: postCoverUpdates.length,
      postPhotos: postPhotoUpdates.length,
      revisionCovers: revisionCoverUpdates.length,
      revisionPhotos: revisionPhotoUpdates.length
    },
    updated: updatedCounts,
    conversions: {
      convertedPaths: conversionResult.convertedCount,
      skippedPaths: conversionResult.skippedCount,
      failedPaths: conversionResult.failures.length,
      failures: conversionResult.failures
    },
    updates: {
      failedRows: updateFailures.length,
      failures: updateFailures
    },
    cursor: {
      postsAfterId: lastPostId,
      revisionsAfterId: lastRevisionId
    },
    hasMore: (approvedPosts?.length ?? 0) === batchSize || (pendingRevisions?.length ?? 0) === batchSize
  }
})