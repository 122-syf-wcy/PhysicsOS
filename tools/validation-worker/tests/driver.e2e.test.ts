/**
 * Real HTTP + two-layer iframe + standard V3 SDK regression.
 *
 * The FrameSource below is explicitly a protocol/drawing fixture, NOT a physics
 * solver or an accuracy test. The host's canonical-runtime tests cover physics
 * facts. Formal browser execution belongs to the server Docker gate.
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateCandidate, validationHostPage, validationWrapper, evaluateObservation, startValidationWorker, planScene } from '../src/index.ts'
import type { Browser } from '@playwright/test'
import type { FrameSource, ValidationResponse } from '../src/index.ts'

const run = process.env.PHYSICSOS_VALIDATION_E2E === '1' || process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER === '1'
const describeE2E = run ? describe : describe.skip
// This is the target in the REAL developer-kit target.js served below.
const experimentId = 'uniform-linear'
const scene = { id: 'protocol-fixture-not-a-template-id', revision: 41 }
const sceneRevision = 7

/** Hand-picked positions exercise transport/probes, never claim physical accuracy. */
const createFixtureRuntime = (_scene: Record<string, unknown>): FrameSource => {
  let time = 0, speed = 20, revision = sceneRevision
  const snapshot = () => ({
    sceneRevision: revision, status: 'ready', domain: 'mechanics', title: 'SDK 协议夹具（非物理精度测试）', ariaLabel: '协议与绘制夹具',
    clock: { time, total: 2.4, running: false, rate: 1 },
    inspector: [{ id: 'motion', parameters: [{ id: 'speed', label: '夹具参数', value: speed, unit: 'm/s', min: 5, max: 40, step: 5 }] }],
    view: { bodies: [{ at: { x: 1 + time * 2 + (speed - 20) / 5, y: time === 1.2 ? 5 : 1 } }], visible: {} },
    table: { columns: [], rows: [] }, charts: [], verification: [],
    events: [{ kind: 'apex', time: 1.2 }, { kind: 'impact', time: 2.4 }], trajectoryTimes: [0, 1.2, 2.4],
    // These runtime-only fields MUST NOT be copied wholesale onto the V3 wire.
    sampleReadout: () => ({ time }), ownerSessionId: 'fixture-private-owner', scene: _scene,
  })
  return {
    getSnapshot: snapshot,
    seek(next) { time = next; return snapshot() },
    editParameter(id, value) {
      if (id !== 'speed') throw new Error('unknown fixture parameter')
      speed = value; time = 0; revision++
      return snapshot()
    },
  }
}
const plan = planScene(scene, createFixtureRuntime, experimentId)
const snapshots = plan.frames
const changed = plan.changedFrame!
const modes = ['good', 'wrong-x', 'wrong-y', 'static', 'stamp-only', 'unpainted', 'overpainted', 'same-color-cover', 'oversized', 'transparent', 'hidden', 'filtered', 'wrong-transform', 'pixel-space', 'wrong-changed'] as const
type Mode = typeof modes[number]

/** Only the renderer is a fixture. Connection/validation comes from the unmodified SDK. */
const authoredRuntime = (mode: Mode): string => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#canvas{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}</style></head><body><div id="canvas"></div><script type="module">
import { connectExperiment } from './protocol.js'
const mode = ${JSON.stringify(mode)}
const view = document.createElement('canvas')
view.width = 320; view.height = 240
if (mode === 'hidden') view.style.opacity = '0'
if (mode === 'filtered') view.style.filter = 'opacity(0)'
document.getElementById('canvas').append(view)
const ctx = view.getContext('2d')
connectExperiment(snapshot => {
  const body = snapshot.view.bodies[0].at
  const time = snapshot.clock.time
  const speed = snapshot.inspector[0].parameters[0].value
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  // These bad modes deliberately change pixels WITHOUT painting the subject.
  const background = ['stamp-only', 'unpainted', 'transparent'].includes(mode)
    ? 'rgb(' + Math.round(20 + time * 40 + speed) + ',30,40)' : '#0b1b2b'
  ctx.fillStyle = background
  ctx.fillRect(0, 0, view.width, view.height)
  if (mode !== 'static' && mode !== 'stamp-only') {
    ctx.setTransform(20, 0, 0, -20, 60 + (mode === 'wrong-transform' ? time * 8 : 0), 200)
    ctx.fillStyle = ['same-color-cover', 'oversized'].includes(mode) ? 'rgb(' + Math.round(70 + time * 25 + speed) + ',160,190)' : '#7fd7ff'
    if (mode === 'transparent') ctx.globalAlpha = 0
    let x = body.x + (mode === 'wrong-x' || (mode === 'wrong-changed' && speed !== 20) ? 1 : 0)
    let y = body.y + (mode === 'wrong-y' ? 1 : 0)
    let radius = mode === 'oversized' ? 1000 : 0.6
    if (mode === 'pixel-space') {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      x = 60 + body.x * 20; y = 200 - body.y * 20; radius = 12
    }
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    if (mode !== 'unpainted') ctx.fill()
    if (mode === 'overpainted' || mode === 'same-color-cover') {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (mode === 'overpainted') ctx.fillStyle = background
      ctx.fillRect(0, 0, view.width, view.height)
    }
  }
  if (mode !== 'good' && mode !== 'pixel-space') {
    // Accurate self-reports must NOT rescue incorrect/absent native drawing.
    view.setAttribute('data-body-x', String(body.x))
    view.setAttribute('data-body-y', String(body.y))
    view.setAttribute('data-clock-time', String(time))
    window.__physicsosDrawStats = { geometry: [{ x: body.x, y: body.y }] }
  }
})
</script></body></html>`

const identity = {
  candidateSha256: 'a'.repeat(64), expectedSceneSha256: 'e'.repeat(64), candidateSceneSha256: 'e'.repeat(64),
  candidateSceneRevision: sceneRevision, expectedSceneRevision: sceneRevision,
}

describeE2E('isolated browser acceptance (standard V3 SDK)', () => {
  let server: Server
  let browser: Browser
  let worker: Awaited<ReturnType<typeof startValidationWorker>>
  let origin: string
  let dir: string
  const token = 't'.repeat(32)
  const sdkRequests = new Set<string>()
  const runtimeScenes: Record<string, unknown>[] = []
  const assetsFor = (mode: Mode) => ({
    hostUrl: `${origin}/validation/${token}/${mode}/host.html`,
    wrapperUrl: `${origin}/validation/${token}/${mode}/wrapper.html`,
    entryUrl: `${origin}/validation/${token}/${mode}/index.html`,
  })

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'physicsos-validation-e2e-'))
    // Resolve from repository source, not a Mac path, compiled copy or handwritten protocol.
    const sdk = new Map(await Promise.all(['protocol.js', 'universal-contract.js', 'target.js'].map(async name => [
      name, await readFile(new URL(`../../../developer-kit/universal-experiment-template/src/${name}`, import.meta.url), 'utf8'),
    ] as const)))
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const prefix = `/validation/${token}/`
      const [mode, file, extra] = url.pathname.slice(prefix.length).split('/')
      if (!url.pathname.startsWith(prefix) || !modes.includes(mode as Mode) || extra !== undefined) { res.writeHead(404); res.end(); return }
      if (file === 'wrapper.html') {
        const wrapper = validationWrapper(new URL(assetsFor(mode as Mode).entryUrl))
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': wrapper.csp })
        res.end(wrapper.bytes)
        return
      }
      if (file === 'host.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(validationHostPage({ token, wrapperPath: assetsFor(mode as Mode).wrapperUrl, frames: snapshots, changedFrame: changed }))
        return
      }
      if (file === 'index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(authoredRuntime(mode as Mode)); return }
      const source = file === undefined ? undefined : sdk.get(file)
      if (source !== undefined) {
        sdkRequests.add(file!)
        // ES modules in the real sandbox="allow-scripts" iframe have opaque origin.
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'access-control-allow-origin': '*' })
        res.end(source)
        return
      }
      res.writeHead(404); res.end()
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no asset port')
    origin = `http://127.0.0.1:${address.port}`
    worker = await startValidationWorker({
      token, screenshots: false,
      runtimeFor: async input => { runtimeScenes.push(input); return createFixtureRuntime },
    })
    // Reuse the worker's sandboxed browser; each validation still gets a fresh context.
    browser = worker.browser
  }, 120_000)

  afterAll(async () => {
    await worker?.close()
    if (server !== undefined) await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  })

  const post = async (overrides: Record<string, unknown> = {}) => {
    const assets = assetsFor('good')
    return await fetch(`http://127.0.0.1:${worker.port}/validate`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        wrapperUrl: assets.wrapperUrl, entryUrl: assets.entryUrl, token, scene, experimentId,
        expected: { candidateSha256: identity.candidateSha256, sceneSha256: identity.expectedSceneSha256, sceneRevision },
        ...overrides,
      }),
    })
  }

  it('accepts cold scene-only HTTP via runtimeFor → planScene → the actual SDK, without stamps', async () => {
    const before = runtimeScenes.length
    // No frames/changedFrame/hostUrl: the server must plan and normalize both kinds of frame.
    const response = await post()
    expect(response.status).toBe(200)
    const body = await response.json() as ValidationResponse
    expect(runtimeScenes.slice(before)).toEqual([scene])
    expect([...sdkRequests].sort()).toEqual(['protocol.js', 'target.js', 'universal-contract.js'])
    expect(body.result.firstFrameAcknowledged).toBe(true)
    expect(body.result.runtimeError).toBeUndefined()
    expect(body.result.frames).toHaveLength(3)
    expect(body.result.frames.map(frame => frame.time)).toEqual([0, 1.2, 2.4])
    expect(body.result.frames.map(frame => frame.revision)).toEqual([7, 7, 7])
    expect(body.result.changedFrame?.revision).toBe(8)
    expect(body.result.frames.every(frame => frame.stamped === undefined && frame.opaquePixels > 0 && frame.drawnBodies?.length === 1)).toBe(true)
    expect(body.result.changedFrame?.drawnBodies).toHaveLength(1)
    expect(body.checks.filter(check => !check.passed)).toEqual([])
    expect(body.passed).toBe(true)
  }, 120_000)

  it.each(['source', 'experimentId', 'revision', 'ariaLabel', 'table', 'charts', 'verification', 'events', 'trajectoryTimes'])('lets the standard SDK reject missing %s (not a permissive imitation)', async field => {
    const first = snapshots[0]!
    const invalid = { ...first.snapshot }
    delete invalid[field]
    const response = await post({ frames: [{ ...first, snapshot: invalid }, ...snapshots.slice(1)], changedFrame: changed })
    expect(response.status).toBe(200)
    const body = await response.json() as ValidationResponse
    expect(body.passed).toBe(false)
    expect(body.result.firstFrameAcknowledged).toBe(false)
    expect(body.result.frames).toEqual([])
    expect(body.result.runtimeError).toBe('SNAPSHOT_INVALID')
  }, 120_000)

  it('lets the real target.js reject a scene-only plan bound to another template', async () => {
    const response = await post({ experimentId: 'another-template' })
    expect(response.status).toBe(200)
    const body = await response.json() as ValidationResponse
    expect(body.passed).toBe(false)
    expect(body.result.firstFrameAcknowledged).toBe(false)
    expect(body.result.runtimeError).toBe('SNAPSHOT_INVALID')
  }, 120_000)

  it.each(['missing-source', 'wrong-id'])('also rejects an invalid changed frame in the actual SDK: %s', async invalid => {
    const snapshot = { ...changed.snapshot }
    if (invalid === 'missing-source') delete snapshot.source
    else snapshot.experimentId = 'another-template'
    const response = await post({ frames: snapshots, changedFrame: { ...changed, snapshot } })
    expect(response.status).toBe(200)
    const body = await response.json() as ValidationResponse
    expect(body.result.firstFrameAcknowledged).toBe(true)
    expect(body.result.frames).toHaveLength(3)
    expect(body.result.changedFrame).toBeUndefined()
    expect(body.result.runtimeError).toBe('SNAPSHOT_INVALID')
    expect(body.passed).toBe(false)
    expect(body.checks.find(check => check.name === 'parameter-change')?.passed).toBe(false)
  }, 120_000)

  it('samples a world-coordinate renderer through both opaque frames and writes the requested screenshot', async () => {
    const { result } = await validateCandidate({ browser, assets: assetsFor('good'), frames: snapshots, changedFrame: changed, screenshotPath: join(dir, 'good.png') })
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(result.frames.every(frame => frame.drawnBodies?.[0]?.source === 'canvas-2d-arc-fill')).toBe(true)
    expect(evaluateObservation({ ...result, ...identity }).passed).toBe(true)
  }, 120_000)

  it.each(['wrong-x', 'wrong-y', 'static', 'stamp-only', 'unpainted', 'overpainted', 'same-color-cover', 'oversized', 'transparent', 'hidden', 'filtered', 'wrong-transform'] as const)('rejects %s despite SDK acknowledgements and forged geometry stamps', async mode => {
    const { result } = await validateCandidate({ browser, assets: assetsFor(mode), frames: snapshots, changedFrame: changed })
    const verdict = evaluateObservation({ ...result, ...identity })
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(verdict.passed).toBe(false)
    expect(verdict.checks.filter(check => !check.passed).map(check => check.name)).toContain('geometry-follows-engine')
    if (mode === 'static' || mode === 'stamp-only') expect(verdict.checks.find(check => check.name === 'motion-sampled')?.passed).toBe(false)
    if (['static', 'stamp-only', 'unpainted', 'overpainted', 'same-color-cover', 'oversized', 'transparent', 'hidden', 'filtered'].includes(mode)) {
      expect(result.frames.every(frame => frame.drawnBodies?.length === 0)).toBe(true)
    }
  }, 120_000)

  it('requires correct native geometry after the parameter change too', async () => {
    const { result } = await validateCandidate({ browser, assets: assetsFor('wrong-changed'), frames: snapshots, changedFrame: changed })
    const verdict = evaluateObservation({ ...result, ...identity })
    expect(verdict.checks.find(check => check.name === 'geometry-follows-engine')?.passed).toBe(true)
    expect(verdict.checks.find(check => check.name === 'parameter-change')?.passed).toBe(false)
    expect(verdict.passed).toBe(false)
  }, 120_000)

  it('keeps an arbitrary pixel-space projection explicitly blocked, even when it looks correct', async () => {
    const { result } = await validateCandidate({ browser, assets: assetsFor('pixel-space'), frames: snapshots, changedFrame: changed })
    const verdict = evaluateObservation({ ...result, ...identity })
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(result.frames.every(frame => frame.opaquePixels > 0 && frame.drawnBodies?.length === 1)).toBe(true)
    expect(verdict.passed).toBe(false)
    expect(verdict.checks.find(check => check.name === 'geometry-follows-engine')).toMatchObject({ passed: false, detail: expect.stringContaining('产品验收仍阻断') })
  }, 120_000)

  it('allows only the exact main host GET while blocking host fetches, subframes and other paths', async () => {
    let hostUrl = ''
    let mainDocumentRequests = 0
    let otherRequests = 0
    const host = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/host.html') {
        mainDocumentRequests++
        const html = validationHostPage({ token, wrapperPath: assetsFor('good').wrapperUrl, frames: snapshots, changedFrame: changed })
        const probes = `<script>
          fetch(${JSON.stringify(hostUrl)}).catch(() => {});
          fetch(${JSON.stringify(hostUrl)}, { method: 'POST' }).catch(() => {});
          fetch(${JSON.stringify(hostUrl.replace('/host.html', '/forbidden'))}).catch(() => {});
          const probe = document.createElement('iframe'); probe.hidden = true;
          probe.src = ${JSON.stringify(hostUrl)}; document.body.append(probe);
        </script>`
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html + probes)
      } else { otherRequests++; res.writeHead(404); res.end() }
    })
    await new Promise<void>(resolve => { host.listen(0, '127.0.0.1', resolve) })
    try {
      const address = host.address()
      if (address === null || typeof address === 'string') throw new Error('no host port')
      hostUrl = `http://127.0.0.1:${address.port}/host.html`
      const { result } = await validateCandidate({ browser, assets: { ...assetsFor('good'), hostUrl }, frames: snapshots, changedFrame: changed })
      expect(result.firstFrameAcknowledged).toBe(true)
      expect(result.frames).toHaveLength(snapshots.length)
      expect(mainDocumentRequests).toBe(1)
      expect(otherRequests).toBe(0)
    } finally { await new Promise<void>(resolve => { host.close(() => { resolve() }) }) }
  }, 120_000)
})
