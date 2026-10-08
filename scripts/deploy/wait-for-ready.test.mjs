import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { waitForReady } from './wait-for-ready.mjs'

test('waits through unavailable responses until the application is ready', async (t) => {
  let attempts = 0
  const server = createServer((_req, res) => {
    attempts += 1
    res.writeHead(attempts < 3 ? 503 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: attempts < 3 ? 'not_ready' : 'ready' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const result = await waitForReady(`http://127.0.0.1:${server.address().port}`, {
    timeoutMs: 1000,
    intervalMs: 5,
  })
  assert.equal(result.ok, true)
  assert.equal(attempts, 3)
})

test('rejects HTML fallback and returns a bounded failure rather than success', async (t) => {
  const server = createServer((_req, res) => res.end('<html>fallback</html>'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const result = await waitForReady(`http://127.0.0.1:${server.address().port}`, {
    timeoutMs: 50,
    intervalMs: 5,
  })
  assert.equal(result.ok, false)
})
