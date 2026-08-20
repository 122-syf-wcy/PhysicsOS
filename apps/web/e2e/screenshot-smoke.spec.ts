import { expect, test } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const screenshotDir = path.join(repoRoot, 'docs', 'reports', 'screenshots')

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const

const pages = [
  { name: 'home', path: '/' },
  { name: 'physics-lab-workspace', path: '/lab' },
  { name: 'question-space', path: '/questions' },
  { name: 'desktop-workspace', path: '/desktop' },
] as const

for (const pageDef of pages) {
  for (const viewport of viewports) {
    test(`${pageDef.name} ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(pageDef.path)
      await expect(page.locator('#root')).toBeVisible()
      const file = path.join(screenshotDir, `${pageDef.name}-${viewport.name}.png`)
      await page.screenshot({ path: file, fullPage: pageDef.name === 'home' })
    })
  }
}
