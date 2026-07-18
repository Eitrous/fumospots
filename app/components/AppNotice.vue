<script setup lang="ts">
import type { AppNoticeState } from '~~/app/composables/useAppNotice'

const { t } = useI18n()
const { notice, closeNotice } = useAppNotice()

let closeTimer: ReturnType<typeof setTimeout> | null = null

const clearCloseTimer = () => {
  if (!closeTimer) {
    return
  }

  clearTimeout(closeTimer)
  closeTimer = null
}

const scheduleClose = (nextNotice: AppNoticeState | null) => {
  clearCloseTimer()

  if (!import.meta.client || !nextNotice || nextNotice.duration <= 0) {
    return
  }

  closeTimer = setTimeout(() => {
    closeNotice()
  }, nextNotice.duration)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (!notice.value || event.key !== 'Escape') {
    return
  }

  event.preventDefault()
  closeNotice()
}

watch(notice, scheduleClose, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  clearCloseTimer()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition name="workbench-notice">
    <div
      v-if="notice"
      class="workbench-like-dialog workbench-notice"
      :class="`is-${notice.tone}`"
      :role="notice.tone === 'error' ? 'alert' : 'status'"
      :aria-live="notice.tone === 'error' ? 'assertive' : 'polite'"
      aria-atomic="true"
    >
      <div class="workbench-like-dialog__panel workbench-notice__panel">
        <i
          class="workbench-like-dialog__icon fa-solid"
          :class="notice.icon"
          aria-hidden="true"
        />
        <p>{{ notice.message }}</p>
        <button
          class="workbench-icon-button workbench-like-dialog__close"
          type="button"
          :aria-label="t('common.close')"
          @click="closeNotice"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true" />
          <span class="sr-only">{{ t('common.close') }}</span>
        </button>
      </div>
    </div>
  </Transition>
</template>
