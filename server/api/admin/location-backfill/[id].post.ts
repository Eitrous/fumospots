import { getRouterParam, readBody } from 'h3'
import { createAdminServerClient, requireAdminUser } from '~~/server/utils/supabase'

type LocationBackfillUpdateBody = {
  countryName?: string | null
  regionName?: string | null
  cityName?: string | null
}

const normalizeField = (value: unknown) => {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null
}

export default defineEventHandler(async (event) => {
  await requireAdminUser(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid post id.'
    })
  }

  const body = await readBody<LocationBackfillUpdateBody>(event)
  const countryName = normalizeField(body?.countryName)
  const regionName = normalizeField(body?.regionName)
  const cityName = normalizeField(body?.cityName)

  if (!regionName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Region is required.'
    })
  }

  const supabase = createAdminServerClient(event)
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, post_revisions!left(id)')
    .eq('id', id)
    .eq('status', 'approved')
    .is('post_revisions.id', null)
    .maybeSingle()

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

  const { error: updateError } = await supabase
    .from('posts')
    .update({
      country_name: countryName,
      region_name: regionName,
      city_name: cityName
    })
    .eq('id', id)

  if (updateError) {
    throw createError({
      statusCode: 500,
      statusMessage: updateError.message
    })
  }

  return {
    success: true,
    id
  }
})
