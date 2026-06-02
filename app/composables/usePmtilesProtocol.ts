const PMTILES_PROTOCOL_STATE_KEY = '__fumo_pmtiles_protocol_state__' as const

type PmtilesModule = typeof import('~~/vendor/pmtiles.mjs')
type PmtilesArchive = {
  getZxy: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<unknown>
  source?: {
    getKey: () => string
  }
}
type PmtilesProtocol = {
  tile: unknown
  get: (url: string) => PmtilesArchive | undefined
  add: (archive: PmtilesArchive) => void
}
type PmtilesProtocolState = {
  registered: boolean
  protocol: PmtilesProtocol | null
  registrationPromise: Promise<void> | null
  recoveryPromise: Promise<void> | null
  modulePromise: Promise<PmtilesModule> | null
  archives: Map<string, PmtilesArchive>
  completedLowZoomWarmups: Set<string>
  activeLowZoomWarmups: Map<string, Promise<void>>
  generation: number
}

type NavigatorWithConnection = Navigator & {
  connection?: {
    saveData?: boolean
  }
}

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

const LOW_ZOOM_WARMUP_BATCH_SIZE = 8
const LOW_ZOOM_WARMUP_IDLE_TIMEOUT_MS = 1200

const getPmtilesProtocolState = () => {
  const globalState = globalThis as typeof globalThis & {
    [PMTILES_PROTOCOL_STATE_KEY]?: PmtilesProtocolState
  }

  if (!globalState[PMTILES_PROTOCOL_STATE_KEY]) {
    globalState[PMTILES_PROTOCOL_STATE_KEY] = {
      registered: false,
      protocol: null,
      registrationPromise: null,
      recoveryPromise: null,
      modulePromise: null,
      archives: new Map(),
      completedLowZoomWarmups: new Set(),
      activeLowZoomWarmups: new Map(),
      generation: 0
    }
  }

  return globalState[PMTILES_PROTOCOL_STATE_KEY]
}

const loadPmtilesModule = () => {
  const state = getPmtilesProtocolState()
  state.modulePromise ||= import('~~/vendor/pmtiles.mjs')
  return state.modulePromise
}

const normalizePmtilesUrl = (pmtilesUrl: string | null | undefined) => pmtilesUrl?.trim() || ''

const clearLowZoomWarmupState = (state: PmtilesProtocolState) => {
  state.completedLowZoomWarmups.clear()
  state.activeLowZoomWarmups.clear()
}

const createAbortError = () => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

const isAbortError = (error: unknown) => {
  return error instanceof Error && error.name === 'AbortError'
}

const shouldSkipLowZoomWarmup = () => {
  if (!import.meta.client) {
    return true
  }

  const connection = (navigator as NavigatorWithConnection).connection
  return Boolean(connection?.saveData)
}

const waitForBrowserIdle = async (signal?: AbortSignal) => {
  throwIfAborted(signal)

  await new Promise<void>((resolve, reject) => {
    const win = window as WindowWithIdleCallback
    let idleHandle: number | null = null
    let timeoutHandle: ReturnType<typeof window.setTimeout> | null = null

    const cleanup = () => {
      if (idleHandle !== null && win.cancelIdleCallback) {
        win.cancelIdleCallback(idleHandle)
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle)
      }
      signal?.removeEventListener('abort', handleAbort)
    }

    const finish = () => {
      cleanup()
      resolve()
    }

    const handleAbort = () => {
      cleanup()
      reject(createAbortError())
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    if (win.requestIdleCallback) {
      idleHandle = win.requestIdleCallback(finish, {
        timeout: LOW_ZOOM_WARMUP_IDLE_TIMEOUT_MS
      })
      return
    }

    timeoutHandle = window.setTimeout(finish, 48)
  })

  throwIfAborted(signal)
}

const buildLowZoomTileList = (maxZoom: number) => {
  const tiles: Array<[number, number, number]> = []

  for (let z = 0; z <= maxZoom; z += 1) {
    const tileCount = 2 ** z
    for (let x = 0; x < tileCount; x += 1) {
      for (let y = 0; y < tileCount; y += 1) {
        tiles.push([z, x, y])
      }
    }
  }

  return tiles
}

const getPmtilesArchive = async (pmtilesUrl: string) => {
  const normalizedUrl = normalizePmtilesUrl(pmtilesUrl)
  if (!normalizedUrl) {
    return null
  }

  const state = getPmtilesProtocolState()
  const existingProtocolArchive = state.protocol?.get(normalizedUrl)
  if (existingProtocolArchive) {
    state.archives.set(normalizedUrl, existingProtocolArchive)
    return existingProtocolArchive
  }

  const existingArchive = state.archives.get(normalizedUrl)
  if (existingArchive) {
    state.protocol?.add(existingArchive)
    return existingArchive
  }

  const { PMTiles } = await loadPmtilesModule()
  const archive = new PMTiles(normalizedUrl) as PmtilesArchive
  state.archives.set(normalizedUrl, archive)
  state.protocol?.add(archive)
  return archive
}

export const registerPmtilesProtocol = async (
  maplibregl: typeof import('maplibre-gl')
) => {
  const state = getPmtilesProtocolState()

  if (state.registered) {
    return
  }

  if (state.registrationPromise) {
    await state.registrationPromise
    return
  }

  state.registrationPromise = (async () => {
    const { Protocol } = await loadPmtilesModule()
    const protocol = new Protocol({ metadata: true }) as PmtilesProtocol

    for (const archive of state.archives.values()) {
      protocol.add(archive)
    }

    maplibregl.addProtocol('pmtiles', protocol.tile as Parameters<typeof maplibregl.addProtocol>[1])
    state.protocol = protocol
    state.registered = true
  })().finally(() => {
    state.registrationPromise = null
  })

  await state.registrationPromise
}

export const recoverPmtilesProtocol = async (
  maplibregl: typeof import('maplibre-gl')
) => {
  const state = getPmtilesProtocolState()

  if (state.recoveryPromise) {
    await state.recoveryPromise
    return
  }

  state.recoveryPromise = (async () => {
    if (state.registrationPromise) {
      try {
        await state.registrationPromise
      } catch {
        // Recovery installs a fresh protocol below even if the previous registration failed.
      }
    }

    state.generation += 1
    state.protocol = null
    state.registered = false
    clearLowZoomWarmupState(state)

    try {
      maplibregl.removeProtocol('pmtiles')
    } catch {
      // The protocol may not have been registered in this MapLibre instance.
    }

    await registerPmtilesProtocol(maplibregl)
  })().finally(() => {
    state.recoveryPromise = null
  })

  await state.recoveryPromise
}

export const resetPmtilesProtocol = recoverPmtilesProtocol

export const warmLowZoomPmtilesCache = (
  pmtilesUrl: string,
  options: {
    maxZoom?: number
    signal?: AbortSignal
  } = {}
) => {
  if (shouldSkipLowZoomWarmup()) {
    return Promise.resolve()
  }

  const normalizedUrl = normalizePmtilesUrl(pmtilesUrl)
  if (!normalizedUrl) {
    return Promise.resolve()
  }

  const maxZoom = Math.max(0, Math.floor(options.maxZoom ?? 4))
  const state = getPmtilesProtocolState()
  const generation = state.generation
  const cacheKey = `${generation}:${normalizedUrl}::z${maxZoom}`

  if (state.completedLowZoomWarmups.has(cacheKey)) {
    return Promise.resolve()
  }

  const activeWarmup = state.activeLowZoomWarmups.get(cacheKey)
  if (activeWarmup) {
    return activeWarmup
  }

  const warmup = (async () => {
    const archive = await getPmtilesArchive(normalizedUrl)
    if (!archive) {
      return
    }

    const tiles = buildLowZoomTileList(maxZoom)

    for (let index = 0; index < tiles.length; index += LOW_ZOOM_WARMUP_BATCH_SIZE) {
      throwIfAborted(options.signal)
      await waitForBrowserIdle(options.signal)

      const batch = tiles.slice(index, index + LOW_ZOOM_WARMUP_BATCH_SIZE)
      await Promise.all(batch.map(async ([z, x, y]) => {
        try {
          throwIfAborted(options.signal)
          await archive.getZxy(z, x, y, options.signal)
        } catch (error) {
          if (isAbortError(error)) {
            throw error
          }
        }
      }))
    }

    if (state.generation === generation) {
      state.completedLowZoomWarmups.add(cacheKey)
    }
  })()
    .catch((error) => {
      if (isAbortError(error)) {
        throw error
      }

      if (state.generation === generation) {
        state.completedLowZoomWarmups.add(cacheKey)
      }
    })
    .finally(() => {
      if (state.generation === generation) {
        state.activeLowZoomWarmups.delete(cacheKey)
      }
    })

  state.activeLowZoomWarmups.set(cacheKey, warmup)
  return warmup
}
