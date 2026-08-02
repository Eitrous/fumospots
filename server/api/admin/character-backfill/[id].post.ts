import { getRouterParam, readBody } from 'h3'
import {
  assertCharacterIdsExist,
  characterIdsToRows,
  normalizeCharacterIds
} from '~~/server/utils/characters'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid post id.'
    })
  }

  const body = await readBody<{ characterIds?: unknown }>(event)
  const characterIds = normalizeCharacterIds(body?.characterIds)
  const supabase = createAdminServerClient(event)
  await assertCharacterIdsExist(supabase, characterIds)

  const { data: candidate, error: candidateError } = await supabase
    .from('admin_character_backfill_posts')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (candidateError) {
    throw createError({
      statusCode: 500,
      statusMessage: candidateError.message
    })
  }

  if (!candidate) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Post is no longer eligible for character backfill.'
    })
  }

  const { error } = await supabase
    .from('post_characters')
    .insert(characterIdsToRows(characterIds, 'post_id', id))

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  return {
    success: true,
    id
  }
})
