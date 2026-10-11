// Run with Node.js 24+: node scripts/check-photo-upload.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createContext, runInContext } from 'node:vm'

const component = readFileSync(new URL('../app/components/workbench/WorkbenchSubmitPanel.vue', import.meta.url), 'utf8')
const shared = readFileSync(new URL('../shared/fumo.ts', import.meta.url), 'utf8')
const uploadCode = [
  shared.match(/export const MAX_PHOTO_UPLOAD_BYTES = [^\n]+/)[0].replace('export ', ''),
  component.slice(component.indexOf('const ALLOWED_PHOTO_UPLOAD_TYPES ='), component.indexOf('const DECIMAL_COORDINATE_PATTERN =')),
  component.slice(component.indexOf('const getAdaptiveWebpQuality ='), component.indexOf('const applyEditablePost =')),
  component.slice(component.indexOf('const createWebpUploadFile ='), component.indexOf('const applyPlaceNameFromGeocode =')),
  component.slice(component.indexOf('const preparePhotoUpload ='), component.indexOf('const submitPost ='))
].join('\n')
const mib = 1024 * 1024
const source = new File([new Uint8Array(4 * mib)], 'photo.jpg', { type: 'image/jpeg' })
const encoded = (size, type) => new Blob([new Uint8Array(size)], { type })

const prepare = async (blobs, file = source) => {
  const state = createContext({
    File,
    t: key => key,
    createImageBitmap: async () => ({ width: 4000, height: 3000, close() {} }),
    document: {
      createElement: () => ({
        getContext: () => ({ drawImage() {} }),
        toBlob: callback => callback(blobs.shift())
      })
    }
  })
  runInContext(stripTypeScriptTypes(uploadCode) + '\nglobalThis.prepare = preparePhotoUpload', state)
  return state.prepare({ file, sourceFile: file }, 0, 'post', 'owner')
}

// WebKit's PNG fallback must not turn a valid 4 MiB JPEG into a >25 MiB upload.
{
  const result = await prepare([encoded(27 * mib, 'image/png'), encoded(mib, 'image/png')])
  assert.equal(result.uploads[0].file, source)
  assert.equal(result.uploads[0].contentType, 'image/jpeg')
  assert.equal(result.photo.imagePath, 'owner/post/01/original.jpg')
  assert.equal(result.photo.thumbPath, null)
  assert.equal(result.uploads.length, 1)
  assert.equal(result.skippedUploadSteps, 1)
}

// Even small PNG fallbacks must never be mislabeled as WebP.
{
  const result = await prepare([encoded(mib, 'image/png'), encoded(1024, 'image/png')])
  assert.equal(result.uploads[0].file, source)
  assert.equal(result.photo.thumbPath, null)
}

// WebP encoding can also grow an image; keep the valid source in that case.
{
  const result = await prepare([encoded(27 * mib, 'image/webp'), encoded(1024, 'image/webp')])
  assert.equal(result.uploads[0].file, source)
  assert.equal(result.uploads[0].contentType, 'image/jpeg')
  assert.equal(result.photo.thumbPath, 'owner/post/01/thumb.webp')
}

// Supported encoders still produce correctly labeled, compressed originals and thumbnails.
{
  const result = await prepare([encoded(mib, 'image/webp'), encoded(1024, 'image/webp')])
  assert.equal(result.photo.imagePath, 'owner/post/01/original.webp')
  assert.equal(result.photo.thumbPath, 'owner/post/01/thumb.webp')
  assert.equal(result.uploads.length, 2)
  assert.equal(result.skippedUploadSteps, 0)
  for (const upload of result.uploads) {
    assert.equal(upload.contentType, 'image/webp')
    assert.equal(upload.file.type, 'image/webp')
    assert.match(upload.file.name, /\.webp$/)
  }
}

// Encoding failures preserve the existing original upload and missing-thumbnail fallback.
{
  const result = await prepare([null, null])
  assert.equal(result.uploads[0].file, source)
  assert.equal(result.photo.thumbPath, null)
  assert.equal(result.skippedUploadSteps, 1)
}

// The fallback must still enforce the original upload size limit.
{
  const oversized = new File([new Uint8Array(26 * mib)], 'large.jpg', { type: 'image/jpeg' })
  await assert.rejects(prepare([null], oversized), { message: 'submit.errors.photoTooLarge' })
}

console.log('Photo upload checks passed: PNG fallback, MIME accuracy, size growth, WebP encoding, encoding failure, and upload limits.')
