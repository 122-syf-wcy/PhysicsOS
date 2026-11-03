import assert from 'node:assert/strict'
import test from 'node:test'
import { connectExperiment, isSnapshot } from '../src/protocol.ts'

const valid = {
  revision: 0,
  source: 'preview-fixture',
  parameters: { objectDistanceCm: 30, objectHeightCm: 6, focalLengthCm: 10, screenDistanceCm: 15 },
  visible: { image: true, rays: true },
  rays: [
    {
      points: [
        { x: -30, y: 6 },
        { x: 0, y: 6 },
        { x: 15, y: -3 },
      ],
    },
  ],
  result: { imageDistanceCm: 15, imageHeightCm: -3, imageKind: 'real', screenSharp: true },
}
test('accepts finite host snapshots and explicit no-image state', () => {
  assert.equal(isSnapshot(valid), true)
  assert.equal(
    isSnapshot({
      ...valid,
      result: {
        ...valid.result,
        imageDistanceCm: null,
        imageHeightCm: null,
        imageKind: 'none',
        screenSharp: false,
      },
    }),
    true,
  )
})
test('rejects malformed frames rather than assigning them into Three objects', () => {
  for (const value of [
    null,
    [],
    {},
    { ...valid, revision: -1 },
    { ...valid, source: 'arbitrary' },
    { ...valid, parameters: { ...valid.parameters, focalLengthCm: NaN } },
    { ...valid, result: { ...valid.result, imageDistanceCm: Infinity } },
  ])
    assert.equal(isSnapshot(value), false)
})

test('rejects missing layer/height facts and malformed or excessive ray geometry', () => {
  for (const value of [
    { ...valid, parameters: { ...valid.parameters, objectHeightCm: undefined } },
    { ...valid, visible: undefined },
    { ...valid, visible: { image: 'yes', rays: true } },
    { ...valid, rays: undefined },
    {
      ...valid,
      rays: [
        {
          points: [
            { x: 0, y: NaN },
            { x: 1, y: 1 },
          ],
        },
      ],
    },
    { ...valid, rays: [{ points: [{ x: 0, y: 0 }] }] },
    {
      ...valid,
      rays: [
        {
          points: valid.rays[0].points,
          extension: [
            { x: 0, y: 0 },
            { x: Infinity, y: 1 },
          ],
        },
      ],
    },
    { ...valid, rays: Array(13).fill(valid.rays[0]) },
    { ...valid, rays: [{ points: Array(17).fill({ x: 0, y: 0 }) }] },
  ])
    assert.equal(isSnapshot(value), false)
})

function openConnection(onFrame) {
  const listeners = new Set()
  const parent = { postMessage() {} }
  Object.assign(globalThis, {
    location: { search: '?hostOrigin=https%3A%2F%2Fhost.example&channel=channel-token-123456' },
    parent,
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
  })
  const posted = []
  const port = { start() {}, close() {}, postMessage: (message) => posted.push(message) }
  const connection = connectExperiment(onFrame)
  for (const listener of listeners)
    listener({
      source: parent,
      origin: 'https://host.example',
      data: { type: 'experiment/connect', protocolVersion: 2, channel: 'channel-token-123456' },
      ports: [port],
    })
  return { connection, posted, message: (data) => port.onmessage?.({ data }) }
}
const snapshotMessage = (frameId, revision = 0) => ({
  type: 'experiment/snapshot',
  protocolVersion: 2,
  frameId,
  snapshot: { ...valid, source: 'platform-engine', revision },
})
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
test('V2 acknowledges only after the renderer completes, with the exact received frame and revision', async () => {
  let complete
  const seen = []
  const fixture = openConnection((frame) => {
    seen.push(frame.revision)
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  fixture.message(snapshotMessage('frame-1', 7))
  await flush()
  assert.deepEqual(seen, [7])
  assert.deepEqual(fixture.posted, [{ type: 'experiment/connected', protocolVersion: 2 }])
  complete()
  await flush()
  assert.deepEqual(fixture.posted.at(-1), {
    type: 'experiment/rendered',
    protocolVersion: 2,
    frameId: 'frame-1',
    revision: 7,
  })
  fixture.connection.dispose()
})
test('V2 serializes asynchronous render callbacks in arrival order and revokes pending work on dispose', async () => {
  const seen = []
  const completes = []
  const fixture = openConnection((frame) => {
    seen.push(frame.revision)
    return new Promise((resolve) => completes.push(resolve))
  })
  fixture.message(snapshotMessage('frame-1', 1))
  fixture.message(snapshotMessage('frame-2', 2))
  await flush()
  assert.deepEqual(seen, [1])
  completes[0]()
  await flush()
  assert.deepEqual(seen, [1, 2])
  assert.deepEqual(fixture.posted.at(-1), {
    type: 'experiment/rendered',
    protocolVersion: 2,
    frameId: 'frame-1',
    revision: 1,
  })
  fixture.connection.dispose()
  completes[1]()
  await flush()
  assert.equal(fixture.posted.filter((item) => item.type === 'experiment/rendered').length, 1)
})
test('V2 reports rejected renderers and malformed snapshots with fixed error codes', async () => {
  const fixture = openConnection(async () => {
    throw new Error('secret rendering details')
  })
  fixture.message(snapshotMessage('frame-1'))
  await flush()
  assert.deepEqual(fixture.posted.at(-1), {
    type: 'experiment/error',
    protocolVersion: 2,
    code: 'RENDER_FAILED',
  })
  fixture.message({ ...snapshotMessage('frame-2'), snapshot: {} })
  await flush()
  assert.deepEqual(fixture.posted.at(-1), {
    type: 'experiment/error',
    protocolVersion: 2,
    code: 'SNAPSHOT_INVALID',
  })
  fixture.connection.dispose()
})

test('V2 blocked-render bursts preserve the first frame and draw only the latest pending full state', async () => {
  const seen = []
  const completes = []
  const fixture = openConnection((frame) => {
    seen.push(frame.revision)
    return new Promise((resolve) => completes.push(resolve))
  })
  fixture.message(snapshotMessage('frame-1', 1))
  await flush()
  for (let revision = 2; revision <= 100; revision++)
    fixture.message(snapshotMessage(`frame-${revision}`, revision))
  await flush()
  assert.deepEqual(seen, [1])
  completes[0]()
  await flush()
  assert.deepEqual(seen, [1, 100])
  assert.deepEqual(fixture.posted.at(-1), {
    type: 'experiment/rendered',
    protocolVersion: 2,
    frameId: 'frame-1',
    revision: 1,
  })
  completes[1]()
  await flush()
  assert.deepEqual(
    fixture.posted.filter((message) => message.type === 'experiment/rendered'),
    [
      { type: 'experiment/rendered', protocolVersion: 2, frameId: 'frame-1', revision: 1 },
      { type: 'experiment/rendered', protocolVersion: 2, frameId: 'frame-100', revision: 100 },
    ],
  )
  fixture.message(snapshotMessage('frame-101', 101))
  fixture.message(snapshotMessage('frame-102', 102))
  fixture.message(snapshotMessage('frame-103', 103))
  await flush()
  assert.deepEqual(seen, [1, 100, 101])
  fixture.connection.dispose()
  completes[2]()
  await flush()
  assert.deepEqual(seen, [1, 100, 101])
  assert.equal(fixture.posted.filter((message) => message.type === 'experiment/rendered').length, 2)
})

test('V2 invalid envelopes report fixed errors immediately while another frame is blocked', async () => {
  let complete
  const seen = []
  const fixture = openConnection((frame) => {
    seen.push(frame.revision)
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  fixture.message(snapshotMessage('frame-1', 1))
  await flush()
  for (const malformed of [
    { ...snapshotMessage('frame-2', 2), snapshot: {} },
    snapshotMessage('', 2),
    snapshotMessage('x'.repeat(161), 2),
  ]) {
    fixture.message(malformed)
    await flush()
    assert.deepEqual(fixture.posted.at(-1), {
      type: 'experiment/error',
      protocolVersion: 2,
      code: 'SNAPSHOT_INVALID',
    })
  }
  assert.deepEqual(seen, [1])
  fixture.connection.dispose()
  complete()
  await flush()
  assert.equal(
    fixture.posted.some((message) => message.type === 'experiment/rendered'),
    false,
  )
})
