import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app = path.join(workspace, 'apps/mobile-lab')
const source = JSON.parse(readFileSync(path.join(app, 'shared-source.json'), 'utf8'))
const reference = path.join(app, '.cache/shared', source.commit)
const git = args => execFileSync('git', ['-C', reference, ...args], { encoding: 'utf8' }).trim()

test('reviewed Web snapshot is a clean isolated reference with exact shared tree identities', () => {
  assert.match(source.commit, /^[a-f0-9]{40}$/)
  assert.equal(git(['rev-parse', 'HEAD']), source.commit)
  assert.equal(git(['status', '--porcelain']), '')
  assert.equal(git(['rev-parse', 'HEAD:packages']), source.packagesTree)
  assert.equal(git(['rev-parse', 'HEAD:overlays/harness/files/packages/client/ui-physicsos/src']), source.uiTree)
})

test('APK assets record the same latest reviewed source and are never a browser test bundle', () => {
  const bundle = JSON.parse(readFileSync(path.join(app, 'dist/lab/manifest.json'), 'utf8'))
  assert.equal(bundle.test, false)
  assert.equal(bundle.sourceCommit, source.commit)
  assert.equal(bundle.packagesTree, source.packagesTree)
  assert.equal(bundle.uiTree, source.uiTree)
  assert.ok(bundle.files.includes('worker.js'))
  const catalog = JSON.parse(readFileSync(path.join(app, 'dist/lab/catalog.json'), 'utf8'))
  assert.equal(bundle.experiments, catalog.experiments.length)
  assert.equal(new Set(catalog.experiments.map(item => item.id)).size, catalog.experiments.length)
})

test('generated TypeScript config resolves shared packages from the reviewed checkout, not the old Android baseline', () => {
  const configuration = JSON.parse(readFileSync(path.join(app, '.cache/shared-tsconfig.json'), 'utf8'))
  for (const [key, values] of Object.entries(configuration.compilerOptions.paths)) {
    if (!key.startsWith('@lab/') && !key.startsWith('@physicsos/')) continue
    for (const value of values) assert.ok(path.resolve(value).startsWith(path.resolve(reference) + path.sep), `${key} points outside the shared source reference`)
  }
})
