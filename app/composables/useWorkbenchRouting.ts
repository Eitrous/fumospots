import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import type { RegionScope, RegionSort, WorkbenchPanel } from '~~/shared/fumo'

const PANEL_VALUES = new Set<WorkbenchPanel>(['info', 'post', 'login', 'onboarding', 'submit', 'edit', 'user', 'region', 'posts'])
const REGION_SORT_VALUES = new Set<RegionSort>(['created', 'captured'])

const firstQueryValue = (value: LocationQuery[string]) => {
  return Array.isArray(value) ? value[0] : value
}

export const resolveWorkbenchState = (query: LocationQuery) => {
  const requestedPanel = firstQueryValue(query.panel)
  const rawPanel = typeof requestedPanel === 'string' ? requestedPanel : 'info'
  let panel: WorkbenchPanel = PANEL_VALUES.has(rawPanel as WorkbenchPanel)
    ? rawPanel as WorkbenchPanel
    : 'info'

  const rawPost = firstQueryValue(query.post)
  const postId = typeof rawPost === 'string' ? Number(rawPost) : Number.NaN
  const hasValidPostId = Number.isInteger(postId) && postId > 0

  if ((panel === 'post' || panel === 'edit') && !hasValidPostId) {
    panel = 'info'
  }

  const rawUsername = firstQueryValue(query.username)
  const username = typeof rawUsername === 'string' && rawUsername.trim()
    ? rawUsername.trim()
    : null

  if (panel === 'user' && !username) {
    panel = 'info'
  }

  const rawCountry = firstQueryValue(query.country)
  const countryName = typeof rawCountry === 'string' && rawCountry.trim()
    ? rawCountry.trim()
    : null

  const rawRegion = firstQueryValue(query.region)
  const regionName = typeof rawRegion === 'string' && rawRegion.trim()
    ? rawRegion.trim()
    : null

  const rawCity = firstQueryValue(query.city)
  const cityName = typeof rawCity === 'string' && rawCity.trim()
    ? rawCity.trim()
    : null

  if (panel === 'region' && !regionName) {
    panel = 'info'
  }

  const rawSort = firstQueryValue(query.sort)
  const regionSort = typeof rawSort === 'string' && REGION_SORT_VALUES.has(rawSort as RegionSort)
    ? rawSort as RegionSort
    : 'created'

  const rawNext = firstQueryValue(query.next)
  const nextPath = typeof rawNext === 'string' && rawNext.trim()
    ? rawNext
    : null

  const regionScope: RegionScope | null = panel === 'region' && regionName
    ? {
        countryName,
        regionName,
        cityName
      }
    : null

  return {
    panel,
    postId: (panel === 'post' || panel === 'edit') && hasValidPostId ? postId : null,
    username: panel === 'user' ? username : null,
    regionScope,
    regionSort: panel === 'region' ? regionSort : 'created',
    nextPath
  }
}

export const createWorkbenchLocation = (
  panel: WorkbenchPanel = 'info',
  options: {
    postId?: number | null
    username?: string | null
    regionScope?: RegionScope | null
    regionSort?: RegionSort | null
    next?: string | null
  } = {}
): RouteLocationRaw => {
  const query: LocationQueryRaw = {}

  if (panel !== 'info') {
    query.panel = panel
  }

  if ((panel === 'post' || panel === 'edit') && options.postId) {
    query.post = String(options.postId)
  }

  if (panel === 'user' && options.username) {
    query.username = options.username
  }

  if (panel === 'region' && options.regionScope?.regionName) {
    query.region = options.regionScope.regionName

    if (options.regionScope.countryName) {
      query.country = options.regionScope.countryName
    }

    if (options.regionScope.cityName) {
      query.city = options.regionScope.cityName
    }

    if (options.regionSort && options.regionSort !== 'created') {
      query.sort = options.regionSort
    }
  }

  if (options.next) {
    query.next = options.next
  }

  return {
    path: '/',
    query
  }
}
