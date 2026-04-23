import { getQuery } from 'h3'
import type { GeoBounds, RegionGeometryResponse, RegionScope } from '~~/shared/fumo'
import {
  fetchSearchGeocodeEntries,
  getPreferredGeocodeAcceptLanguage,
  normalizeGeocodeResult,
  normalizeLocationScopeForLocale,
  type NominatimSearchEntry
} from '~~/server/utils/geocode'
import {
  enforceRateLimit,
  getRateLimitIdentifier,
  isPublicNominatimBaseUrl
} from '~~/server/utils/rateLimit'

const getTrimmedQueryValue = (value: unknown) => {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null
}

const normalizeScopeValue = (value: string | null) => {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() || ''
}

const fieldMatches = (left: string | null, right: string | null) => {
  return Boolean(left && right && normalizeScopeValue(left) === normalizeScopeValue(right))
}

const displayNameContains = (displayName: string, value: string | null) => {
  const normalizedValue = normalizeScopeValue(value)
  return Boolean(normalizedValue && normalizeScopeValue(displayName).includes(normalizedValue))
}

const matchesScope = (
  entry: NominatimSearchEntry,
  scope: RegionScope,
  acceptLanguage: string
) => {
  const result = normalizeGeocodeResult(entry, acceptLanguage)

  if (scope.countryName) {
    const matchedCountry = fieldMatches(result.countryName, scope.countryName)
      || displayNameContains(entry.display_name, scope.countryName)

    if (!matchedCountry) {
      return false
    }
  }

  const matchedRegion = fieldMatches(result.regionName, scope.regionName)
    || fieldMatches(result.cityName, scope.regionName)
    || displayNameContains(entry.display_name, scope.regionName)

  if (!matchedRegion) {
    return false
  }

  if (!scope.cityName) {
    return true
  }

  return fieldMatches(result.cityName, scope.cityName)
    || fieldMatches(result.regionName, scope.cityName)
    || displayNameContains(entry.display_name, scope.cityName)
}

const pickMatchedEntry = (
  entries: NominatimSearchEntry[],
  scope: RegionScope,
  acceptLanguage: string
) => {
  const exactMatch = entries.find((entry) => matchesScope(entry, scope, acceptLanguage))
  if (exactMatch) {
    return exactMatch
  }

  if (entries.length === 1) {
    return entries[0]
  }

  return null
}

const parseBoundingBox = (rawBoundingBox?: string[]): GeoBounds | null => {
  if (!rawBoundingBox || rawBoundingBox.length < 4) {
    return null
  }

  const south = Number(rawBoundingBox[0])
  const north = Number(rawBoundingBox[1])
  const west = Number(rawBoundingBox[2])
  const east = Number(rawBoundingBox[3])

  if ([south, north, west, east].some((value) => Number.isNaN(value))) {
    return null
  }

  return {
    west,
    south,
    east,
    north
  }
}

const pickGeometry = (entry: NominatimSearchEntry) => {
  if (entry.geojson?.type === 'Polygon' || entry.geojson?.type === 'MultiPolygon') {
    return entry.geojson
  }

  return null
}

export default defineEventHandler(async (event): Promise<RegionGeometryResponse> => {
  const config = useRuntimeConfig(event)
  const query = getQuery(event)
  const regionName = getTrimmedQueryValue(query.region)

  if (!regionName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Region is required.'
    })
  }

  const acceptLanguage = getPreferredGeocodeAcceptLanguage(event)
  const scope: RegionScope = normalizeLocationScopeForLocale({
    countryName: getTrimmedQueryValue(query.country),
    regionName,
    cityName: getTrimmedQueryValue(query.city)
  }, acceptLanguage)

  await enforceRateLimit(event, 'geocodeIp', getRateLimitIdentifier(event))
  if (isPublicNominatimBaseUrl(config.geocodeBaseUrl)) {
    await enforceRateLimit(event, 'geocodeGlobal', 'nominatim')
  }

  let entries: NominatimSearchEntry[]

  try {
    entries = await fetchSearchGeocodeEntries(
      event,
      [scope.countryName, scope.regionName, scope.cityName].filter(Boolean).join(' '),
      {
        limit: 3,
        polygonGeoJson: true,
        acceptLanguage
      }
    )
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Region geometry service is unavailable.'
    })
  }

  const matchedEntry = pickMatchedEntry(entries, scope, acceptLanguage)
  if (!matchedEntry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Region geometry was not found.'
    })
  }

  return {
    scope,
    bbox: parseBoundingBox(matchedEntry.boundingbox),
    geometry: pickGeometry(matchedEntry)
  }
})
