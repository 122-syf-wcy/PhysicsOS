/** Prepare the authored authentication illustrations; run in the existing build container. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(process.env.PHYSICSOS_SOURCE_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)))
const source = resolve(process.env.PHYSICSOS_AUTH_ART_SOURCE ?? join(root, 'overlays/harness/files/apps/web/design-assets/auth-heritage-20261116'))
const output = resolve(process.env.PHYSICSOS_AUTH_ART_OUTPUT ?? join(root, 'overlays/harness/files/apps/web/public/physicsos/auth-heritage'))
const require = createRequire(join(root, 'vendor/deepseek-harness/packages/attachment/attachment-local/package.json'))
const sharp = require('sharp')
sharp.concurrency(1)
const sources = [
  { name: 'welcome', sha256: '32df79255d5e02941d6bfd015b837d6461271f705890ba6e884fcd45e08ac100' },
  { name: 'join', sha256: 'e73c2dad0295e684dc5f31a9f585c62c0abe277d172613ab024d0ae6d72d9b29' },
]
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
await mkdir(output, { recursive: true })
const assets = []
for (const item of sources) {
  const bytes = await readFile(join(source, `${item.name}-original.png`))
  assert.equal(digest(bytes), item.sha256, 'Auth illustration source differs from the reviewed generated asset')
  const metadata = await sharp(bytes, { limitInputPixels: 4_000_000 }).metadata()
  assert.equal(metadata.width, 880); assert.equal(metadata.height, 1184)
  for (const width of [440, 880]) {
    for (const format of ['webp', 'avif']) {
      const filename = `${item.name}-${width}.${format}`
      const pipeline = sharp(bytes, { limitInputPixels: 4_000_000 }).rotate().resize({ width, withoutEnlargement: true })
      const encoded = await (format === 'webp'
        ? pipeline.webp({ quality: 88, effort: 6, preset: 'drawing' })
        : pipeline.avif({ quality: 58, effort: 5 })).toBuffer()
      const target = join(output, filename)
      const existing = await stat(target).then(() => readFile(target), error => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (existing !== undefined) assert.equal(digest(existing), digest(encoded), 'Refusing to replace different authored illustration bytes')
      else await writeFile(target, encoded, { flag: 'wx' })
      const actual = await sharp(encoded, { limitInputPixels: 4_000_000 }).metadata()
      assert.equal(actual.width, width)
      assert.equal(actual.height, Math.round(1184 * width / 880))
      assert.ok(encoded.length > 0 && encoded.length < 350_000, 'Runtime illustration exceeds the public asset budget')
      assets.push({ filename, width: actual.width, height: actual.height, bytes: encoded.length, sha256: digest(encoded), sourceSha256: item.sha256 })
    }
  }
}
const manifest = { schemaVersion: 1, collection: 'PhysicsOS authentication heritage illustrations', assets }
const manifestBytes = JSON.stringify(manifest, null, 2) + '\n'
try { await writeFile(join(output, 'manifest.json'), manifestBytes, { flag: 'wx' }) }
catch (error) {
  if (error.code !== 'EEXIST') throw error
  assert.equal(await readFile(join(output, 'manifest.json'), 'utf8'), manifestBytes, 'Refusing to overwrite a different illustration manifest')
}
console.log(JSON.stringify({ count: assets.length, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), assets }))
