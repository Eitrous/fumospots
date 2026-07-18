<script setup lang="ts">
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

const props = withDefaults(defineProps<{
  nextPath?: string | null
}>(), {
  nextPath: null
})

const auth = useAuthState()
const { t } = useI18n()
const username = ref('')
const saving = ref(false)
const errorMessage = useErrorNoticeState()

const fallbackNextPath = computed(() => props.nextPath || '/')

const suggestUsername = () => {
  const email = auth.viewer.value?.email || ''
  const local = email.split('@')[0]?.toLowerCase() || 'fumo_traveler'
  return local.replace(/[^a-z0-9_-]+/g, '_').slice(0, 24)
}

watch(
  () => [auth.ready.value, auth.user.value?.id, auth.viewer.value?.profile.username],
  () => {
    if (!auth.ready.value) {
      return
    }

    if (!auth.user.value) {
      void navigateTo(createWorkbenchLocation('login', {
        next: fallbackNextPath.value
      }), { replace: true })
      return
    }

    if (auth.hasUsername.value) {
      void navigateTo(fallbackNextPath.value, { replace: true })
      return
    }

    if (!username.value) {
      username.value = suggestUsername()
    }
  },
  { immediate: true }
)

const canSubmit = computed(() => {
  return Boolean(username.value.trim()) && !saving.value
})

const submitUsername = async () => {
  errorMessage.value = ''

  if (!username.value.trim()) {
    errorMessage.value = t('onboarding.errors.required')
    return
  }

  saving.value = true

  try {
    await $fetch('/api/profile/setup', {
      method: 'POST',
      headers: auth.authHeaders.value,
      body: {
        username: username.value.trim()
      }
    })

    await auth.refreshViewer()
    await navigateTo(fallbackNextPath.value, { replace: true })
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t('onboarding.errors.saveFailed'))
  } finally {
    saving.value = false
  }
}

useWorkbenchToolbarAction(computed(() => ({
  label: saving.value ? t('onboarding.saving') : t('onboarding.submit'),
  icon: 'fa-id-card',
  run: submitUsername,
  disabled: !canSubmit.value,
  loading: saving.value
})))
</script>

<template>
  <section class="workbench-panel workbench-panel--poster">
    <span class="eyebrow">{{ t('onboarding.eyebrow') }}</span>
    <h2 class="workbench-panel__title workbench-panel__title--poster">{{ t('onboarding.title') }}</h2>
    <p class="workbench-panel__copy workbench-panel__copy--poster">{{ t('onboarding.description') }}</p>

    <label class="field-label">
      <span>{{ t('onboarding.label') }}</span>
      <input
        v-model="username"
        class="field-input"
        maxlength="24"
        placeholder="marisa_fumo_trip"
        @keyup.enter="submitUsername"
      >
    </label>
  </section>
</template>
