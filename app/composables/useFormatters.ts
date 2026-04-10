import type { LatLng, PrivacyMode } from '~~/shared/fumo'

export const useFormatters = () => {
  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })

  const formatDateTime = (value?: string | null) => {
    if (!value) {
      return '未提供'
    }

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '未提供' : dateFormatter.format(date)
  }

  const formatLatLng = (value?: LatLng | null) => {
    if (!value) {
      return '未标注'
    }

    return `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
  }

  const privacyModeLabel = (mode: PrivacyMode) => {
    return mode === 'exact' ? '公开精确坐标' : '公开近似位置'
  }

  return {
    formatDateTime,
    formatLatLng,
    privacyModeLabel
  }
}
