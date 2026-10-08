import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnObserved, stopChild } from './test-process.mjs'

test('startup diagnostics include child exit and retained output', async () => {
  const observed = spawnObserved(
    process.execPath,
    ['-e', 'console.error("missing plugin fixture"); process.exit(7)'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await new Promise((resolve) => observed.child.once('close', resolve))
  assert.throws(() => observed.assertRunning(), /child exited \(7\).*missing plugin fixture/s)
})

test('cleanup terminates a process that ignores graceful shutdown', async () => {
  const { child } = spawnObserved(
    process.execPath,
    ['-e', 'process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000)'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await new Promise((resolve) => child.stdout.once('data', resolve))
  const started = Date.now()
  await stopChild(child, 100)
  assert.ok(Date.now() - started < 1_000)
  assert.notEqual(child.signalCode, null)
})

test('registration readiness has one overall deadline even when HTTP stalls', async () => {
  const { createServer } = await import('node:http')
  const { registerWhenReady } = await import('./test-process.mjs')
  const server = createServer(() => {})
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const started = Date.now()
    await assert.rejects(
      registerWhenReady(
        `http://127.0.0.1:${server.address().port}`,
        {},
        {
          assertRunning() {},
          diagnostics: () => 'fixture boot log',
        },
        80,
      ),
      /did not become ready.*fixture boot log/s,
    )
    assert.ok(Date.now() - started < 500)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
