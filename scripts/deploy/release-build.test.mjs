import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const moduleUrl = new URL('./release-build.mjs', import.meta.url)
const sha = value => createHash('sha256').update(value).digest('hex')
const file = value => ({ sha256: sha(value), bytes: Buffer.byteLength(value), mode: 0o644, type: 'file' })
const manifest = files => ({ schemaVersion: 1, ownership: 'physicsos-source-projection/1', revision: 'a'.repeat(40), submoduleRevision: 'b'.repeat(40), files })

test('frozen Git projection publishes across the tmpfs boundary and omits root preview/docs/desktop trees', async t => {
  const api = await import(moduleUrl)
  const base = await mkdtemp(join(tmpdir(), 'physicsos-projection-git-'))
  const outputParent = await mkdtemp(join(process.env.PHYSICSOS_TEST_OUTPUT_ROOT ?? tmpdir(), 'physicsos-projection-output-'))
  t.after(() => Promise.all([rm(base, { recursive: true, force: true }), rm(outputParent, { recursive: true, force: true })]))
  const git = (cwd, ...args) => { const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
  const vendor = join(base, 'vendor'), root = join(base, 'root')
  await mkdir(vendor); await mkdir(root)
  git(vendor, 'init', '-q')
  await writeFile(join(vendor, 'package.json'), '{"name":"fixture-harness"}')
  git(vendor, 'add', '.'); git(vendor, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
  git(root, 'init', '-q'); git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', vendor, 'vendor/deepseek-harness')
  for (const directory of ['overlays/harness/files/packages/client/fixture/src', 'docs', 'UI', 'apps/desktop']) await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(root, 'overlays/harness/files/packages/client/fixture/src/index.ts'), 'export {}')
  await writeFile(join(root, 'docs/a.md'), 'docs'); await writeFile(join(root, 'UI/a.png'), 'preview'); await writeFile(join(root, 'apps/desktop/package.json'), '{"name":"desktop"}')
  git(root, 'add', '.'); git(root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
  const projection = await api.createSourceProjection({ root, revision: git(root, 'rev-parse', 'HEAD'), outputDir: join(outputParent, 'projection') })
  assert.equal(await readFile(join(projection.root, 'vendor/deepseek-harness/packages/client/fixture/src/index.ts'), 'utf8'), 'export {}')
  assert.equal(Object.keys(projection.files).some(name => name.startsWith('docs/') || name.startsWith('UI/') || name.startsWith('apps/desktop/')), false)
})

test('streamed source projection fits its final tree without retaining a second full tar copy', async t => {
  if (!process.env.PHYSICSOS_TEST_LOWSPACE_ROOT) return t.skip('requires isolated 3 MiB tmpfs budget')
  const api = await import(moduleUrl), base = await mkdtemp(join(tmpdir(), 'physicsos-stream-source-')), output = await mkdtemp(join(process.env.PHYSICSOS_TEST_LOWSPACE_ROOT, 'projection-'))
  t.after(() => Promise.all([rm(base, { recursive: true, force: true }), rm(output, { recursive: true, force: true })]))
  const git = (cwd, ...args) => { const value = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }); assert.equal(value.status, 0, value.stderr); return value.stdout.trim() }
  const vendor = join(base, 'vendor'), root = join(base, 'root')
  await mkdir(vendor); await mkdir(root); git(vendor, 'init', '-q')
  await writeFile(join(vendor, 'package.json'), '{"name":"fixture"}'); git(vendor, 'add', '.'); git(vendor, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
  git(root, 'init', '-q'); git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', vendor, 'vendor/deepseek-harness')
  await mkdir(join(root, 'packages/fixture/src'), { recursive: true }); await writeFile(join(root, 'packages/fixture/src/large.bin'), Buffer.alloc(2 * 1024 * 1024, 97))
  await mkdir(join(root, 'overlays/harness/files/fixture'), { recursive: true }); await writeFile(join(root, 'overlays/harness/files/fixture/source.ts'), 'export {}')
  git(root, 'add', '.'); git(root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
  const projection = await api.createSourceProjection({ root, revision: git(root, 'rev-parse', 'HEAD'), outputDir: join(output, 'source-projection') })
  assert.equal(projection.entries['packages/fixture/src/large.bin'].bytes, 2 * 1024 * 1024)
})

test('GNU tar closing on archive padding is accepted only when both archive processes succeeded', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.archiveTransportSucceeded, 'function')
  assert.equal(api.archiveTransportSucceeded(0, 0, { code: 'ERR_STREAM_PREMATURE_CLOSE' }), true)
  assert.equal(api.archiveTransportSucceeded(0, 2, { code: 'ERR_STREAM_PREMATURE_CLOSE' }), false)
  assert.equal(api.archiveTransportSucceeded(128, 0, { code: 'EPIPE' }), false)
  assert.equal(api.archiveTransportSucceeded(0, 0, { code: 'EIO' }), false)
})

test('effective vendor patch applies when projection staging is nested inside a different Git working tree', async t => {
  const api = await import(moduleUrl), base = await mkdtemp(join(tmpdir(), 'physicsos-patch-repo-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const git = (cwd, ...args) => { const value = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }); assert.equal(value.status, 0, value.stderr); return value.stdout.trim() }
  const vendor = join(base, 'vendor'), root = join(base, 'root')
  await mkdir(vendor); await mkdir(root); git(vendor, 'init', '-q')
  const before = '{"name":"fixture","value":"before"}', after = '{"name":"fixture","value":"after"}'
  await writeFile(join(vendor, 'package.json'), before); git(vendor, 'add', '.'); git(vendor, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
  await writeFile(join(vendor, 'package.json'), after); const patch = git(vendor, 'diff') + '\n'; git(vendor, 'checkout', '--', 'package.json')
  git(root, 'init', '-q'); git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', vendor, 'vendor/deepseek-harness')
  await mkdir(join(root, 'overlays/harness/files/fixture'), { recursive: true }); await writeFile(join(root, 'overlays/harness/files/fixture/source.ts'), 'export {}')
  await writeFile(join(root, 'overlays/harness/upstream-changes.patch'), patch)
  git(root, 'add', '.'); git(root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture')
  const projection = await api.createSourceProjection({ root, revision: git(root, 'rev-parse', 'HEAD'), outputDir: join(root, '.projection/result') })
  assert.equal(await readFile(join(projection.root, 'vendor/deepseek-harness/package.json'), 'utf8'), after)
})

test('source filtering keeps source lib directories and tests while excluding generated declarations and secrets', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.isSourcePath, 'function')
  for (const name of ['packages/ui/src/lib/cn.ts', 'packages/ui/src/build/action.ts', 'vendor/deepseek-harness/packages/core/session/tests/fixtures/dist/a.js', 'vendor/deepseek-harness/packages/core/session/tests/a.spec.ts', 'vendor/deepseek-harness/tsconfig.physicsos.json', 'vendor/deepseek-harness/patches/exceljs.patch']) assert.equal(api.isSourcePath(name), true, name)
  for (const name of ['.env.database_url', 'vendor/deepseek-harness/lib/physicsos-types/a.d.ts', 'packages/ui/lib/index.js', 'packages/ui/node_modules/react/index.js', 'private.key', '../escape']) assert.equal(api.isSourcePath(name), false, name)
})

test('package inventory carries declared runtime startup and invariant outputs into artifact admission', async t => {
  const api = await import(moduleUrl)
  const base = await mkdtemp(join(tmpdir(), 'physicsos-release-artifacts-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const prefix = 'vendor/deepseek-harness/packages/physicsos/auth-host'
  await mkdir(join(base, prefix), { recursive: true })
  const meta = JSON.stringify({ name: '@deepseek-ai/dsh-auth-host', exports: { '.': { default: './lib/index.js' }, './startup': './lib/startup.js', './invariant': { types: './lib/types/invariant.d.ts', default: './lib/invariant.js' } } })
  await writeFile(join(base, prefix, 'package.json'), meta)
  await writeFile(join(base, prefix, 'tsdown.config.ts'), 'export default {}')
  const source = manifest({ [prefix + '/package.json']: file(meta), [prefix + '/tsconfig.json']: file('{}') })
  const packages = await api.indexPackages(base, source)
  const plan = api.planBuild({ packages, changed: [prefix + '/src/index.ts'] })
  assert.ok(plan.requiredArtifacts.includes(prefix + '/lib/startup.js'))
  assert.ok(plan.requiredArtifacts.includes(prefix + '/lib/invariant.js'))
})

test('content deltas skip unchanged files and delete only paths owned by the prior source manifest', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.computeSourceDelta, 'function')
  const before = manifest({ 'packages/a/src/a.ts': file('same'), 'packages/a/src/deleted.ts': file('old') })
  const after = manifest({ 'packages/a/src/a.ts': file('same'), 'packages/a/tests/new.spec.ts': file('test') })
  assert.deepEqual(api.computeSourceDelta(before, after).changed, ['packages/a/tests/new.spec.ts'])
  assert.deepEqual(api.computeSourceDelta(before, after).deleted, ['packages/a/src/deleted.ts'])
  assert.throws(() => api.computeSourceDelta(manifest({ '.env.admin_password': file('private') }), after), /unsafe|source/i)
})

test('source delta ignores group-write permission differences while preserving executable changes', async () => {
  const api = await import(moduleUrl)
  const before = manifest({ 'scripts/a.mjs': { ...file('same'), mode: 0o644 } })
  const after = manifest({ 'scripts/a.mjs': { ...file('same'), mode: 0o664 } })
  assert.deepEqual(api.computeSourceDelta(before, after).changed, [])
  assert.deepEqual(api.computeSourceDelta(before, manifest({ 'scripts/a.mjs': { ...file('same'), mode: 0o775 } })).changed, ['scripts/a.mjs'])
})

test('applying a delta validates staged bytes and commits its marker only after the full projection matches', async t => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.applySourceDelta, 'function')
  const base = await mkdtemp(join(tmpdir(), 'physicsos-release-test-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'app'), stage = join(base, 'stage'), marker = join(base, 'state/source.json')
  await mkdir(join(root, 'packages/a/src'), { recursive: true })
  await mkdir(join(stage, 'packages/a/src'), { recursive: true })
  await writeFile(join(root, 'packages/a/src/old.ts'), 'old')
  await writeFile(join(root, 'unowned-data'), 'keep')
  await writeFile(join(stage, 'packages/a/src/new.ts'), 'corrupted')
  const before = manifest({ 'packages/a/src/old.ts': file('old') })
  const after = manifest({ 'packages/a/src/new.ts': file('new') })
  await assert.rejects(api.applySourceDelta({ root, stage, previous: before, next: after, marker }), /digest|bytes/i)
  assert.equal(await readFile(join(root, 'packages/a/src/old.ts'), 'utf8'), 'old')
  await writeFile(join(stage, 'packages/a/src/new.ts'), 'new')
  await api.applySourceDelta({ root, stage, previous: before, next: after, marker })
  assert.equal(await readFile(join(root, 'packages/a/src/new.ts'), 'utf8'), 'new')
  assert.equal(await readFile(join(root, 'unowned-data'), 'utf8'), 'keep')
  assert.equal(JSON.parse(await readFile(marker, 'utf8')).revision, 'a'.repeat(40))
  await assert.rejects(readFile(join(root, 'packages/a/src/old.ts')), /ENOENT/)
})

test('source application refuses a symlink parent that would write outside the builder workspace', async t => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.applySourceDelta, 'function')
  const base = await mkdtemp(join(tmpdir(), 'physicsos-release-link-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(join(base, 'app/packages'), { recursive: true })
  await mkdir(join(base, 'outside'))
  await mkdir(join(base, 'stage/packages/a'), { recursive: true })
  await symlink(join(base, 'outside'), join(base, 'app/packages/a'))
  await writeFile(join(base, 'stage/packages/a/index.ts'), 'new')
  await assert.rejects(api.applySourceDelta({ root: join(base, 'app'), stage: join(base, 'stage'), previous: manifest({}), next: manifest({ 'packages/a/index.ts': file('new') }), marker: join(base, 'marker.json') }), /symlink/i)
  await assert.rejects(readFile(join(base, 'outside/index.ts')), /ENOENT/)
})

test('UI plugin edits rebuild both plugin halves without Vite, while static frontend inputs trigger Vite', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.planBuild, 'function')
  const packages = [{ name: '@deepseek-ai/dsh-client-ui-physicsos', path: 'vendor/deepseek-harness/packages/client/ui-physicsos', mode: 'client', build: 'local', dependencies: [] }]
  let plan = api.planBuild({ packages, changed: ['vendor/deepseek-harness/packages/client/ui-physicsos/src/client/canvas/a.tsx'], deleted: [] })
  assert.equal(plan.vite, false)
  assert.deepEqual(plan.packageScopes.map(p => p.name), ['@deepseek-ai/dsh-client-ui-physicsos'])
  assert.equal(plan.packageScopes[0].face, null)
  assert.ok(plan.requiredArtifacts.includes('vendor/deepseek-harness/packages/client/ui-physicsos/lib/client.js'))
  plan = api.planBuild({ packages, changed: ['vendor/deepseek-harness/apps/web/index.html'], deleted: [] })
  assert.equal(plan.vite, true)
})

test('shared source changes rebuild declaration boundary and its inlining consumers, while new dependencies invalidate builder reuse', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.planBuild, 'function')
  const packages = [
    { name: '@physicsos/physics-scene', path: 'packages/physics-scene', mode: 'source', build: 'source', dependencies: [] },
    { name: '@deepseek-ai/dsh-auth-host', path: 'vendor/deepseek-harness/packages/physicsos/auth-host', mode: 'host', build: 'local', dependencies: ['@physicsos/physics-scene'] },
  ]
  const plan = api.planBuild({ packages, changed: ['packages/physics-scene/src/index.ts'], deleted: [] })
  assert.equal(plan.sharedTypes, true)
  assert.deepEqual(plan.packageScopes.map(p => p.name), ['@deepseek-ai/dsh-auth-host'])
  assert.equal(api.planBuild({ packages, changed: ['vendor/deepseek-harness/packages/physicsos/auth-host/package.json'], deleted: [] }).requiresBuilderPreparation, true)
  assert.equal(api.planBuild({ packages, changed: ['vendor/deepseek-harness/native/system/src/flock.c'], deleted: [] }).requiresBuilderPreparation, true)
})

test('runtime seeds require audited complete dependency, ABI, native and projection evidence before reuse', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.validateSeedReceipt, 'function')
  const expected = { dependencyFingerprint: 'a'.repeat(64), sourceDigest: 'b'.repeat(64), abi: { node: '24.7.0', modules: '137', platform: 'linux', arch: 'x64', libc: 'glibc' } }
  assert.throws(() => api.validateSeedReceipt({ ...expected, origin: 'runtime' }, expected), /audit|complete|hydration/i)
  const receipt = { ...expected, schemaVersion: 1, origin: 'audited-runtime-seed', audited: true, completeDevelopmentDependencies: true, lockedDependenciesVerified: true, sourceProjectionVerified: true, nativeProbeVerified: true, toolsVerified: ['typescript', 'tsdown', 'vite', 'vitest', 'tsx'], baseImage: 'sha256:' + 'c'.repeat(64) }
  assert.doesNotThrow(() => api.validateSeedReceipt(receipt, expected))
  assert.throws(() => api.validateSeedReceipt({ ...receipt, abi: { ...receipt.abi, arch: 'arm64' } }, expected), /ABI/i)
  assert.throws(() => api.validateSeedReceipt({ ...receipt, dependencyFingerprint: 'd'.repeat(64) }, expected), /dependenc/i)
})

test('test-only changes enter the source projection without rebuilding runtime bundles', async () => {
  const api = await import(moduleUrl)
  const packages = [{ name: '@deepseek-ai/dsh-auth-host', path: 'vendor/deepseek-harness/packages/physicsos/auth-host', mode: 'host', build: 'local', dependencies: [] }]
  const plan = api.planBuild({ packages, changed: ['vendor/deepseek-harness/packages/physicsos/auth-host/tests/contract.spec.ts'], deleted: [] })
  assert.deepEqual(plan.packageScopes, [])
  assert.deepEqual(plan.testInputs, ['vendor/deepseek-harness/packages/physicsos/auth-host/tests/contract.spec.ts'])
})

test('disk admission refuses impossible reservations before an output is created', async t => {
  const api = await import(moduleUrl)
  const base = await mkdtemp(join(tmpdir(), 'physicsos-release-disk-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  await assert.rejects(api.requireDisk({ path: base, bytes: Number.MAX_SAFE_INTEGER }), /disk space/i)
  assert.deepEqual(await (await import('node:fs/promises')).readdir(base), [])
})

test('source digest and dependency identity reject tampered metadata and distinguish native/ABI changes', async () => {
  const api = await import(moduleUrl)
  const source = manifest({ 'packages/a/package.json': file('{"name":"a"}'), 'packages/a/src/a.ts': file('source') })
  assert.throws(() => api.validateSourceManifest({ ...source, sourceDigest: 'f'.repeat(64) }), /digest/i)
  assert.throws(() => api.validateSourceManifest({ ...source, dependencyFingerprint: 'f'.repeat(64) }), /dependency/i)
  assert.throws(() => api.validateSourceManifest({ ...source, files: { 'packages/a/package.json': 'f'.repeat(64) }, entries: { 'packages/a/package.json': file('{"name":"a"}') } }), /digest/i)
  const first = api.dependencyFingerprint(source)
  assert.equal(api.dependencyFingerprint(manifest({ ...source.files, 'packages/a/src/a.ts': file('edited') })), first)
  assert.notEqual(api.dependencyFingerprint(manifest({ ...source.files, 'packages/a/package.json': file('{"name":"a","dependencies":{"new":"1"}}') })), first)
  const abi = { node: '24.7.0', modules: '137', arch: 'x64', platform: 'linux', libc: 'glibc' }, baseImage = 'sha256:' + 'a'.repeat(64)
  assert.notEqual(api.builderCacheIdentity({ dependencyFingerprint: first, abi, baseImage }), api.builderCacheIdentity({ dependencyFingerprint: first, abi: { ...abi, modules: '138' }, baseImage }))
})

test('shared declaration repair detects missing outputs despite retained buildinfo and only targets included source packages', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.requiredSharedDeclarationPaths, 'function')
  const required = api.requiredSharedDeclarationPaths(['../../packages/physics-scene/src/**/*.ts', '../../packages/physics-workbench/src/**/*.ts'], { 'packages/physics-scene/src/index.ts': true, 'packages/physics-workbench/src/index.ts': true, 'packages/ui/src/index.ts': true })
  assert.deepEqual(required, ['vendor/deepseek-harness/lib/physicsos-types/physics-scene/src/index.d.ts', 'vendor/deepseek-harness/lib/physicsos-types/physics-workbench/src/index.d.ts'])
  assert.deepEqual(api.sharedDeclarationStatus(required, ['vendor/deepseek-harness/lib/physicsos-types/tsconfig.tsbuildinfo']).missing, required)
  assert.equal(api.sharedDeclarationStatus(required, required).verified, true)
})

test('plan validation rejects traversal and mismatched scope paths before invoking tools or deleting outputs', async () => {
  const api = await import(moduleUrl)
  assert.equal(typeof api.validateBuildPlan, 'function')
  const source = manifest({ 'vendor/deepseek-harness/packages/physicsos/auth-host/package.json': file('{}') })
  const plan = { revision: source.revision, packageScopes: [{ name: 'host', path: 'packages/physicsos/auth-host', sourcePath: 'vendor/deepseek-harness/packages/physicsos/auth-host', mode: 'host', build: 'local' }], requiredArtifacts: ['vendor/deepseek-harness/packages/physicsos/auth-host/lib/index.js'] }
  assert.doesNotThrow(() => api.validateBuildPlan(plan, source))
  assert.throws(() => api.validateBuildPlan({ ...plan, packageScopes: [{ ...plan.packageScopes[0], sourcePath: '../../var/lib/physicsos' }] }, source), /scope|path/i)
  assert.throws(() => api.validateBuildPlan({ ...plan, requiredArtifacts: ['vendor/deepseek-harness/../../private.key'] }, source), /artifact|path/i)
})

test('non-code package files and presets produce file scopes without compiler work', async () => {
  const api = await import(moduleUrl)
  const packages = [{ name: '@deepseek-ai/dsh-plugin-center', path: 'vendor/deepseek-harness/packages/physicsos/plugin-center', mode: 'host', build: 'local', dependencies: [] }]
  const plan = api.planBuild({ packages, changed: ['vendor/deepseek-harness/packages/physicsos/plugin-center/plugins/manifest.json'], deleted: [] })
  assert.deepEqual(plan.packageScopes.map(({ mode, files }) => ({ mode, files })), [{ mode: 'files', files: ['plugins/manifest.json'] }])
  assert.deepEqual(plan.requiredArtifacts, [])
  assert.equal(plan.vite, false)
})

test('source verification catches leftover owned source while preserving generated outputs and unowned data', async t => {
  const api = await import(moduleUrl)
  const base = await mkdtemp(join(tmpdir(), 'physicsos-release-exact-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  await mkdir(join(base, 'packages/a/src'), { recursive: true })
  await mkdir(join(base, 'packages/a/lib'), { recursive: true })
  await writeFile(join(base, 'packages/a/src/old.ts'), 'old')
  await writeFile(join(base, 'packages/a/lib/index.js'), 'generated')
  await writeFile(join(base, 'unowned-data'), 'keep')
  await assert.rejects(api.verifySourceProjection(base, manifest({}), { exact: true }), /extra owned/i)
  await rm(join(base, 'packages/a/src/old.ts'))
  await api.verifySourceProjection(base, manifest({}), { exact: true })
  assert.equal(await readFile(join(base, 'packages/a/lib/index.js'), 'utf8'), 'generated')
  assert.equal(await readFile(join(base, 'unowned-data'), 'utf8'), 'keep')
})
