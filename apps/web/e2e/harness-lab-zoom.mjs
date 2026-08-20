import { chromium } from '@playwright/test'
import path from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = path.join(root, 'docs', 'reports', 'screenshots')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle', timeout: 60_000 })
const later = page.getByRole('button', { name: '稍后配置' })
if (await later.isVisible().catch(() => false)) await later.click()
const labButton = page.getByRole('button', { name: '物理实验室' })
await labButton.waitFor({ state: 'visible' })
await labButton.click()
await page
  .locator('[data-physicsos-surface="lab"][data-verification-status="verified"]')
  .waitFor({ state: 'visible' })

const canvas = page.getByRole('img', { name: '磁场中的带电粒子运动' })
const file = path.join(outDir, 'harness-lab-canvas-1600x900.png')
await canvas.screenshot({ path: file })
stdout.write(`${file}\n`)

const scene = path.join(outDir, 'harness-lab-scene-1600x900.png')
await page.locator('section[aria-label="场景与对象"]').screenshot({ path: scene })
stdout.write(`${scene}\n`)

const inspector = path.join(outDir, 'harness-lab-inspector-1600x900.png')
await page.locator('section[aria-label="属性"]').screenshot({ path: inspector })
stdout.write(`${inspector}\n`)

const timeline = path.join(outDir, 'harness-lab-timeline-1600x900.png')
await page.locator('footer[aria-label="时间轴"]').screenshot({ path: timeline })
stdout.write(`${timeline}\n`)

await browser.close()
