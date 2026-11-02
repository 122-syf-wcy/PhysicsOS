import { chromium, expect } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const base = process.env.PHYSICSOS_DOCS_BASE ?? 'http://127.0.0.1:3094/developers/index.html'
const out = process.env.PHYSICSOS_DOCS_SHOTS ?? 'docs/reports/screenshots/developer-docs'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const id of [
    'start',
    'code-style',
    'structure',
    'physics',
    'three',
    'visual',
    'package',
    'review',
    'authors',
    'agents',
    'downloads',
  ]) {
    await page.goto(`${base}#/${id}`)
    await expect(page.locator('h1')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.goto(`${base}#/agents`)
  await page.getByLabel('实验 ID（可选）').fill('convex-lens')
  await page.getByRole('button', { name: '复制 AGENTS.md', exact: true }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(await page.locator('.agent-preview').textContent())
  expect(copied).toContain('适用范围：实验 convex-lens')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 AGENTS.md', exact: true }).click()
  const download = await pending
  expect(await readFile(await download.path(), 'utf8')).toBe(copied)
  await page.getByLabel('实验 ID（可选）').fill('../invalid<script>')
  await expect(page.getByRole('button', { name: '复制 AGENTS.md', exact: true })).toBeDisabled()
  await page.getByLabel('实验 ID（可选）').fill('')
  const canonical = await page.request.get(new URL('downloads/AGENTS.md', base).toString())
  expect(await canonical.text()).toBe(await page.locator('.agent-preview').textContent())
  await page.getByLabel('搜索开发文档').fill('pointercancel')
  await page.locator('.search-result').first().click()
  await expect(page).toHaveURL(/#\/physics\/preview$/)
  await page.goto(`${base}#/missing`)
  await page.getByRole('link', { name: '返回文档首页 →' }).click()
  await expect(page.locator('h1')).toContainText('一起')
  await expect.poll(() => page.locator('.hero-mascot img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await page.locator('#toast').waitFor({ state: 'hidden' })
  await page.screenshot({
    path: join(out, 'home-desktop.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await page.getByRole('link', { name: '代码风格', exact: true }).click()
  await page.locator('#toc-nav').getByRole('link', { name: '提示词约束意图，工具约束结果' }).click()
  await expect(page.locator('#toc-nav .current')).toHaveText('提示词约束意图，工具约束结果')
  await page.goBack()
  await expect(page).toHaveURL(/#\/code-style$/)
  await page.goto(`${base}#/agents`)
  await page.getByLabel('实验 ID（可选）').fill('convex-lens')
  await page.screenshot({
    path: join(out, 'agents-desktop.png'),
    fullPage: false,
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.locator('#sidebar')).toHaveAttribute('inert', '')
  await page.getByRole('button', { name: '打开文档目录' }).click()
  await expect(page.locator('#sidebar')).not.toHaveAttribute('inert', '')
  await page.getByRole('link', { name: '代码风格', exact: true }).click()
  await expect(page.locator('#sidebar')).toHaveAttribute('inert', '')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto(`${base}#/start`)
  // On mobile the mascot is the only thing between the buttons and the cards;
  // capture it decoded, not as the blank its lazy image leaves behind.
  await expect
    .poll(() => page.locator('.hero-mascot img').evaluate((image) => image.complete && image.naturalWidth > 0))
    .toBe(true)
  await page.screenshot({
    path: join(out, 'home-mobile.png'),
    fullPage: false,
    animations: 'disabled',
  })
  expect(errors).toEqual([])

  const fallback = await browser.newContext()
  await fallback.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('permission denied')
        },
      },
    })
  })
  const manual = await fallback.newPage()
  await manual.goto(`${base}#/agents`)
  await manual.getByRole('button', { name: '复制 AGENTS.md', exact: true }).click()
  await expect(manual.getByRole('dialog')).toBeVisible()
  expect(await manual.locator('#copy-fallback').inputValue()).toContain('# PhysicsOS 实验开发约定')
  console.log(
    'Developer docs acceptance passed: routes, search, clipboard, downloads, invalid IDs, TOC, mobile and fallback',
  )
} finally {
  await browser.close()
}
