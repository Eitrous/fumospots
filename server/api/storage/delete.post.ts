import { readBody } from 'h3'
import { requireAuthenticatedUser } from '~~/server/utils/supabase'
import { isOwnedStoragePath } from '~~/server/utils/storagePath'
import { deleteStorageObjects } from '~~/server/utils/storage'

type DeleteStorageBody = {
  paths?: unknown
}

const MAX_PATHS_PER_REQUEST = 200

const normalizePaths = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string'))]
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthenticatedUser(event)
  const body = await readBody<DeleteStorageBody>(event)
  const paths = normalizePaths(body?.paths)

  if (!paths.length) {
    return {
      deletedCount: 0
    }
  }

  if (paths.length > MAX_PATHS_PER_REQUEST) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Too many storage paths.'
    })
  }

  for (const path of paths) {
    if (!isOwnedStoragePath(path, user.id)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Storage path is invalid.'
      })
    }
  }

  const deletedCount = await deleteStorageObjects(event, paths)

  return {
    deletedCount
  }
})
