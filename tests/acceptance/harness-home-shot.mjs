import { chromium } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = path.join(root, 'docs', 'reports', 'screenshots')
mkdirSync(outDir, { recursive: true })

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
]

const browser = await chromium.launch()
for (const viewport of viewports) {
  const page = await browser.newPage({ viewport })
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle', timeout: 60_000 })
  const later = page.getByRole('button', { name: '稍后配置' })
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.waitForTimeout(800)
  const file = path.join(outDir, `harness-home-${viewport.name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(file)
  await page.close()
}
await browser.close()
