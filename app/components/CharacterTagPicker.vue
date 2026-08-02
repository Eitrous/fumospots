<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import type { CharacterCatalogItem } from '~~/shared/fumo'
import { getCharacterDisplayName, MAX_POST_CHARACTERS } from '~~/shared/fumo'

const props = withDefaults(defineProps<{
  modelValue: number[]
  characters: CharacterCatalogItem[]
  disabled?: boolean
  max?: number
  displayIcon?: boolean
  borderless?: boolean
  displayCounter?: boolean
}>(), {
  disabled: false,
  max: MAX_POST_CHARACTERS
})

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
}>()

const { t, locale } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const search = ref('')
const open = ref(false)
const hasSearchQuery = computed(() => Boolean(search.value.trim()))

const selectedIdSet = computed(() => new Set(props.modelValue))
const selectedCharacters = computed(() => {
  const byId = new Map(props.characters.map(character => [character.id, character]))
  return props.modelValue
    .map(id => byId.get(id))
    .filter((character): character is CharacterCatalogItem => Boolean(character))
})
const availableCharacters = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()

  return props.characters
    .filter(character => !selectedIdSet.value.has(character.id))
    .filter((character) => {
      if (!query) {
        return true
      }

      return [character.nameEn, character.nameZh, character.nameJa, character.slug]
        .filter(Boolean)
        .some(value => String(value).toLocaleLowerCase().includes(query))
    })
})
const hasReachedLimit = computed(() => props.modelValue.length >= props.max)

const characterName = (character: CharacterCatalogItem) => {
  return getCharacterDisplayName(character, locale.value)
}

const addCharacter = (character: CharacterCatalogItem) => {
  if (props.disabled || hasReachedLimit.value || selectedIdSet.value.has(character.id)) {
    return
  }

  emit('update:modelValue', [...props.modelValue, character.id])
  search.value = ''
  open.value = true
}

const removeCharacter = (characterId: number) => {
  if (props.disabled) {
    return
  }

  emit('update:modelValue', props.modelValue.filter(id => id !== characterId))
}

const handleFocus = () => {
  if (!props.disabled) {
    open.value = true
  }
}

const handleClickOutside = () => {
  open.value = false
}

onClickOutside(rootRef, () => {
  open.value = false
})
</script>

<template>
  <div ref="rootRef" class="character-picker" :class="{ 'is-disabled': disabled }">
    <div class="character-picker__search-layer">
      <div class="character-picker__search" :class="{ 'is-borderless': props.borderless, 'no-counter': !props.displayCounter }">
        <span v-if="props.displayIcon" class="character-picker__search-icon">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
        </span>
        <input
          v-model="search"
          type="search"
          autocomplete="off"
          :disabled="disabled || hasReachedLimit"
          :placeholder="hasReachedLimit ? t('characters.limitReached', { max }) : t('characters.searchPlaceholder')"
          :aria-label="t('characters.searchLabel')"
          @focus="handleFocus"
          @input="open = true"
          @keydown.esc="open = false"
        >
        <span v-if="props.displayCounter" class="character-picker__count">{{ modelValue.length }}/{{ max }}</span>
      </div>

      <div
        v-if="open && hasSearchQuery && availableCharacters.length && !disabled && !hasReachedLimit"
        class="character-picker__menu"
      >
        <button
          v-for="character in availableCharacters"
          :key="character.id"
          type="button"
          @click="addCharacter(character)"
        >
          <span>{{ characterName(character) }}</span>
          <small v-if="characterName(character) !== character.nameEn">{{ character.nameEn }}</small>
        </button>
      </div>
    </div>

    <div v-if="selectedCharacters.length" class="character-picker__tags" aria-live="polite" @click="handleClickOutside">
      <span
        v-for="character in selectedCharacters"
        :key="character.id"
        class="character-picker__tag"
      >
        <span class="character-picker__tag-name">
          <svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em" viewBox="0 0 24 24">
            <path d="M0 0h24v24H0z" fill="none" />
            <path fill="currentColor" d="M12 10a2 2 0 0 0-2 2a2 2 0 0 0 2 2c1.11 0 2-.89 2-2a2 2 0 0 0-2-2" />
          </svg>
          {{ characterName(character) }}
        </span>
        <button
          type="button"
          :disabled="disabled"
          :aria-label="t('characters.remove', { name: characterName(character) })"
          @click="removeCharacter(character.id)"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </span>
    </div>

  </div>
</template>

<style scoped>
.character-picker {
  position: relative;
  display: grid;
  gap: 0.65rem;
}

.character-picker__search-layer {
  position: relative;
  z-index: 1;
}

.character-picker__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.character-picker__tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2rem;
  padding: 0.35rem 0.3rem 0.35rem 0.1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 0.82rem;
  line-height: 1.2;
}

.character-picker__tag-name {
  display: inline-flex;
  align-items: center;
  gap: 0;
}

.character-picker__tag-name svg {
  color: var(--accent);
}

.character-picker__tag button {
  display: inline-grid;
  width: 1.35rem;
  height: 1.35rem;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-muted);
}

.character-picker__tag button:hover,
.character-picker__tag button:focus-visible {
  background: var(--bg);
  color: var(--ink);
}

.character-picker__search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  min-height: 2.85rem;
  padding: 0 0.8rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink-muted);
}

.character-picker__search.is-borderless {
  border: 0;
  background: transparent;
}

.character-picker__search.no-counter {
  grid-template-columns: auto;
  padding-right: 0;
}

.character-picker__search:focus-within {
  border-color: var(--accent);
}

.character-picker__search input {
  min-width: 0;
  height: 2.75rem;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
}

.character-picker__search input::-webkit-search-cancel-button {
  display: none;
}

.character-picker__count {
  font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
}

.character-picker__menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 70;
  display: grid;
  width: 100%;
  max-height: 18rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
}

.character-picker__menu button {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  width: 100%;
  padding: 0.72rem 0.8rem;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: inherit;
  text-align: left;
}

.character-picker__menu button:last-of-type {
  border-bottom: 0;
}

.character-picker__menu button:hover,
.character-picker__menu button:focus-visible {
  background: var(--bg);
  outline: 0;
}

.character-picker__menu small {
  color: var(--ink-muted);
}

.character-picker__menu p {
  margin: 0;
  padding: 0.85rem;
  color: var(--ink-muted);
  font-size: 0.86rem;
}

.character-picker.is-disabled {
  opacity: 0.62;
}
</style>
