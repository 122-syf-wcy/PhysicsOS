import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { connectExperiment } from '../src/protocol.js'
import { isUniversalSnapshot } from '../src/universal-contract.js'

const fixture = JSON.parse(await readFile(new URL('../public/fixture.json', import.meta.url)))
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(draw) {
  const origin = 'https://preview.example'
  const channel = '12345678-1234-1234-1234-123456789abc'
  const listeners = new Map()
  const sent = []
  const ready = []
  const parent = { postMessage(value, target) { ready.push({ value, target }) } }
  Object.assign(globalThis, { location: { search: `?hostOrigin=${encodeURIComponent(origin)}&channel=${channel}` }, parent, addEventListener(type, handler) { listeners.set(type, handler) }, removeEventListener(type) { listeners.delete(type) } })
  const connection = connectExperiment(draw)
  const port = { postMessage(value) { sent.push(value) }, start() {}, close() { this.closed = true } }
  const connect = overrides => listeners.get('message')?.({ source: parent, origin, data: { type: 'experiment/connect', protocolVersion: 3, channel }, ports: [port], ...overrides })
  return { connection, port, sent, ready, connect, listeners }
}

test('SDK authenticates its host and one channel before receiving frames', async () => {
  const draws = []
  const h = harness(snapshot => draws.push(snapshot))
  assert.equal(h.ready[0].value.protocolVersion, 3)
  h.connect({ origin: 'https://wrong.example' }); assert.equal(h.sent.length, 0)
  h.connect({ source: {} }); assert.equal(h.sent.length, 0)
  h.connect({ ports: [] }); assert.equal(h.sent.length, 0)
  h.connect(); assert.equal(h.sent[0].type, 'experiment/connected')
  h.port.onmessage({ data: { type: 'experiment/snapshot', protocolVersion: 3, frameId: 'exact-1', snapshot: fixture } })
  await tick()
  assert.deepEqual(draws, [fixture])
  assert.deepEqual(h.sent[1], { type: 'experiment/rendered', protocolVersion: 3, frameId: 'exact-1', revision: fixture.revision })
  h.connection.send({ type: 'parameter/commit', protocolVersion: 3, id: 'value', value: NaN })
  assert.equal(h.sent.length, 2)
  h.connection.dispose(); assert.equal(h.port.closed, true)
})
test('SDK reports invalid provenance and render failures without a success acknowledgement', async () => {
  const h = harness(() => { throw new Error('Rendering failed') })
  h.connect()
  h.port.onmessage({ data: { type: 'experiment/snapshot', protocolVersion: 3, frameId: 'invalid', snapshot: { ...fixture, experimentId: 'wrong' } } })
  assert.equal(h.sent.at(-1).code, 'SNAPSHOT_INVALID')
  h.port.onmessage({ data: { type: 'experiment/snapshot', protocolVersion: 3, frameId: 'throws', snapshot: fixture } })
  await tick()
  assert.equal(h.sent.at(-1).code, 'RENDER_FAILED')
  assert.equal(h.sent.filter(item => item.type === 'experiment/rendered').length, 0)
  const cyclic = { ...fixture }; cyclic.self = cyclic
  assert.equal(isUniversalSnapshot(cyclic), false)
  assert.equal(isUniversalSnapshot({ ...fixture, view: {callback() {}} }), false)
  h.connection.dispose()
})
test('blocked rendering coalesces pending frames while preserving the in-flight frame identity', async () => {
  let release
  const drawn = []
  const h = harness(async snapshot => { drawn.push(snapshot.revision); if (drawn.length === 1) await new Promise(resolve => { release = resolve }) })
  h.connect()
  for (const revision of [1, 2, 3]) h.port.onmessage({ data: { type: 'experiment/snapshot', protocolVersion: 3, frameId: `frame-${revision}`, snapshot: { ...fixture, revision } } })
  assert.equal(h.sent.length, 1)
  release(); await tick()
  assert.deepEqual(drawn, [1, 3])
  assert.deepEqual(h.sent.slice(1).map(item => [item.frameId, item.revision]), [['frame-1', 1], ['frame-3', 3]])
  h.connection.dispose()
})
