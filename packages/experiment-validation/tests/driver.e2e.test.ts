/**
 * End-to-end proof that the driver observes the *innermost* authored frame
 * through the real two-layer opaque protocol — not a host-side imitation.
 *
 * Runs only where a Playwright Chromium is installed (the server build gate).
 * Locally, set PHYSICSOS_VALIDATION_E2E=1 to run it with the local browser.
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import { validateCandidate, validationHostPage, validationWrapper, evaluateObservation } from '../src/index.ts'
import type { Browser } from '@playwright/test'

const run = process.env.PHYSICSOS_VALIDATION_E2E === '1' || process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER === '1'
const describeE2E = run ? describe : describe.skip

/** One authored-style renderer: connects over the real V3 protocol and paints per snapshot. */
const authoredRuntime = (mode: 'good' | 'bad'): string => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#canvas{position:fixed;inset:0}</style></head><body><div id="canvas"></div><script type="module">
const params = new URLSearchParams(location.search)
const host = params.get('hostOrigin'), channel = params.get('channel')
const port = await new Promise(resolve => {
  const onMessage = event => {
    const data = event.data
    if (data && data.type === 'experiment/connect' && data.channel === channel) {
      removeEventListener('message', onMessage)
      resolve(event.ports[0])
    }
  }
  addEventListener('message', onMessage)
  parent.postMessage({ type: 'experiment/ready', protocolVersion: 3, channel }, host)
})
const root = document.getElementById('canvas')
const view = document.createElement('canvas')
view.width = 320
view.height = 240
root.append(view)
const ctx = view.getContext('2d')
let frames = 0
port.onmessage = message => {
  const data = message.data
  if (!data || data.type !== 'experiment/snapshot') return
  try {
    const body = data.snapshot.view.bodies[0].at
    const t = data.snapshot.clock.time
    ${mode === 'good'
      ? `const speed = data.snapshot.inspector[0].parameters[0].value
    ctx.fillStyle = '#0b1b2b'
    ctx.fillRect(0, 0, view.width, view.height)
    ctx.fillStyle = '#7fd7ff'
    ctx.beginPath()
    ctx.arc(60 + body.x * 20 + speed, view.height - 40 - body.y * 20, 12 + t * 4, 0, Math.PI * 2)
    ctx.fill()
    view.setAttribute('data-body-x', String(body.x))
    view.setAttribute('data-body-y', String(body.y))
    view.setAttribute('data-clock-time', String(t))`
      : `ctx.fillStyle = '#eeeeee'
    ctx.fillRect(0, 0, view.width, view.height)`}
    frames++
    port.postMessage({ type: 'experiment/rendered', protocolVersion: 3, frameId: data.frameId, revision: data.snapshot.revision })
  } catch {
    port.postMessage({ type: 'experiment/error', protocolVersion: 3, code: 'RENDER_FAILED' })
  }
}
port.start()
</script></body></html>`

const snapshotAt = (time: number, speed: number, y: number) => ({
  title: '验收夹具', domain: 'mechanics', revision: 1,
  clock: { time, total: 2.4, running: false, rate: 1 },
  inspector: [{ id: 'motion', parameters: [{ id: 'speed', label: '初速度', value: speed, unit: 'm/s', min: 5, max: 40 }] }],
  view: { bodies: [{ at: { x: time * 2, y } }], visible: {} },
})
const snapshots = [
  { frameId: 'f0', snapshot: snapshotAt(0, 20, 0) },
  { frameId: 'f1', snapshot: snapshotAt(1.2, 20, 1.8) },
  { frameId: 'f2', snapshot: snapshotAt(2.4, 20, 0) },
]
const changed = { frameId: 'f-changed', snapshot: snapshotAt(0, 25, 0) }

describeE2E('isolated browser acceptance (real protocol)', () => {
  let server: Server
  let browser: Browser
  let origin: string
  let dir: string
  const token = 't'.repeat(32)

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'physicsos-validation-e2e-'))
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === `/validation/${token}/wrapper.html`) {
        const wrapper = validationWrapper(new URL(`/validation/${token}/good/index.html`, origin))
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': wrapper.csp })
        res.end(wrapper.bytes)
        return
      }
      if (url.pathname === `/validation/${token}/host.html`) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(validationHostPage({ token, wrapperPath: `/validation/${token}/wrapper.html`, frames: snapshots, changedFrame: changed }))
        return
      }
      if (url.pathname === `/validation/${token}/good/index.html`) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(authoredRuntime('good')); return }
      if (url.pathname === `/validation/${token}/bad/index.html`) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(authoredRuntime('bad')); return }
      res.writeHead(404); res.end()
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    origin = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await new Promise<void>(resolve => { server?.close(() => { resolve() }) })
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  })

  /**
   * The wrapper always points at `good/index.html` (its frame-src CSP is
   * fixed), so the "broken" case is served at that same path in its own
   * origin prefix; see `originFor`.
   */
  it('accepts a moving, engine-bound repaint through two opaque iframes', async () => {
    const { result } = await validateCandidate({ browser, assets: { hostUrl: `${origin}/validation/${token}/host.html`, wrapperUrl: `${origin}/validation/${token}/wrapper.html`, entryUrl: `${origin}/validation/${token}/good/index.html` }, frames: snapshots, changedFrame: changed, screenshotPath: join(dir, 'good.png') })
    const verdict = evaluateObservation({
      ...result,
      candidateSha256: 'a'.repeat(64),
      expectedSceneSha256: 'e'.repeat(64),
      candidateSceneSha256: 'e'.repeat(64),
      candidateSceneRevision: 1,
      expectedSceneRevision: 1,
    })
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(verdict.checks.filter(check => !check.passed)).toEqual([])
    expect(verdict.passed).toBe(true)
  }, 120_000)

  it('rejects a static background that only pretends to be an experiment', async () => {
    // Same wrapper path, but the wrapper's raw entry resolves to the bad page
    // for this run; the host page is served under the bad prefix too.
    const badWrapper = new URL(`/validation/${token}/bad/index.html`, origin)
    const wrapper = validationWrapper(badWrapper)
    server.removeAllListeners('request')
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === `/validation/${token}/bad-wrapper.html`) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': wrapper.csp })
        res.end(wrapper.bytes)
        return
      }
      if (url.pathname === `/validation/${token}/bad-host.html`) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(validationHostPage({ token, wrapperPath: `/validation/${token}/bad-wrapper.html`, frames: snapshots, changedFrame: changed }))
        return
      }
      if (url.pathname === `/validation/${token}/bad/index.html`) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(authoredRuntime('bad')); return }
      res.writeHead(404); res.end()
    })
    const { result } = await validateCandidate({ browser, assets: { hostUrl: `${origin}/validation/${token}/bad-host.html`, wrapperUrl: `${origin}/validation/${token}/bad-wrapper.html`, entryUrl: `${origin}/validation/${token}/bad/index.html` }, frames: snapshots, changedFrame: changed })
    const verdict = evaluateObservation({
      ...result,
      candidateSha256: 'a'.repeat(64),
      expectedSceneSha256: 'e'.repeat(64),
      candidateSceneSha256: 'e'.repeat(64),
      candidateSceneRevision: 1,
      expectedSceneRevision: 1,
    })
    expect(verdict.passed).toBe(false)
    const names = verdict.checks.filter(check => !check.passed).map(check => check.name)
    expect(names).toContain('geometry-follows-engine')
    expect(names).toContain('motion-sampled')
  }, 120_000)
})
