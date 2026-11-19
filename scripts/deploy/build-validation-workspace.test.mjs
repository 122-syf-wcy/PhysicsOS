import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildValidationWorkspace, compiledExports, PACKAGES, VIEWPORT_OUTPUTS } from './build-validation-workspace.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))

test('worker Docker build inputs and every compiler entry exist in the actual repository context', async () => {
  const dockerfile = await readFile(join(repository, 'scripts/deploy/validation-worker.Dockerfile'), 'utf8')
  const buildStage = dockerfile.split('FROM ${PLAYWRIGHT_IMAGE} AS runtime')[0]
  const copies = [...buildStage.matchAll(/^COPY (\S+) (\S+)$/gm)].map(([, source, target]) => ({
    source, target: posix.normalize(target).replace(/^\.\//, ''),
  }))
  for (const row of copies) await access(join(repository, row.source))
  const configCopy = copies.find(row => row.target === 'tsconfig.worker.json')
  assert.ok(configCopy, 'The root compiler config must come from a tracked context path')
  const config = JSON.parse(await readFile(join(repository, configCopy.source), 'utf8'))
  for (const input of config.include) {
    const copy = copies.find(row => input === row.target || input.startsWith(row.target + '/'))
    assert.ok(copy, `compiler input has no Docker context mapping: ${input}`)
    await access(join(repository, copy.source, input.slice(copy.target.length)))
  }
  const viewport = copies.find(row => 'viewport/physics/mechanics-workspace-runtime.ts'.startsWith(row.target + '/'))
  assert.equal(resolve(repository, viewport.source), resolve(repository, 'overlays/harness/files/packages/client/ui-physicsos/src/client/physics'))
  const worker = copies.find(row => row.target === 'tools/validation-worker')
  assert.equal(worker.source, 'tools/validation-worker')
})

test('workspace exports preserve canonical aliases and reject paths outside package source', () => {
  assert.deepEqual(compiledExports({ '.': './src/index.ts', './capture': './src/json.ts' }), {
    '.': './src/index.js', './capture': './src/json.js',
  })
  assert.throws(() => compiledExports({ '.': '../../private.ts' }), /export target/)
})

test('assembled workspace uses ESM and resolves bare package imports through the compiled canonical alias', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-worker-workspace-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of PACKAGES) {
    const source = join(root, 'packages', name)
    const output = join(root, 'dist/packages', name, 'src')
    await mkdir(source, { recursive: true })
    await mkdir(output, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@physicsos/' + name, version: '1.0.0', exports: { '.': './src/index.ts', './capture': './src/json.ts' } }))
    await writeFile(join(output, 'index.js'), 'export const ready = true;\n')
    await writeFile(join(output, 'json.js'), `export const sourcePackage = ${JSON.stringify(name)};\n`)
  }
  for (const relative of VIEWPORT_OUTPUTS) {
    const target = join(root, 'dist', relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, 'export const fixtureOnly = true;\n')
  }
  await buildValidationWorkspace(root)
  const packageRoot = JSON.parse(await readFile(join(root, 'dist/package.json'), 'utf8'))
  assert.equal(packageRoot.type, 'module')
  const consumer = join(root, 'dist/viewport/consumer.js')
  await mkdir(dirname(consumer), { recursive: true })
  await writeFile(consumer, "export { sourcePackage } from '@physicsos/physics-workbench/capture';\n")
  assert.equal((await import(pathToFileURL(consumer).href)).sourcePackage, 'physics-workbench')
  await rm(join(root, 'dist/viewport/physics-runtime-bridge.js'))
  await assert.rejects(buildValidationWorkspace(root), /missing compiled Lab runtime: viewport\/physics-runtime-bridge\.js/)
})
