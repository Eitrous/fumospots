import type { SupabaseClient } from '@supabase/supabase-js'
import type { CharacterCatalogItem } from '~~/shared/fumo'

type CharacterRow = {
  id: number
  slug: string
  name_en: string
  name_zh: string | null
  name_ja: string | null
}

type CharacterRelationRow = {
  character_id?: number
  characters?: CharacterRow | CharacterRow[] | null
}

export const normalizeCharacterIds = (value: unknown) => {
  const characterIds = Array.isArray(value)
    ? [...new Set(value)]
    : []

  if (
    characterIds.length < 1
    || characterIds.some(id => !Number.isInteger(id) || Number(id) <= 0)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Please select at least one valid character.'
    })
  }

  return characterIds as number[]
}

export const assertCharacterIdsExist = async (
  supabase: SupabaseClient,
  characterIds: number[]
) => {
  const { data, error } = await supabase
    .from('characters')
    .select('id')
    .in('id', characterIds)

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const foundIds = new Set((data || []).map(row => Number(row.id)))
  if (characterIds.some(id => !foundIds.has(id))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'One or more selected characters are invalid.'
    })
  }
}

export const characterIdsToRows = (
  characterIds: number[],
  parentIdName: 'post_id' | 'revision_id',
  parentId: number
) => {
  return characterIds.map(characterId => ({
    [parentIdName]: parentId,
    character_id: characterId
  }))
}

export const mapCharacterRelations = (
  rows: CharacterRelationRow[] | null | undefined
): CharacterCatalogItem[] => {
  return (rows || [])
    .flatMap((row) => {
      if (!row.characters) {
        return []
      }

      return Array.isArray(row.characters) ? row.characters : [row.characters]
    })
    .map(character => ({
      id: Number(character.id),
      slug: character.slug,
      nameEn: character.name_en,
      nameZh: character.name_zh,
      nameJa: character.name_ja
    }))
}

export const getCharacterIdsFromRelations = (
  rows: CharacterRelationRow[] | null | undefined
) => {
  return (rows || [])
    .map(row => Number(row.character_id))
    .filter(id => Number.isInteger(id) && id > 0)
}
