/** Hooks for the existing server-Docker 76-ZIP acceptance (local or private CDP browser). */
import assert from 'node:assert/strict'

/** Install BEFORE the release page loads. No science host, runtime or HTTP server is created here. */
export async function prepareRetainedProbe(context) {
  await context.addInitScript(() => {
    const counters = window.labGpuCreates = { program: 0, buffer: 0, texture: 0, framebuffer: 0 }
    for (const [name, key] of [['createProgram', 'program'], ['createBuffer', 'buffer'], ['createTexture', 'texture'], ['createFramebuffer', 'framebuffer']]) {
      const original = WebGL2RenderingContext.prototype[name]
      WebGL2RenderingContext.prototype[name] = function (...args) { counters[key]++; return original.apply(this, args) }
    }
    window.labLifecycle = []
    addEventListener('pagehide', event => window.labLifecycle.push({ type: 'pagehide', persisted: event.persisted }))
    addEventListener('pageshow', event => window.labLifecycle.push({ type: 'pageshow', persisted: event.persisted }))
  })
  await context.route('**/dist/runtime/scene-kit.js', async route => {
    const response = await route.fetch()
    let source = await response.text()
    assert.ok(source.includes("import * as THREE from '../vendor/three.module.js'"), 'Probe must use the release\'s actual frozen Three module')
    source = source.replace("import * as THREE from '../vendor/three.module.js'", `
      import * as ThreeBase from '../vendor/three.module.js';
      const THREE={...ThreeBase,WebGLRenderer:class extends ThreeBase.WebGLRenderer{
        constructor(...args){super(...args);window.labRenderer=this;window.labRendererCreates=(window.labRendererCreates??0)+1;
          const render=this.render;this.render=(scene,camera)=>{render.call(this,scene,camera);if(camera.isOrthographicCamera){window.labScene=scene;window.labCamera=camera;window.labDraws=(window.labDraws??0)+1}};
        }
      }};
    `)
    assert.ok(source.includes('export function createSceneKit(initialView)'), 'Probe matches retained core factory signature')
    source = source.replace('export function createSceneKit(initialView)', 'function makeProbeSceneKit(initialView)')
    source += '\nexport function createSceneKit(initialView){const kit=makeProbeSceneKit(initialView);window.labKit=kit;return kit}\n'
    await route.fulfill({ response, body: source, contentType: 'text/javascript' })
  })
}

async function inspect(frame) {
  return frame.evaluate(() => {
    const kit = window.labKit, renderer = window.labRenderer, camera = window.labCamera, host = document.getElementById('canvas')
    const parts = [], materials = [], paths = []
    kit.group.traverse(object => {
      if (object.userData.retainedKey) parts.push({ key: object.userData.retainedKey, object: object.uuid, geometry: object.geometry?.uuid, material: object.material?.uuid })
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.push(material.uuid)
      if (object.isLine && object.geometry.attributes.position) paths.push({ key: object.userData.retainedKey, drawCount: object.geometry.drawRange.count, liveCount: object.geometry.attributes.position.count, samples: object.geometry.userData.sampleCount })
    })
    return { group: kit.group.uuid, stats: { ...kit.stats }, parts, materials, paths,
      labelNodes: [...document.querySelectorAll('#labels span')].map(node => ({ key: node.dataset.labelId, token: node.dataset.probeToken })),
      gpu: { ...window.labGpuCreates }, rendererCreates: window.labRendererCreates, draws: window.labDraws,
      renderState: host.dataset.renderState, revision: host.dataset.revision,
      camera: camera && { zoom: camera.zoom, position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom },
      memory: { ...renderer.info.memory } }
  })
}

/**
 * Invoke after the existing first-frame ack and before parameter/seek checks.
 * send(frameId,snapshot) must use that page's ORIGINAL authenticated V3 port;
 * ack(frameId) remains the host's exact frame/revision assertion. Snapshot is
 * the real server runtime's output. No snapshot facts or clocks are altered.
 */
export async function checkRetainedFrame({ page, frame, snapshot, send, ack, id = snapshot.experimentId }) {
  const prefix = `retained:${id}:`, first = await inspect(frame), trustedBefore = JSON.stringify(snapshot)
  await frame.waitForFunction(() => Boolean(window.labRenderer && window.labKit && window.labCamera))
  await page.waitForLoadState('networkidle'); await frame.evaluate(() => document.fonts.ready)
  const sendAndAck = async suffix => { const frameId = prefix + suffix; await send(frameId, snapshot); await ack(frameId) }
  const noAck = async frameId => {
    await page.waitForTimeout(100)
    const messages = await page.evaluate(() => window.messages)
    assert.ok(!messages.some(message => message.type === 'experiment/rendered' && message.frameId === frameId), `${id}: undrawn frame got a fake ACK`)
    assert.ok(!messages.some(message => message.type === 'experiment/error'), `${id}: recoverable lifecycle sent fatal/revoked the port`)
  }
  await frame.evaluate(() => [...document.querySelectorAll('#labels span')].forEach((node, i) => { node.dataset.probeToken = `existing-${i}` }))
  for (let i = 0; i < 2; i++) await sendAndAck(`warm:${i}`)
  const warm = await inspect(frame)
  for (let i = 0; i < 8; i++) await sendAndAck(`stable:${i}`)
  const stable = await inspect(frame)
  assert.equal(stable.group, first.group)
  for (const key of ['meshAllocations', 'geometryAllocations', 'materialAllocations', 'bufferAllocations', 'labelAllocations']) assert.equal(stable.stats[key], warm.stats[key], `${id}: stable topology allocates ${key}`)
  assert.deepEqual(stable.parts, warm.parts, `${id}: stable part identities changed`)
  assert.deepEqual(stable.labelNodes, warm.labelNodes, `${id}: keyed label DOM was replaced`)
  assert.deepEqual(stable.gpu, warm.gpu, `${id}: identical frames allocate new GPU resources`)
  assert.equal(new Set(stable.materials).size, stable.materials.length, `${id}: parts share mutable materials`)
  assert.equal(stable.rendererCreates, 1)
  for (const path of stable.paths) {
    if (path.samples !== undefined) assert.equal(path.drawCount, path.samples, `${id}: fake trailing line samples`)
    assert.ok(path.drawCount <= path.liveCount, `${id}: line draw range exceeds live buffer`)
  }
  await frame.locator('#zoom-in').click()
  const controlled = await inspect(frame)
  const lose = async () => {
    await frame.evaluate(() => {
      const extension = window.labRenderer.getContext().getExtension('WEBGL_lose_context')
      if (!extension) throw new Error('WEBGL_lose_context unavailable')
      window.labLossExtension = extension; extension.loseContext()
    })
    await frame.waitForFunction(() => document.getElementById('canvas').dataset.renderState === 'contextlost')
  }
  await lose()
  const recoveryId = prefix + 'recover'
  await send(recoveryId, snapshot); await noAck(recoveryId)
  await frame.evaluate(() => window.labLossExtension.restoreContext())
  await ack(recoveryId)
  const restored = await inspect(frame)
  assert.equal(restored.group, first.group); assert.equal(restored.rendererCreates, 1); assert.equal(restored.renderState, 'ready')
  assert.deepEqual(restored.camera, controlled.camera, `${id}: recovery lost camera controls`)
  assert.equal(restored.revision, String(snapshot.revision))
  // Main and renderer both receive these events; persisted pagehide must not
  // close the existing port, dispose the kit, or recreate a physical session.
  await frame.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  const cacheId = prefix + 'bfcache'
  await send(cacheId, snapshot); await noAck(cacheId)
  await frame.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await ack(cacheId)
  assert.equal((await inspect(frame)).group, first.group)
  // Loss followed by zero-area restoration must wait until the real canvas is
  // visible again. This exercises native context events, not a mock renderer.
  await lose()
  const originalDisplay = await frame.evaluate(() => {
    const host = document.getElementById('canvas'), old = host.style.display; host.style.display = 'none'; return old
  })
  const hiddenId = prefix + 'recover-zero-area'
  await send(hiddenId, snapshot)
  await frame.evaluate(() => window.labLossExtension.restoreContext())
  await noAck(hiddenId)
  await frame.evaluate(value => { document.getElementById('canvas').style.display = value }, originalDisplay)
  await ack(hiddenId)
  assert.equal((await inspect(frame)).renderState, 'ready')
  // Clear orbit control changes for the caller's existing screenshots/tests.
  await frame.locator('#reset-view').click()
  assert.equal(JSON.stringify(snapshot), trustedBefore, 'probe mutated scientific facts')
  return { passed: true, staticFrames: 10, contextRecoveries: 2, zeroAreaAckWithheld: true, persistedSamePort: true,
    nativeBfCache: 'not exercised by synthetic persisted events', materialIsolation: true,
    warm: { stats: warm.stats, gpu: warm.gpu }, restored: { stats: restored.stats, memory: restored.memory } }
}

/** Optional final check immediately before caller closes this package page. */
export async function checkRetainedDisposal(frame) {
  const before = await inspect(frame)
  await frame.evaluate(async () => {
    const module = await import('./runtime/renderer.js')
    module.disposeRenderer(); module.disposeRenderer()
  })
  assert.equal(await frame.locator('#canvas canvas').count(), 0, 'disposed display left its canvas')
  assert.equal(await frame.locator('#labels span').count(), 0, 'disposed display leaked keyed label DOM')
  return { disposedTwice: true, priorMemory: before.memory }
}
