/**
 * Marketing screenshots for the public PhysicsOS website.
 *
 * Drives the real harness web server (http://127.0.0.1:3080) and captures the
 * surfaces the landing page shows. Output goes to the overlay public tree, so
 * the website can ship the shots as ordinary static assets:
 *
 *   overlays/harness/files/apps/web/public/physicsos/website/shots/
 *
 * Usage: node scripts/design/website-shots.mjs
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { stdout } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/* @playwright/test lives under tests/acceptance, not next to this script. */
const resolveFromAcceptance = createRequire(path.join(ROOT, 'tests/acceptance/package.json'))
const playwright = await import(
  pathToFileURL(resolveFromAcceptance.resolve('@playwright/test')).href
)
const { chromium } = playwright.default ?? playwright
const OUT = path.join(ROOT, 'overlays/harness/files/apps/web/public/physicsos/website/shots')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
})
const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text().slice(0, 200))
})
page.on('pageerror', (e) => {
  problems.push(e.message.slice(0, 200))
})

/* The site ships these as JPEG: a full-page screenshot is a flat, opaque
   image, and JPEG lands ~4x smaller than PNG at a quality nobody can tell
   apart at hero scale. Captured as PNG first, then converted. */
const shot = async (name) => {
  const png = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: png })
  execFileSync('python3', [
    '-c',
    `
from PIL import Image
im = Image.open(${JSON.stringify(png)}).convert('RGB')
im.save(${JSON.stringify(path.join(OUT, name + '.jpg'))}, 'JPEG', quality=84, optimize=True, progressive=True)
`.trim(),
  ])
  rmSync(png)
  stdout.write(`  ${name}.jpg\n`)
}
const settle = (ms = 700) => page.waitForTimeout(ms)

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 60_000 })

/* First boot: the beta notice, then the API-key guide. The key guide's primary
   button stays disabled until a key is entered, so it is dismissed with its
   own secondary action instead of clicking through. */
await page
  .getByRole('button', { name: '继续' })
  .waitFor({ state: 'visible', timeout: 20_000 })
  .catch(() => {})
const cont = page.getByRole('button', { name: '继续' })
if (await cont.isVisible().catch(() => false)) await cont.click({ timeout: 5000 }).catch(() => {})
const skipKey = page.getByRole('button', { name: '稍后配置' })
await skipKey.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
if (await skipKey.isVisible().catch(() => false)) await skipKey.click({ timeout: 5000 })
await page.waitForTimeout(600)

/* Home (conversation surface with the PhysicsOS hero). */
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })
await settle(1400)
await shot('01-home')

/* Experiment library. */
await page.getByRole('button', { name: '物理实验室' }).click()
await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })
await settle(900)
await shot('02-experiment-library')

/* Pick a template, then screenshot the lab it opens. */
const pick = async (name, domain) => {
  await page
    .locator('[class*="grid"] button', { hasText: new RegExp(name) })
    .first()
    .click()
  await page
    .locator(`[data-physicsos-domain="${domain}"]`)
    .waitFor({ state: 'visible', timeout: 20_000 })
  await settle(1300)
}
const reopen = async () => {
  await page.getByTitle('切换实验').click()
  await page
    .locator('[data-physicsos-state="picker"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await settle(500)
}

await pick('^磁场中的带电粒子运动', 'magnetic')
await shot('03-lab-magnetic')

await reopen()
await pick('^串联电路', 'circuit')
await shot('04-lab-circuit')

await reopen()
await pick('^斜面运动', 'mechanics')
await shot('05-lab-incline')

await reopen()
await pick('^双源干涉与波的叠加', 'wave')
await shot('06-lab-wave')

/* Question space: open a question so the workspace shows text + visualization. */
await page.getByRole('button', { name: '试题空间' }).click()
await page
  .locator('[data-physicsos-surface="questions"]')
  .waitFor({ state: 'visible', timeout: 20_000 })
await settle(900)
const firstQuestion = page
  .locator('[data-physicsos-surface="questions"] button', { hasText: /质子|电子|磁场/ })
  .first()
if (await firstQuestion.isVisible().catch(() => false)) {
  await firstQuestion.click().catch(() => {})
  await settle(2200)
}
await shot('07-question-space')

stdout.write(`problems: ${JSON.stringify(problems.slice(0, 5))}\n`)
stdout.write(`out: ${OUT}\n`)
await browser.close()
