/**
 * Walk every experiment template and report what breaks.
 *
 * For each selectable template: open it, screenshot it idle, press 运行, pause,
 * screenshot again, then open the inspector's 读数 tab and screenshot that.
 * Anything the browser complains about along the way (page errors, console
 * errors) is collected and printed at the end, and the screenshots land in
 * `tmp/audit-all/` for a human pass.
 *
 * This is the experiment area's broadest smoke test — it is how the
 * "blank canvas / magnified canvas / dead toggle" class of defect gets found,
 * because those are exactly the failures that pass every unit test.
 *
 * Usage:
 *   node tests/acceptance/audit-all-domains.mjs                  # own isolated server
 *   AUDIT_BASE=http://127.0.0.1:3080 AUDIT_USER=… AUDIT_PASS=… node tests/acceptance/audit-all-domains.mjs
 *   AUDIT_ONLY=plane-mirror,convex-lens node tests/acceptance/audit-all-domains.mjs
 *
 * The isolated default exists because the app is behind the auth gate: a script
 * that just navigates to `/` and looks for 稍后配置 no longer reaches anything,
 * so this suite would otherwise report "0 templates" and look green.
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { isExpectedGuest401, registerStudent, startIsolatedServer } from './support.mjs'

const OUT = path.resolve('tmp/audit-all')
mkdirSync(OUT, { recursive: true })
const ONLY = process.env.AUDIT_ONLY?.split(',').filter(Boolean)

const external = process.env.AUDIT_BASE
const own = external === undefined ? await startIsolatedServer({ port: 3096 }) : undefined
const BASE = external ?? own.base

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
const problems = []
page.on('pageerror', e => problems.push(`PAGEERR ${e.message.slice(0, 160)}`))
page.on('console', m => {
  if (m.type() !== 'error') return
  /* The boot-time guest `/auth/me` 401 is the documented answer, not a fault. */
  if (isExpectedGuest401(m.location()?.url ?? '', m.text())) return
  problems.push(`CONSOLE ${m.text().slice(0, 160)}`)
})

/** Reach the picker, clearing onboarding and (when present) the auth gate. */
const toPicker = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  const later = page.getByRole('button', { name: '稍后配置' })
  await later.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
  if (await page.locator('[data-physicsos-auth-gate]').isVisible().catch(() => false)) {
    await registerStudent(page)
  }
  await page.getByRole('button', { name: '物理实验室' }).click()
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(900)
}

await toPicker()

const ids = await page
  .locator('[data-template-id]')
  .evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('data-template-id')))])
console.log(`templates: ${ids.length}`)
const list = ONLY === undefined ? ids : ids.filter(id => ONLY.includes(id))
console.log(`auditing: ${list.length}`)

let opened = 0
let skipped = 0

for (const id of list) {
  const tag = id.replaceAll(/[^a-z0-9-]/gi, '')
  try {
    const card = page.locator(`[data-template-id="${id}"]`).first()
    await card.scrollIntoViewIfNeeded({ timeout: 5000 })
    if (!(await card.isEnabled().catch(() => false))) {
      console.log(`skip ${id} (disabled/comingSoon)`)
      skipped++
      continue
    }
    await card.click({ timeout: 5000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(OUT, `${tag}-idle.png`) })
    await page.getByRole('button', { name: '运行', exact: true }).first()
      .click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(2200)
    await page.getByRole('button', { name: '暂停' }).first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, `${tag}-run.png`) })

    const insp = page.getByRole('button', { name: '检查器', exact: true }).first()
    if (await insp.isVisible().catch(() => false)) {
      await insp.click()
      await page.waitForTimeout(300)
      await page.getByRole('tab', { name: '读数' }).click().catch(() => {})
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT, `${tag}-inspector.png`) })
    }

    await page.getByRole('button', { name: '后退' }).first().click().catch(async () => {
      await page.goBack().catch(() => {})
    })
    await page.waitForTimeout(700)
    if (!(await page.locator('[data-physicsos-state="picker"]').isVisible().catch(() => false))) {
      await toPicker()
    }
    opened++
    console.log(`ok ${id}`)
  } catch (e) {
    problems.push(`FAIL ${id}: ${String(e).slice(0, 160)}`)
    console.log(`fail ${id}: ${String(e).slice(0, 120)}`)
    await toPicker().catch(() => {})
  }
}

console.log(`\nopened ${opened}｜skipped ${skipped}｜problems ${problems.length}`)
console.log('---- problems ----')
for (const p of problems) console.log(p)
await browser.close()
own?.stop()
console.log('done')
