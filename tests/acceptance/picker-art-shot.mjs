import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
const lab = p.getByText('物理实验室').first()
if (await lab.count()) await lab.click()
await p.waitForTimeout(2000)
await p.screenshot({ path: 'tmp/picker-a.png' })
const btn = p.getByText('新建').first()
if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500) }
await p.screenshot({ path: 'tmp/picker-b.png' })
await b.close()
