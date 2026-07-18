import { customRef, getCurrentScope, onScopeDispose } from 'vue'

export type AppNoticeTone = 'default' | 'success' | 'error'

export type AppNoticeOptions = {
  message: string
  icon?: string
  tone?: AppNoticeTone
  duration?: number
}

export type AppNoticeState = {
  message: string
  icon: string
  tone: AppNoticeTone
  duration: number
}

const DEFAULT_NOTICE_DURATION = 5000

const defaultIconForTone = (tone: AppNoticeTone) => {
  if (tone === 'error') {
    return 'fa-triangle-exclamation'
  }

  if (tone === 'success') {
    return 'fa-circle-check'
  }

  return 'fa-circle-info'
}

export const useAppNotice = () => {
  const notice = useState<AppNoticeState | null>('app-notice', () => null)

  const closeNotice = () => {
    notice.value = null
  }

  const showNotice = (input: string | AppNoticeOptions) => {
    const options: AppNoticeOptions = typeof input === 'string'
      ? { message: input }
      : input
    const message = options.message.trim()

    if (!message) {
      return
    }

    const tone = options.tone ?? 'default'
    notice.value = {
      message,
      tone,
      icon: options.icon ?? defaultIconForTone(tone),
      duration: options.duration ?? DEFAULT_NOTICE_DURATION
    }
  }

  const showErrorNotice = (message: string) => {
    showNotice({
      message,
      tone: 'error'
    })
  }

  return {
    notice,
    showNotice,
    showErrorNotice,
    closeNotice
  }
}

export const useErrorNoticeState = (initialValue = '') => {
  const { showErrorNotice } = useAppNotice()
  let active = true

  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
    })
  }

  return customRef<string>((track, trigger) => {
    let value = initialValue

    return {
      get() {
        track()
        return value
      },
      set(nextValue) {
        value = nextValue
        trigger()

        if (active && nextValue) {
          showErrorNotice(nextValue)
        }
      }
    }
  })
}
