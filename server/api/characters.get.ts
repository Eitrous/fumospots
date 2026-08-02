import type { CharacterCatalogResponse } from '~~/shared/fumo'
import { setPublicApiCacheControl } from '~~/server/utils/cacheControl'
import { createPublicServerClient } from '~~/server/utils/supabase'

export default defineEventHandler(async (event): Promise<CharacterCatalogResponse> => {
  const supabase = createPublicServerClient(event)
  const { data, error } = await supabase
    .from('characters')
    .select('id, slug, name_en, name_zh, name_ja')
    .order('sort_order', { ascending: true })

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  setPublicApiCacheControl(event)

  return {
    items: (data || []).map(character => ({
      id: Number(character.id),
      slug: character.slug,
      nameEn: character.name_en,
      nameZh: character.name_zh,
      nameJa: character.name_ja
    }))
  }
})
