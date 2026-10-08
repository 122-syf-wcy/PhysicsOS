import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { inspectClientDependencies } from './check-workspace-dependencies.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-dependencies-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'vendor/deepseek-harness/packages/client/ui-physicsos')
  const modules = join(root, 'vendor/deepseek-harness/node_modules')
  await mkdir(app, { recursive: true })
  await writeFile(join(app, 'package.json'), '{}')
  for (const name of ['react', 'react-dom', '@testing-library/react']) {
    await mkdir(join(modules, name), { recursive: true })
    await writeFile(join(modules, name, 'index.js'), 'module.exports = {}')
    await writeFile(
      join(modules, name, 'package.json'),
      JSON.stringify({ name, version: '18.3.1', main: 'index.js' }),
    )
  }
  return { root, app, modules }
}

test('accepts coherent React instances in the current checkout', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(inspectClientDependencies(f.root).errors, [])
})

test('detects a different React instance used by the test renderer', async (t) => {
  const f = await fixture(t)
  const nested = join(f.modules, '@testing-library/react/node_modules/react')
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'index.js'), 'module.exports = {}')
  const result = inspectClientDependencies(f.root)
  assert.match(result.errors.join('\n'), /React instance/)
})

test('rejects dependency links into another checkout even if instances match', async (t) => {
  const f = await fixture(t)
  const external = await mkdtemp(join(tmpdir(), 'physicsos-other-checkout-'))
  t.after(() => rm(external, { recursive: true, force: true }))
  await writeFile(join(external, 'index.js'), 'module.exports = {}')
  await rm(join(f.modules, 'react'), { recursive: true })
  await symlink(external, join(f.modules, 'react'))
  assert.match(inspectClientDependencies(f.root).errors.join('\n'), /outside this checkout/)
})
