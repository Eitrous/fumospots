import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getHeader,
  sendStream,
  setHeader,
  setResponseStatus
} from 'h3'

const ARCHIVE_RELATIVE_PATH = 'map-assets/geopolitics.pmtiles'
const archivePath = [
  resolve(process.cwd(), 'public', ARCHIVE_RELATIVE_PATH),
  resolve(process.cwd(), '.output/public', ARCHIVE_RELATIVE_PATH),
  resolve(process.cwd(), '../public', ARCHIVE_RELATIVE_PATH)
].find(candidate => existsSync(candidate))

const parseSingleRange = (value: string, size: number) => {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) {
    return null
  }

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1
    }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    return null
  }

  return {
    start,
    end: Math.min(requestedEnd, size - 1)
  }
}

export default defineEventHandler((event) => {
  if (!archivePath) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Geopolitics PMTiles archive not found'
    })
  }

  const { size, mtime } = statSync(archivePath)
  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'Content-Type', 'application/vnd.pmtiles')
  setHeader(event, 'Last-Modified', mtime.toUTCString())

  const rangeHeader = getHeader(event, 'range')
  if (!rangeHeader) {
    setHeader(event, 'Content-Length', size)
    return sendStream(event, createReadStream(archivePath))
  }

  const range = parseSingleRange(rangeHeader, size)
  if (!range) {
    setResponseStatus(event, 416, 'Range Not Satisfiable')
    setHeader(event, 'Content-Range', `bytes */${size}`)
    return ''
  }

  const length = range.end - range.start + 1
  setResponseStatus(event, 206, 'Partial Content')
  setHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  setHeader(event, 'Content-Length', length)

  return sendStream(event, createReadStream(archivePath, range))
})
