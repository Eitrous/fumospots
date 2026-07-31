<script setup lang="ts">
import { MIN_PASSWORD_LENGTH } from '~~/shared/fumo'
import { normalizeApiErrorMessage } from '~~/app/composables/normalizeApiErrorMessage'

type AuthSection = 'login' | 'register'
type AuthMode = 'password' | 'link' | 'register'

const props = withDefaults(defineProps<{
  nextPath?: string | null
}>(), {
  nextPath: null
})
const emit = defineEmits<{
  notice: [message: string]
}>()

const auth = useAuthState()
const { t } = useI18n()
const authSection = ref<AuthSection>('login')
const mode = ref<AuthMode | null>(null)
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const errorMessage = useErrorNoticeState()
const successMessage = ref('')

const fallbackNextPath = computed(() => props.nextPath || '/')
const requiresPassword = computed(() => mode.value !== null && mode.value !== 'link')
const requiresConfirmPassword = computed(() => mode.value === 'register')
const hasSelectedMode = computed(() => mode.value !== null)
const isRegisterSection = computed(() => authSection.value === 'register')
const emailPasswordAuthEnabled = auth.emailPasswordAuthEnabled
const emailLinkAuthEnabled = auth.emailLinkAuthEnabled
const formStackRef = ref<HTMLElement | null>(null)

const resetLocalState = () => {
  mode.value = null
  email.value = ''
  password.value = ''
  confirmPassword.value = ''
  errorMessage.value = ''
  successMessage.value = ''
}

const sectionOptions = computed(() => [
  {
    value: 'login' as const,
    label: t('auth.loginTab'),
    icon: 'fa-right-to-bracket'
  },
  {
    value: 'register' as const,
    label: t('auth.registerTab'),
    icon: 'fa-user-plus'
  }
])

const modeOptions = computed(() => {
  if (isRegisterSection.value) {
    return [
      {
        value: 'register' as const,
        label: t('auth.register'),
        icon: 'fa-envelope',
        disabled: !emailPasswordAuthEnabled.value,
        unavailableMessage: t('auth.passwordAuthTemporarilyUnavailable')
      }
    ]
  }

  return [
    {
      value: 'password' as const,
      label: t('auth.passwordLogin'),
      icon: 'fa-key',
      disabled: !emailPasswordAuthEnabled.value,
      unavailableMessage: t('auth.passwordAuthTemporarilyUnavailable')
    },
    {
      value: 'link' as const,
      label: t('auth.linkLogin'),
      icon: 'fa-envelope',
      disabled: !emailLinkAuthEnabled.value,
      unavailableMessage: t('auth.linkTemporarilyUnavailable')
    }
  ]
})

const oauthOptions = computed(() => {
  const actionLabelKey = isRegisterSection.value ? 'registerLabel' : 'loginLabel'

  return [
    {
      value: 'github' as const,
      label: t(isRegisterSection.value ? 'auth.githubRegister' : 'auth.githubLogin'),
      icon: 'fa-github',
      actionLabel: t(`auth.oauth.${actionLabelKey}`, { provider: 'GitHub' }),
      run: auth.signInWithGitHub
    },
    {
      value: 'google' as const,
      label: t(isRegisterSection.value ? 'auth.googleRegister' : 'auth.googleLogin'),
      icon: 'fa-google',
      actionLabel: t(`auth.oauth.${actionLabelKey}`, { provider: 'Google' }),
      run: auth.signInWithGoogle
    },
    {
      value: 'microsoft' as const,
      label: t(isRegisterSection.value ? 'auth.microsoftRegister' : 'auth.microsoftLogin'),
      icon: 'fa-microsoft',
      actionLabel: t(`auth.oauth.${actionLabelKey}`, { provider: 'Microsoft' }),
      run: auth.signInWithMicrosoft
    }
  ]
})

const panelTitle = computed(() => {
  if (!mode.value) {
    return t('auth.title')
  }

  return t(`auth.modes.${mode.value}.title`)
})

const panelDescription = computed(() => {
  if (!mode.value) {
    return t(isRegisterSection.value ? 'auth.registerDescription' : 'auth.loginDescription')
  }

  return t(`auth.modes.${mode.value}.description`)
})

const primaryActionLabel = computed(() => {
  if (submitting.value) {
    return t('auth.submitting')
  }

  if (!mode.value) {
    return t('auth.title')
  }

  return t(`auth.modes.${mode.value}.submit`)
})

const primaryActionIcon = computed(() => {
  return modeOptions.value.find((option) => option.value === mode.value)?.icon || 'fa-right-to-bracket'
})

const redirectAfterLogin = async () => {
  if (!auth.ready.value || !auth.user.value) {
    return
  }

  if (!auth.viewer.value) {
    await auth.refreshViewer()
  }

  if (!auth.hasUsername.value) {
    await navigateTo(createWorkbenchLocation('onboarding', {
      next: fallbackNextPath.value
    }), { replace: true })
    return
  }

  await navigateTo(fallbackNextPath.value, { replace: true })
}

watch(
  () => [auth.ready.value, auth.user.value?.id, auth.hasUsername.value],
  () => {
    void redirectAfterLogin()
  },
  { immediate: true }
)

const setMode = (nextMode: AuthMode) => {
  const nextOption = modeOptions.value.find((option) => option.value === nextMode)
  if (nextOption?.disabled) {
    errorMessage.value = nextOption.unavailableMessage
    return
  }

  mode.value = nextMode
  errorMessage.value = ''
  successMessage.value = ''

  nextTick(() => {
    formStackRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

const setSection = (nextSection: AuthSection) => {
  if (authSection.value === nextSection) {
    return
  }

  authSection.value = nextSection
  resetLocalState()
}

const validateForm = () => {
  if (!mode.value) {
    errorMessage.value = t('auth.errors.selectMethod')
    return false
  }

  if (!email.value.trim()) {
    errorMessage.value = t('auth.errors.requiredEmail')
    return false
  }

  if (requiresPassword.value && password.value.length < MIN_PASSWORD_LENGTH) {
    errorMessage.value = t('auth.errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH })
    return false
  }

  if (requiresConfirmPassword.value && password.value !== confirmPassword.value) {
    errorMessage.value = t('auth.errors.passwordMismatch')
    return false
  }

  return true
}

const submitAuth = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  const selectedOption = modeOptions.value.find((option) => option.value === mode.value)
  if (selectedOption?.disabled) {
    errorMessage.value = selectedOption.unavailableMessage
    return
  }

  if (!validateForm()) {
    return
  }

  submitting.value = true

  try {
    const nextEmail = email.value.trim()

    if (mode.value === 'password') {
      await auth.signInWithPassword(nextEmail, password.value)
      await redirectAfterLogin()
      return
    }

    if (mode.value === 'register') {
      const data = await auth.signUpWithPassword(nextEmail, password.value)
      if (data.session) {
        await redirectAfterLogin()
        return
      }

      emit('notice', t('auth.registrationNeedsConfirmation'))
      return
    }

    await auth.sendMagicLink(nextEmail, fallbackNextPath.value)
    successMessage.value = t('auth.magicLinkSuccess')
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t(`auth.errors.${mode.value}Failed`))
  } finally {
    submitting.value = false
  }
}

const handleEnter = () => {
  void submitAuth()
}

const submitOAuth = async (
  provider: 'github' | 'google' | 'microsoft',
  signIn: (nextPath?: string) => Promise<unknown>
) => {
  errorMessage.value = ''
  successMessage.value = ''
  submitting.value = true

  try {
    await signIn(fallbackNextPath.value)
  } catch (error) {
    errorMessage.value = normalizeApiErrorMessage(error, t(`auth.errors.${provider}Failed`))
  } finally {
    submitting.value = false
  }
}

const submitGitHub = async () => {
  await submitOAuth('github', auth.signInWithGitHub)
}

const submitGoogle = async () => {
  await submitOAuth('google', auth.signInWithGoogle)
}

const submitMicrosoft = async () => {
  await submitOAuth('microsoft', auth.signInWithMicrosoft)
}

const submitOAuthByProvider = async (provider: 'github' | 'google' | 'microsoft') => {
  if (provider === 'github') {
    await submitGitHub()
    return
  }

  if (provider === 'google') {
    await submitGoogle()
    return
  }

  await submitMicrosoft()
}

const canSubmit = computed(() => {
  const selectedOption = modeOptions.value.find((option) => option.value === mode.value)

  return hasSelectedMode.value
    && !selectedOption?.disabled
    && Boolean(email.value.trim())
    && !submitting.value
})

useWorkbenchToolbarAction(computed(() => ({
  label: primaryActionLabel.value,
  icon: primaryActionIcon.value,
  run: submitAuth,
  disabled: !canSubmit.value,
  loading: submitting.value
})))
</script>

<template>
  <section class="workbench-panel workbench-panel--poster workbench-login-panel">
    <span class="eyebrow">{{ t('auth.eyebrow') }}</span>
    <h2 class="workbench-panel__title workbench-panel__title--poster">{{ panelTitle }}</h2>
    <p class="workbench-panel__copy workbench-panel__copy--poster">{{ panelDescription }}</p>

    <div class="auth-section-switcher" role="tablist" :aria-label="t('auth.sectionLabel')">
      <button
        v-for="option in sectionOptions"
        :key="option.value"
        class="auth-oauth-button auth-section-entry"
        :class="{ 'is-active': authSection === option.value }"
        type="button"
        role="tab"
        :aria-selected="authSection === option.value"
        :title="option.label"
        :aria-label="option.label"
        @click="setSection(option.value)"
      >
        <i class="fa-solid" :class="option.icon" aria-hidden="true" />
        <span>{{ option.label }}</span>
      </button>
    </div>

    <div class="auth-oauth-stack">
      <button
        v-for="option in oauthOptions"
        :key="option.value"
        class="auth-oauth-button"
        type="button"
        :disabled="submitting"
        :title="option.label"
        :aria-label="option.actionLabel"
        @click="submitOAuthByProvider(option.value)"
      >
        <i class="fa-brands" :class="option.icon" aria-hidden="true" />
        <span>{{ option.label }}</span>
      </button>
    </div>

    <div class="auth-mode-stack" role="tablist" :aria-label="t('auth.modeLabel')">
      <button
        v-for="option in modeOptions"
        :key="option.value"
        class="auth-oauth-button auth-mode-entry"
        :class="{
          'is-active': mode === option.value,
          'is-unavailable': option.disabled
        }"
        type="button"
        role="tab"
        :aria-selected="mode === option.value"
        :disabled="submitting || option.disabled"
        :title="option.disabled ? option.unavailableMessage : option.label"
        :aria-label="option.disabled
          ? t('auth.unavailableMethodLabel', { method: option.label })
          : option.label"
        @click="setMode(option.value)"
      >
        <span class="auth-mode-entry__label">
          <i class="fa-solid" :class="option.icon" aria-hidden="true" />
          <span>{{ option.label }}</span>
        </span>
        <span v-if="option.disabled" class="auth-mode-entry__status">
          {{ t('auth.temporarilyUnavailable') }}
        </span>
      </button>
    </div>

    <div v-if="hasSelectedMode" ref="formStackRef" class="auth-form-stack">
      <label class="field-label">
        <span>{{ t('auth.emailLabel') }}</span>
        <input
          v-model="email"
          class="field-input"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          @keyup.enter="handleEnter"
        >
      </label>

      <label v-if="requiresPassword" class="field-label">
        <span>{{ t('auth.passwordLabel') }}</span>
        <input
          v-model="password"
          class="field-input"
          type="password"
          :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
          :placeholder="t('auth.passwordPlaceholder', { min: MIN_PASSWORD_LENGTH })"
          @keyup.enter="handleEnter"
        >
      </label>

      <label v-if="requiresConfirmPassword" class="field-label">
        <span>{{ t('auth.confirmPasswordLabel') }}</span>
        <input
          v-model="confirmPassword"
          class="field-input"
          type="password"
          autocomplete="new-password"
          :placeholder="t('auth.confirmPasswordPlaceholder')"
          @keyup.enter="handleEnter"
        >
      </label>
    </div>

    <p v-if="successMessage" class="success-banner">{{ successMessage }}</p>
  </section>
</template>
