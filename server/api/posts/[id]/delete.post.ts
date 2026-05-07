import { getRouterParam } from 'h3'
import { createAdminServerClient, requireAuthenticatedUser } from '~~/server/utils/supabase'
import { isOwnedStoragePath } from '~~/server/utils/storagePath'
import { deleteStorageObjects } from '~~/server/utils/storage'

type PostRow = {
  id: number
  user_id: string
  image_path: string | null
  thumb_path: string | null
}

type PhotoPathRow = {
  image_path: string | null
  thumb_path: string | null
}

type RevisionRow = {
  id: number
  image_path: string | null
  thumb_path: string | null
}

const collectOwnedPaths = (rows: PhotoPathRow[], userId: string, collector: Set<string>) => {
  for (const row of rows) {
    if (isOwnedStoragePath(row.image_path, userId)) {
      collector.add(row.image_path)
    }

    if (isOwnedStoragePath(row.thumb_path, userId)) {
      collector.add(row.thumb_path)
    }
  }
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid post id.'
    })
  }

  const { user } = await requireAuthenticatedUser(event)
  const supabase = createAdminServerClient(event)

  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, user_id, image_path, thumb_path')
    .eq('id', id)
    .maybeSingle<PostRow>()

  if (postError) {
    throw createError({
      statusCode: 500,
      statusMessage: postError.message
    })
  }

  if (!post) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Post not found.'
    })
  }

  if (post.user_id !== user.id) {
    throw createError({
      statusCode: 403,
      statusMessage: 'You can only delete your own posts.'
    })
  }

  const storagePaths = new Set<string>()
  if (isOwnedStoragePath(post.image_path, user.id)) {
    storagePaths.add(post.image_path)
  }
  if (isOwnedStoragePath(post.thumb_path, user.id)) {
    storagePaths.add(post.thumb_path)
  }

  const [{ data: postPhotos, error: postPhotosError }, { data: revisions, error: revisionsError }] = await Promise.all([
    supabase
      .from('post_photos')
      .select('image_path, thumb_path')
      .eq('post_id', id),
    supabase
      .from('post_revisions')
      .select('id, image_path, thumb_path')
      .eq('post_id', id)
  ])

  if (postPhotosError) {
    throw createError({
      statusCode: 500,
      statusMessage: postPhotosError.message
    })
  }

  if (revisionsError) {
    throw createError({
      statusCode: 500,
      statusMessage: revisionsError.message
    })
  }

  collectOwnedPaths((postPhotos || []) as PhotoPathRow[], user.id, storagePaths)
  collectOwnedPaths((revisions || []) as RevisionRow[], user.id, storagePaths)

  const revisionIds = ((revisions || []) as RevisionRow[]).map((revision) => revision.id)
  if (revisionIds.length) {
    const { data: revisionPhotos, error: revisionPhotosError } = await supabase
      .from('post_revision_photos')
      .select('image_path, thumb_path')
      .in('revision_id', revisionIds)

    if (revisionPhotosError) {
      throw createError({
        statusCode: 500,
        statusMessage: revisionPhotosError.message
      })
    }

    collectOwnedPaths((revisionPhotos || []) as PhotoPathRow[], user.id, storagePaths)
  }

  const { data: deletedPost, error: deleteError } = await supabase
    .from('posts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle<{ id: number }>()

  if (deleteError) {
    throw createError({
      statusCode: 500,
      statusMessage: deleteError.message
    })
  }

  if (!deletedPost) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Post not found.'
    })
  }

  if (storagePaths.size) {
    try {
      await deleteStorageObjects(event, [...storagePaths])
    } catch {
      // Keep deletion successful even if storage cleanup fails.
    }
  }

  return {
    id,
    success: true
  }
})
