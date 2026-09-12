/** One-off visual check: uniform-linear lab at a short viewport, data panel open. */
import { openAcceptance, BASE } from './support.mjs'

const { page, check, shot, dismissOnboarding, finish } = await openAcceptance(import.meta.url, {
  viewport: { width: 1024, height: 705 },
  settleMs: 400,
})

await page.goto(BASE)
await dismissOnboarding()

await page.getByRole('button', { name: '物理实验室' }).click()
await page.getByRole('button', { name: /匀速直线运动/ }).first().click()
await page.waitForTimeout(800)

await page.getByRole('button', { name: '运行' }).click().catch(() => {})
await page.waitForTimeout(1200)

await page.getByRole('button', { name: '图像' }).click()
await page.waitForTimeout(500)

const metrics = await page.evaluate(() => {
  const dp = [...document.querySelectorAll('section')].find(e => e.className.includes('dataPanel'))
  const db = [...document.querySelectorAll('div')].find(e => e.className.includes('dataBody'))
  const rect = (e) => e ? { top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom } : null
  return {
    vh: innerHeight,
    panel: rect(dp),
    bodyBottom: db?.getBoundingClientRect().bottom,
    clippedPx: db ? db.scrollHeight - db.clientHeight : null,
  }
})
check('data panel fits inside the viewport', metrics.panel && metrics.panel.bottom <= metrics.vh, JSON.stringify(metrics))
check('data body content not clipped', metrics.clippedPx === 0, `clippedPx=${metrics.clippedPx}`)

await shot('mechanics-uniform-linear-705')

await finish()
