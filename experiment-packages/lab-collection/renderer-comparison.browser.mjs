import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire('/app/vendor/deepseek-harness/package.json')
const { chromium } = require('@playwright/test')
const root = resolve(process.argv[2])
const snapshotBytes = await readFile(resolve(root, 'snapshot.json'))
const snapshot = JSON.parse(snapshotBytes)
const report = { passed: false, snapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex'), checks: [] }
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 580 } })
  await page.route('http://feedback.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    const file = resolve(root, '.' + path)
    assert.ok(file.startsWith(root + '/'))
    if (path === '/comparison.html') {
      const html = (await readFile(resolve(root, 'index.html'), 'utf8'))
        .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-presentation="embedded">')
        .replace('<script type="module" src="./runtime/main.js"></script>', '<script type="module">import {renderFrame} from "./runtime/renderer.js";window.feedbackRender=renderFrame</script>')
      await route.fulfill({ body: html, contentType: 'text/html' }); return
    }
    try { await route.fulfill({ body: await readFile(file), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.webp') ? 'image/webp' : 'application/json' }) }
    catch { await route.fulfill({ status: 404, body: 'missing fixture asset' }) }
  })
  await page.goto('http://feedback.test/comparison.html')
  await page.waitForFunction(() => typeof window.feedbackRender === 'function')
  await page.evaluate(snapshot => window.feedbackRender(snapshot), snapshot)
  const labels = await page.locator('#labels span[data-label-id^="comparison-label-"]').evaluateAll(elements => elements.map(el => {
    const box = el.getBoundingClientRect(), canvas = document.querySelector('#canvas').getBoundingClientRect()
    return { id: el.dataset.labelId, text: el.textContent, color: el.style.color, inside: box.x >= canvas.x && box.right <= canvas.right && box.y >= canvas.y && box.bottom <= canvas.bottom }
  }))
  report.checks.push({ name: 'three-angle-labels-visible-in-default-view', passed: labels.length === 3 && labels.every(label => label.inside), labels })
  report.checks.push({ name: 'three-angle-colors-distinct', passed: new Set(labels.map(label => label.color)).size === 3 })
  await page.screenshot({ path: resolve(root, 'comparison.png') })
  report.passed = report.checks.every(check => check.passed)
} catch (error) { report.failure = error.message }
finally { await browser.close() }
await writeFile(resolve(root, 'comparison-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
process.exitCode = report.passed ? 0 : 1
