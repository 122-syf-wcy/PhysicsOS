import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isolatedHarnessEnvironment } from './isolated-harness.mjs'

test('isolated acceptance overrides provider/storage state without inheriting real credentials', () => {
  const env = isolatedHarnessEnvironment(
    {
      PATH: '/bin',
      HOME: '/home/example',
      OPENAI_API_KEY: 'private',
      DEEPSEEK_API_KEY: 'private',
      DATABASE_URL: 'postgresql://production',
      REDIS_URL_FILE: '/secret',
      PHYSICSOS_SESSIONS_ROOT: '/production',
      DSH_HOME: '/personal',
    },
    '/temporary/test-home',
    'http://127.0.0.1:8877/v1',
    'test-password',
  )
  assert.equal(env.PATH, '/bin')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.REDIS_URL_FILE, undefined)
  assert.equal(env.PHYSICSOS_SESSIONS_ROOT, undefined)
  assert.equal(env.DSH_HOME, '/temporary/test-home')
  assert.equal(env.DEEPSEEK_BASE_URL, 'http://127.0.0.1:8877/v1')
  assert.equal(env.PHYSICSOS_STORAGE_BACKEND, 'json')
})

test('isolated acceptance refuses a remote model endpoint', () => {
  assert.throws(
    () => isolatedHarnessEnvironment({}, '/tmp/test', 'https://provider.example/v1', 'test'),
    /loopback/,
  )
})
