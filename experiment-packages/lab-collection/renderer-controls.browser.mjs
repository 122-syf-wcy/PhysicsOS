import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Run in the existing server Docker image. The staged root contains public/
// contents, src/ as runtime/, and the release's frozen vendor/three.module.js.
const require = createRequire('/app/vendor/deepseek-harness/package.json')
const { chromium } = require('@playwright/test')
const root = resolve(process.argv[2])
const snapshot = { domain: 'mechanics', experimentId: 'average-speed', revision: 1, view: {
  origin: { x: -6, y: -4 }, extent: { width: 12, height: 8 },
  particles: [{ id: 'left', at: { x: -1, y: 0 }, radius: 0.15, sign: 'negative' },
    { id: 'right', at: { x: 1, y: 0 }, radius: 0.15, sign: 'positive' }],
  labels: [{ id: 'target', text: '目标', at: { x: 1, y: 1, z: 1 } }],
} }
const browser = await chromium.launch({ headless: true, executablePath: process.env.PHYSICSOS_CHROMIUM_PATH ?? chromium.executablePath(), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const report = { passed: false, checks: [] }
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 }, hasTouch: true })
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(5000)
  page.setDefaultNavigationTimeout(30000)
  await page.route('http://controls.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/controls.html') {
      const html = (await readFile(resolve(root, 'index.html'), 'utf8'))
        .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-presentation="embedded">')
        .replace('<script type="module" src="./runtime/main.js"></script>', `<script type="module">
          import { renderFrame } from './runtime/renderer.js';
          window.renderTestFrame = renderFrame;
          renderFrame(${JSON.stringify(snapshot)});
        </script>`)
      await route.fulfill({ body: html, contentType: 'text/html' }); return
    }
    if (path === '/runtime/scene-kit.js') {
      // Observe the actual Three.js render boundary without adding a test API to
      // production. All geometry, fitting, input handlers and WebGL stay real.
      const source = (await readFile(resolve(root, 'runtime/scene-kit.js'), 'utf8')).replace("import * as THREE from '../vendor/three.module.js'", `
        import * as ThreeBase from '../vendor/three.module.js';
        const THREE = { ...ThreeBase, WebGLRenderer: class extends ThreeBase.WebGLRenderer {
          constructor(...args) {
            super(...args); const render = this.render;
            this.render = (scene, camera) => {
              render.call(this, scene, camera);
              if (!camera.isOrthographicCamera || !scene.children[0]?.isGroup) return;
              const world = scene.children[0];
              const project = x => new ThreeBase.Vector3(x, 0, 0).applyMatrix4(world.matrixWorld).project(camera).toArray();
              window.cameraProbe = { left: project(-1), right: project(1), zoom: camera.zoom,
                viewport: [this.domElement.width / this.getPixelRatio(), this.domElement.height / this.getPixelRatio()],
                direction: camera.getWorldDirection(new ThreeBase.Vector3()).toArray() };
            };
          }
        } };
      `)
      await route.fulfill({ body: source, contentType: 'text/javascript' }); return
    }
    const file = resolve(root, '.' + path)
    assert.ok(file.startsWith(root + '/'))
    try { await route.fulfill({ body: await readFile(file), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.webp') ? 'image/webp' : 'application/json' }) }
    catch { await route.fulfill({ status: 404, body: 'missing fixture asset' }) }
  })
  await page.goto('http://controls.test/controls.html')
  await page.waitForFunction(() => window.cameraProbe, undefined, { timeout: 30000 })
  const canvas = page.locator('#canvas canvas')
  const probe = () => page.evaluate(() => window.cameraProbe)
  const separation = p => Math.hypot(p.right[0] - p.left[0], p.right[1] - p.left[1])
  const center = p => [(p.right[0] + p.left[0]) / 2, (p.right[1] + p.left[1]) / 2]
  const near = (a, b) => Math.abs(a - b) < 1e-7
  const stable = (a, b) => ['left', 'right', 'direction'].every(key => a[key].every((value, i) => near(value, b[key][i])))
  const check = async (name, run) => {
    try { await run(); report.checks.push({ name, passed: true }) }
    catch (error) { report.checks.push({ name, passed: false, failure: error.message }) }
  }
  const reset = async () => { await page.locator('#reset-view').click(); await page.locator('#front-view').click() }
  const point = async () => { const b = await canvas.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const drag = async (dx, dy, options = {}) => {
    const p = await point()
    if (options.shift) await page.keyboard.down('Shift')
    await page.mouse.move(p.x, p.y); await page.mouse.down({ button: options.button ?? 'left' })
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 4 }); await page.mouse.up({ button: options.button ?? 'left' })
    if (options.shift) await page.keyboard.up('Shift')
  }
  await check('wheel changes rendered world scale and engine frames preserve it', async () => {
    await reset(); const before = await probe(), p = await point()
    await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -240)
    await page.waitForFunction(zoom => window.cameraProbe.zoom > zoom, before.zoom)
    const after = await probe(); assert.ok(separation(after) > separation(before) * 1.1)
    await page.evaluate(s => {
      for (let revision = 2; revision < 8; revision++) window.renderTestFrame({ ...s, revision,
        view: { ...s.view, particles: s.view.particles.map(particle => ({ ...particle, at: { ...particle.at, y: revision / 20 } })) } })
    }, snapshot)
    assert.ok(stable(await probe(), after), 'engine frames reset the user view')
  })
  await check('off-center wheel keeps its world anchor fixed and zoom stops at both limits', async () => {
    await reset(); const before = await probe(), b = await canvas.boundingBox()
    await page.mouse.move(b.x + (before.left[0] + 1) * b.width / 2, b.y + (1 - before.left[1]) * b.height / 2)
    await page.mouse.wheel(0, -180)
    await page.waitForFunction(zoom => window.cameraProbe.zoom > zoom, before.zoom)
    const anchored = await probe()
    assert.ok(Math.abs(anchored.left[0] - before.left[0]) * b.width / 2 < 1, 'wheel moved the world point under the cursor')
    assert.ok(Math.abs(anchored.left[1] - before.left[1]) * b.height / 2 < 1)
    for (const [button, limit] of [['放大', 4], ['缩小', 0.5]]) {
      const control = page.getByRole('button', { name: button, exact: true })
      for (let attempt = 0; attempt < 20 && !(await control.isDisabled()); attempt++) await control.click()
      assert.equal(await control.isDisabled(), true, 'zoom limit was never reached')
      assert.equal((await probe()).zoom, limit)
      const limited = await probe(), p = await point()
      await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, button === '放大' ? -800 : 800)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.ok(stable(await probe(), limited), 'wheel bypassed the zoom limit')
    }
  })
  await check('Shift drag translates without rotation or changing world scale', async () => {
    await reset(); const before = await probe()
    await drag(60, 35, { shift: true }); const after = await probe()
    assert.ok(center(after)[0] > center(before)[0] + 0.1)
    assert.ok(center(after)[1] < center(before)[1] - 0.05)
    assert.ok(near(separation(before), separation(after)))
    assert.deepEqual(after.direction, before.direction)
    await page.evaluate(s => window.renderTestFrame({ ...s, revision: 9 }), snapshot)
    assert.ok(stable(await probe(), after), 'engine frame reset the pan')
  })
  await check('zoom buttons work from the keyboard and restore the original scale', async () => {
    await reset(); const before = await probe()
    await page.getByRole('button', { name: '放大', exact: true }).focus(); await page.keyboard.press('Enter')
    assert.ok(separation(await probe()) > separation(before))
    await page.getByRole('button', { name: '缩小', exact: true }).focus(); await page.keyboard.press('Space')
    assert.ok(stable(await probe(), before))
  })
  await check('move mode translates and reset restores the apparatus view', async () => {
    await page.locator('#reset-view').click(); const initial = await probe()
    await page.getByRole('button', { name: '移动', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '移动', exact: true }).getAttribute('aria-pressed'), 'true')
    const before = await probe(); await drag(55, 20); const after = await probe()
    assert.deepEqual(after.direction, before.direction)
    assert.ok(center(after)[0] > center(before)[0])
    await page.getByRole('button', { name: '放大', exact: true }).click()
    await page.locator('#reset-view').click(); assert.ok(stable(await probe(), initial))
    assert.equal(await page.getByRole('button', { name: '移动', exact: true }).getAttribute('aria-pressed'), 'false')
  })
  await check('front view retains zoom and pan while full view restores the whole apparatus', async () => {
    await page.locator('#reset-view').click()
    await page.getByRole('button', { name: '放大', exact: true }).click(); await drag(50, 25, { shift: true })
    const before = await probe()
    await page.locator('#front-view').click(); const front = await probe()
    assert.equal(front.zoom, before.zoom)
    assert.ok(center(front).every((value, i) => near(value, center(before)[i])))
    assert.notDeepEqual(front.direction, before.direction)
    await page.locator('#full-view').click(); const full = await probe()
    assert.equal(full.zoom, 1); assert.ok(center(full).every(value => near(value, 0)))
    await page.locator('#full-view').click()
    await page.getByRole('button', { name: '缩小', exact: true }).click(); await drag(-45, 20, { shift: true })
    await page.locator('#full-view').click()
    assert.ok(stable(await probe(), full), 'full view kept a stale user offset')
  })
  await check('ordinary drag still rotates and the secondary mouse button does not', async () => {
    await reset(); const before = await probe(); await drag(60, 25)
    assert.notDeepEqual((await probe()).direction, before.direction)
    const rotated = await probe(); await drag(60, 25, { button: 'right' })
    assert.ok(stable(await probe(), rotated))
    const p = await point(); await page.mouse.move(p.x + 20, p.y + 20)
    assert.ok(stable(await probe(), rotated), 'released pointer still moves the camera')
  })
  await check('two fingers pinch and translate, then one finger resumes rotation without a jump', async () => {
    await reset(); const before = await probe(), p = await point()
    await canvas.evaluate(el => {
      window.touchEvents = []
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(type, e => {
        if (e.pointerType === 'touch') window.touchEvents.push({ type, id: e.pointerId, x: e.clientX, y: e.clientY })
      })
    })
    const cdp = await page.context().newCDPSession(page)
    const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 1, radiusY: 1 })) })
    await touch('touchStart', [[p.x - 45, p.y, 1], [p.x + 45, p.y, 2]])
    await touch('touchMove', [[p.x - 60, p.y + 20, 1], [p.x + 100, p.y + 20, 2]])
    const pinched = await probe()
    assert.ok(separation(pinched) > separation(before) * 1.4)
    assert.ok(center(pinched)[0] > center(before)[0] + 0.02)
    assert.ok(center(pinched)[1] < center(before)[1] - 0.02)
    assert.deepEqual(pinched.direction, before.direction)
    // CDP touchEnd lists the released contacts, rather than the remaining ones.
    await touch('touchEnd', [[p.x + 100, p.y + 20, 2]])
    assert.ok(stable(await probe(), pinched), 'lifting one finger changed the camera')
    await touch('touchMove', [[p.x - 40, p.y + 30, 1]])
    // Chromium may acknowledge a touch packet before its coalesced pointermove.
    await page.waitForFunction(({ x, y }) => window.touchEvents.some(event => event.type === 'pointermove' && Math.abs(event.x - x) < 1 && Math.abs(event.y - y) < 1), { x: p.x - 40, y: p.y + 30 })
    assert.notDeepEqual((await probe()).direction, pinched.direction, JSON.stringify(await page.evaluate(() => window.touchEvents)))
    await touch('touchCancel', [])
    const cancelled = await probe(); await page.mouse.move(p.x + 90, p.y + 80)
    assert.ok(stable(await probe(), cancelled))
    await cdp.detach()
  })
  await check('lost capture, cancellation and window blur end the current gesture', async () => {
    await reset(); const p = await point()
    for (const type of ['lostpointercapture', 'pointercancel', 'blur']) {
      await page.mouse.move(p.x, p.y)
      await canvas.evaluate(el => el.addEventListener('pointerdown', e => { window.testPointerId = e.pointerId }, { once: true }))
      await page.mouse.down(); await page.mouse.move(p.x + 25, p.y + 10)
      await canvas.evaluate((el, type) => type === 'blur' ? window.dispatchEvent(new Event('blur'))
        : el.dispatchEvent(new PointerEvent(type, { pointerId: window.testPointerId })), type)
      const before = await probe(); await page.mouse.move(p.x + 70, p.y + 40)
      assert.ok(stable(await probe(), before), `${type} left a stale drag`)
      await page.mouse.up()
    }
  })
  await check('resize keeps zoom, pan, and orientation and mobile controls fit', async () => {
    await reset(); await page.getByRole('button', { name: '放大', exact: true }).click(); await drag(45, 25, { shift: true })
    const before = await probe()
    for (const size of [{ width: 390, height: 420 }, { width: 280, height: 340 }]) {
      await page.setViewportSize(size)
      await page.waitForFunction(width => window.cameraProbe.viewport[0] === width, size.width)
      const after = await probe(); assert.equal(after.zoom, before.zoom); assert.deepEqual(after.direction, before.direction)
      assert.ok(center(after)[0] > 0 && center(after)[1] < 0, 'resize lost the pan')
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        buttonsFit: [...document.querySelectorAll('.view-tools button')].every(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }),
        canvasHeight: document.querySelector('#canvas').clientHeight }))
      assert.equal(layout.overflow, false); assert.equal(layout.buttonsFit, true); assert.ok(layout.canvasHeight >= 180)
    }
    await page.setViewportSize({ width: 900, height: 600 })
    await page.waitForFunction(() => window.cameraProbe.viewport[0] === 900)
    assert.ok(stable(await probe(), before), 'returning to the original size changed the view')
  })
  await page.screenshot({ path: resolve(root, 'controls.png'), timeout: 30000 })
  assert.deepEqual(errors, [])
  report.passed = report.checks.every(check => check.passed)
} catch (error) { report.failure = error.message; report.errors = errors }
finally { await browser.close() }
await writeFile(resolve(root, 'controls-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
process.exitCode = report.passed ? 0 : 1
