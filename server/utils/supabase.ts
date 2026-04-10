import { createClient } from '@supabase/supabase-js'
import { getHeader, type H3Event } from 'h3'
import type { User } from '@supabase/supabase-js'
import type { AppProfile } from '~~/shared/fumo'
import { STORAGE_BUCKET } from '~~/shared/fumo'

type ProfileRow = {
  id: string
  username: string | null
  avatar_url: string | null
  role: 'user' | 'admin'
  created_at: string | null
  updated_at: string | null
}

const PROFILE_FIELDS = 'id, username, avatar_url, role, created_at, updated_at'

export const createPublicServerClient = (event: H3Event, accessToken?: string) => {
  const config = useRuntimeConfig(event)

  return createClient(
    config.public.supabaseUrl,
    config.public.supabaseAnonKey,
    {
      global: accessToken
        ? {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        : undefined,
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

export const createAdminServerClient = (event: H3Event) => {
  const config = useRuntimeConfig(event)

  if (!config.supabaseServiceRoleKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'SUPABASE_SERVICE_ROLE_KEY is missing.'
    })
  }

  return createClient(
    config.public.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

export const getAccessToken = (event: H3Event) => {
  const authorization = getHeader(event, 'authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  const token = authorization.slice('Bearer '.length).trim()
  return token || null
}

const mapProfileRow = (profile: ProfileRow): AppProfile => {
  return {
    id: profile.id,
    username: profile.username,
    avatarUrl: profile.avatar_url,
    role: profile.role,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at
  }
}

export const ensureProfile = async (event: H3Event, user: User) => {
  const admin = createAdminServerClient(event)
  const { error: upsertError } = await admin
    .from('profiles')
    .upsert({ id: user.id }, { onConflict: 'id' })

  if (upsertError) {
    throw createError({
      statusCode: 500,
      statusMessage: upsertError.message
    })
  }

  const { data, error } = await admin
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', user.id)
    .single<ProfileRow>()

  if (error || !data) {
    throw createError({
      statusCode: 500,
      statusMessage: error?.message || 'Failed to load profile.'
    })
  }

  return mapProfileRow(data)
}

export const requireAuthenticatedUser = async (event: H3Event) => {
  const accessToken = getAccessToken(event)
  if (!accessToken) {
    throw createError({
      statusCode: 401,
      statusMessage: '缺少登录令牌'
    })
  }

  const supabase = createPublicServerClient(event, accessToken)
  const { data, error } = await supabase.auth.getUser(accessToken)

  if (error || !data.user) {
    throw createError({
      statusCode: 401,
      statusMessage: '登录状态已失效'
    })
  }

  return {
    accessToken,
    user: data.user
  }
}

export const requireAdminUser = async (event: H3Event) => {
  const auth = await requireAuthenticatedUser(event)
  const profile = await ensureProfile(event, auth.user)

  if (profile.role !== 'admin') {
    throw createError({
      statusCode: 403,
      statusMessage: '需要管理员权限'
    })
  }

  return {
    ...auth,
    profile
  }
}

export const signStorageObject = async (
  event: H3Event,
  path?: string | null,
  expiresIn = 60 * 60
) => {
  if (!path) {
    return null
  }

  const admin = createAdminServerClient(event)
  const { data, error } = await admin
    .storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn)

  if (error) {
    return null
  }

  return data.signedUrl
}

export const signStorageObjects = async (
  event: H3Event,
  paths: Array<string | null | undefined>,
  expiresIn = 60 * 30
) => {
  const uniquePaths = [...new Set(paths.filter(Boolean) as string[])]
  if (!uniquePaths.length) {
    return new Map<string, string>()
  }

  const admin = createAdminServerClient(event)
  const { data, error } = await admin
    .storage
    .from(STORAGE_BUCKET)
    .createSignedUrls(uniquePaths, expiresIn)

  if (error || !data) {
    return new Map<string, string>()
  }

  return new Map(
    data
      .filter((entry) => Boolean(entry.path && entry.signedUrl))
      .map((entry) => [entry.path, entry.signedUrl as string])
  )
}
