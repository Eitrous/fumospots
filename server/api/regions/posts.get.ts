import { getQuery } from 'h3'
import type { PublicRegionPage, RegionScope, RegionSort } from '~~/shared/fumo'
import {
  getPreferredGeocodeAcceptLanguage,
  isTaiwanLocationScope,
  normalizeLocationScopeForLocale
} from '~~/server/utils/geocode'
import {
  createPublicServerClient,
  signStorageObjects
} from '~~/server/utils/supabase'

type RegionPostRow = {
  id: number
  user_id: string
  title: string
  image_path: string
  thumb_path: string | null
  place_name: string | null
  captured_at: string | null
  created_at: string | null
}

const REGION_SORT_VALUES = new Set<RegionSort>(['created', 'captured'])
const CHINA_COUNTRY_ALIASES = ['China', '\u4e2d\u56fd']
const TAIWAN_COUNTRY_ALIASES = ['Taiwan', '\u53f0\u6e7e', '\u53f0\u7063', '\u81fa\u7063']
const TAIWAN_PROVINCE_ALIASES = ['Taiwan Province', '\u53f0\u6e7e\u7701', '\u53f0\u7063\u7701', '\u81fa\u7063\u7701']
const REGION_POST_SELECT = `
  id,
  user_id,
  title,
  image_path,
  thumb_path,
  place_name,
  captured_at,
  created_at
`

const getTrimmedQueryValue = (value: unknown) => {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : null
}

const applyRegionFilters = <T extends {
  eq: (column: string, value: string) => T
}>(request: T, scope: RegionScope) => {
  let next = request.eq('region_name', scope.regionName)

  if (scope.countryName) {
    next = next.eq('country_name', scope.countryName)
  }

  if (scope.cityName) {
    next = next.eq('city_name', scope.cityName)
  }

  return next
}

const buildRegionTitle = (scope: RegionScope) => {
  return [scope.cityName, scope.regionName, scope.countryName].filter(Boolean).join(' / ')
}

const dedupeRegionPosts = (rows: RegionPostRow[]) => {
  const rowsById = new Map<number, RegionPostRow>()

  for (const row of rows) {
    if (!rowsById.has(row.id)) {
      rowsById.set(row.id, row)
    }
  }

  return [...rowsById.values()]
}

const sortRegionPosts = (rows: RegionPostRow[], sort: RegionSort) => {
  return [...rows].sort((left, right) => {
    if (sort === 'captured') {
      const leftCaptured = left.captured_at || ''
      const rightCaptured = right.captured_at || ''

      if (leftCaptured !== rightCaptured) {
        return rightCaptured.localeCompare(leftCaptured)
      }
    }

    return String(right.created_at || '').localeCompare(String(left.created_at || ''))
  })
}

const fetchTaiwanPosts = async (
  supabase: ReturnType<typeof createPublicServerClient>,
  scope: RegionScope,
  sort: RegionSort
) => {
  const requests = [
    supabase
      .from('public_approved_posts')
      .select(REGION_POST_SELECT)
      .in('country_name', CHINA_COUNTRY_ALIASES)
      .in('region_name', TAIWAN_PROVINCE_ALIASES)
  ]

  if (scope.cityName) {
    requests[0] = requests[0].eq('city_name', scope.cityName)
    requests.push(
      supabase
        .from('public_approved_posts')
        .select(REGION_POST_SELECT)
        .in('country_name', TAIWAN_COUNTRY_ALIASES)
        .eq('city_name', scope.cityName),
      supabase
        .from('public_approved_posts')
        .select(REGION_POST_SELECT)
        .in('country_name', TAIWAN_COUNTRY_ALIASES)
        .eq('region_name', scope.cityName)
    )
  } else {
    requests.push(
      supabase
        .from('public_approved_posts')
        .select(REGION_POST_SELECT)
        .in('country_name', TAIWAN_COUNTRY_ALIASES)
    )
  }

  const results = await Promise.all(requests)
  const rows: RegionPostRow[] = []

  for (const result of results) {
    if (result.error) {
      throw createError({
        statusCode: 500,
        statusMessage: result.error.message
      })
    }

    rows.push(...((result.data || []) as RegionPostRow[]))
  }

  return sortRegionPosts(dedupeRegionPosts(rows), sort)
}

export default defineEventHandler(async (event): Promise<PublicRegionPage> => {
  const query = getQuery(event)
  const regionName = getTrimmedQueryValue(query.region)

  if (!regionName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Region is required.'
    })
  }

  const acceptLanguage = getPreferredGeocodeAcceptLanguage(event)
  const scope = normalizeLocationScopeForLocale({
    countryName: getTrimmedQueryValue(query.country),
    regionName,
    cityName: getTrimmedQueryValue(query.city)
  }, acceptLanguage)

  const rawSort = getTrimmedQueryValue(query.sort)
  const sort: RegionSort = rawSort && REGION_SORT_VALUES.has(rawSort as RegionSort)
    ? rawSort as RegionSort
    : 'created'

  const supabase = createPublicServerClient(event)

  let postCount = 0
  let posts: RegionPostRow[] = []

  if (isTaiwanLocationScope(scope)) {
    posts = await fetchTaiwanPosts(supabase, scope, sort)
    postCount = posts.length
  } else {
    const countRequest = applyRegionFilters(
      supabase
        .from('public_approved_posts')
        .select('id', {
          count: 'exact',
          head: true
        }),
      scope
    )
    const { count, error: countError } = await countRequest

    if (countError) {
      throw createError({
        statusCode: 500,
        statusMessage: countError.message
      })
    }

    let postsRequest = applyRegionFilters(
      supabase
        .from('public_approved_posts')
        .select(REGION_POST_SELECT),
      scope
    )

    if (sort === 'captured') {
      postsRequest = postsRequest
        .order('captured_at', {
          ascending: false,
          nullsFirst: false
        })
        .order('created_at', { ascending: false })
    } else {
      postsRequest = postsRequest.order('created_at', { ascending: false })
    }

    const { data: rows, error: postsError } = await postsRequest.limit(100)

    if (postsError) {
      throw createError({
        statusCode: 500,
        statusMessage: postsError.message
      })
    }

    postCount = count ?? rows?.length ?? 0
    posts = (rows || []) as RegionPostRow[]
  }

  const visiblePosts = posts.slice(0, 100)
  const userIds = [...new Set(visiblePosts.map((post) => post.user_id))]
  const authorMap = new Map<string, string>()

  if (userIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('public_profiles')
      .select('id, username')
      .in('id', userIds)

    if (profilesError) {
      throw createError({
        statusCode: 500,
        statusMessage: profilesError.message
      })
    }

    for (const profile of profiles || []) {
      authorMap.set(profile.id, profile.username)
    }
  }

  const coverPathByPostId = new Map<number, string>()
  for (const post of visiblePosts) {
    coverPathByPostId.set(post.id, post.thumb_path || post.image_path)
  }
  const coverUrls = await signStorageObjects(event, [...coverPathByPostId.values()], 60 * 30)

  return {
    title: buildRegionTitle(scope),
    scope,
    sort,
    postCount,
    posts: visiblePosts.map((post) => ({
      id: post.id,
      title: post.title,
      thumbUrl: coverUrls.get(coverPathByPostId.get(post.id) || '') ?? null,
      placeName: post.place_name,
      capturedAt: post.captured_at,
      createdAt: post.created_at,
      author: {
        username: authorMap.get(post.user_id) ?? 'unknown'
      }
    }))
  }
})
