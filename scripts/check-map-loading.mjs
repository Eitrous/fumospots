// Run with Node.js 24+: node scripts/check-map-loading.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createContext, runInContext } from 'node:vm'
import { createClient } from '@supabase/supabase-js'

const component = readFileSync(new URL('../app/components/WorldMap.vue', import.meta.url), 'utf8')
const refreshSourceCode = component.slice(
  component.indexOf('const refreshSource ='),
  component.indexOf('const ensureRegionHighlightLayers =')
)
const feature = id => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [id / 100, 0] },
  properties: { id, userId: 'owner' }
})
const page = (ids, nextAfterId = null, throughId = 4000) => ({
  type: 'FeatureCollection', features: ids.map(feature), nextAfterId, throughId
})
const tick = () => new Promise(resolve => setImmediate(resolve))
const clientCode = source => stripTypeScriptTypes(source).replaceAll('import.meta.client', 'true')
const displaySyncCode = component.slice(
  component.indexOf('const scheduleDisplaySourceSync ='),
  component.indexOf('const refreshSource =')
)

// Explicit afterId=0 avoids reusing a cached response from the old API URL.
{
  const fetchCode = component.slice(
    component.indexOf('const fetchGeoJsonPage ='),
    component.indexOf('const toggleMapCharacterFilter =')
  )
  const queries = []
  const context = createContext({ $fetch: async (_, options) => queries.push(options.query) })
  runInContext(stripTypeScriptTypes(fetchCode) + '\nglobalThis.fetchPage = fetchGeoJsonPage', context)
  await context.fetchPage(0, [])
  await context.fetchPage(500, ['reimu'], undefined, 1000)
  assert.equal(queries[0].afterId, 0)
  assert.equal(queries[1].throughId, 1000)
  assert.equal(queries[1].characters, 'reimu')
}

const createMap = (existingIds = []) => {
  const requests = []
  const frames = []
  const state = createContext({
    AbortController,
    MAP_POSTS_CONCURRENCY: Number(component.match(/const MAP_POSTS_CONCURRENCY = (\d+)/)[1]),
    mapRef: { value: {} },
    mapDisposed: false,
    mapDisplaySyncFrame: null,
    suppressNextMarkerAnimations: false,
    window: { requestAnimationFrame: callback => { frames.push(callback); return frames.length } },
    collection: { value: { type: 'FeatureCollection', features: existingIds.map(feature) } },
    selectedCharacterSlugs: { value: [] },
    collectionQueryKey: existingIds.length ? '' : null,
    refreshSourceSequence: 0,
    mapPostsAbortController: null,
    lastMapSourceLoadedAt: 0,
    previewGroupCache: new Map(),
    pointHoverPreviewCache: new Map(),
    activePreviewMemberIds: { value: [] },
    activePreviewGroupKey: { value: '' },
    previewItems: { value: [] },
    previewCloses: 0,
    displayUpdates: [],
    getFeaturePostId: properties => properties.id,
    closePointHoverPreview() {},
    closeActivePreview() {
      state.previewCloses++
      state.activePreviewMemberIds.value = []
      state.activePreviewGroupKey.value = ''
      state.previewItems.value = []
    },
    closeMapPreviews() { state.closeActivePreview() },
    syncSelectionSource() {},
    syncDisplaySource(options) { state.displayUpdates.push(options) },
    isAbortError: error => error.name === 'AbortError',
    loading: 0,
    startMapLoading() { state.loading++ },
    finishMapLoading() { state.loading-- },
    fetchGeoJsonPage(afterId, characters, signal, throughId) {
      return new Promise((resolve, reject) => {
        // Deliberately let cancelled responses arrive to test the write guard.
        requests.push({ afterId, characters, signal, throughId, resolve, reject })
      })
    }
  })
  runInContext(clientCode(displaySyncCode + refreshSourceCode) + '\nglobalThis.refreshSource = refreshSource', state)
  return {
    state, requests,
    ids: () => Array.from(state.collection.value.features, item => item.properties.id),
    flushFrames() { frames.splice(0).forEach(callback => callback()) }
  }
}

// Data can arrive before the map exists; dense batches publish once per frame.
{
  const map = createMap()
  map.state.mapRef.value = null
  const done = map.state.refreshSource()
  assert.equal(map.requests.length, 1)
  map.requests[0].resolve(page([500], 500))
  await tick()
  assert.equal(map.requests.length, 5)
  map.requests.slice(1).forEach(request => request.resolve(page([request.throughId], null, request.throughId)))
  await done
  assert.deepEqual(map.ids(), [500, 1375, 2250, 3125, 4000])
  assert.equal(map.state.displayUpdates.length, 0)
  map.flushFrames()
  assert.equal(map.state.displayUpdates.length, 1)
  assert.equal(map.state.displayUpdates[0].animate, false)
}

// Supplementing the same filter preserves the opened list, including completion.
{
  const map = createMap([500, 4000])
  map.state.activePreviewMemberIds.value = [500]
  map.state.activePreviewGroupKey.value = 'opened'
  map.state.previewItems.value = [{ id: 500 }]
  const done = map.state.refreshSource()
  map.requests[0].resolve(page([500], 500))
  await tick()
  map.requests.slice(1).forEach(request => request.resolve(page([request.throughId], null, request.throughId)))
  await done
  assert.equal(map.state.previewCloses, 0)
  assert.equal(map.state.activePreviewGroupKey.value, 'opened')
  assert.equal(map.state.previewItems.value[0].id, 500)
}

// Deleted preview members and a changed filter still dismiss obsolete content.
for (const filterChanged of [false, true]) {
  const map = createMap([99])
  map.state.activePreviewMemberIds.value = [99]
  if (filterChanged) map.state.selectedCharacterSlugs.value = ['reimu']
  const done = map.state.refreshSource()
  assert.equal(map.state.previewCloses, filterChanged ? 1 : 0)
  map.requests[0].resolve(page([], null, 0))
  await done
  assert.equal(map.state.previewCloses, 1)
}

// Unmounting prevents late data writes and any subsequent request.
{
  const map = createMap()
  map.state.mapRef.value = null
  const done = map.state.refreshSource()
  map.state.mapDisposed = true
  map.state.refreshSourceSequence++
  map.state.mapPostsAbortController.abort()
  map.requests[0].resolve(page([500], 500))
  await done
  await map.state.refreshSource()
  assert.deepEqual(map.ids(), [])
  assert.equal(map.requests.length, 1)
  assert.equal(map.state.loading, 0)
}

// A fast last range must render immediately without discarding old points.
{
  const map = createMap([99, 5000])
  const done = map.state.refreshSource()
  map.requests[0].resolve(page([500], 500))
  await tick()
  assert.equal(map.requests.length, 5, 'the remaining four ranges start together')
  assert.deepEqual(map.requests.slice(1).map(({ afterId, throughId }) => [afterId, throughId]), [
    [500, 1375], [1375, 2250], [2250, 3125], [3125, 4000]
  ])
  map.requests[4].resolve(page([4000], null, 4000))
  await tick()
  assert.deepEqual(map.ids(), [99, 500, 4000, 5000])
  assert.equal(map.state.lastMapSourceLoadedAt, 0)
  map.requests[1].resolve(page([501, 600], 600, 1375))
  await tick()
  assert.equal(map.requests[5].afterId, 600, 'a range continues independently')
  assert.equal(map.requests[5].throughId, 1375)
  map.requests[5].resolve(page([1375], null, 1375))
  map.requests[2].resolve(page([2250], null, 2250))
  map.requests[3].resolve(page([3125], null, 3125))
  await done
  assert.deepEqual(map.ids(), [500, 501, 600, 1375, 2250, 3125, 4000])
  assert.ok(map.state.lastMapSourceLoadedAt > 0)
  assert.equal(map.state.loading, 0)
}

// One failed range cancels its siblings and preserves already displayed data.
{
  const map = createMap([99])
  const done = map.state.refreshSource()
  map.requests[0].resolve(page([500], 500))
  await tick()
  map.requests[1].reject(new Error('network failed'))
  await done
  assert.ok(map.requests.slice(1).every(request => request.signal.aborted))
  map.requests.slice(2).forEach(request => request.resolve(page([9999], null, request.throughId)))
  await tick()
  assert.deepEqual(map.ids(), [99, 500])
  assert.equal(map.state.lastMapSourceLoadedAt, 0)
  assert.equal(map.state.loading, 0)
}

// Switching filters must reject late writes from the previous four ranges.
{
  const map = createMap()
  const oldDone = map.state.refreshSource()
  map.requests[0].resolve(page([500], 500))
  await tick()
  map.state.selectedCharacterSlugs.value = ['reimu']
  const newDone = map.state.refreshSource()
  assert.ok(map.requests[1].signal.aborted)
  assert.deepEqual(Array.from(map.requests[5].characters), ['reimu'])
  map.requests[5].resolve(page([42], null, 42))
  await newDone
  map.requests.slice(1, 5).forEach(request => request.resolve(page([9999], null, request.throughId)))
  await oldDone
  assert.deepEqual(map.ids(), [42])
  assert.equal(map.state.loading, 0)
}

// Empty data and a one-ID remainder must terminate without overlapping ranges.
for (const firstPage of [page([], null, 0), page([1], 1, 2)]) {
  const map = createMap([99])
  const done = map.state.refreshSource()
  map.requests[0].resolve(firstPage)
  await tick()
  if (firstPage.nextAfterId !== null) {
    assert.equal(map.requests.length, 2)
    assert.equal(map.requests[1].afterId, 1)
    assert.equal(map.requests[1].throughId, 2)
    map.requests[1].resolve(page([2], null, 2))
  }
  await done
  assert.deepEqual(map.ids(), firstPage.throughId ? [1, 2] : [])
  assert.equal(map.state.loading, 0)
}

// The posts layer becomes ready when the style loads, even while basemap tiles wait.
{
  const runtimeCode = component.slice(component.indexOf('const handleMapStyleLoad ='), component.indexOf('const loadRegionHighlight ='))
    + component.slice(component.indexOf('const syncMapRuntimeState ='), component.indexOf('const scheduleMapRuntimeSync ='))
  const state = createContext({
    mapRef: { value: { isStyleLoaded: () => false } },
    mapStyleReady: false,
    initialSourceLoaded: false,
    pendingStyleSourceRefresh: false,
    setups: 0,
    updates: 0,
    scheduleMapRuntimeSync() {},
    scheduleBaseMapHealthCheck() {},
    scheduleMapResize() {},
    setupMapLayers() { state.setups++ },
    scheduleDisplaySourceSync() { state.updates++ },
    bindMapInteractions() {},
    syncRegionHighlightSource() {},
    syncSelectionSource() {},
    fitPendingRegionBounds() {}
  })
  runInContext(clientCode(runtimeCode) + '\nObject.assign(globalThis, { handleMapStyleLoad, syncMapRuntimeState })', state)
  state.syncMapRuntimeState()
  assert.equal(state.setups, 0)
  state.handleMapStyleLoad()
  state.syncMapRuntimeState()
  assert.equal(state.setups, 1)
  assert.equal(state.updates, 1)
  // Applying an identical style may emit no style.load event.
  state.mapStyleReady = false
  state.mapRef.value.isStyleLoaded = () => true
  state.syncMapRuntimeState()
  assert.equal(state.setups, 2)
}

// New cluster members must not invalidate an in-flight preview or replay transitions.
{
  const frames = []
  const writes = []
  let resolvePreview
  const displayCode = component.slice(component.indexOf('const withMarkerFrame ='), component.indexOf('const scheduleMarkerAnimation ='))
    + component.slice(component.indexOf('const buildClusterState = (\n'), component.indexOf('const refreshSource ='))
    + component.slice(component.indexOf('const openClusterPreview ='), component.indexOf('// const zoomToClusterState ='))
  const state = createContext({
    performance,
    ready: false,
    mapRef: { value: { getSource: () => state.ready ? { setData: value => writes.push(value) } : null } },
    mapDisplaySyncFrame: null,
    suppressNextMarkerAnimations: false,
    window: { requestAnimationFrame: callback => { frames.push(callback); return frames.length } },
    props: { focusUserId: null },
    displayCollection: { value: { type: 'FeatureCollection', features: [] } },
    displayFeatureKeys: new Set(),
    displayClusterStateByKey: new Map(),
    markerAnimationByKey: new Map(),
    activePreviewGroupKey: { value: '' },
    activePreviewMemberIds: { value: [] },
    activePreviewAnchor: { value: null },
    previewItems: { value: [] },
    previewError: { value: '' },
    previewLoading: { value: false },
    previewSheetDragOffset: { value: 0 },
    previewRequestSequence: 0,
    previewOpenedAt: 0,
    members: [],
    collectVisiblePointMembers: () => state.members,
    resolveMaxZoomCollisionGroups: members => [members],
    normalizeLongitude: value => value,
    formatClusterCount: String,
    getDisplayFeatureKey: item => item.properties.display_key,
    startMarkerAnimation() { assert.fail('supplementing data should not replay marker transitions') },
    scheduleMarkerAnimation() {},
    syncSelectionSource() {},
    getPreviewItemsForGroup: () => new Promise(resolve => { resolvePreview = resolve }),
    t: value => value
  })
  runInContext(clientCode(displayCode) + '\nObject.assign(globalThis, { syncDisplaySource, scheduleDisplaySourceSync, openClusterPreview })', state)
  state.syncDisplaySource({ animate: false })
  assert.equal(writes.length, 0, 'rendering waits for the posts source')
  state.ready = true
  state.members = [1, 2].map(id => ({ id, adjustedLng: id, lng: id, lat: 0, x: id, y: 0, feature: feature(id) }))
  state.syncDisplaySource({ animate: false })
  const opened = state.displayClusterStateByKey.get('1:2')
  const pendingPreview = state.openClusterPreview(opened)
  state.members.push({ id: 3, adjustedLng: 3, lng: 3, lat: 0, x: 3, y: 0, feature: feature(3) })
  state.markerAnimationByKey.set('cluster:1:2', { phase: 'exit' })
  state.suppressNextMarkerAnimations = true
  state.scheduleDisplaySourceSync()
  state.scheduleDisplaySourceSync()
  assert.equal(frames.length, 1)
  frames[0]()
  assert.equal(state.markerAnimationByKey.size, 0)
  assert.equal(state.displayCollection.value.features.length, 1, 'the old cluster leaves no animated ghost')
  assert.equal(state.displayCollection.value.features[0].properties.point_count, 3)
  assert.equal(state.activePreviewGroupKey.value, '1:2')
  assert.equal(state.activePreviewAnchor.value.x, 2)
  resolvePreview([{ id: 1 }, { id: 2 }])
  await pendingPreview
  assert.deepEqual(Array.from(state.previewItems.value, item => item.id), [1, 2])
  assert.equal(state.previewLoading.value, false)
}

// Exercise the real Supabase client against a deterministic REST response.
let rows = Array.from({ length: 2501 }, (_, index) => ({
  id: (index + 1) * 3, user_id: 'owner', public_lat: 0, public_lng: 1
}))
const queries = []
const supabase = createClient('https://map.test', 'public-test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (input, options) => {
      const url = new URL(input)
      queries.push(url)
      if (url.pathname.endsWith('/rpc/get_public_map_posts')) {
        assert.deepEqual(JSON.parse(options.body).requested_character_slugs, ['reimu'])
      }
      const ids = url.searchParams.get('id')
      const result = rows
        .filter(row => (!ids?.startsWith('in.') || ids.slice(4, -1).split(',').includes(String(row.id))))
        .filter(row => !url.searchParams.getAll('id').some(filter =>
          (filter.startsWith('gt.') && row.id <= Number(filter.slice(3))) ||
          (filter.startsWith('lte.') && row.id > Number(filter.slice(4)))
        ))
        .sort((left, right) => url.searchParams.get('order') === 'id.desc' ? right.id - left.id : left.id - right.id)
        .slice(0, Number(url.searchParams.get('limit') || rows.length))
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
    }
  }
})
const apiSource = readFileSync(new URL('../server/api/map/posts.get.ts', import.meta.url), 'utf8')
const api = createContext({
  createPublicServerClient: () => supabase,
  createError: error => Object.assign(new Error(error.statusMessage), error),
  getQuery: event => event,
  defineEventHandler: handler => handler,
  enforceRateLimit: async () => {},
  getRateLimitIdentifier: () => 'test',
  setPublicApiCacheControl() {}
})
runInContext(stripTypeScriptTypes(apiSource.replace(/^import[^\n]*\n/gm, '').replace(
  'export default defineEventHandler', 'globalThis.handler = defineEventHandler'
)), api)
const first = await api.handler({ afterId: '0' })
assert.equal(first.features.length, 500)
assert.equal(first.nextAfterId, 1500)
assert.equal(first.throughId, 7503)
// Deleting an earlier row cannot shift or skip the next range's records.
rows = rows.filter(row => row.id !== 3)
const bounded = await api.handler({ afterId: '1500', throughId: '3000', characters: 'reimu' })
assert.equal(bounded.features.length, 500)
assert.equal(bounded.features[0].properties.id, 1503)
assert.equal(bounded.features.at(-1).properties.id, 3000)
assert.equal(bounded.nextAfterId, null)
assert.equal(bounded.features[0].properties.userId, 'owner')
assert.equal(queries.filter(url => url.searchParams.get('order') === 'id.desc').length, 1)
for (const throughId of ['-1', '1.5', '9007199254740992', ['1', '2']]) {
  await assert.rejects(api.handler({ throughId }), error => error.statusCode === 400)
}
console.log('Map loading checks passed: early loading, style readiness, coalesced rendering, preview preservation, concurrency, cancellation, and API queries.')
