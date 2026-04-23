import { getHeader } from 'h3'
import type { H3Event } from 'h3'
import type { GeocodeResult, LatLng } from '~~/shared/fumo'

type NominatimAddress = {
  attraction?: string
  city?: string
  city_district?: string
  country?: string
  country_code?: string
  county?: string
  hamlet?: string
  neighbourhood?: string
  region?: string
  state?: string
  suburb?: string
  town?: string
  village?: string
}

type NominatimEntry = {
  display_name: string
  lat: string
  lon: string
  name?: string
  address?: NominatimAddress
}

export type NominatimSearchEntry = NominatimEntry & {
  boundingbox?: string[]
  geojson?: GeoJSON.Geometry | null
}

type SearchNominatimOptions = {
  limit?: number
  polygonGeoJson?: boolean
  acceptLanguage?: string
}

type LocationScopeFields = {
  countryName: string | null | undefined
  regionName: string | null | undefined
  cityName: string | null | undefined
}

export const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,en'
const TAIWAN_COUNTRY_CODE = 'tw'
const CHINA_COUNTRY_ALIASES = new Set(['china', '\u4e2d\u56fd'])
const TAIWAN_COUNTRY_ALIASES = new Set([
  'taiwan',
  '\u53f0\u6e7e',
  '\u53f0\u7063',
  '\u81fa\u7063'
])
const TAIWAN_PROVINCE_ALIASES = new Set([
  'taiwan province',
  '\u53f0\u6e7e\u7701',
  '\u53f0\u7063\u7701',
  '\u81fa\u7063\u7701'
])

export type GeocodeLocale = 'zh-CN' | 'en' | 'ja'

const TAIWAN_POLITICAL_LABELS: Record<GeocodeLocale, {
  countryName: string
  regionName: string
}> = {
  'zh-CN': {
    countryName: '\u4e2d\u56fd',
    regionName: '\u53f0\u6e7e\u7701'
  },
  en: {
    countryName: 'China',
    regionName: 'Taiwan Province'
  },
  ja: {
    countryName: '\u4e2d\u56fd',
    regionName: '\u53f0\u6e7e\u7701'
  }
}

const pickPlaceName = (entry: NominatimEntry) => {
  const address = entry.address || {}
  return (
    entry.name ||
    address.attraction ||
    address.city ||
    address.town ||
    address.village ||
    address.county ||
    entry.display_name.split(',')[0] ||
    '\u672a\u547d\u540d\u5730\u70b9'
  )
}

const normalizeLocationValue = (value: string | null | undefined) => {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() || ''
}

export const normalizeGeocodeLocale = (
  acceptLanguage: string | null | undefined
): GeocodeLocale => {
  const candidates = String(acceptLanguage || '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase())
    .filter(Boolean)

  for (const candidate of candidates) {
    if (candidate.startsWith('zh')) {
      return 'zh-CN'
    }

    if (candidate.startsWith('ja')) {
      return 'ja'
    }

    if (candidate.startsWith('en')) {
      return 'en'
    }
  }

  return 'zh-CN'
}

export const getTaiwanPoliticalLabels = (acceptLanguage = DEFAULT_ACCEPT_LANGUAGE) => {
  return TAIWAN_POLITICAL_LABELS[normalizeGeocodeLocale(acceptLanguage)]
}

const getTaiwanCityName = (address: NominatimAddress) => {
  return (
    address.city ||
    address.county ||
    address.town ||
    address.village ||
    address.city_district ||
    address.suburb ||
    address.neighbourhood ||
    address.hamlet ||
    null
  )
}

const isTaiwanAddress = (address: NominatimAddress) => {
  return address.country_code?.trim().toLowerCase() === TAIWAN_COUNTRY_CODE
}

export const isChinaCountryValue = (value: string | null | undefined) => {
  return CHINA_COUNTRY_ALIASES.has(normalizeLocationValue(value))
}

export const isTaiwanCountryValue = (value: string | null | undefined) => {
  return TAIWAN_COUNTRY_ALIASES.has(normalizeLocationValue(value))
}

export const isTaiwanProvinceValue = (value: string | null | undefined) => {
  return TAIWAN_PROVINCE_ALIASES.has(normalizeLocationValue(value))
}

export const isTaiwanLocationScope = (scope: LocationScopeFields) => {
  return isTaiwanCountryValue(scope.countryName) || isTaiwanProvinceValue(scope.regionName)
}

export const normalizeLocationScopeForLocale = <T extends LocationScopeFields>(
  scope: T,
  acceptLanguage = DEFAULT_ACCEPT_LANGUAGE
) => {
  const countryName = scope.countryName?.trim() || null
  const regionName = scope.regionName?.trim() || null
  const cityName = scope.cityName?.trim() || null

  if (isTaiwanProvinceValue(regionName) || isTaiwanCountryValue(countryName)) {
    const labels = getTaiwanPoliticalLabels(acceptLanguage)
    const normalizedCityName = isTaiwanProvinceValue(regionName)
      ? cityName
      : regionName || cityName

    return {
      ...scope,
      countryName: labels.countryName,
      regionName: labels.regionName,
      cityName: normalizedCityName
    }
  }

  return {
    ...scope,
    countryName,
    regionName,
    cityName
  }
}

export const normalizeGeocodeResult = (
  entry: NominatimEntry,
  acceptLanguage = DEFAULT_ACCEPT_LANGUAGE
): GeocodeResult => {
  const address = entry.address || {}
  const baseResult = {
    displayName: entry.display_name,
    placeName: pickPlaceName(entry),
    lat: Number(entry.lat),
    lng: Number(entry.lon)
  }

  if (isTaiwanAddress(address)) {
    const labels = getTaiwanPoliticalLabels(acceptLanguage)

    return {
      ...baseResult,
      countryName: labels.countryName,
      regionName: labels.regionName,
      cityName: getTaiwanCityName(address)
    }
  }

  return {
    ...baseResult,
    countryName: address.country || null,
    regionName: address.state || address.region || address.county || null,
    cityName:
      address.city ||
      address.town ||
      address.village ||
      address.city_district ||
      address.suburb ||
      address.neighbourhood ||
      address.hamlet ||
      null
  }
}

export const getPreferredGeocodeAcceptLanguage = (event: H3Event) => {
  return getHeader(event, 'accept-language') || DEFAULT_ACCEPT_LANGUAGE
}

const getNominatimHeaders = (event: H3Event, acceptLanguage = DEFAULT_ACCEPT_LANGUAGE) => {
  const config = useRuntimeConfig(event)

  return {
    'User-Agent': config.geocodeUserAgent,
    'Accept-Language': acceptLanguage
  }
}

export const fetchSearchGeocodeEntries = async (
  event: H3Event,
  q: string,
  options: SearchNominatimOptions = {}
) => {
  const config = useRuntimeConfig(event)

  return await $fetch<NominatimSearchEntry[]>(`${config.geocodeBaseUrl}/search`, {
    query: {
      q,
      format: 'jsonv2',
      addressdetails: 1,
      limit: options.limit ?? 6,
      polygon_geojson: options.polygonGeoJson ? 1 : undefined
    },
    headers: getNominatimHeaders(event, options.acceptLanguage)
  })
}

export const fetchReverseGeocodeResult = async (
  event: H3Event,
  location: LatLng,
  acceptLanguage = DEFAULT_ACCEPT_LANGUAGE
) => {
  const config = useRuntimeConfig(event)
  const result = await $fetch<NominatimEntry>(`${config.geocodeBaseUrl}/reverse`, {
    query: {
      lat: location.lat,
      lon: location.lng,
      format: 'jsonv2',
      addressdetails: 1
    },
    headers: getNominatimHeaders(event, acceptLanguage)
  })

  return normalizeGeocodeResult(result, acceptLanguage)
}
