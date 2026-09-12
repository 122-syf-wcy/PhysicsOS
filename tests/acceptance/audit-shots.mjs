import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import process from 'node:process'

const OUT = path.resolve('tmp/audit')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:3080'

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
page.on('pageerror', e => console.log('PAGEERR', e.message.slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)) })

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })
await page.screenshot({ path: path.join(OUT, '01-home.png') })

// Lab → picker
await page.getByRole('button', { name: '物理实验室' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(OUT, '02-picker.png') })

// Parallel plate template
const card = page.getByText('平行板电场偏转').first()
await card.click().catch(e => console.log('card click fail', e.message))
await page.waitForTimeout(1500)
await page.screenshot({ path: path.join(OUT, '03-parallel-plate.png') })

// run a bit then pause mid-flight
await page.getByRole('button', { name: '运行', exact: true }).first().click().catch(() => {})
await page.waitForTimeout(2600)
await page.getByRole('button', { name: '暂停' }).first().click().catch(() => {})
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(OUT, '04-parallel-plate-running.png') })

// expand data panel
await page.getByRole('button', { name: '展开' }).first().click().catch(() => {})
await page.waitForTimeout(600)
await page.screenshot({ path: path.join(OUT, '05-parallel-plate-data.png') })

await browser.close()
console.log('done')
