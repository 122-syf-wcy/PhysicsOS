import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyMigration, planMigration, readOwnership } from './sessions-to-account-layout.mjs'

const roots = []

async function freshRoot() {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-session-layout-'))
  roots.push(root)
  return root
}

async function writeLegacySession(root, project, id) {
  const dir = join(root, project, id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'session.jsonl'),
    `${JSON.stringify({
      type: 'session',
      version: 0,
      id,
      createdAt: 1,
      cwd: '/private/work',
      delegationDepth: 0,
    })}\n`,
  )
}

async function writeAuthStorage(root, resources) {
  const path = join(root, 'storages', 'physicsos_auth.json')
  await mkdir(join(root, 'storages'), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify({
      unit: { name: 'physicsos_auth', version: 0 },
      global: null,
      tables: {
        api_resources: Object.fromEntries(resources.map((resource) => [resource.id, resource])),
      },
    })}\n`,
  )
  return path
}

test.afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('reads the auth ownership ledger without accepting workspaces', async () => {
  const home = await freshRoot()
  const ownership = await writeAuthStorage(home, [
    {
      id: 'session:s-1',
      kind: 'session',
      resourceId: 's-1',
      ownerKey: 'GZU:student01',
      schoolId: 'GZU',
    },
    {
      id: 'workspace:w-1',
      kind: 'workspace',
      resourceId: 'w-1',
      ownerKey: 'GZU:student01',
      schoolId: 'GZU',
    },
  ])

  const owners = await readOwnership(ownership)
  assert.deepEqual([...owners.keys()], ['s-1'])
  assert.deepEqual(owners.get('s-1'), { schoolId: 'GZU', userKey: 'GZU:student01' })
})

test('dry-run plans a move, apply is atomic, and a rerun is a no-op', async () => {
  const home = await freshRoot()
  const sessionsRoot = join(home, 'sessions')
  await writeLegacySession(sessionsRoot, '--private-work--', 's-1')
  const ownership = await writeAuthStorage(home, [
    {
      id: 'session:s-1',
      kind: 'session',
      resourceId: 's-1',
      ownerKey: 'GZU:student01',
      schoolId: 'GZU',
    },
  ])

  const dry = await planMigration({ root: sessionsRoot, ownershipPath: ownership })
  assert.equal(dry.plans.length, 1)
  assert.equal(dry.plans[0].from, join(sessionsRoot, '--private-work--', 's-1', 'session.jsonl'))
  assert.equal(
    dry.plans[0].to,
    join(sessionsRoot, 'GZU', 'GZU~003Astudent01', 's-1', 'session.jsonl'),
  )
  assert.equal(await readFile(dry.plans[0].from, 'utf8').then(() => true), true)

  const applied = await applyMigration(dry)
  assert.equal(applied.moved, 1)
  await assert.rejects(readFile(dry.plans[0].from, 'utf8'))
  assert.equal(await readFile(dry.plans[0].to, 'utf8').then(() => true), true)

  const rerun = await planMigration({ root: sessionsRoot, ownershipPath: ownership })
  assert.equal(rerun.plans.length, 0)
  assert.equal(rerun.skipped.length, 0)
})

test('unknown ownership and duplicate owners are skipped, never guessed', async () => {
  const home = await freshRoot()
  const sessionsRoot = join(home, 'sessions')
  await writeLegacySession(sessionsRoot, '--private-work--', 'known')
  await writeLegacySession(sessionsRoot, '--private-work--', 'unknown')
  await writeLegacySession(sessionsRoot, '--private-work--', 'duplicate')
  const ownership = await writeAuthStorage(home, [
    {
      id: 'session:known',
      kind: 'session',
      resourceId: 'known',
      ownerKey: 'GZU:student01',
      schoolId: 'GZU',
    },
    {
      id: 'session:duplicate',
      kind: 'session',
      resourceId: 'duplicate',
      ownerKey: 'GZU:student01',
      schoolId: 'GZU',
    },
    {
      id: 'session:duplicate-2',
      kind: 'session',
      resourceId: 'duplicate',
      ownerKey: 'GZU:student02',
      schoolId: 'GZU',
    },
  ])

  const plan = await planMigration({ root: sessionsRoot, ownershipPath: ownership })
  assert.deepEqual(
    plan.plans.map((row) => row.id),
    ['known'],
  )
  assert.deepEqual(plan.skipped.map((row) => row.reason).sort(), [
    'ownership-conflict',
    'ownership-missing',
  ])
})
