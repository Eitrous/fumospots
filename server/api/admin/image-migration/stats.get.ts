import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'
import { isWebpStoragePath } from '~~/server/utils/imageWebp'

type ImagePathRow = {
  image_path: string
  thumb_path: string | null
}

const needsConversion = (path: string | null | undefined) => {
  return Boolean(path && !isWebpStoragePath(path))
}

const collectPendingPaths = (rows: ImagePathRow[]) => {
  const pendingPaths = new Set<string>()

  for (const row of rows) {
    if (needsConversion(row.image_path)) {
      pendingPaths.add(row.image_path)
    }

    if (needsConversion(row.thumb_path)) {
      pendingPaths.add(row.thumb_path as string)
    }
  }

  return pendingPaths
}

const summarizeRows = (rows: ImagePathRow[]) => {
  let pendingRows = 0
  const pendingPaths = collectPendingPaths(rows)

  for (const row of rows) {
    const rowNeedsConversion = needsConversion(row.image_path) || needsConversion(row.thumb_path)

    if (!rowNeedsConversion) {
      continue
    }

    pendingRows += 1

  }

  return {
    totalRows: rows.length,
    pendingRows,
    pendingPaths: pendingPaths.size
  }
}

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)
  const supabase = createAdminServerClient(event)

  const { data: approvedPosts, error: approvedPostsError } = await supabase
    .from('posts')
    .select('image_path, thumb_path')
    .eq('status', 'approved')

  if (approvedPostsError) {
    throw createError({
      statusCode: 500,
      statusMessage: approvedPostsError.message
    })
  }

  const { data: approvedPostPhotos, error: approvedPostPhotosError } = await supabase
    .from('public_approved_post_photos')
    .select('image_path, thumb_path')

  if (approvedPostPhotosError) {
    throw createError({
      statusCode: 500,
      statusMessage: approvedPostPhotosError.message
    })
  }

  const { data: pendingRevisions, error: pendingRevisionsError } = await supabase
    .from('post_revisions')
    .select('id, image_path, thumb_path')
    .eq('status', 'pending')

  if (pendingRevisionsError) {
    throw createError({
      statusCode: 500,
      statusMessage: pendingRevisionsError.message
    })
  }

  const pendingRevisionIds = (pendingRevisions || []).map((row) => row.id)
  let pendingRevisionPhotos: ImagePathRow[] = []

  if (pendingRevisionIds.length) {
    const { data: photos, error: pendingRevisionPhotosError } = await supabase
      .from('post_revision_photos')
      .select('image_path, thumb_path')
      .in('revision_id', pendingRevisionIds)

    if (pendingRevisionPhotosError) {
      throw createError({
        statusCode: 500,
        statusMessage: pendingRevisionPhotosError.message
      })
    }

    pendingRevisionPhotos = photos || []
  }

  const approvedPostCoverSummary = summarizeRows((approvedPosts || []) as ImagePathRow[])
  const approvedPostPhotoSummary = summarizeRows((approvedPostPhotos || []) as ImagePathRow[])
  const pendingRevisionCoverSummary = summarizeRows((pendingRevisions || []) as ImagePathRow[])
  const pendingRevisionPhotoSummary = summarizeRows(pendingRevisionPhotos)
  const allPendingPaths = new Set([
    ...collectPendingPaths((approvedPosts || []) as ImagePathRow[]),
    ...collectPendingPaths((approvedPostPhotos || []) as ImagePathRow[]),
    ...collectPendingPaths((pendingRevisions || []) as ImagePathRow[]),
    ...collectPendingPaths(pendingRevisionPhotos)
  ])

  return {
    approvedPosts: {
      coverRows: approvedPostCoverSummary,
      photoRows: approvedPostPhotoSummary
    },
    pendingRevisions: {
      coverRows: pendingRevisionCoverSummary,
      photoRows: pendingRevisionPhotoSummary
    },
    totals: {
      pendingRows:
        approvedPostCoverSummary.pendingRows
        + approvedPostPhotoSummary.pendingRows
        + pendingRevisionCoverSummary.pendingRows
        + pendingRevisionPhotoSummary.pendingRows,
      pendingPaths: allPendingPaths.size
    }
  }
})