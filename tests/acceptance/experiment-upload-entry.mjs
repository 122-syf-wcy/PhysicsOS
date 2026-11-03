import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const base = process.env.PHYSICSOS_CONTRIBUTION_BASE ?? 'http://127.0.0.1:3095'
const home = process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_HOME ?? '/tmp/physicsos-upload-entry-preview'
const shots = join(root, 'docs/reports/screenshots/experiment-upload-entry')
await mkdir(shots, { recursive: true })
const password = await readFile(join(home, 'admin-password'), 'utf8')
const zip = join(root, 'developer-kit/experiment-template/release/convex-lens-1.0.0.zip')
const bytes = await readFile(zip)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
try {
  const createContext = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()) })
    })
    return context
  }
  const admin = await createContext()
  const login = async (context, username) => {
    const response = await context.request.post(`${base}/physicsos/auth/login`, { data: { username, schoolId: 'PHYSICSOS-OPEN', password } })
    expect(response.ok()).toBe(true)
  }
  await login(admin, 'admin')
  const username = `entry_${Date.now()}`
  const created = await admin.request.post(`${base}/physicsos/admin/users`, { data: { username, displayName: '入口验收贡献者', password, role: 'STUDENT', schoolId: 'PHYSICSOS-OPEN' } })
  expect(created.ok()).toBe(true)
  const student = await createContext()
  await login(student, username)
  const dismissNotice = async page => {
    const response = await page.context().request.get(`${base}/physicsos/notice/platform-notice`)
    const state = await response.json()
    if (state.notice?.enabled && state.acknowledgedVersion !== state.notice.version) {
      const notice = page.locator('[data-physicsos-platform-notice]')
      await expect(notice).toBeVisible({ timeout: 30000 })
      await notice.getByRole('button').last().click()
      await expect(notice).toBeHidden()
    }
  }
  const page = await student.newPage()
  await page.goto(base)
  await expect(page.getByRole('button', { name: '实验上传', exact: true })).toBeVisible({ timeout: 60000 })
  await dismissNotice(page)
  await page.getByRole('button', { name: '实验上传', exact: true }).click()
  await expect(page).toHaveURL(`${base}/#/contribute`)
  let workspace = page.locator('[data-physicsos-surface="contribute"]')
  await expect(workspace.getByRole('heading', { name: '实验上传与贡献' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(workspace.getByText('当前支持：凸透镜成像规律 · 三维实验')).toBeVisible()
  await workspace.locator('input[type="file"]').first().setInputFiles(zip)
  await workspace.getByLabel('作者显示名', { exact: true }).fill('入口验收贡献者')
  await workspace.getByLabel('本次修改说明', { exact: true }).fill('由统一实验上传页提交')
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/convex-lens/packages'))
  await workspace.getByRole('button', { name: '上传并提交审核', exact: true }).click()
  const response = await uploaded
  expect(response.status()).toBe(201)
  const { item } = await response.json()
  expect(item.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  await expect(workspace.locator(`[data-package-id="${item.id}"]`)).toContainText('等待审核', { timeout: 30000 })
  await workspace.evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: join(shots, 'upload-desktop.png'), animations: 'disabled' })
  await page.reload()
  await expect(page).toHaveURL(`${base}/#/contribute`)
  await expect(page.locator(`[data-package-id="${item.id}"]`)).toContainText('等待审核', { timeout: 60000 })
  await expect(page.getByRole('button', { name: '审核通过并发布', exact: true })).toHaveCount(0)

  const reviewer = await admin.newPage()
  await reviewer.goto(`${base}/#/contribute`)
  await expect(reviewer.getByRole('heading', { name: '实验上传与贡献' })).toBeVisible({ timeout: 60000 })
  await dismissNotice(reviewer)
  await reviewer.locator(`[data-package-id="${item.id}"]`).getByRole('button', { name: '预览 v1.0.0', exact: true }).click()
  await expect(reviewer.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
  const archive = await admin.request.get(`${base}/physicsos/experiments/packages/${item.id}/archive`)
  expect(archive.ok()).toBe(true)
  expect(createHash('sha256').update(await archive.body()).digest('hex')).toBe(item.sha256)
  await reviewer.getByRole('button', { name: '审核通过并发布', exact: true }).click()
  await expect(reviewer.locator(`[data-package-id="${item.id}"]`)).toContainText('当前默认', { timeout: 30000 })
  await reviewer.screenshot({ path: join(shots, 'review-desktop.png'), animations: 'disabled' })

  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.locator(`[data-package-id="${item.id}"]`)).toContainText('当前默认')
  await page.getByRole('link', { name: '打开凸透镜实验 →', exact: true }).click()
  await expect(page.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
  const sceneUrl = page.url()
  await page.getByRole('button', { name: '贡献实验', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '贡献凸透镜实验' })).toBeVisible()
  await expect(page.getByRole('dialog').locator(`[data-package-id="${item.id}"]`)).toContainText('当前默认')
  await page.getByRole('button', { name: '关闭贡献实验' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(`${base}/#/contribute`)
  await expect(page.getByRole('heading', { name: '实验上传与贡献' })).toBeVisible()
  await page.goForward()
  await expect(page).toHaveURL(sceneUrl)
  await expect(page.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: '实验上传', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  workspace = page.locator('[data-physicsos-surface="contribute"]')
  await expect(page.getByRole('button', { name: '实验上传', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect.poll(() => workspace.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await workspace.evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: join(shots, 'upload-mobile.png'), animations: 'disabled' })
  expect(errors).toEqual([])
  await writeFile(join(home, 'upload-entry-result.json'), JSON.stringify({ activeId: item.id, sha256: item.sha256, version: item.version }), { mode: 0o600 })
  console.log('PASS: home sidebar, direct upload page, real student ZIP, administrator preview/approval/archive, reload/history, retained experiment dialog, mobile and clean console')
} finally { await browser.close() }
