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
  let time = 0, speed = 20
  const revision = sceneRevision
  const snapshot = () => ({
    sceneRevision: revision, status: 'ready', domain: 'mechanics', title: 'SDK 协议夹具（非物理精度测试）', ariaLabel: '协议与绘制夹具',
    clock: { time, total: 2.4, running: false, rate: 1 },
    inspector: [{ id: 'motion', parameters: [{ id: 'speed', label: '夹具参数', value: speed, unit: 'm/s', min: 5, max: 40, step: 5 }] }],
    view: {
      bodies: [{ at: { x: 1 + time * 2 + (speed - 20) / 5, y: time === 1.2 ? 5 : 1 } }], visible: {},
      ground: { from: speed === 20 ? -1 : -2, to: speed === 20 ? 9 : 10, y: 0 },
    },
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
      speed = value; time = 0
      return snapshot()
    },
  }
}
const plan = planScene(scene, createFixtureRuntime, experimentId)
const snapshots = plan.frames
const changed = plan.changedFrame!
const groundModes = ['ground-good', 'ground-wrong-x', 'ground-wrong-y', 'ground-reversed-ground', 'ground-reversed-y', 'ground-wrong-scale', 'ground-static-trajectory', 'ground-unpainted', 'ground-covered', 'ground-wrong-changed'] as const
const modes = ['good', 'wrong-x', 'wrong-y', 'static', 'stamp-only', 'unpainted', 'overpainted', 'same-color-cover', 'oversized', 'transparent', 'hidden', 'filtered', 'wrong-transform', 'pixel-space', 'wrong-changed', ...groundModes, 'ground-tainted', 'ground-cors-denied', 'ground-external-asset'] as const
type Mode = typeof modes[number]

/** Manual equal-unit projection + translate/arc(0,0), with a keypoint over the centre. */
const groundRuntime = (mode: Mode): string => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#canvas{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}</style></head><body><div id="canvas"></div><script type="module">
import { connectExperiment } from './protocol.js'
const mode = ${JSON.stringify(mode)}
const canvas = document.createElement('canvas')
canvas.width = 320; canvas.height = 240
 document.getElementById('canvas').append(canvas)
const ctx = canvas.getContext('2d')
let backgroundImage
if (['ground-tainted', 'ground-cors-denied', 'ground-external-asset'].includes(mode)) {
  // The URL has the document's URL origin, but this iframe's security origin
  // is opaque. Deliberately match new Image() WITHOUT a crossOrigin setting.
  backgroundImage = new Image()
  backgroundImage.id = 'taint-background'; backgroundImage.hidden = true
  document.body.append(backgroundImage)
  await new Promise(resolve => {
    backgroundImage.onload = resolve; backgroundImage.onerror = resolve
    backgroundImage.src = mode === 'ground-external-asset' ? 'https://external.invalid/background.png?capability=private-image-fixture'
      : mode === 'ground-cors-denied' ? './denied.png?capability=private-image-fixture' : './background.png'
  })
}
connectExperiment(snapshot => {
  const ground = snapshot.view.ground, body = snapshot.view.bodies[0].at
  const speed = snapshot.inspector[0].parameters[0].value
  const scale = speed === 20 ? 20 : 18
  const point = p => ({ x: 60 + p.x * scale, y: 180 - p.y * scale })
  ctx.setTransform(1.1, 0, 0, 1.1, 0, 0)
  const background = 'rgb(' + Math.round(15 + snapshot.clock.time * 12 + speed) + ',30,40)'
  ctx.fillStyle = background; ctx.fillRect(0, 0, 320, 240)
  // Realistic native onerror fallback: the renderer can still ACK and draw.
  // The driver must separately reject the actual required asset failure.
  if (backgroundImage?.naturalWidth > 0) ctx.drawImage(backgroundImage, 0, 0, 320, 240)
  let a = point({ x: ground.from, y: ground.y }), b = point({ x: ground.to, y: ground.y })
  if (mode === 'ground-reversed-ground') [a, b] = [b, a]
  ctx.strokeStyle = '#8d7354'; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
  if (mode !== 'ground-unpainted') ctx.stroke()
  if (mode === 'ground-covered') { ctx.fillStyle = background; ctx.fillRect(0, a.y - 4, 320, 8) }
  const balls = mode === 'ground-static-trajectory' ? [{ x: 1, y: 1 }, { x: 3.4, y: 5 }, { x: 5.8, y: 1 }] : [body]
  for (const position of balls) {
    const p = point(position)
    if (mode === 'ground-wrong-x' || (mode === 'ground-wrong-changed' && speed !== 20)) p.x += 12
    if (mode === 'ground-wrong-y') p.y -= 12
    if (mode === 'ground-reversed-y') p.y = 180 + position.y * scale
    if (mode === 'ground-wrong-scale') { p.x = 60 + position.x * scale * 1.2; p.y = 180 - position.y * scale * 1.2 }
    ctx.save(); ctx.translate(p.x, p.y)
    const gradient = ctx.createRadialGradient(-5, -6, 2, 0, 0, 15)
    gradient.addColorStop(0, '#f3b866'); gradient.addColorStop(1, '#a4631f')
    ctx.fillStyle = gradient
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#784816'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore()
    // This is real authored decoration, not probe painting. It erases the old
    // central 5×5 evidence, leaving the ball's non-central interior visible.
    ctx.fillStyle = '#fffdf8'; ctx.strokeStyle = '#3f7a9e'
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
  if (mode !== 'ground-good' && mode !== 'ground-tainted') {
    canvas.setAttribute('data-body-x', String(body.x)); canvas.setAttribute('data-body-y', String(body.y))
    window.__physicsosDrawStats = { geometry: [body, ground] }
  }
})
</script></body></html>`

/** Only the renderer is a fixture. Connection/validation comes from the unmodified SDK. */
const authoredRuntime = (mode: Mode): string => mode.startsWith('ground-') ? groundRuntime(mode) : `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#canvas{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}</style></head><body><div id="canvas"></div><script type="module">
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
  const imageRequests: { path: string; corsOrigin: string | undefined; hasCookie: boolean; hasAuthorization: boolean }[] = []
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
      if ((mode === 'ground-tainted' && file === 'background.png') || (mode === 'ground-cors-denied' && file === 'denied.png')) {
        imageRequests.push({ path: url.pathname, corsOrigin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined, hasCookie: req.headers.cookie !== undefined, hasAuthorization: req.headers.authorization !== undefined })
        // Identical PNG bytes: an explicit anonymous CORS grant is required.
        // Raw no-cors Image loading still taints despite this response header.
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store',
          ...(file === 'background.png' ? { 'access-control-allow-origin': '*' } : {}) })
        res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
        return
      }
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
    expect(body.result.changedFrame?.revision).toBe(7)
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

  it('reproduces native Canvas taint from a same-URL-origin PNG without crossOrigin in the real opaque iframe', async () => {
    const assets = assetsFor('ground-tainted')
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    try {
      const page = await context.newPage()
      await page.goto(assets.hostUrl, { waitUntil: 'domcontentloaded' })
      const acknowledged = await page.evaluate(async frame => {
        const host = (window as unknown as { __validation: { connect(): Promise<boolean>; send(id: string, snapshot: unknown): Promise<boolean> } }).__validation
        await host.connect()
        return await host.send(frame.frameId, frame.snapshot)
      }, snapshots[0]!)
      expect(acknowledged).toBe(true)
      const inner = page.frames().find(frame => frame.url().startsWith(assets.entryUrl))
      expect(inner?.parentFrame()?.parentFrame()).toBe(page.mainFrame())
      const readback = await inner!.evaluate(() => {
        const image = document.querySelector<HTMLImageElement>('#taint-background')!
        const canvas = document.querySelector('canvas')!
        let errorName = ''
        try { canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height) }
        catch (error) { errorName = error instanceof Error ? error.name : 'unknown' }
        return { errorName, securityOrigin: window.origin, imageOrigin: new URL(image.src).origin,
          documentUrlOrigin: new URL(location.href).origin, crossOrigin: image.crossOrigin, loaded: image.complete && image.naturalWidth === 1 }
      })
      expect(readback).toMatchObject({ errorName: 'SecurityError', securityOrigin: 'null', crossOrigin: null, loaded: true })
      expect(readback.imageOrigin).toBe(readback.documentUrlOrigin)
      // Playwright can capture the actual visible surface without disabling
      // security. This alone is NOT accepted as shape/material/fill evidence.
      const png = await inner!.locator('canvas').screenshot({ type: 'png' })
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    } finally { await context.close() }
  }, 120_000)

  it('uses anonymous CORS to prove real native paint with the SAME renderer and PNG bytes, not a screenshot substitute', async () => {
    const assets = assetsFor('ground-tainted')
    const pngUrl = new URL('./background.png', assets.entryUrl).href
    const sourceBefore = await (await fetch(assets.entryUrl)).text()
    const bytesBefore = Buffer.from(await (await fetch(pngUrl)).arrayBuffer())
    expect(sourceBefore).not.toMatch(/\.crossOrigin\s*=/)
    const before = imageRequests.length
    const { result } = await validateCandidate({ browser, assets, frames: snapshots, changedFrame: changed })
    const requests = imageRequests.slice(before)
    expect(requests).toEqual([{ path: new URL(pngUrl).pathname, corsOrigin: 'null', hasCookie: false, hasAuthorization: false }])
    expect(await (await fetch(assets.entryUrl)).text()).toBe(sourceBefore)
    expect(Buffer.from(await (await fetch(pngUrl)).arrayBuffer())).toEqual(bytesBefore)
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(result.runtimeError).toBeUndefined()
    expect(result.frames).toHaveLength(snapshots.length)
    for (const frame of [...result.frames, result.changedFrame!]) {
      expect(frame.taintedSurfaces).toBeUndefined()
      expect(frame.opaquePixels).toBeGreaterThan(0)
      expect(frame.drawnGrounds?.[0]).toMatchObject({ source: 'canvas-2d-line-stroke', strokeIndex: 0 })
      expect(frame.drawnBodies?.[0]).toMatchObject({ source: 'canvas-2d-arc-fill', drawIndex: 0, paintedPixels: 0 })
      expect(frame.drawnBodies?.[0]?.paintedPatches).toBeGreaterThanOrEqual(2)
    }
    expect(evaluateObservation({ ...result, ...identity }).passed).toBe(true)
  }, 120_000)

  it.each(['ground-cors-denied', 'ground-external-asset'] as const)('rejects %s even when native onerror fallback ACKs and paints the correct engine geometry', async mode => {
    const before = imageRequests.length
    const { result } = await validateCandidate({ browser, assets: assetsFor(mode), frames: snapshots, changedFrame: changed })
    const verdict = evaluateObservation({ ...result, ...identity })
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(verdict.checks.find(check => check.name === 'geometry-follows-engine')?.passed).toBe(true)
    expect(result.runtimeError).toMatch(/CORS_ERROR|IMAGE_REQUEST_FAILED|CONSOLE_ERROR/)
    expect(verdict.checks.find(check => check.name === 'runtime-error')?.passed).toBe(false)
    expect(verdict.passed).toBe(false)
    if (mode === 'ground-cors-denied') expect(imageRequests.slice(before)).toEqual([
      { path: `/validation/${token}/${mode}/denied.png`, corsOrigin: 'null', hasCookie: false, hasAuthorization: false },
    ])
    else expect(imageRequests.slice(before)).toEqual([])
    const diagnostics = JSON.stringify({ runtimeError: result.runtimeError, checks: verdict.checks })
    for (const sensitive of [token, origin, '/validation/', '/question/', 'capability=', 'private-image-fixture', 'external.invalid']) {
      expect(diagnostics).not.toContain(sensitive)
    }
  }, 120_000)

  it('accepts independently ground-anchored translate/arc painting despite a keypoint covering its centre', async () => {
    const assets = assetsFor('ground-good')
    const response = await post({ wrapperUrl: assets.wrapperUrl, entryUrl: assets.entryUrl })
    expect(response.status).toBe(200)
    const body = await response.json() as ValidationResponse
    expect(body.result.frames.every(frame => frame.drawnGrounds?.[0]?.strokeIndex === 0)).toBe(true)
    for (const frame of [...body.result.frames, body.result.changedFrame!]) {
      expect(frame.drawnBodies?.[0]).toMatchObject({ drawIndex: 0, x: 0, y: 0, paintedPixels: 0 })
      expect(frame.drawnBodies?.[0]?.paintedPatches).toBeGreaterThanOrEqual(2)
    }
    // The parameter change legitimately changes both the ground span and camera.
    expect(body.result.changedFrame?.engineGround).not.toEqual(body.result.frames[0]?.engineGround)
    expect(body.result.changedFrame?.revision).toBe(sceneRevision)
    expect(body.checks.filter(check => !check.passed)).toEqual([])
    expect(body.passed).toBe(true)
  }, 120_000)

  it.each(groundModes.filter(mode => mode !== 'ground-good' && mode !== 'ground-wrong-changed'))('rejects %s using an independent ground anchor, never a body-fitted camera', async mode => {
    const { result } = await validateCandidate({ browser, assets: assetsFor(mode), frames: snapshots, changedFrame: changed })
    const verdict = evaluateObservation({ ...result, ...identity })
    expect(result.firstFrameAcknowledged).toBe(true)
    expect(verdict.passed).toBe(false)
    expect(verdict.checks.find(check => check.name === 'geometry-follows-engine')?.passed).toBe(false)
    if (mode === 'ground-unpainted' || mode === 'ground-covered') expect(result.frames.every(frame => frame.drawnGrounds?.length === 0)).toBe(true)
    if (mode === 'ground-static-trajectory') expect(verdict.checks.find(check => check.name === 'motion-sampled')?.passed).toBe(false)
  }, 120_000)

  it('rejects a misprojected changed ball even when changed ground is legitimately recalibrated', async () => {
    const { result } = await validateCandidate({ browser, assets: assetsFor('ground-wrong-changed'), frames: snapshots, changedFrame: changed })
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
