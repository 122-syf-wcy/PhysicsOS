import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { acquireOperationLock } from './operation-lock.mjs'
import { runLockedCommand } from './operation-run.mjs'

test('maintenance refuses an active release before running its command', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-maintenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const release = await acquireOperationLock(root, 'release')
  let calls = 0
  await assert.rejects(runLockedCommand({ projectDir: root, operation: 'postgres-backup', command: 'ignored', args: [] }, { run: async () => { calls++ } }), /already active/)
  assert.equal(calls, 0)
  await release.release()
})

test('failed maintenance releases ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-maintenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(runLockedCommand({ projectDir: root, operation: 'postgres-backup', command: 'ignored', args: [] }, { run: async () => { throw new Error('capture failed') } }), /capture failed/)
  await assert.rejects(lstat(join(root, '.physicsos-operation-lock')), { code: 'ENOENT' })
})

test('cancelled maintenance lets its command settle before releasing ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-maintenance-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cancellation = new AbortController()
  let settled = false
  await assert.rejects(runLockedCommand({ projectDir: root, operation: 'postgres-backup', command: 'ignored', args: [], signal: cancellation.signal }, { run: async (_command, _args, options) => { assert.equal(options.signal, undefined); cancellation.abort(); settled = true } }))
  assert.equal(settled, true)
  await assert.rejects(lstat(join(root, '.physicsos-operation-lock')), { code: 'ENOENT' })
})

test('first-install entry refuses an existing deployment before package or secret changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-initial-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { writeFile } = await import('node:fs/promises')
  await mkdir(join(root, 'bin'))
  await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const result = spawnSync('/bin/bash', [fileURLToPath(new URL('./deploy-server.sh', import.meta.url))], { env: { PATH: join(root, 'bin'), PHYSICSOS_DIR: root }, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /已有 PhysicsOS/)
  assert.doesNotMatch(result.stderr, /apt-get:|openssl:|cat:/)
})
