import { Redis } from '@upstash/redis'
import {
  getRequestHeader,
  getRequestIP,
  getRequestURL,
  type H3Event
} from 'h3'

type SecurityAlertSeverity = 'info' | 'warning' | 'critical'

type SecurityAlertInput = {
  type: string
  severity: SecurityAlertSeverity
  message: string
  fingerprint: string
  metadata?: Record<string, unknown>
}

const ALERT_PREFIX = 'fumo:security-alert'
const ALERT_COOLDOWN_SECONDS = 60 * 5
const REQUEST_IP_FALLBACK = 'unknown'
const WEBHOOK_TIMEOUT_MS = 1500

let alertRedis: Redis | null = null
let warnedAlertsDisabled = false
let warnedMissingWebhook = false
const localCooldowns = new Map<string, number>()

const hasUpstashConfig = () => {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

const getAlertRedis = () => {
  if (!hasUpstashConfig()) {
    return null
  }

  if (!alertRedis) {
    alertRedis = Redis.fromEnv()
  }

  return alertRedis
}

const getAlertIp = (event: H3Event) => {
  return (
    getRequestIP(event, { xForwardedFor: true })
    || getRequestHeader(event, 'x-real-ip')
    || REQUEST_IP_FALLBACK
  )
}

const shouldSendAlert = async (fingerprint: string) => {
  const now = Date.now()
  const localExpiresAt = localCooldowns.get(fingerprint)
  if (localExpiresAt && localExpiresAt > now) {
    return false
  }

  localCooldowns.set(fingerprint, now + ALERT_COOLDOWN_SECONDS * 1000)

  const redis = getAlertRedis()
  if (!redis) {
    return true
  }

  try {
    const redisKey = `${ALERT_PREFIX}:cooldown:${fingerprint}`
    const result = await redis.set(redisKey, '1', {
      ex: ALERT_COOLDOWN_SECONDS,
      nx: true
    })

    return result === 'OK'
  } catch (error) {
    console.warn('[security-alert] Redis cooldown check failed.', error)
    return true
  }
}

const compactMetadata = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (typeof value === 'string' && value.length > 500) {
        return [key, `${value.slice(0, 500)}...`]
      }

      return [key, value]
    })
  )
}

export const notifySecurityAlert = async (
  event: H3Event,
  input: SecurityAlertInput
) => {
  try {
    const config = useRuntimeConfig(event)

    if (!config.securityAlertsEnabled) {
      if (!warnedAlertsDisabled) {
        warnedAlertsDisabled = true
        console.warn('Security alert webhook is disabled because SECURITY_ALERTS_ENABLED is not true.')
      }
      return
    }

    if (!await shouldSendAlert(input.fingerprint)) {
      return
    }

    const webhookUrl = config.securityAlertWebhookUrl || process.env.SECURITY_ALERT_WEBHOOK_URL
    const webhookToken = config.securityAlertWebhookToken || process.env.SECURITY_ALERT_WEBHOOK_TOKEN
    const url = getRequestURL(event)

    const payload = {
      type: input.type,
      severity: input.severity,
      message: input.message,
      path: url.pathname,
      method: event.method,
      ip: getAlertIp(event),
      userAgent: getRequestHeader(event, 'user-agent') || null,
      fingerprint: input.fingerprint,
      metadata: compactMetadata(input.metadata),
      timestamp: new Date().toISOString()
    }

    console.warn('[security-alert]', payload)

    if (!webhookUrl) {
      if (!warnedMissingWebhook) {
        warnedMissingWebhook = true
        console.warn('Security alert webhook is disabled because SECURITY_ALERT_WEBHOOK_URL is missing.')
      }
      return
    }

    await $fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {})
      },
      body: payload,
      timeout: WEBHOOK_TIMEOUT_MS
    })
  } catch (error) {
    console.warn('[security-alert] Failed to send alert.', error)
  }
}
