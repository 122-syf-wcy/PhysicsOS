/** Real WebGL, sandbox SDK and platform runtime acceptance for authored release archives. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { readArchive } from './downloaded-experiment-release.mjs'
const directory = process.env.PHYSICSOS_LAB_RELEASE_DIR ?? '/tmp/physicsos-lab-collection-20261105'
const output = process.env.PHYSICSOS_LAB_SHOTS ?? '/tmp/physicsos-lab-collection-shots'
const index = JSON.parse(await readFile(join(directory, 'index.json')))
const { createExperiment, snapshotOf } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_RUNTIME_MODULE ?? '/tmp/physicsos-lab-runtimes.mjs'))
await mkdir(output, { recursive: true })
let activeFiles, activeId
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/preview') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fafbf7}iframe{display:block;width:100vw;height:100vh;border:0}</style>'); return }
  const match = /^\/package\/([a-z0-9-]+)\/(dist\/.+)$/.exec(path)
  const bytes = match?.[1] === activeId ? activeFiles?.get(match[2]) : undefined
  if (!bytes) { res.writeHead(404); res.end(); return }
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('content-type', mime[extname(path)] ?? 'application/octet-stream'); res.end(bytes)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })
const programProbe = process.env.PHYSICSOS_LAB_PROGRAM_PROBE === '1'
if (programProbe) await context.addInitScript(() => {
  const createProgram = WebGL2RenderingContext.prototype.createProgram
  WebGL2RenderingContext.prototype.createProgram = function (...args) {
    window.__labProgramCreates = (window.__labProgramCreates ?? 0) + 1
    return createProgram.apply(this, args)
  }
})
const results = [], errors = [], external = [], failures = []
context.on('request', req => { if (!req.url().startsWith(origin + '/')) external.push(req.url()) })
context.on('response', res => { if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) failures.push(res.url()) })
const selected = process.argv.slice(2)
const distinctSegment = (a, b) => a && b && Number.isFinite(a.x) && Number.isFinite(a.y)
  && Number.isFinite(b.x) && Number.isFinite(b.y) && (a.x !== b.x || a.y !== b.y || (a.z ?? 0) !== (b.z ?? 0))
const sampledLine = points => Array.isArray(points) && points.some(p => distinctSegment(points[0], p))
// Only require a visual difference when this frame supplies something the
// enabled layers actually draw. A zero vector or empty trajectory is not ink.
function drawableLayers(snapshot, keys) {
  const v = snapshot.view, active = new Set(keys), layers = new Set()
  const add = (key, drawable) => { if (active.has(key) && drawable) layers.add(key) }
  for (const vector of v.vectors ?? []) add(vector.observable, distinctSegment(vector.from, vector.to))
  for (const guide of v.guides ?? []) add(guide.observable, distinctSegment(guide.from, guide.to) || guide.label)
  for (const trajectory of v.trajectories ?? []) add(snapshot.domain === 'optics' ? 'rays' : snapshot.domain === 'wave' ? 'waveform' : snapshot.domain === 'modern' ? (trajectory.id.includes('photon') ? 'photonEnergy' : 'photocurrent') : 'trajectory', sampledLine(trajectory.points))
  add('trajectory', v.motionMarks?.length)
  add('keyPoints', v.keyPoints?.length)
  add('guides', v.coordinate || v.spring?.equilibrium !== undefined || v.pendulum || v.opticalAxisMarks?.length)
  add('arms', v.leverBeam && v.dimensions?.some(d => distinctSegment(d.from, d.to)))
  add('energyConversion', v.energyRamp)
  add('energy', v.energyBar)
  add('rays', v.opticalRays?.length)
  add('image', v.opticalImages?.length || v.lightRig?.imageFrom)
  add('lightRays', v.lightRig?.rays?.length || v.lightRefraction)
  add('displaced', v.fluidBlock && (v.fluidBlock.submergedTop > v.fluidBlock.at.y - v.fluidBlock.halfHeight || v.dimensions?.some(d => d.id === 'submerged-height')))
  add('pressure', v.pressureSolid?.faces?.some(p => p.loaded && p.pressureText) || v.pressureProbes?.some(p => p.primary && p.readingText) || v.pressureBarometer)
  add('pressureComparison', v.pressureComparisonLiquid || v.pressureHemispheres || v.pressureSolid?.faces?.some(p => !p.loaded) || v.pressureProbes?.some(p => !p.primary))
  add('thermometer', v.thermalThermometer || v.thermalComparisonThermometer || v.thermometer || v.noiseRig?.levelText)
  add('phase', v.thermalSample || v.thermalComparisonSample)
  add('waveform', sampledLine(v.waveProfile?.points) || v.waveFronts?.length)
  add('nodes', v.waveNodes?.length)
  add('superposition', v.wavePoint)
  add('wavefronts', v.acousticWavefronts?.length || v.noiseRig?.wavefronts?.length)
  add('path', v.acousticPulse)
  add('electricField', v.electricField || v.boundedField || v.fieldStreamlines?.length)
  add('magneticField', v.field || v.compositeRegions?.some(r => r.magneticField))
  add('equipotentials', v.equipotentials?.length)
  add('regions', v.compositeRegions?.length)
  add('fieldLines', v.currentFieldCircles?.length || v.currentFieldLines?.length || v.currentCoil || v.currentRotor)
  add('fieldComparison', v.currentProbes?.some(p => !p.primary) || v.currentCore || v.currentCoil?.comparisonTurnsText)
  add('current', v.chargeFlows?.length || v.circuitComponents?.some(c => c.currentText || c.currentDirection) || v.transformerCoils?.length)
  add('voltage', v.circuitComponents?.some(c => c.voltageText) || v.transformerCoils?.length)
  add('power', v.circuitComponents?.some(c => c.powerText || c.glow > 0))
  add('barMotion', v.inductionBar)
  add('inductionCurrent', v.inductionCurrent)
  add('photocurrent', snapshot.domain === 'modern')
  add('stoppingPotential', snapshot.domain === 'modern')
  return [...layers]
}
try {
  for (const item of index.packages.slice(Number(process.env.PHYSICSOS_LAB_START_AT ?? 0)).filter(p => !selected.length || selected.includes(p.experimentId))) {
    const id = item.experimentId, runtime = createExperiment(id)
    const archive = await readFile(join(directory, item.filename))
    assert.equal(createHash('sha256').update(archive).digest('hex'), item.sha256)
    activeId = id; activeFiles = await readArchive(archive)
    const page = await context.newPage(); page.on('pageerror', error => errors.push(`${id}: ${error.message}`))
    page.on('console', entry => { if (entry.type() === 'error') errors.push(`${id}: ${entry.text()}`) })
    await page.goto(origin + '/preview')
    await page.evaluate(({ id, snapshot }) => {
      window.messages = []; window.intents = []
      const iframe = document.createElement('iframe'); iframe.setAttribute('sandbox', 'allow-scripts'); document.body.append(iframe)
      const channel = crypto.randomUUID()
      addEventListener('message', event => {
        if (event.source !== iframe.contentWindow || event.data?.type !== 'experiment/ready' || event.data.channel !== channel) return
        const pair = new MessageChannel(); window.port = pair.port1
        pair.port1.onmessage = event => {
          const message = event.data; window.messages.push(message)
          if (message.type === 'experiment/connected') pair.port1.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'first', snapshot })
          if (!message.type.startsWith('experiment/')) window.intents.push(message)
        }
        pair.port1.start(); iframe.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel }, '*', [pair.port2])
      })
      iframe.src = `/package/${id}/dist/index.html?hostOrigin=${encodeURIComponent(location.origin)}&channel=${channel}`
    }, { id, snapshot: snapshotOf(runtime, id) })
    const ack = async frameId => {
      await page.waitForFunction(id => window.messages.some(m => m.type === 'experiment/error' || (m.type === 'experiment/rendered' && m.frameId === id)), frameId, { timeout: 30000 })
      const messages = await page.evaluate(() => window.messages)
      assert.ok(!messages.some(m => m.type === 'experiment/error'), `${id}: renderer failure ${JSON.stringify(messages)}`)
      assert.ok(messages.some(m => m.frameId === frameId && m.revision === runtime.getSnapshot().sceneRevision), `${id}: wrong revision ACK`)
    }
    await ack('first')
    const frame = page.frames().find(f => f.url().includes(`/package/${id}/`))
    const programCreations = []
    if (programProbe) {
      programCreations.push(await frame.evaluate(() => window.__labProgramCreates ?? 0))
      for (let i = 0; i < 3; i += 1) {
        const frameId = `program-probe-${i}`
        await page.evaluate(({ snapshot, frameId }) => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId, snapshot }), { snapshot: snapshotOf(runtime, id), frameId })
        await ack(frameId)
        programCreations.push(await frame.evaluate(() => window.__labProgramCreates ?? 0))
      }
      console.log(`PROGRAM_PROBE ${id}: ${JSON.stringify(programCreations)}`)
      assert.equal(programCreations[3], programCreations[2], `${id}: identical snapshots recompiled GPU programs after warm-up`)
    }
    const visualDigest = async () => {
      const pixels = await frame.locator('#canvas canvas').screenshot()
      const text = await frame.locator('#readouts').textContent()
      return createHash('sha256').update(pixels).update(text ?? '').digest('hex')
    }
    const canvasDigest = async () => createHash('sha256').update(await frame.locator('#canvas').screenshot()).digest('hex')
    const evidence = await frame.evaluate(() => {
      const canvas = document.querySelector('#canvas canvas'), context = canvas.getContext('webgl2'), bytes = new Uint8Array(canvas.width * canvas.height * 4)
      context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, bytes)
      let variations = 0
      for (let i = 0; i < bytes.length; i += 16) if (Math.abs(bytes[i] - bytes[0]) + Math.abs(bytes[i + 1] - bytes[1]) + Math.abs(bytes[i + 2] - bytes[2]) > 24) variations++
      return { calls: Number(canvas.dataset.drawCalls), triangles: Number(canvas.dataset.triangles), variations, width: canvas.clientWidth, height: canvas.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    await page.screenshot({ path: join(output, `${id}-desktop.png`) })
    assert.ok(evidence.calls > 0 && evidence.triangles > 0 && evidence.variations > 20, `${id}: blank WebGL ${JSON.stringify(evidence)}`)
    assert.equal(evidence.overflow, false)
    // Real input intent round-trip against the same platform runtime (not a fixture equation).
    const parameters = runtime.getSnapshot().inspector.flatMap(s => s.parameters ?? [])
    const parameter = parameters[0]
    let parameterChecked = false, parameterVisualChanged = false
    if (parameter) {
      const magnitudeDelta = Math.abs(parameter.value) * 0.1
      const range = (parameter.max ?? parameter.value) - (parameter.min ?? parameter.value)
      const rangeDelta = Number.isFinite(range) && range > 0 ? range * 0.1 : 1
      const delta = parameter.step ?? (magnitudeDelta > 0 ? magnitudeDelta : rangeDelta)
      const value = parameter.max !== undefined && parameter.value + delta > parameter.max ? parameter.value - delta : parameter.value + delta
      if ((parameter.min === undefined || value >= parameter.min) && value !== parameter.value) {
        const before = await visualDigest()
        const control = frame.locator(`[data-parameter="${parameter.id}"]`)
        await control.fill(String(value)); await control.press('Tab')
        await page.waitForFunction(() => window.intents.some(m => m.type === 'parameter/commit'))
        const intent = (await page.evaluate(() => window.intents)).find(m => m.type === 'parameter/commit')
        assert.equal(intent.id, parameter.id); assert.equal(intent.value, value)
        runtime.editParameter(intent.id, intent.value)
        const snapshot = snapshotOf(runtime, id)
        assert.equal(snapshot.inspector.flatMap(s => s.parameters ?? []).find(p => p.id === parameter.id)?.value, value, `${id}: host did not apply parameter`)
        await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'parameter', snapshot }), snapshot)
        await ack('parameter'); parameterChecked = true; parameterVisualChanged = before !== await visualDigest()
      }
      assert.equal(parameterChecked, true, `${id}: editable parameters exist but no parameter round-trip was checked`)
    }
    let playbackChecked = false
    if (runtime.getSnapshot().clock.total > 0) {
      const before = await visualDigest(), prior = JSON.stringify(runtime.getSnapshot().view)
      runtime.seek(runtime.getSnapshot().clock.total * 0.42)
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'time', snapshot }), snapshotOf(runtime, id))
      await ack('time'); playbackChecked = true
      if (prior !== JSON.stringify(runtime.getSnapshot().view)) assert.notEqual(await visualDigest(), before, `${id}: changed timeline facts did not repaint`)
    }
    let buoyancyDisplacementChecked = false
    if (id === 'buoyancy') {
      // Partial immersion separates the volume label from the block label;
      // isolate this layer from unrelated force-arrow label collision handling.
      runtime.seek(runtime.getSnapshot().clock.total * 0.1)
      const forcesWereVisible = runtime.getSnapshot().view.visible.forces
      runtime.setObservable('forces', false)
      const submerged = () => runtime.getSnapshot().view.dimensions?.some(d => d.id === 'submerged-height' && distinctSegment(d.from, d.to))
      for (const fraction of [0.7, 1]) {
        if (submerged()) break
        runtime.seek(runtime.getSnapshot().clock.total * fraction)
      }
      assert.ok(submerged(), 'buoyancy: no submerged frame available for displacement regression')
      await frame.locator('#front-view').click()
      runtime.setObservable('displaced', true)
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'displacement-on', snapshot }), snapshotOf(runtime, id))
      await ack('displacement-on')
      const displacementLabel = /V\s*排\s*=/
      assert.match(await frame.locator('#labels').innerText(), displacementLabel, 'buoyancy: V排 label must be visible before hiding displacement')
      runtime.setObservable('displaced', false)
      assert.ok(submerged(), 'buoyancy: regression must keep the upstream dimension supplied while hidden')
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'displacement-off', snapshot }), snapshotOf(runtime, id))
      await ack('displacement-off')
      assert.doesNotMatch(await frame.locator('#labels').innerText(), displacementLabel, 'buoyancy: V排 canvas label remains after displaced is off')
      await page.screenshot({ path: join(output, `${id}-displaced-off.png`) })
      runtime.setObservable('displaced', true)
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'displacement-restored', snapshot }), snapshotOf(runtime, id))
      await ack('displacement-restored')
      assert.match(await frame.locator('#labels').innerText(), displacementLabel, 'buoyancy: V排 label did not return after restoring displacement')
      buoyancyDisplacementChecked = true
      runtime.setObservable('forces', forcesWereVisible !== false)
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'displacement-force-restored', snapshot }), snapshotOf(runtime, id))
      await ack('displacement-force-restored')
    }
    const visibleSnapshot = snapshotOf(runtime, id)
    const keys = Object.keys(visibleSnapshot.view.visible ?? {}).filter(key => visibleSnapshot.view.visible[key])
    const visibilityDrawableLayers = drawableLayers(visibleSnapshot, keys)
    const visibilityApplicable = visibilityDrawableLayers.length > 0
    let visibilityChanged = false, visibilityChecked = false
    if (keys.length) {
      const before = await canvasDigest()
      for (const key of keys) runtime.setObservable(key, false)
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'hidden', snapshot }), snapshotOf(runtime, id))
      await ack('hidden'); visibilityChanged = before !== await canvasDigest()
      if (visibilityApplicable) assert.ok(visibilityChanged, `${id}: drawable layers did not disappear: ${visibilityDrawableLayers.join(', ')}`)
      visibilityChecked = true
      // Restore all displayed layers for visual inspection and phone screenshots.
      for (const key of keys) runtime.setObservable(key, true)
      await page.evaluate(snapshot => window.port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'restored', snapshot }), snapshotOf(runtime, id))
      await ack('restored')
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await frame.locator('#front-view').click()
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${id}: mobile overflow`)
    await page.screenshot({ path: join(output, `${id}-mobile.png`) })
    results.push({ id, domain: item.domain, sha256: item.sha256, ...evidence, parameterChecked, parameterApplicable: parameters.length > 0, parameterCount: parameters.length, parameterNotApplicableReason: parameters.length ? null : 'The platform runtime exposes no editable parameters', parameterVisualChanged, playbackChecked, visibilityChanged, visibilityChecked, visibilityApplicable, visibilityDrawableLayers, visibilityKeys: keys, visibilityAssessmentVersion: 1, visibilityNotApplicableReason: visibilityApplicable ? null : 'No enabled nonempty drawable layer in the tested runtime snapshot', buoyancyDisplacementChecked, ...(programProbe ? { programCreations } : {}) })
    await page.close(); console.log(`PASS ${results.length}/${index.count} ${id}: WebGL + SDK + parameter/time + mobile`)
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failures, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ count: results.length, domains: new Set(results.map(r => r.domain)).size, errors, external, failures, results }, null, 2) + '\n')
} catch (error) { console.error(JSON.stringify({ errors, external, failures })); throw error }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
