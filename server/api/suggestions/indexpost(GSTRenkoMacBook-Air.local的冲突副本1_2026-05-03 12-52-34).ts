import { readBody } from 'h3'
import {
  MAX_SUGGESTION_LENGTH,
  type SubmitSuggestionPayload,
  type SuggestionSubmitResponse
} from '~~/shared/fumo'
import {
  createPublicServerClient,
  ensureProfile,
  requireAuthenticatedUser
} from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, 'submitIp', getRateLimitIdentifier(event))

  const body = await readBody<SubmitSuggestionPayload>(event)
  const { accessToken, user } = await requireAuthenticatedUser(event)
  await enforceRateLimit(event, 'submitUser', user.id)

  const profile = await ensureProfile(event, user, accessToken)
  const content = body.content?.trim()

  if (!content) {
    throw createError({
      statusCode: 400,
      statusMessage: '建议内容不能为空。'
    })
  }

  if (content.length > MAX_SUGGESTION_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `建议内容不能超过 ${MAX_SUGGESTION_LENGTH} 个字符。`
    })
  }

  const supabase = createPublicServerClient(event, accessToken)
  const { error } = await supabase
    .from('suggestions')
    .insert({
      user_id: profile.id,
      content
    })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error?.message || '建议提交失败。'
    })
  }

  setResponseStatus(event, 201)

  const response: SuggestionSubmitResponse = {
    success: true
  }

  return response
})
