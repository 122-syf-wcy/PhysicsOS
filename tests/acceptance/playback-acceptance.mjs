/**
 * Playback/animation acceptance: keyboard transport, the replay affordance
 * after a finished run, live clock advance, and the playhead-synced data row.
 *
 * node tests/acceptance/playback-acceptance.mjs
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

const openExperiment = async (page, templateId) => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: '稍后再说' })
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.getByRole('button', { name: '物理实验室' }).click()
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.evaluate((id) => {
    document.querySelector(`button[data-template-id="${id}"]`)?.click()
  }, templateId)
  await page.locator('[data-physicsos-surface="lab"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(600)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', (m) => { if (m.type() === 'error') gate.consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => { gate.pageErrors.push(e.message.slice(0, 200)) })
page.on('requestfailed', (r) => { gate.failedRequests.push(`${r.method()} ${r.url().slice(0, 140)}`) })
page.on('response', (r) => { if (r.status() >= 400) gate.errorResponses.push(`${r.status()} ${r.url().slice(0, 140)}`) })

/* ---- uniform-acceleration: finite run, keyboard transport ------------- */
await openExperiment(page, 'uniform-acceleration')

const canvasBox = await page.locator('section[aria-label="实验画布"], [data-physicsos-surface="lab"] section').first().boundingBox()
check('canvas is visible', (canvasBox?.height ?? 0) > 200, `height=${canvasBox?.height}`)

/* Nothing focused yet: ArrowRight steps 10% each — ten presses end the run. */
for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight')
await page.waitForTimeout(300)
const replayCount = await page.getByRole('button', { name: '重播' }).count()
check('finished run offers 重播', replayCount >= 1, `count=${replayCount}`)

/* Space replays: clock rewinds and the run starts. Focus still sits on the
   picker-open button, which owns Space natively — blur it the way clicking the
   canvas would, so the workspace's transport keys take over. */
await page.evaluate(() => {
  const el = document.activeElement
  if (el instanceof HTMLElement) el.blur()
})
await page.keyboard.press(' ')
await page.waitForTimeout(400)
const running = await page.locator('[data-physicsos-surface="lab"]').getAttribute('data-physicsos-running')
check('Space replays from t = 0 (running)', running === 'true', `running=${running}`)
check('重播 affordance cleared while running', (await page.getByRole('button', { name: '重播' }).count()) === 0)

/* Space again pauses. */
await page.keyboard.press(' ')
await page.waitForTimeout(300)
const paused = await page.locator('[data-physicsos-surface="lab"]').getAttribute('data-physicsos-running')
check('Space pauses', paused === 'false', `running=${paused}`)

/* Home rewinds to t = 0. */
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await page.keyboard.press('Home')
await page.waitForTimeout(200)

/* ---- live run: clock actually advances under rAF ---------------------- */
await page.getByRole('button', { name: '运行', exact: true }).click()
await page.waitForTimeout(1600)
const runningNow = await page.locator('[data-physicsos-surface="lab"]').getAttribute('data-physicsos-running')
check('run button starts the clock', runningNow === 'true', `running=${runningNow}`)
await page.keyboard.press(' ')

/* ---- data panel: playhead-synced row ---------------------------------- */
await page.evaluate(() => {
  const expand = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '展开')
  expand?.click()
})
await page.waitForTimeout(300)
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '数据')
  tab?.click()
})
await page.waitForTimeout(300)
const highlightedRows = await page.locator('tr.dataRowCurrent, tr[class*="dataRowCurrent"]').count()
check('data table marks the playhead row', highlightedRows >= 1, `count=${highlightedRows}`)

/* ---- cyclic model keeps running past the window (uniform linear) ------ */
await openExperiment(page, 'uniform-linear')
await page.getByRole('button', { name: '运行', exact: true }).click()
await page.waitForTimeout(1500)
const cyclicRunning = await page.locator('[data-physicsos-surface="lab"]').getAttribute('data-physicsos-running')
check('cyclic demo runs', cyclicRunning === 'true', `running=${cyclicRunning}`)

/* ---- gates ------------------------------------------------------------- */
check('no console errors', gate.consoleErrors.length === 0, gate.consoleErrors[0])
check('no page errors', gate.pageErrors.length === 0, gate.pageErrors[0])
check('no failed requests', gate.failedRequests.length === 0, gate.failedRequests[0])
check('no error responses', gate.errorResponses.length === 0, gate.errorResponses[0])

await browser.close()
if (failures.length > 0) {
  stdout.write(`\n${failures.length} failure(s):\n${failures.map(f => `  - ${f}`).join('\n')}\n`)
  process.exit(1)
}
stdout.write('\nall playback checks passed\n')
