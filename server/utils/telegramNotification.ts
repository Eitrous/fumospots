import type { H3Event } from 'h3'
import { createAdminServerClient } from '~~/server/utils/supabase'

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org'
const TELEGRAM_TIMEOUT_MS = 2000
const NEW_SUBMISSION_PREFIX = '\u6709\u65b0\u7684\u6295\u7a3f\u3002\u65f6\u95f4\uff1a'
const PENDING_REVIEW_COUNT_LABEL = '\u3002\u5f53\u524d\u672a\u5ba1\u6838\u6570\u91cf\uff1a'
const MESSAGE_SUFFIX = '\u3002'

let warnedMissingTelegramConfig = false

const formatShanghaiTime = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)

  const getPart = (type: Intl.DateTimeFormatPartTypes) => {
    return parts.find((part) => part.type === type)?.value || '00'
  }

  return `${getPart('year')}-${getPart('month')}-${getPart('day')} ${getPart('hour')}:${getPart('minute')}:${getPart('second')}`
}

const getPendingReviewCount = async (event: H3Event) => {
  const supabase = createAdminServerClient(event)

  const [{ count: pendingPosts, error: postsError }, { count: pendingRevisions, error: revisionsError }] = await Promise.all([
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('post_revisions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
  ])

  if (postsError || revisionsError) {
    throw new Error(postsError?.message || revisionsError?.message || 'Failed to count pending reviews.')
  }

  return (pendingPosts || 0) + (pendingRevisions || 0)
}

export const notifyTelegramNewSubmission = async (event: H3Event) => {
  try {
    const config = useRuntimeConfig(event)
    const botToken = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN
    const chatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID

    if (!botToken || !chatId) {
      if (!warnedMissingTelegramConfig) {
        warnedMissingTelegramConfig = true
        console.warn('Telegram submission notification is disabled because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.')
      }
      return
    }

    const submittedAt = formatShanghaiTime(new Date())
    const pendingReviewCount = await getPendingReviewCount(event)

    await $fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, {
      method: 'POST',
      body: {
        chat_id: chatId,
        text: `${NEW_SUBMISSION_PREFIX}${submittedAt}${PENDING_REVIEW_COUNT_LABEL}${pendingReviewCount}${MESSAGE_SUFFIX}`,
        disable_web_page_preview: true
      },
      timeout: TELEGRAM_TIMEOUT_MS
    })
  } catch (error) {
    console.warn('[telegram-notification] Failed to send new submission notification.', error)
  }
}
