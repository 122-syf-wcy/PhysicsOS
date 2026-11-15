import assert from 'node:assert/strict'
import test from 'node:test'
import { createRetainedController } from './src/retained-controller.js'
import { createResourceOwner, createAssetFence } from './src/render-resources.js'

function harness(options = {}) {
  let time = 0, visible = true, nextTimer = 0
  const timers = new Map(), drawn = [], phases = [], failures = []
  const controller = createRetainedController({
    draw(snapshot, repaint) { drawn.push({ snapshot, repaint }); return true },
    visible: () => visible, now: () => time,
    setTimer(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: time + ms }); return id }, clearTimer: id => timers.delete(id),
    onState: phase => phases.push(phase), onFailure: error => failures.push(error), ...options,
  })
  return { controller, drawn, phases, failures, timers,
    visible(value) { visible = value; controller.visibilityChanged() },
    advance(ms) {
      const target = time + ms
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > target) break
        time = next[1].at; timers.delete(next[0]); next[1].fn()
      }
      time = target
    },
  }
}
const frame = revision => Object.freeze({ source: 'platform-engine', experimentId: 'average-speed', revision, clock: Object.freeze({ time: revision / 100, running: true }), owner: 'unchanged-owner', release: 'unchanged-release' })

test('context lost waits, restores the exact trusted frame, then returns ready without reconstructing science', async () => {
  let recoveries = 0, losses = 0
  const h = harness({ recover() { recoveries++ }, onLoss() { losses++ } }), first = frame(1), next = frame(2)
  assert.equal(h.controller.submit(first), true)
  h.controller.contextLost()
  let acknowledged = false
  const waiting = h.controller.submit(next).then(() => { acknowledged = true })
  await Promise.resolve()
  assert.equal(acknowledged, false); assert.equal(h.drawn.length, 1); assert.equal(h.controller.state, 'contextlost')
  assert.equal(h.controller.latestSnapshot, next)
  h.controller.contextRestored(); await waiting
  assert.equal(h.controller.state, 'ready'); assert.equal(recoveries, 1); assert.equal(losses, 1)
  assert.deepEqual(h.phases, ['contextlost', 'recovering', 'ready']); assert.equal(h.failures.length, 0)
  assert.equal(h.drawn.at(-1).snapshot, next, 'original trusted object must be drawn, not rebuilt/integrated')
  assert.equal(next.clock.time, 0.02); assert.equal(next.owner, 'unchanged-owner'); assert.equal(next.release, 'unchanged-release')
  h.controller.dispose()
})

test('latest submission does not masquerade as the earlier waiting frame ACK', async () => {
  const h = harness(), first = frame(1), later = frame(2)
  h.controller.contextLost()
  const firstPromise = h.controller.submit(first), laterPromise = h.controller.submit(later)
  h.controller.contextRestored()
  await Promise.all([firstPromise, laterPromise])
  assert.deepEqual(h.drawn.map(item => item.snapshot), [first, later], 'no success for an undrawn submitted revision')
  assert.equal(h.controller.latestSnapshot, later)
  h.controller.dispose()
})

test('zero area/hidden and BFCache suspension cannot ACK until shown, same display resumes', async () => {
  const h = harness(), next = frame(7)
  h.visible(false)
  let acknowledged = false
  const waiting = h.controller.submit(next).then(() => { acknowledged = true })
  h.advance(60000); await Promise.resolve()
  assert.equal(h.drawn.length, 0); assert.equal(acknowledged, false); assert.equal(h.failures.length, 0)
  h.controller.suspend(true); h.visible(true)
  assert.equal(h.drawn.length, 0)
  h.controller.suspend(false); await waiting
  assert.equal(h.drawn[0].snapshot, next); assert.equal(h.controller.state, 'ready')
  h.controller.suspend(true); h.advance(60000); h.controller.suspend(false)
  assert.equal(h.drawn.at(-1).snapshot, next); assert.equal(h.drawn.at(-1).repaint, true)
  h.controller.dispose()
})

test('visible recovery has a bounded failure, hidden time does not exhaust its recovery budget', async () => {
  const h = harness(), next = frame(9)
  h.controller.contextLost()
  const rejected = assert.rejects(h.controller.submit(next), /recovery timed out/)
  h.advance(4000); h.visible(false); h.advance(60000)
  assert.equal(h.controller.state, 'contextlost'); assert.equal(h.failures.length, 0)
  h.visible(true); h.advance(5999)
  assert.equal(h.failures.length, 0)
  h.advance(1); await rejected
  assert.equal(h.controller.state, 'failed'); assert.equal(h.failures.length, 1)
  h.controller.contextRestored(); assert.equal(h.controller.state, 'failed')
  h.controller.dispose()
})

test('restore errors become explicit terminal failure and all waiting frames reject', async () => {
  const h = harness({ recover() { throw new Error('Environment restoration failed') } })
  h.controller.contextLost()
  const rejected = assert.rejects(h.controller.submit(frame(11)), /Environment restoration failed/)
  h.controller.contextRestored(); await rejected
  assert.equal(h.controller.state, 'failed'); assert.equal(h.failures.length, 1)
  h.controller.dispose(); h.controller.dispose()
  assert.equal(h.controller.state, 'disposed'); assert.equal(h.timers.size, 0)
})

test('dispose rejects pending drawing once and a late restore cannot redraw a disposed display', async () => {
  const h = harness()
  h.controller.contextLost()
  const rejected = assert.rejects(h.controller.submit(frame(13)), /display is disposed/)
  h.controller.dispose(); h.controller.dispose(); h.controller.contextRestored()
  await rejected
  assert.equal(h.drawn.length, 0); assert.equal(h.failures.length, 0); assert.equal(h.timers.size, 0)
})

test('generation fence retires late textures and disposal is idempotent, no late install after replacement', () => {
  const owner = createResourceOwner(), fence = createAssetFence(owner), counts = new Map(), installs = []
  const texture = name => ({ name, dispose() { counts.set(name, (counts.get(name) ?? 0) + 1) } })
  const old = texture('old'), firstTicket = fence.ticket()
  fence.own(old); fence.invalidate()
  assert.equal(fence.accept(firstTicket, old, resource => installs.push(resource)), false)
  assert.equal(counts.get('old'), 1); assert.equal(installs.length, 0)
  const next = texture('next'), ticket = fence.ticket()
  assert.equal(fence.accept(ticket, next, resource => installs.push(resource)), true)
  fence.dispose(); fence.dispose()
  assert.equal(counts.get('next'), 1)
  const late = texture('late')
  assert.equal(fence.accept(ticket, late, resource => installs.push(resource)), false)
  assert.equal(counts.get('late'), 1); assert.equal(installs.length, 1)
})
