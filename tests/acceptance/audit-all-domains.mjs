import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import process from 'node:process'

const OUT = path.resolve('tmp/audit-all')
mkdirSync(OUT, { recursive: true })
const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:3080'
const ONLY = process.env.AUDIT_ONLY?.split(',')

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
const problems = []
page.on('pageerror', e => problems.push(`PAGEERR ${e.message.slice(0, 160)}`))
page.on('console', m => { if (m.type() === 'error') problems.push(`CONSOLE ${m.text().slice(0, 160)}`) })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })

await page.getByRole('button', { name: '物理实验室' }).click()
await page.waitForTimeout(1500)

const cards = page.locator('[data-template-id]')
const ids = await cards.evaluateAll(nodes => nodes.map(n => n.getAttribute('data-template-id')))
console.log(`templates: ${ids.length}`)
const list = ONLY ? ids.filter(id => ONLY.includes(id)) : ids

for (const id of list) {
  const tag = id.replaceAll(/[^a-z0-9-]/gi, '')
  try {
    const card = page.locator(`[data-template-id="${id}"]`).first()
    await card.scrollIntoViewIfNeeded({ timeout: 5000 })
    if (!(await card.isEnabled().catch(() => false))) {
      console.log(`skip ${id} (disabled/comingSoon)`)
      continue
    }
    await card.click({ timeout: 5000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(OUT, `${tag}-idle.png`) })
    const run = page.getByRole('button', { name: '运行', exact: true }).first()
    if (await run.isVisible().catch(() => false) && await run.isEnabled().catch(() => false)) {
      await run.click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(2200)
      await page.getByRole('button', { name: '暂停' }).first().click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(OUT, `${tag}-run.png`) })
    }
    // open inspector → readings tab, for the right-column audit
    const insp = page.getByRole('button', { name: '检查器', exact: true }).first()
    if (await insp.isVisible().catch(() => false)) {
      await insp.click()
      await page.waitForTimeout(300)
      await page.getByRole('tab', { name: '读数' }).click().catch(() => {})
      await page.waitForTimeout(200)
      await page.screenshot({ path: path.join(OUT, `${tag}-inspector.png`) })
    }
    // back to picker
    await page.getByRole('button', { name: '后退' }).first().click().catch(async () => {
      await page.goBack().catch(() => {})
    })
    await page.waitForTimeout(700)
    // ensure we are back on the picker; if not, navigate fresh
    if (!(await page.locator('[data-physicsos-state="picker"]').isVisible().catch(() => false))) {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.getByRole('button', { name: '物理实验室' }).click()
      await page.waitForTimeout(1200)
    }
    console.log(`ok ${id}`)
  } catch (e) {
    problems.push(`FAIL ${id}: ${String(e).slice(0, 160)}`)
    console.log(`fail ${id}: ${String(e).slice(0, 120)}`)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
    await page.getByRole('button', { name: '物理实验室' }).click().catch(() => {})
    await page.waitForTimeout(1200)
  }
}

console.log('---- problems ----')
for (const p of problems) console.log(p)
await browser.close()
console.log('done')
