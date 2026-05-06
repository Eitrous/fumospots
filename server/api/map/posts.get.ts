import { getQuery, setHeader, type H3Event } from 'h3'
import type { PublicMapPointCollection } from '~~/shared/fumo'
import { MAP_FETCH_BOUNDS_GRID_SIZE } from '~~/shared/fumo'
import { createPublicServerClient } from '~~/server/utils/supabase'
import { enforceRateLimit, getRateLimitIdentifier } from '~~/server/utils/rateLimit'

type MapQuery = {
  west?: string
  south?: string
  east?: string
  north?: string
}

type MapBounds = {
  west: number
  south: number
  east: number
  north: number
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value))
}

const roundDownToFetchGrid = (value: number) => {
  return Math.floor(value / MAP_FETCH_BOUNDS_GRID_SIZE) * MAP_FETCH_BOUNDS_GRID_SIZE
}

const roundUpToFetchGrid = (value: number) => {
  return Math.ceil(value / MAP_FETCH_BOUNDS_GRID_SIZE) * MAP_FETCH_BOUNDS_GRID_SIZE
}

const normalizeMapBounds = (bounds: MapBounds): MapBounds => {
  return {
    west: clamp(roundDownToFetchGrid(bounds.west), -180, 180),
    south: clamp(roundDownToFetchGrid(bounds.south), -90, 90),
    east: clamp(roundUpToFetchGrid(bounds.east), -180, 180),
    north: clamp(roundUpToFetchGrid(bounds.north), -90, 90)
  }
}

const getMapBounds = (event: H3Event): MapBounds => {
  const cachedBounds = event.context.mapBounds as MapBounds | undefined
  if (cachedBounds) {
    return cachedBounds
  }

  const q = getQuery(event) as MapQuery

  const west = Number(q.west)
  const south = Number(q.south)
  const east = Number(q.east)
  const north = Number(q.north)

  if ([west, south, east, north].some(Number.isNaN)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid bbox'
    })
  }

  if (south > north) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid bbox'
    })
  }

  const bounds = normalizeMapBounds({
    west,
    south,
    east,
    north
  })

  event.context.mapBounds = bounds
  return bounds
}

const fetchMapPosts = async (event: H3Event) => {
  const { west, south, east, north } = getMapBounds(event)

  const supabase = createPublicServerClient(event)

  let query = supabase
    .from('public_approved_posts')
    .select(`
      id,
      public_lat,
      public_lng
    `)
    .not('public_lat', 'is', null)
    .not('public_lng', 'is', null)
    .gte('public_lat', south)
    .lte('public_lat', north)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (east < west) {
    query = query.or(`public_lng.gte.${west},public_lng.lte.${east}`)
  } else {
    query = query
      .gte('public_lng', west)
      .lte('public_lng', east)
  }

  const { data, error } = await query

  if (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message
    })
  }

  const features = (data || []).map((row: any) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.public_lng, row.public_lat]
    },
    properties: {
      id: row.id
    }
  })) satisfies PublicMapPointCollection['features']

  return {
    type: 'FeatureCollection',
    features
  } satisfies PublicMapPointCollection
}

export default defineEventHandler(async (event) => {
  getMapBounds(event)
  await enforceRateLimit(event, 'mapIp', getRateLimitIdentifier(event))

  const response = await fetchMapPosts(event)

  setHeader(event, 'Cache-Control', 'no-store')

  return response
})
