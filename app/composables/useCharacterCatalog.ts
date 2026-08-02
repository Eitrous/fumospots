import type { CharacterCatalogItem, CharacterCatalogResponse } from '~~/shared/fumo'

let catalogRequest: Promise<CharacterCatalogItem[]> | null = null

export const useCharacterCatalog = () => {
  const characters = useState<CharacterCatalogItem[]>('character-catalog-items', () => [])
  const loading = useState<boolean>('character-catalog-loading', () => false)
  const error = useState<string>('character-catalog-error', () => '')

  const loadCharacters = async (force = false) => {
    if (characters.value.length && !force) {
      return characters.value
    }

    if (!catalogRequest) {
      loading.value = true
      error.value = ''
      catalogRequest = $fetch<CharacterCatalogResponse>('/api/characters')
        .then((response) => {
          characters.value = response.items
          return response.items
        })
        .catch((requestError) => {
          error.value = requestError instanceof Error ? requestError.message : 'Failed to load characters.'
          return characters.value
        })
        .finally(() => {
          loading.value = false
          catalogRequest = null
        })
    }

    return await catalogRequest
  }

  return {
    characters,
    loading,
    error,
    loadCharacters
  }
}
