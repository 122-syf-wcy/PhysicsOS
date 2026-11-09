import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire('/app/vendor/deepseek-harness/package.json')
const { chromium } = require('@playwright/test')
const prefix = process.argv[2] ?? '/tmp/physicsos-feedback-common'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const report = { passed: false, checks: [] }
try {
  for (const [width, height] of [[1366, 768], [1440, 900], [390, 844], [390, 600]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
    await page.route('http://feedback.test/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/workspace') { await route.fulfill({ body: await readFile(`${prefix}.html`), contentType: 'text/html' }); return }
      const assets = '/app/vendor/deepseek-harness/apps/web/public'
      const file = resolve(assets, '.' + path)
      if (!file.startsWith(assets + '/physicsos/')) { await route.fulfill({ status: 404, body: '' }); return }
      try { await route.fulfill({ body: await readFile(file), contentType: path.endsWith('.css') ? 'text/css' : path.endsWith('.woff2') ? 'font/woff2' : path.endsWith('.woff') ? 'font/woff' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.svg') ? 'image/svg+xml' : 'image/png' }) }
      catch { await route.fulfill({ status: 404, body: 'missing fixture asset' }) }
    })
    await page.goto('http://feedback.test/workspace')
    const geometry = await page.evaluate(() => {
      const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } }
      const canvas = document.querySelector('section[aria-label="实验画布"]')
        ?? document.querySelector('[data-physicsos-surface] section[class*="canvas"]')
      const timeline = document.querySelector('[aria-label="时间轴"]')
        ?? document.querySelector('[data-physicsos-surface] div[class*="timeline"]')
      const chart = [...document.querySelectorAll('section')].find(el => el.className.includes('dataPanel'))
      const stage = canvas.parentElement
      const plot = chart.querySelector('svg[role="img"]')
      const curve = plot.querySelector('path')
      return { canvas: box(canvas), timeline: box(timeline), chart: box(chart), plot: box(plot), visibleStroke: getComputedStyle(curve).stroke !== 'none', stage: box(stage), scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight, pageWidth: document.documentElement.scrollWidth }
    })
    const noOverlap = geometry.canvas.bottom <= geometry.timeline.y + 1 && geometry.timeline.bottom <= geometry.chart.y + 1
    const desktopFits = width < 600 || geometry.chart.bottom <= height + 1 && geometry.scrollHeight <= geometry.clientHeight + 1
    const usableCanvas = geometry.canvas.height >= (height >= 700 ? 260 : 220)
    const noHorizontalScroll = geometry.pageWidth <= width
    const wholePlot = geometry.plot.bottom <= geometry.chart.bottom - 1 && geometry.visibleStroke
    report.checks.push({ name: `experiment-and-chart-${width}x${height}`, passed: noOverlap && desktopFits && usableCanvas && noHorizontalScroll && wholePlot, geometry })
    if (width < 600) {
      await page.locator('section[class*="dataPanel"]').evaluate(el => el.scrollIntoView({ block: 'end' }))
      const chart = await page.locator('section[class*="dataPanel"]').boundingBox()
      report.checks.push({ name: `phone-chart-reachable-${height}`, passed: chart.y < height && chart.y + chart.height <= height + 1 })
    }
    await page.screenshot({ path: `${prefix}-${width}x${height}.png` })
    await page.close()
  }
  report.passed = report.checks.every(check => check.passed)
} catch (error) { report.failure = error.message }
finally { await browser.close() }
await writeFile(`${prefix}-layout-report.json`, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
process.exitCode = report.passed ? 0 : 1
