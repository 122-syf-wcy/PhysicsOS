/**
 * Capture the Home hero stage so the reverted collision look can be verified.
 *
 * Usage: node scripts/design/hero-shot.mjs
 * Writes tmp/hero-live.png and tmp/hero-stage.png
 */
const { chromium } = await import('file:///D:/PhysicsOS/vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs')

const ROOT = 'D:/PhysicsOS/tmp'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const problems = []
page.on('console', m => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)) })
page.on('pageerror', e => problems.push(e.message.slice(0, 200)))

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
/* The GUI holds SSE connections open, so networkidle never fires; the boot
   sequence plus one entrance cycle is enough to judge the canvas. */
await page.waitForTimeout(4000)
await page.screenshot({ path: `${ROOT}/hero-live.png` })

const stage = page.locator('[class*="stage"] >> canvas').first()
if (await stage.count() > 0) {
  await stage.screenshot({ path: `${ROOT}/hero-stage.png` })
} else {
  const hero = page.locator('canvas').first()
  await hero.screenshot({ path: `${ROOT}/hero-stage.png` })
}
console.log('problems:', problems.slice(0, 5))
await browser.close()
