import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const dataRoot = resolve(repoRoot, 'map-data/geopolitics')
const cacheRoot = resolve(dataRoot, '.cache')
const archiveRoot = resolve(cacheRoot, 'archives')
const unpackedRoot = resolve(cacheRoot, 'unpacked')
const manifest = JSON.parse(await readFile(resolve(dataRoot, 'manifest.json'), 'utf8'))

const sha256 = async (path) => {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`)
  }
}

await mkdir(archiveRoot, { recursive: true })
await mkdir(unpackedRoot, { recursive: true })

for (const source of manifest.sources) {
  const archivePath = resolve(archiveRoot, basename(new URL(source.url).pathname))
  const temporaryPath = `${archivePath}.download`
  const existingValid = existsSync(archivePath) && await sha256(archivePath) === source.sha256

  if (!existingValid) {
    await rm(temporaryPath, { force: true })
    console.log(`[geopolitics] downloading ${source.id} ${source.version}`)
    run('curl', [
      '--retry', '10',
      '--retry-all-errors',
      '--retry-delay', '2',
      '-fL', source.url,
      '-o', temporaryPath
    ])
    const digest = await sha256(temporaryPath)
    if (digest !== source.sha256) {
      throw new Error(`SHA-256 mismatch for ${source.id}: expected ${source.sha256}, received ${digest}`)
    }
    await rename(temporaryPath, archivePath)
  }

  const destination = resolve(unpackedRoot, source.id)
  await mkdir(destination, { recursive: true })
  run('unzip', ['-oq', archivePath, '-d', destination])

  const shapefilePath = resolve(destination, `${source.stem}.shp`)
  const databasePath = resolve(destination, `${source.stem}.dbf`)
  if (!existsSync(shapefilePath) || !existsSync(databasePath)) {
    throw new Error(`Missing SHP/DBF pair for ${source.id}`)
  }
}

console.log(`[geopolitics] verified and unpacked ${manifest.sources.length} source archives`)
