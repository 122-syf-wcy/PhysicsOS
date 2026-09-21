/**
 * KaTeX MathText acceptance: open the force-composition experiment, open the
 * derivation tab, and verify KaTeX-typeset output (`.katex` markup, fraction
 * nodes, stylesheet link) with the console/network gate.
 *
 * node tests/acceptance/katex-mathtext-acceptance.mjs
 */
import { chromium } from '@playwright/test'
import { stdout } from 'node:process'

const BASE = 'http://127.0.0.1:3080'
const failures = []
const gate = { consoleErrors: [], pageErrors: [], failedRequests: [], errorResponses: [] }

const check = (label, condition, detail) => {
  if (condition) {
    stdout.write(`  ✓ ${label}\n`)
    return true
  }
  failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
  stdout.write(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
  return false
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') gate.consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => { gate.pageErrors.push(e.message.slice(0, 200)) })
page.on('requestfailed', (r) => { gate.failedRequests.push(`${r.method()} ${r.url().slice(0, 140)}`) })
page.on('response', (r) => { if (r.status() >= 400) gate.errorResponses.push(`${r.status()} ${r.url().slice(0, 140)}`) })

await page.goto(BASE, { waitUntil: 'networkidle' })
const later = page.getByRole('button', { name: '稍后再说' })
if (await later.isVisible().catch(() => false)) await later.click()

await page.getByRole('button', { name: '物理实验室' }).click()
await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
await page.evaluate(() => {
  document.querySelector('button[data-template-id="force-composition"]')?.click()
})
await page.waitForTimeout(1200)

/* KaTeX stylesheet must be linked exactly once. */
const cssLinks = await page.locator('link[href="/physicsos/katex/katex.min.css"]').count()
check('KaTeX stylesheet linked once', cssLinks === 1, `count=${cssLinks}`)
const cssOk = await page.evaluate(async () => {
  const res = await fetch('/physicsos/katex/katex.min.css')
  return res.ok
})
check('KaTeX stylesheet served', cssOk)
const fontOk = await page.evaluate(async () => {
  const res = await fetch('/physicsos/katex/fonts/KaTeX_Main-Regular.woff2')
  return res.ok
})
check('KaTeX fonts served', fontOk)

/* Readings tab: derived rows go through MathText. */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '数据')
  btn?.click()
})
await page.waitForTimeout(400)
const katexCount = await page.locator('.katex').count()
check('KaTeX markup rendered in readings', katexCount > 0, `count=${katexCount}`)
const fiveN = await page.evaluate(() => document.body.textContent?.includes('5') ?? false)
check('resultant 5 N visible', fiveN)

/* The vt-area experiment's derivation carries \tfrac steps — switch scenes and
   verify KaTeX .mfrac nodes appear (the old custom renderer used .frac). */
await page.evaluate(() => {
  document.querySelector('[title="切换实验"]')?.click()
})
await page.waitForTimeout(600)
await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
await page.evaluate(() => {
  document.querySelector('button[data-template-id="vt-area"]')?.click()
})
await page.waitForTimeout(1200)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '推导')
  btn?.click()
})
await page.waitForTimeout(400)
const mfrac = await page.locator('.katex .mfrac').count()
check('KaTeX fraction nodes in derivation', mfrac > 0, `count=${mfrac}`)
const legacyFrac = await page.locator('.math .frac').count()
check('no legacy .frac nodes remain', legacyFrac === 0, `count=${legacyFrac}`)

check('no console errors', gate.consoleErrors.length === 0, gate.consoleErrors.join(' | '))
check('no page errors', gate.pageErrors.length === 0, gate.pageErrors.join(' | '))
check('no failed requests', gate.failedRequests.length === 0, gate.failedRequests.join(' | '))
check('no error responses', gate.errorResponses.length === 0, gate.errorResponses.join(' | '))

await browser.close()
if (failures.length > 0) {
  stdout.write(`\n${failures.length} FAILURES\n`)
  process.exit(1)
}
stdout.write('\nALL PASS\n')
