import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { pruneBackups } from './backup-scheduled.mjs'

test('retention removes only expired full archives and always keeps the successful capture', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-retention-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const keep = join(root, 'physicsos-20200101T000000000Z.pbackup')
  const expired = join(root, 'physicsos-20200102T000000000Z.pbackup')
  for (const name of [keep, expired, join(root, 'notes.txt')]) {
    await writeFile(name, 'keep sensitive bytes')
    await utimes(name, new Date(0), new Date(0))
  }
  await symlink(keep, join(root, 'physicsos-20200103T000000000Z.pbackup'))
  await mkdir(join(root, 'physicsos-20200104T000000000Z.pbackup'))
  await pruneBackups(root, keep, 14)
  assert.equal(existsSync(expired), false)
  assert.equal(await readFile(keep, 'utf8'), 'keep sensitive bytes')
  assert.equal(existsSync(join(root, 'notes.txt')), true)
  assert.equal(existsSync(join(root, 'physicsos-20200103T000000000Z.pbackup')), true)
  assert.equal(existsSync(join(root, 'physicsos-20200104T000000000Z.pbackup')), true)
})
