<script setup lang="ts">
import type { SubmitSuggestionPayload } from '~~/shared/fumo'
import { MAX_SUGGESTION_LENGTH } from '~~/shared/fumo'

definePageMeta({
  middleware: ['require-auth']
})

const auth = useAuthState()
const { t } = useI18n()

useTheme()
useHead({
  bodyAttrs: {
    class: 'suggestions-page-body'
  }
})

const content = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const contentLength = computed(() => content.value.length)
const submitLabel = computed(() => {
  return submitting.value
    ? t('suggestions.submitting')
    : t('suggestions.submit')
})

const normalizeApiErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const maybeError = error as {
      statusMessage?: unknown
      data?: { statusMessage?: unknown }
    }

    if (typeof maybeError.statusMessage === 'string' && maybeError.statusMessage.trim()) {
      return maybeError.statusMessage
    }

    if (typeof maybeError.data?.statusMessage === 'string' && maybeError.data.statusMessage.trim()) {
      return maybeError.data.statusMessage
    }
  }

  return fallback
}

const submitSuggestion = async () => {
  successMessage.value = ''
  errorMessage.value = ''

  const trimmed = content.value.trim()

  if (!trimmed) {
    errorMessage.value = t('suggestions.errors.required')
    return
  }

  if (trimmed.length > MAX_SUGGESTION_LENGTH) {
    errorMessage.value = t('suggestions.errors.tooLong', {
      max: MAX_SUGGESTION_LENGTH
    })
    return
  }

  await auth.init()

  if (!auth.authHeaders.value.Authorization) {
    errorMessage.value = t('suggestions.errors.sessionExpired')
    return
  }

  submitting.value = true

  try {
    const payload: SubmitSuggestionPayload = {
      content: trimmed
    }

    await $fetch('/api/suggestions', {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: payload
    })

    content.value = ''
    successMessage.value = t('suggestions.success')
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t('suggestions.errors.submitFailed'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="page-shell suggestions-page">
    <section class="panel panel--page suggestions-panel">
      <div class="suggestions-panel__head">
        <div class="suggestions-panel__head-row">
          <NuxtLink
            class="workbench-icon-button"
            to="/"
            :title="t('suggestions.backHome')"
            :aria-label="t('suggestions.backHome')"
          >
            <i class="button-icon fa-solid fa-arrow-left" aria-hidden="true" />
            <span class="sr-only">{{ t('suggestions.backHome') }}</span>
          </NuxtLink>
        </div>

        <h1 class="page-title">{{ t('suggestions.title') }}</h1>
        <p class="lede">{{ t('suggestions.description') }}</p>
      </div>
      <div>一些常见问题及答复请见<a class="submit-guide-link" href="https://blog.0x-3f.com/2026/04/12/fumospots_manual/#FAQ">FAQ</a></div>
      <form class="suggestions-panel__form" @submit.prevent="submitSuggestion">
        <label class="field-label">
          <span>{{ t('suggestions.fieldLabel') }}</span>
          <textarea
            v-model="content"
            class="field-textarea suggestions-panel__textarea"
            :maxlength="MAX_SUGGESTION_LENGTH"
            :placeholder="t('suggestions.placeholder')"
          />
        </label>

        <div class="suggestions-panel__actions">
          <p class="status-inline">
            {{ t('suggestions.counter', { count: contentLength, max: MAX_SUGGESTION_LENGTH }) }}
          </p>

          <button
            class="workbench-icon-button workbench-icon-button--primary suggestions-submit-button"
            type="submit"
            :title="submitLabel"
            :aria-label="submitLabel"
            :disabled="submitting"
          >
            <i
              class="button-icon fa-solid"
              :class="submitting ? 'fa-spinner fa-spin' : 'fa-paper-plane'"
              aria-hidden="true"
            />
            <span class="sr-only">{{ submitLabel }}</span>
          </button>
        </div>
      </form>

      <p v-if="successMessage" class="success-banner">{{ successMessage }}</p>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.submit-guide-link {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  width: fit-content;
  color: var(--accent);
  font-size: 0.92rem;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 0.18em;
}

.submit-guide-link:hover,
.submit-guide-link:focus-visible {
  color: var(--accent-deep);
}
</style>