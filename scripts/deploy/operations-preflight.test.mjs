import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('full backup installation refuses a missing host runtime before any system command', async t => {
  const emptyPath = await mkdtemp(join(tmpdir(), 'physicsos-no-runtime-'))
  t.after(() => rm(emptyPath, { recursive: true, force: true }))
  const result = spawnSync('/bin/bash', [fileURLToPath(new URL('./install-operations.sh', import.meta.url))], {
    env: { PATH: emptyPath, PHYSICSOS_BACKUP_KEY_FILE: '/private/configured-key' },
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /host Node\.js >=24\.7/)
  assert.doesNotMatch(result.stderr, /date:|apt-get:|id:/)
})
