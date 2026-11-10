import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildRelease, publishRelease } from './release.mjs'

const name = 'vendor/deepseek-harness/packages/client/ui-physicsos/src/Example.ts'
const checksum = files => createHash('sha256').update(JSON.stringify(files)).digest('hex')
function manifest(version) {
  const files = { [name]: version.repeat(64) }
  return { schemaVersion: 1, ownership: 'physicsos-source-projection/1', revision: version.repeat(40), submoduleRevision: 'e'.repeat(40), sourceDigest: checksum(files), dependencyFingerprint: checksum({}), files, entries: { [name]: { sha256: files[name], bytes: 3, type: 'file', mode: 0o644 } } }
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-release-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const old = manifest('a'), next = manifest('b'), state = join(root, '.physicsos-release')
  await mkdir(state); await writeFile(join(state, 'published-source.json'), JSON.stringify(old))
  const sourceFile = join(root, 'source.json'); await writeFile(sourceFile, JSON.stringify(next))
  return { root, old, next, state, sourceFile }
}

test('failed image build does not promote the published source baseline', async t => {
  const f = await fixture(t)
  const output = join(f.root, 'build')
  const run = async (command, args) => {
    if (command === 'docker' && args.includes('/app/physicsos-development-builder.json')) return Buffer.from(JSON.stringify({ dependencyFingerprint: f.next.dependencyFingerprint, completeDevelopmentDependencies: true, lockedDependenciesVerified: true }))
    if (command === 'docker' && args.includes('/app/physicsos-source-manifest.json')) return Buffer.from(JSON.stringify(f.old))
    if (command === 'docker' && args[0] === 'inspect') return Buffer.from(JSON.stringify([{ Image: 'sha256:' + 'c'.repeat(64) }]))
    if (command === 'python3' && args[1] === 'export') return Buffer.from(JSON.stringify({ codeDigest: 'e'.repeat(64), bytesExported: 12, changedFiles: [name] }))
    if (command === 'python3' && args[1] === 'build') throw new Error('image export failed')
    throw new Error('Unexpected fixture command')
  }
  await assert.rejects(buildRelease({ projectDir: f.root, revision: f.next.revision, builder: 'physicsos-development-test', outputDir: output }, {
    run, progress: () => {}, project: async ({ outputDir }) => { await mkdir(join(outputDir, 'source'), { recursive: true }); await writeFile(join(outputDir, 'source-manifest.json'), JSON.stringify(f.next)); return { root: join(outputDir, 'source'), manifestPath: join(outputDir, 'source-manifest.json') } },
    index: async () => [{ name: '@deepseek-ai/dsh-client-ui-physicsos', path: 'vendor/deepseek-harness/packages/client/ui-physicsos', mode: 'client', build: 'local', dependencies: [], hasTsconfig: true }],
    sync: async () => ({ changed: [name], deleted: [], bytes: 3 }), build: async () => ({ completed: true }),
  }), /image export failed/)
  assert.deepEqual(JSON.parse(await readFile(join(f.state, 'published-source.json'), 'utf8')), f.old)
  assert.deepEqual(JSON.parse(await readFile(join(f.state, 'compiled-source.json'), 'utf8')), f.next)
})

test('source baseline advances only after successful publication', async t => {
  const f = await fixture(t), plan = { projectDir: f.root, sourceManifestFile: f.sourceFile, sourceDigest: f.next.sourceDigest, revision: f.next.revision }
  await assert.rejects(publishRelease(plan, { switch: async () => ({ deployed: false }) }), /did not publish/)
  assert.deepEqual(JSON.parse(await readFile(join(f.state, 'published-source.json'), 'utf8')), f.old)
  await publishRelease(plan, { switch: async () => ({ deployed: true }) })
  assert.deepEqual(JSON.parse(await readFile(join(f.state, 'published-source.json'), 'utf8')), f.next)
})

test('tampered publication source is rejected before a switch', async t => {
  const f = await fixture(t); let calls = 0
  f.next.files[name] = 'c'.repeat(64); await writeFile(f.sourceFile, JSON.stringify(f.next))
  await assert.rejects(publishRelease({ projectDir: f.root, sourceManifestFile: f.sourceFile, sourceDigest: f.next.sourceDigest, revision: f.next.revision }, { switch: async () => { calls++; return { deployed: true } } }), /digest|manifest/i)
  assert.equal(calls, 0)
})
