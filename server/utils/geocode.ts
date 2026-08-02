import { getHeader } from 'h3'
import type { H3Event } from 'h3'
import type { GeocodeResult, LatLng } from '~~/shared/fumo'

type NominatimAddress = {
  'ISO3166-2-lvl4'?: string
  attraction?: string
  city?: string
  city_district?: string
  country?: string
  country_code?: string
  county?: string
  hamlet?: string
  neighbourhood?: string
  province?: string
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

export type GeocodeLocale = 'zh-CN' | 'en' | 'ja'

export const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,en'
const CHINA_COUNTRY_CODE = 'cn'
const INDIA_COUNTRY_CODE = 'in'
const SOUTH_TIBET_ISO_3166_2_CODE = 'IN-AR'
const TAIWAN_COUNTRY_CODE = 'tw'
const CHINA_COUNTRY_ALIASES = new Set(['china', '\u4e2d\u56fd'])
const INDIA_COUNTRY_ALIASES = new Set(['india', '\u5370\u5ea6', '\u30a4\u30f3\u30c9'])
const SOUTH_TIBET_REGION_ALIASES = new Set([
  'south tibet',
  'arunachal pradesh',
  '\u85cf\u5357',
  '\u85cf\u5357\u5730\u533a',
  '\u85cf\u5357\u5730\u5340',
  '\u963f\u9c81\u7eb3\u6070\u5c14\u90a6',
  '\u963f\u9b6f\u7d0d\u6070\u723e\u90a6',
  '\u963f\u9c81\u7eb3\u67e5\u5c14\u90a6',
  '\u30a2\u30eb\u30ca\u30fc\u30c1\u30e3\u30eb\u30fb\u30d7\u30e9\u30c7\u30fc\u30b7\u30e5\u5dde'
])
const TIBET_REGION_ALIASES = new Set([
  'tibet',
  'tibet autonomous region',
  '\u897f\u85cf',
  '\u897f\u85cf\u81ea\u6cbb\u533a',
  '\u897f\u85cf\u81ea\u6cbb\u5340',
  '\u30c1\u30d9\u30c3\u30c8\u81ea\u6cbb\u533a'
])
// Coordinate-verified resident-point matches from Tibet's 2024 standard-map
// databases and the Ministry of Civil Affairs' standardized-name batches.
// Do not add phonetic guesses here.
const SOUTH_TIBET_STANDARD_PLACE_LABELS: Record<GeocodeLocale, Record<string, string>> = {
  'zh-CN': {
    tawang: '\u8fbe\u65fa',
    '\u8fbe\u65fa': '\u8fbe\u65fa',
    bomdila: '\u90a6\u8fea\u62c9',
    '\u90a6\u8fea\u62c9': '\u90a6\u8fea\u62c9',
    tuting: '\u90fd\u767b',
    '\u90fd\u767b': '\u90fd\u767b',
    mipi: '\u7c73\u57f9',
    '\u7c73\u57f9': '\u7c73\u57f9',
    gelling: '\u66f4\u4ec1',
    '\u66f4\u4ec1': '\u66f4\u4ec1'
  },
  en: {
    tawang: 'Tawang',
    '\u8fbe\u65fa': 'Tawang',
    bomdila: 'Bomdila',
    '\u90a6\u8fea\u62c9': 'Bomdila',
    tuting: 'Duding',
    '\u90fd\u767b': 'Duding',
    mipi: 'Migpain',
    '\u7c73\u57f9': 'Migpain',
    gelling: 'Gengren',
    '\u66f4\u4ec1': 'Gengren'
  },
  ja: {
    tawang: '\u8fbe\u65fa',
    '\u8fbe\u65fa': '\u8fbe\u65fa',
    bomdila: '\u90a6\u8fea\u62c9',
    '\u90a6\u8fea\u62c9': '\u90a6\u8fea\u62c9',
    tuting: '\u90fd\u767b',
    '\u90fd\u767b': '\u90fd\u767b',
    mipi: '\u7c73\u57f9',
    '\u7c73\u57f9': '\u7c73\u57f9',
    gelling: '\u66f4\u4ec1',
    '\u66f4\u4ec1': '\u66f4\u4ec1'
  }
}
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
const CHINA_SUBDIVISION_LABELS_ZH_BY_CODE: Record<string, string> = {
  'CN-AH': '\u5b89\u5fbd\u7701',
  'CN-BJ': '\u5317\u4eac\u5e02',
  'CN-CQ': '\u91cd\u5e86\u5e02',
  'CN-FJ': '\u798f\u5efa\u7701',
  'CN-GD': '\u5e7f\u4e1c\u7701',
  'CN-GS': '\u7518\u8083\u7701',
  'CN-GX': '\u5e7f\u897f\u58ee\u65cf\u81ea\u6cbb\u533a',
  'CN-GZ': '\u8d35\u5dde\u7701',
  'CN-HA': '\u6cb3\u5357\u7701',
  'CN-HB': '\u6e56\u5317\u7701',
  'CN-HE': '\u6cb3\u5317\u7701',
  'CN-HI': '\u6d77\u5357\u7701',
  'CN-HK': '\u9999\u6e2f\u7279\u522b\u884c\u653f\u533a',
  'CN-HL': '\u9ed1\u9f99\u6c5f\u7701',
  'CN-HN': '\u6e56\u5357\u7701',
  'CN-JL': '\u5409\u6797\u7701',
  'CN-JS': '\u6c5f\u82cf\u7701',
  'CN-JX': '\u6c5f\u897f\u7701',
  'CN-LN': '\u8fbd\u5b81\u7701',
  'CN-MO': '\u6fb3\u95e8\u7279\u522b\u884c\u653f\u533a',
  'CN-NM': '\u5185\u8499\u53e4\u81ea\u6cbb\u533a',
  'CN-NX': '\u5b81\u590f\u56de\u65cf\u81ea\u6cbb\u533a',
  'CN-QH': '\u9752\u6d77\u7701',
  'CN-SC': '\u56db\u5ddd\u7701',
  'CN-SD': '\u5c71\u4e1c\u7701',
  'CN-SH': '\u4e0a\u6d77\u5e02',
  'CN-SN': '\u9655\u897f\u7701',
  'CN-SX': '\u5c71\u897f\u7701',
  'CN-TJ': '\u5929\u6d25\u5e02',
  'CN-XJ': '\u65b0\u7586\u7ef4\u543e\u5c14\u81ea\u6cbb\u533a',
  'CN-XZ': '\u897f\u85cf\u81ea\u6cbb\u533a',
  'CN-YN': '\u4e91\u5357\u7701',
  'CN-ZJ': '\u6d59\u6c5f\u7701'
}
const CHINA_SUBDIVISION_LABELS_BY_CODE: Record<GeocodeLocale, Record<string, string>> = {
  'zh-CN': CHINA_SUBDIVISION_LABELS_ZH_BY_CODE,
  en: {
    'CN-AH': 'Anhui',
    'CN-BJ': 'Beijing',
    'CN-CQ': 'Chongqing',
    'CN-FJ': 'Fujian',
    'CN-GD': 'Guangdong',
    'CN-GS': 'Gansu',
    'CN-GX': 'Guangxi',
    'CN-GZ': 'Guizhou',
    'CN-HA': 'Henan',
    'CN-HB': 'Hubei',
    'CN-HE': 'Hebei',
    'CN-HI': 'Hainan',
    'CN-HK': 'Hong Kong',
    'CN-HL': 'Heilongjiang',
    'CN-HN': 'Hunan',
    'CN-JL': 'Jilin',
    'CN-JS': 'Jiangsu',
    'CN-JX': 'Jiangxi',
    'CN-LN': 'Liaoning',
    'CN-MO': 'Macao',
    'CN-NM': 'Inner Mongolia',
    'CN-NX': 'Ningxia',
    'CN-QH': 'Qinghai',
    'CN-SC': 'Sichuan',
    'CN-SD': 'Shandong',
    'CN-SH': 'Shanghai',
    'CN-SN': 'Shaanxi',
    'CN-SX': 'Shanxi',
    'CN-TJ': 'Tianjin',
    'CN-XJ': 'Xinjiang',
    'CN-XZ': 'Tibet',
    'CN-YN': 'Yunnan',
    'CN-ZJ': 'Zhejiang'
  },
  ja: CHINA_SUBDIVISION_LABELS_ZH_BY_CODE
}

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

const SOUTH_TIBET_POLITICAL_LABELS: Record<GeocodeLocale, {
  countryName: string
  regionName: string
}> = {
  'zh-CN': {
    countryName: '\u4e2d\u56fd',
    regionName: '\u897f\u85cf\u81ea\u6cbb\u533a'
  },
  en: {
    countryName: 'China',
    regionName: 'Tibet Autonomous Region'
  },
  ja: {
    countryName: '\u4e2d\u56fd',
    regionName: '\u897f\u85cf\u81ea\u6cbb\u533a'
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
    .map((part) => (part.split(';')[0] || '').trim().toLowerCase())
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

export const getSouthTibetPoliticalLabels = (acceptLanguage = DEFAULT_ACCEPT_LANGUAGE) => {
  return SOUTH_TIBET_POLITICAL_LABELS[normalizeGeocodeLocale(acceptLanguage)]
}

const getSouthTibetStandardPlaceName = (
  value: string | null | undefined,
  acceptLanguage: string
) => {
  if (!value) {
    return null
  }

  const locale = normalizeGeocodeLocale(acceptLanguage)
  return SOUTH_TIBET_STANDARD_PLACE_LABELS[locale][normalizeLocationValue(value)] || value
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

const getChinaSubdivisionNameFromIsoCode = (
  address: NominatimAddress,
  acceptLanguage: string
) => {
  if (address.country_code?.trim().toLowerCase() !== CHINA_COUNTRY_CODE) {
    return null
  }

  const code = address['ISO3166-2-lvl4']?.trim().toUpperCase()
  if (!code) {
    return null
  }

  return CHINA_SUBDIVISION_LABELS_BY_CODE[normalizeGeocodeLocale(acceptLanguage)][code] || null
}

const getRegionName = (address: NominatimAddress, acceptLanguage: string) => {
  return (
    address.state ||
    address.province ||
    address.region ||
    getChinaSubdivisionNameFromIsoCode(address, acceptLanguage) ||
    address.county ||
    null
  )
}

const getCityName = (address: NominatimAddress, regionName: string | null) => {
  const cityName = (
    address.city ||
    address.town ||
    address.village ||
    address.city_district ||
    address.suburb ||
    address.neighbourhood ||
    address.hamlet ||
    null
  )

  if (regionName && normalizeLocationValue(cityName) === normalizeLocationValue(regionName)) {
    return (
      address.city_district ||
      address.county ||
      address.suburb ||
      address.neighbourhood ||
      address.hamlet ||
      cityName
    )
  }

  return cityName
}

const isTaiwanAddress = (address: NominatimAddress) => {
  return address.country_code?.trim().toLowerCase() === TAIWAN_COUNTRY_CODE
}

const isSouthTibetAddress = (address: NominatimAddress) => {
  const countryCode = address.country_code?.trim().toLowerCase()
  const subdivisionCode = address['ISO3166-2-lvl4']?.trim().toUpperCase()
  const regionValues = [address.state, address.province, address.region]

  return subdivisionCode === SOUTH_TIBET_ISO_3166_2_CODE
    || (
      countryCode === INDIA_COUNTRY_CODE
      && regionValues.some((value) => SOUTH_TIBET_REGION_ALIASES.has(normalizeLocationValue(value)))
    )
}

const normalizeSouthTibetDisplayName = (
  displayName: string,
  labels: { countryName: string, regionName: string },
  acceptLanguage: string
) => {
  const normalizedParts: string[] = []
  const seenParts = new Set<string>()

  for (const rawPart of displayName.split(',')) {
    const part = rawPart.trim()
    const normalizedPart = normalizeLocationValue(part)
    const politicalPart = SOUTH_TIBET_REGION_ALIASES.has(normalizedPart)
      ? labels.regionName
      : INDIA_COUNTRY_ALIASES.has(normalizedPart)
        ? labels.countryName
        : part
    const nextPart = getSouthTibetStandardPlaceName(politicalPart, acceptLanguage) || politicalPart
    const dedupeKey = normalizeLocationValue(nextPart)

    if (!nextPart || seenParts.has(dedupeKey)) {
      continue
    }

    seenParts.add(dedupeKey)
    normalizedParts.push(nextPart)
  }

  return normalizedParts.join(', ')
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

export const isSouthTibetRegionValue = (value: string | null | undefined) => {
  return SOUTH_TIBET_REGION_ALIASES.has(normalizeLocationValue(value))
}

export const isTibetRegionValue = (value: string | null | undefined) => {
  return TIBET_REGION_ALIASES.has(normalizeLocationValue(value))
}

export const isTaiwanLocationScope = (scope: LocationScopeFields) => {
  return isTaiwanCountryValue(scope.countryName) || isTaiwanProvinceValue(scope.regionName)
}

export const isTibetLocationScope = (scope: LocationScopeFields) => {
  return isTibetRegionValue(scope.regionName)
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

  if (isSouthTibetRegionValue(regionName)) {
    const labels = getSouthTibetPoliticalLabels(acceptLanguage)

    return {
      ...scope,
      countryName: labels.countryName,
      regionName: labels.regionName,
      cityName: isSouthTibetRegionValue(cityName)
        ? null
        : getSouthTibetStandardPlaceName(cityName, acceptLanguage)
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

  if (isSouthTibetAddress(address)) {
    const labels = getSouthTibetPoliticalLabels(acceptLanguage)
    const rawPlaceName = baseResult.placeName
    const rawCityName = getCityName(address, getRegionName(address, acceptLanguage))

    return {
      ...baseResult,
      displayName: normalizeSouthTibetDisplayName(baseResult.displayName, labels, acceptLanguage),
      placeName: isSouthTibetRegionValue(rawPlaceName)
        ? labels.regionName
        : getSouthTibetStandardPlaceName(rawPlaceName, acceptLanguage) || rawPlaceName,
      countryName: labels.countryName,
      regionName: labels.regionName,
      cityName: getSouthTibetStandardPlaceName(rawCityName, acceptLanguage)
    }
  }

  const regionName = getRegionName(address, acceptLanguage)

  return {
    ...baseResult,
    countryName: address.country || null,
    regionName,
    cityName: getCityName(address, regionName)
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
