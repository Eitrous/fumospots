import { readBody } from 'h3'
import type { SubmitPostPayload } from '~~/shared/fumo'
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH
} from '~~/shared/fumo'
import {
  createAdminServerClient,
  ensureProfile,
  requireAuthenticatedUser
} from '~~/server/utils/supabase'

const isValidLatLng = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const maybe = value as { lat?: unknown; lng?: unknown }
  return typeof maybe.lat === 'number'
    && typeof maybe.lng === 'number'
    && maybe.lat >= -90
    && maybe.lat <= 90
    && maybe.lng >= -180
    && maybe.lng <= 180
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SubmitPostPayload>(event)
  const { user } = await requireAuthenticatedUser(event)
  const profile = await ensureProfile(event, user)

  if (!profile.username) {
    throw createError({
      statusCode: 412,
      statusMessage: '请先设置作者 ID'
    })
  }

  const title = body.title?.trim()
  const placeName = body.placeName?.trim()
  const normalizedBody = body.body?.trim() || null

  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: '标题不能为空，且长度不能超过 80 个字符'
    })
  }

  if (normalizedBody && normalizedBody.length > MAX_BODY_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: '留言长度不能超过 1000 个字符'
    })
  }

  if (!body.imagePath || !body.imagePath.startsWith(`${user.id}/`)) {
    throw createError({
      statusCode: 400,
      statusMessage: '图片路径不合法'
    })
  }

  if (body.thumbPath && !body.thumbPath.startsWith(`${user.id}/`)) {
    throw createError({
      statusCode: 400,
      statusMessage: '缩略图路径不合法'
    })
  }

  if (!isValidLatLng(body.exactLocation) || !isValidLatLng(body.publicLocation)) {
    throw createError({
      statusCode: 400,
      statusMessage: '坐标信息不合法'
    })
  }

  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : null
  if (body.capturedAt && Number.isNaN(capturedAt?.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: '拍摄时间格式不正确'
    })
  }

  const supabase = createAdminServerClient(event)
  const publicLocation = body.privacyMode === 'exact'
    ? body.exactLocation
    : body.publicLocation

  const { data, error } = await supabase
    .from('posts')
    .insert({
      user_id: user.id,
      title,
      body: normalizedBody,
      image_path: body.imagePath,
      thumb_path: body.thumbPath || null,
      captured_at: capturedAt?.toISOString() || null,
      exact_lat: body.exactLocation.lat,
      exact_lng: body.exactLocation.lng,
      public_lat: publicLocation.lat,
      public_lng: publicLocation.lng,
      privacy_mode: body.privacyMode,
      place_name: placeName || null,
      country_name: body.countryName || null,
      region_name: body.regionName || null,
      city_name: body.cityName || null,
      status: 'pending',
      review_note: null,
      approved_at: null,
      approved_by: null
    })
    .select('id, status')
    .single()

  if (error || !data) {
    throw createError({
      statusCode: 500,
      statusMessage: error?.message || '投稿保存失败'
    })
  }

  setResponseStatus(event, 201)
  return data
})
