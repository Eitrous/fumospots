const PMTILES_PROTOCOL_STATE_KEY = '__fumo_pmtiles_protocol_state__' as const

type PmtilesModule = typeof import('~~/vendor/pmtiles.mjs')
type PmtilesProtocol = {
  tile: unknown
}
type PmtilesProtocolState = {
  registered: boolean
  protocol: PmtilesProtocol | null
  registrationPromise: Promise<void> | null
  recoveryPromise: Promise<void> | null
  modulePromise: Promise<PmtilesModule> | null
}

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
      modulePromise: null
    }
  }

  return globalState[PMTILES_PROTOCOL_STATE_KEY]
}

const loadPmtilesModule = () => {
  const state = getPmtilesProtocolState()
  state.modulePromise ||= import('~~/vendor/pmtiles.mjs')
  return state.modulePromise
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

    state.protocol = null
    state.registered = false

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
