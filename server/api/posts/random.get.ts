import { createError, getQuery, setHeader } from 'h3'
import type { RandomPostResponse } from '~~/shared/fumo'
import { createPublicServerClient } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

const parseExcludedPostId = (raw: unknown) => {
  const value = Array.isArray(raw) ? raw[0] : raw

  if (value == null || value === '') {
    return null
  }

  const id = Number(value)

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid excluded post id.'
    })
  }

  return id
}

export default defineEventHandler(async (event): Promise<RandomPostResponse> => {
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))
  setHeader(event, 'Cache-Control', 'no-store')

  const excludedPostId = parseExcludedPostId(getQuery(event).exclude)
  const supabase = createPublicServerClient(event)

  let countQuery = supabase
    .from('public_approved_posts')
    .select('id', { count: 'exact', head: true })
    .not('public_lat', 'is', null)
    .not('public_lng', 'is', null)

  if (excludedPostId) {
    countQuery = countQuery.neq('id', excludedPostId)
  }

  const { count, error: countError } = await countQuery

  if (countError) {
    throw createError({
      statusCode: 500,
      statusMessage: countError.message
    })
  }

  const availablePosts = count || 0

  if (availablePosts <= 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No random post available.'
    })
  }

  const randomOffset = Math.floor(Math.random() * availablePosts)

  let postQuery = supabase
    .from('public_approved_posts')
    .select('id')
    .not('public_lat', 'is', null)
    .not('public_lng', 'is', null)
    .order('id', { ascending: true })
    .range(randomOffset, randomOffset)

  if (excludedPostId) {
    postQuery = postQuery.neq('id', excludedPostId)
  }

  const { data, error: postError } = await postQuery

  if (postError) {
    throw createError({
      statusCode: 500,
      statusMessage: postError.message
    })
  }

  const id = Number(data?.[0]?.id)

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No random post available.'
    })
  }

  return { id }
})
