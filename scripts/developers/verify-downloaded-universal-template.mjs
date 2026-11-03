/** Extract exactly the generated download bytes and exercise the author workflow in a fresh directory. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { buildExperimentTemplate } from '../../vendor/deepseek-harness/packages/physicsos/experiment-host/src/template-download.ts'
import { safeArchivePath } from '../../vendor/deepseek-harness/packages/physicsos/experiment-host/src/package-resources.ts'

const require = createRequire(new URL('../../vendor/deepseek-harness/packages/physicsos/experiment-host/package.json', import.meta.url))
const { fromBuffer } = require('yauzl')
const id = process.argv[2] ?? 'pinhole'
const release = buildExperimentTemplate(id)
const directory = await mkdtemp(join(tmpdir(), 'physicsos-downloaded-' + id + '-'))
const zip = await new Promise((resolve, reject) => fromBuffer(release.bytes, { lazyEntries: true }, (error, file) => error ? reject(error) : resolve(file)))
await new Promise((resolve, reject) => {
  zip.on('error', reject); zip.on('end', resolve)
  zip.on('entry', entry => {
    void (async () => {
      if (!safeArchivePath(entry.fileName)) throw new Error('Unsafe generated archive path')
      const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)))
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      const path = join(directory, entry.fileName)
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.concat(chunks)); zip.readEntry()
    })().catch(reject)
  })
  zip.readEntry()
})
for (const args of [['install', '--ignore-scripts', '--include=dev'], ['run', 'configure', '--', '--version', '1.1.0'], ['run', 'release']]) {
  const result = spawnSync('npm', args, { cwd: directory, stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Downloaded-template workflow failed: ' + args.join(' '))
}
const name = `physicsos-${id}-1.1.0.zip`
const first = await readFile(join(directory, 'release', name))
const repeated = spawnSync('npm', ['run', 'release'], { cwd: directory, stdio: 'inherit' })
assert.equal(repeated.status, 0)
assert.deepEqual(await readFile(join(directory, 'release', name)), first)
const descriptor = JSON.parse(await readFile(join(directory, 'release', name + '.json')))
assert.equal(descriptor.experimentId, id); assert.equal(descriptor.version, '1.1.0')
console.log(`Downloaded ${id} template workflow passed with deterministic release: ${directory}/release/${name}`)
