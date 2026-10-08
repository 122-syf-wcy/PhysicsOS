import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-overlay-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const vendor = join(root, 'vendor/deepseek-harness')
  const source = join(root, 'overlays/harness/files/packages/client/ui-physicsos')
  await mkdir(vendor, { recursive: true })
  await mkdir(source, { recursive: true })
  await mkdir(join(root, 'scripts/overlay'), { recursive: true })
  await cp(
    new URL('./harness-overlay.mjs', import.meta.url),
    join(root, 'scripts/overlay/harness-overlay.mjs'),
  )
  const git = (...args) => {
    const result = spawnSync('git', ['-C', vendor, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Fixture')
  await writeFile(join(vendor, 'upstream.txt'), 'baseline\n')
  git('add', '.')
  git('commit', '-qm', 'baseline')
  await writeFile(join(source, 'entry.ts'), 'export const version = 1\n')
  const run = (mode) =>
    spawnSync(process.execPath, ['scripts/overlay/harness-overlay.mjs', mode], {
      cwd: root,
      encoding: 'utf8',
    })
  return { root, vendor, source, git, run }
}

test('capture retains staged upstream changes made by three-way apply', async (t) => {
  const f = await fixture(t)
  await writeFile(join(f.vendor, 'upstream.txt'), 'patched\n')
  f.git('add', 'upstream.txt')
  const result = f.run('capture')
  assert.equal(result.status, 0, result.stderr)
  const patch = await readFile(join(f.root, 'overlays/harness/upstream-changes.patch'), 'utf8')
  assert.match(patch, /\+patched/)
})

test('capture excludes emitted companions of TypeScript sources', async (t) => {
  const f = await fixture(t)
  const src = join(f.vendor, 'packages/example/src')
  await mkdir(src, { recursive: true })
  for (const [file, content] of [
    ['index.ts', 'export const x = 1'],
    ['index.js', 'export const x = 1'],
    ['index.d.ts', 'export declare const x = 1'],
    ['index.js.map', '{}'],
  ]) {
    await writeFile(join(src, file), content)
  }
  assert.equal(f.run('capture').status, 0)
  const patch = await readFile(join(f.root, 'overlays/harness/upstream-changes.patch'), 'utf8')
  assert.match(patch, /diff --git a\/packages\/example\/src\/index\.ts/)
  assert.doesNotMatch(patch, /diff --git a\/packages\/example\/src\/index\.(js|d\.ts)/)
})

test('apply removes previously managed files that were deleted, preserving build output', async (t) => {
  const f = await fixture(t)
  assert.equal(f.run('apply').status, 0)
  const target = join(f.vendor, 'packages/client/ui-physicsos')
  await mkdir(join(target, 'lib'), { recursive: true })
  await writeFile(join(target, 'lib/client.js'), 'built')
  await rm(join(f.source, 'entry.ts'))
  assert.equal(f.run('apply').status, 0)
  assert.equal(existsSync(join(target, 'entry.ts')), false)
  assert.equal(await readFile(join(target, 'lib/client.js'), 'utf8'), 'built')
})

test('verify detects any content drift without modifying either tree', async (t) => {
  const f = await fixture(t)
  assert.equal(f.run('apply').status, 0)
  assert.equal(f.run('verify').status, 0)
  const target = join(f.vendor, 'packages/client/ui-physicsos/entry.ts')
  await writeFile(target, 'local edit')
  const result = f.run('verify')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /entry\.ts/)
  assert.equal(await readFile(target, 'utf8'), 'local edit')
})

test('apply refuses to remove a deleted managed file that has local edits', async (t) => {
  const f = await fixture(t)
  assert.equal(f.run('apply').status, 0)
  const target = join(f.vendor, 'packages/client/ui-physicsos/entry.ts')
  await writeFile(target, 'local edit')
  await rm(join(f.source, 'entry.ts'))
  const result = f.run('apply')
  assert.equal(result.status, 1)
  assert.equal(await readFile(target, 'utf8'), 'local edit')
})
