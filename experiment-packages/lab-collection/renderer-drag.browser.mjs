import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire('/app/vendor/deepseek-harness/package.json')
const { chromium } = require('@playwright/test')
const root = resolve(process.argv[2])
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const report = { passed: false, checks: [] }
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
  await page.route('http://feedback.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    const file = resolve(root, '.' + path)
    assert.ok(file.startsWith(root + '/'))
    try { await route.fulfill({ body: await readFile(file), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : path.endsWith('.webp') ? 'image/webp' : 'text/html' }) }
    catch { await route.fulfill({ status: 404, body: 'missing fixture asset' }) }
  })
  await page.goto('http://feedback.test/drag.html')
  await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.triangles) > 0)
  const canvas = page.locator('#canvas canvas')
  const target = page.locator('#labels span').filter({ hasText: '目标' })
  const position = () => target.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }))
  const reset = async () => { await page.locator('#front-view').click() }
  const bounds = await canvas.boundingBox()
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
  for (const [name, dx, dy, axis] of [['right', 80, 0, 'x'], ['down', 0, 60, 'y']]) {
    await reset()
    const before = await position()
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 5 })
    const after = await position()
    report.checks.push({ name: `grab-object-${name}`, passed: after[axis] > before[axis] + 2, before, after })
    await page.mouse.up()
    await page.mouse.move(x + dx + 40, y + dy + 30)
    assert.deepEqual(await position(), after, 'released pointer must stop dragging')
  }
  await reset()
  await canvas.evaluate(el => el.addEventListener('pointerdown', event => { window.feedbackPointerId = event.pointerId }, { once: true }))
  await page.mouse.move(x, y); await page.mouse.down()
  await canvas.evaluate(el => el.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: window.feedbackPointerId })))
  const beforeLost = await position()
  await page.mouse.move(x + 70, y + 50)
  const afterLost = await position()
  report.checks.push({ name: 'lost-capture-ends-drag', passed: beforeLost.x === afterLost.x && beforeLost.y === afterLost.y })
  await page.mouse.up()
  await reset()
  const beforeSecondary = await position()
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.move(x + 70, y + 50); await page.mouse.up({ button: 'right' })
  const afterSecondary = await position()
  report.checks.push({ name: 'secondary-button-does-not-rotate', passed: beforeSecondary.x === afterSecondary.x && beforeSecondary.y === afterSecondary.y })
  await page.screenshot({ path: resolve(root, 'drag.png') })
  report.passed = report.checks.every(check => check.passed)
} catch (error) { report.failure = error.message }
finally { await browser.close() }
await writeFile(resolve(root, 'drag-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
process.exitCode = report.passed ? 0 : 1
