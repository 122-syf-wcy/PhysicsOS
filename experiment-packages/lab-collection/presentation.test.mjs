import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = (await readFile(new URL('./src/main.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '')
function packagePage() {
  const elements = new Map()
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, dataset: {}, addEventListener() {} })
    return elements.get(id)
  }
  const root = { dataset: {} }, sent = []
  let draw, presentation
  runInNewContext(source, {
    document: { documentElement: root, getElementById: element, querySelector: selector => element(selector), addEventListener() {} },
    connectExperiment(onFrame, options) { draw = onFrame; presentation = options?.onPresentation; return { send: intent => sent.push(intent), reportError() {}, dispose() {} } },
    renderFrame() {}, disposeRenderer() {}, addEventListener() {},
  })
  const snapshot = { title: '斜面实验', inspector: [], clock: { total: 10, time: 1, running: false } }
  return { root, element, sent, present: mode => presentation?.({ mode }), draw: () => draw(snapshot) }
}

test('embedded package keeps duplicate controls hidden through successive engine frames', async () => {
  const h = packagePage()
  h.present('embedded')
  assert.equal(h.root.dataset.presentation, 'embedded')
  assert.equal(h.element('header').hidden, true)
  assert.equal(h.element('.settings').hidden, true)
  await h.draw(); await h.draw()
  assert.equal(h.element('playback').hidden, true)
  assert.equal(h.element('canvas').hidden, false)
  assert.equal(h.element('readouts').hidden, false)
  assert.deepEqual(h.sent, [])
})
test('standalone and legacy-host pages retain parameter and playback controls', async () => {
  for (const mode of [undefined, 'standalone']) {
    const h = packagePage()
    if (mode) h.present(mode)
    await h.draw()
    assert.equal(h.element('header').hidden, false)
    assert.equal(h.element('.settings').hidden, false)
    assert.equal(h.element('playback').hidden, false)
  }
})
