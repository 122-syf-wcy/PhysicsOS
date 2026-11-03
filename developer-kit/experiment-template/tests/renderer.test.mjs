import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import * as three from 'three'

let renders = 0
let renderFailure = false
class Renderer {
  domElement = new EventTarget()
  constructor() {
    this.domElement.setAttribute = () => {}
    this.domElement.remove = () => {}
  }
  setPixelRatio() {}
  setSize() {}
  render() {
    if (renderFailure) throw new Error('private GPU details')
    renders += 1
  }
  dispose() {}
  forceContextLoss() {}
}
mock.module('three', { namedExports: { ...three, WebGLRenderer: Renderer } })
const { mountLens } = await import('../src/lens-renderer.ts')
const snapshot = {
  revision: 0,
  source: 'platform-engine',
  parameters: { objectDistanceCm: 30, objectHeightCm: 6, focalLengthCm: 10, screenDistanceCm: 15 },
  visible: { image: true, rays: true },
  rays: [],
  result: { imageDistanceCm: 15, imageHeightCm: -3, imageKind: 'real', screenSharp: true },
}
function mount() {
  const callbacks = new Map()
  let sequence = 0
  Object.assign(globalThis, {
    devicePixelRatio: 1,
    document: Object.assign(new EventTarget(), { hidden: false }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => {
      callbacks.set(++sequence, callback)
      return sequence
    },
    cancelAnimationFrame: (id) => callbacks.delete(id),
  })
  const host = { append() {}, clientWidth: 800, clientHeight: 600, dataset: {} }
  const failures = []
  const view = mountLens(
    host,
    () => {},
    () => failures.push(true),
  )
  const tick = () => {
    for (const [id, callback] of callbacks) {
      callbacks.delete(id)
      callback()
    }
  }
  return { view, tick, callbacks, failures }
}
test('snapshot completion waits for its scheduled render instead of acknowledging before a draw', async () => {
  const fixture = mount()
  const before = renders
  let complete = false
  const pending = fixture.view.update(snapshot)
  assert.ok(pending instanceof Promise)
  pending.then(() => {
    complete = true
  })
  await Promise.resolve()
  assert.equal(complete, false)
  assert.equal(renders, before)
  fixture.tick()
  await pending
  assert.equal(renders, before + 1)
  fixture.view.dispose()
})
test('scheduled GPU failures reject snapshot completion and report a bounded renderer failure', async () => {
  const fixture = mount()
  const pending = fixture.view.update(snapshot)
  assert.ok(pending instanceof Promise)
  renderFailure = true
  try {
    const rejected = assert.rejects(pending)
    fixture.tick()
    await rejected
    assert.equal(fixture.failures.length, 1)
  } finally {
    renderFailure = false
    fixture.view.dispose()
  }
})
test('disposing before a scheduled render settles pending work without drawing', async () => {
  const fixture = mount()
  const before = renders
  const pending = fixture.view.update(snapshot)
  assert.ok(pending instanceof Promise)
  const rejected = assert.rejects(pending)
  fixture.view.dispose()
  await rejected
  fixture.tick()
  assert.equal(renders, before)
  assert.equal(fixture.callbacks.size, 0)
})
