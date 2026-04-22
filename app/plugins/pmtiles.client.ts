import maplibregl from 'maplibre-gl'
import { Protocol } from '~~/vendor/pmtiles.mjs'

const PMTILES_PROTOCOL_FLAG = '__fumo_pmtiles_protocol_registered__'

export default defineNuxtPlugin(() => {
  const globalState = globalThis as typeof globalThis & Record<string, boolean | undefined>

  if (globalState[PMTILES_PROTOCOL_FLAG]) {
    return
  }

  const protocol = new Protocol({ metadata: true })
  maplibregl.addProtocol('pmtiles', protocol.tile)
  globalState[PMTILES_PROTOCOL_FLAG] = true
})
