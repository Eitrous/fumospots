import type { GeocodeResult } from '~~/shared/fumo'

type NominatimAddress = {
  attraction?: string
  city?: string
  city_district?: string
  country?: string
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
    '未命名地点'
  )
}

export const normalizeGeocodeResult = (entry: NominatimEntry): GeocodeResult => {
  const address = entry.address || {}

  return {
    displayName: entry.display_name,
    placeName: pickPlaceName(entry),
    lat: Number(entry.lat),
    lng: Number(entry.lon),
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
