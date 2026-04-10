import { readBody } from 'h3'
import { USERNAME_PATTERN } from '~~/shared/fumo'
import {
  createAdminServerClient,
  requireAuthenticatedUser
} from '~~/server/utils/supabase'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ username?: string }>(event)
  const { user } = await requireAuthenticatedUser(event)

  const username = body.username?.trim().toLowerCase()

  if (!username || !USERNAME_PATTERN.test(username)) {
    throw createError({
      statusCode: 400,
      statusMessage: '作者 ID 需为 3-24 位字母、数字、下划线或短横线'
    })
  }

  const supabase = createAdminServerClient(event)
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      username
    }, {
      onConflict: 'id'
    })
    .select('id, username, avatar_url, role, created_at, updated_at')
    .single()

  if (error || !data) {
    const duplicate = error?.code === '23505'
    throw createError({
      statusCode: duplicate ? 409 : 500,
      statusMessage: duplicate ? '这个作者 ID 已经被使用了' : error?.message || '保存作者 ID 失败'
    })
  }

  return {
    profile: {
      id: data.id,
      username: data.username,
      avatarUrl: data.avatar_url,
      role: data.role,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    }
  }
})
