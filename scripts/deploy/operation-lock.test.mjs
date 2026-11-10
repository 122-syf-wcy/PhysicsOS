import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

test('backup and release operations exclude each other until the owner releases its lock', async t => {
  const { acquireOperationLock } = await import('./operation-lock.mjs').catch(() => ({}))
  assert.equal(typeof acquireOperationLock, 'function', 'shared operation locking is missing')
  const root = await mkdtemp(join(tmpdir(), 'physicsos-operation-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await acquireOperationLock(root, 'release')
  t.after(() => first.release())
  await assert.rejects(acquireOperationLock(root, 'backup'), /operation.*already active/i)
  const owner = JSON.parse(await readFile(join(root, '.physicsos-operation-lock', 'owner.json')))
  assert.equal(owner.operation, 'release')
  await first.release()
  const second = await acquireOperationLock(root, 'backup')
  await second.release()
  await first.release()
})
