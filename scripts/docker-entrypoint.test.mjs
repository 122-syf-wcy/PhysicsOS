import assert from 'node:assert/strict'
import { test } from 'node:test'

import { secretEnvFromFiles } from './docker-entrypoint.mjs'

const fakeRead = (files) => (path) => {
  const value = files[path]
  if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  return value
}

test('materializes *_FILE secrets and trims the trailing newline', () => {
  const env = { DATABASE_URL_FILE: '/run/secrets/db', REDIS_URL_FILE: '/run/secrets/redis' }
  const resolved = secretEnvFromFiles(
    env,
    fakeRead({
      '/run/secrets/db': 'postgres://u:p@db:5432/physicsos\n',
      '/run/secrets/redis': 'redis://cache:6379',
    }),
  )
  assert.deepEqual(resolved, [
    ['DATABASE_URL', 'postgres://u:p@db:5432/physicsos'],
    ['REDIS_URL', 'redis://cache:6379'],
  ])
})

test('never overrides an already-set variable and ignores unrelated names', () => {
  const env = { DATABASE_URL: 'postgres://explicit', PORT_FILE: '/run/secrets/port', HOME: '/root' }
  assert.deepEqual(secretEnvFromFiles(env, fakeRead({ '/run/secrets/port': '3080' })), [
    ['PORT', '3080'],
  ])
})

test('fails loud on an unreadable or empty secret file', () => {
  assert.throws(
    () => secretEnvFromFiles({ DATABASE_URL_FILE: '/run/secrets/missing' }, fakeRead({})),
    /DATABASE_URL_FILE is unreadable \(ENOENT\)/,
  )
  assert.throws(
    () =>
      secretEnvFromFiles(
        { DATABASE_URL_FILE: '/run/secrets/db' },
        fakeRead({ '/run/secrets/db': '\n' }),
      ),
    /DATABASE_URL_FILE is empty/,
  )
})
