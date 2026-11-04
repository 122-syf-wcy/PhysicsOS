#!/usr/bin/env node
/** Read-only HTTPS regression walk after root switches the accepted chat-code image. */
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginUser, waitForShell, isExpectedGuest401 } from './support.mjs'

const expect = playwrightExpect.configure({ timeout: 20000 })
if (process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER !== '1')
  throw new Error('Production smoke runs only in the designated server Docker')
const fixture = process.env.PHYSICSOS_CHAT_CODE_PRODUCTION_FIXTURE
if (!fixture) throw new Error('Private production smoke fixture directory is required')
async function privateText(name) {
  const path = join(fixture, name), info = await stat(path)
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw new Error('Smoke fixture must be private regular files')
  return (await readFile(path, 'utf8')).trim()
}
const launch = JSON.parse(await privateText('web-launch.json'))
const username = await privateText('username'), password = await privateText('admin-password')
const base = new URL(launch.base).origin
if (base !== 'https://physics.dongsiwei.com' || new URL(launch.authUrl).origin !== base)
  throw new Error('Smoke fixture must target the formal HTTPS site')
const root = fileURLToPath(new URL('../../', import.meta.url))
const shots = join(root, 'docs/reports/screenshots/chat-code-experiment/production-ui')
await mkdir(shots, { recursive: true })
const checks = [], errors = [], reads = [], mutations = []
const check = (label, evidence) => {
  checks.push({ label, passed: true, ...(evidence === undefined ? {} : { evidence }) })
  console.log('PASS ' + label)
}
const cleanUrl = value => {
  try {
    const url = new URL(value)
    return url.origin + url.pathname.replace(/(\/preview\/)[^/]+/, '$1[capability]')
      .replace(/(\/question\/)[^/]+/, '$1[capability]')
  } catch { return String(value).replace(/([?&]token=)[^\s]+/g, '$1[redacted]') }
}
const safeError = value => String(value).replaceAll(password, '[redacted]')
  .replace(/https?:\/\/[^\s"')]+/g, cleanUrl)
  .replace(/((?:cookie|authorization):)[^\n]*/gi, '$1 [redacted]')
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-webgl', '--disable-software-rasterizer'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
let authenticated = false, navigating = false, page
context.on('page', active => {
  active.on('pageerror', error => errors.push({ kind: 'pageerror', error: safeError(error.message) }))
  active.on('console', entry => {
    if (entry.type() !== 'error') return
    if (!authenticated && isExpectedGuest401(entry.location().url, entry.text())) return
    errors.push({ kind: 'console', error: safeError(entry.text()) })
  })
  active.on('requestfailed', request => {
    if (navigating && request.failure()?.errorText === 'net::ERR_ABORTED') return
    if (!authenticated && /\/api\/events/.test(request.url())) return
    errors.push({ kind: 'requestfailed', path: cleanUrl(request.url()), error: request.failure()?.errorText })
  })
  active.on('response', response => {
    if (response.status() < 400) return
    if (!authenticated && isExpectedGuest401(response.url(), String(response.status()))) return
    errors.push({ kind: 'response', path: cleanUrl(response.url()), status: response.status() })
  })
})
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url()), method = request.method()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && url.origin === base) {
    const allowedProductWrite = url.pathname === '/physicsos/auth/login'
      || /\/physicsos\/notice\/.+\/ack$/.test(url.pathname)
    const forbidden = url.pathname.startsWith('/physicsos/') && !allowedProductWrite
      || /^\/api\/session\/(?:prompt|create|rename|patch|delete|fork|resume)$/.test(url.pathname)
    if (forbidden) {
      mutations.push({ method, path: url.pathname })
      await route.abort('blockedbyclient')
      return
    }
  }
  await route.continue()
})
const go = async url => {
  navigating = true
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }) }
  finally { navigating = false }
}
async function json(path) {
  const response = await context.request.get(base + path)
  expect(response.status()).toBe(200)
  reads.push(path)
  return response.json()
}
async function noOverflow(surface) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect.poll(() => surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
}
async function glassChoice(name, label) {
  const control = page.getByRole('combobox', { name, exact: true })
  await control.click()
  const list = page.getByRole('listbox', { name, exact: true })
  await expect(list).toBeVisible()
  await list.getByRole('option', { name: label, exact: true }).click()
  await expect(control).toContainText(label)
}
async function styledButton(button) {
  const style = await button.evaluate(node => {
    const value = getComputedStyle(node)
    return { radius: parseFloat(value.borderRadius), shadow: value.boxShadow, fill: value.backgroundImage }
  })
  expect(style.radius).toBeGreaterThanOrEqual(10)
  expect(style.shadow).not.toBe('none')
  return style
}
async function capture(name, surface) {
  await surface.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, name + '.png'), animations: 'disabled', timeout: 30000 })
}
try {
  page = await context.newPage()
  const ready = await context.request.get(base + '/readyz')
  expect(ready.status()).toBe(200)
  check('formal HTTPS readyz returns 200', { imageId: launch.imageId })
  const privatePath = '/physicsos/question-code/artifacts/qcode_' + '0'.repeat(32) + '/source?sha256=' + '0'.repeat(64)
  const guest = await browser.newContext()
  const guestResponse = await guest.request.get(base + privatePath)
  expect(guestResponse.status()).toBe(401)
  await guest.close()
  check('new private question-code route rejects anonymous requests')
  await go(launch.authUrl)
  await loginUser(page, { username, password })
  authenticated = true
  await waitForShell(page)
  expect((await context.cookies()).some(cookie => cookie.name === 'physicsos_session')).toBe(true)
  const notice = await json('/physicsos/notice/platform-notice')
  if (notice.notice?.enabled && notice.acknowledgedVersion !== notice.notice.version) {
    const panel = page.locator('[data-physicsos-platform-notice]')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '继续', exact: true }).click()
    await expect(panel).toBeHidden()
  }
  check('existing administrator logs in through actual production Web shell')
  const catalog = (await json('/physicsos/experiments/catalog')).items
  expect(catalog).toHaveLength(76)
  expect(new Set(catalog.map(item => item.id)).size).toBe(76)
  check('all 76 registered experiments remain available')
  await page.getByRole('button', { name: '实验上传', exact: true }).click()
  const upload = page.locator('[data-physicsos-surface="contribute"]')
  await expect(upload.getByRole('heading', { name: '实验上传与贡献', exact: true })).toBeVisible()
  const target = upload.getByRole('combobox', { name: '对应实验', exact: true })
  await target.click()
  const list = page.getByRole('listbox', { name: '对应实验', exact: true })
  await expect(list.getByRole('option')).toHaveCount(76)
  await expect(list.locator('[aria-disabled="true"]')).toHaveCount(0)
  expect((await list.getByRole('option').allTextContents()).sort()).toEqual(catalog.map(item => item.label).sort())
  await capture('01-upload-all76-desktop', upload)
  await target.press('Escape')
  let selected = 0
  for (const item of catalog) {
    const same = (await target.textContent()).includes(item.label)
    const response = same ? undefined : page.waitForResponse(response => response.request().method() === 'GET'
      && response.url() === base + '/physicsos/experiments/' + item.id)
    await glassChoice('对应实验', item.label)
    if (response) expect((await response).status()).toBe(200)
    await expect(upload.getByRole('link', { name: '下载独立模板 ↓', exact: true })).toHaveAttribute('href',
      item.id === 'convex-lens' ? '/physicsos/developer-prompts/template' : '/physicsos/experiments/' + item.id + '/template')
    selected++
  }
  const uploadStyle = await styledButton(upload.getByRole('button', { name: '上传并提交审核', exact: true }))
  await noOverflow(upload)
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(upload)
  await capture('02-upload-mobile', upload)
  await page.setViewportSize({ width: 1440, height: 1080 })
  check('actual glass selector enables and selects all 76 matching upload targets', { selected, uploadStyle })
  await page.getByRole('button', { name: '账户菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '管理后台', exact: true }).click()
  const admin = page.locator('[data-physicsos-surface="admin"]')
  await expect(admin).toBeVisible()
  await page.getByRole('tab', { name: '实验审核', exact: true }).click()
  const review = page.locator('[data-experiment-review]')
  await expect(review.getByRole('heading', { name: '实验投稿审核', exact: true })).toBeVisible()
  await expect(review.getByRole('combobox', { name: '审核状态', exact: true })).toBeVisible()
  await expect(review.getByRole('combobox', { name: '筛选实验', exact: true })).toBeVisible()
  const queue = await json('/physicsos/experiments/review-queue')
  expect(queue.canReview).toBe(true)
  await glassChoice('审核状态', '全部记录')
  await noOverflow(review)
  await capture('03-admin-experiment-review', review)
  check('dedicated administrator experiment review page and filters remain present', { packages: queue.items.length })
  const existing = queue.items.find(item => item.protocolVersion === 3 && item.status !== 'rejected')
    ?? queue.items.find(item => item.status === 'approved')
  if (existing) {
    const row = review.locator('[data-package-id="' + existing.id + '"]')
    await row.getByRole('button', { name: '预览 v' + existing.version, exact: true }).click()
    const preview = review.getByRole('region', { name: '候选实验预览', exact: true })
    await expect(preview).toBeVisible()
    await expect(preview.locator('[data-community-status]')).toHaveAttribute('data-community-status', 'ready', { timeout: 60000 })
    await expect(preview.locator('iframe')).toBeVisible()
    await capture('04-existing-upload-rendered-preview', preview)
    check('existing uploaded experiment renders through actual administrator preview', { experimentId: existing.experimentId, protocolVersion: existing.protocolVersion ?? 1 })
  } else check('review page has no existing package to preview; no test submission created')
  await page.getByRole('tab', { name: '开发提示词', exact: true }).click()
  const prompts = page.locator('[data-prompt-management]')
  await expect(prompts.getByLabel('Markdown 正文')).not.toHaveValue('')
  await expect(prompts.getByLabel('提示词版本', { exact: true })).not.toHaveValue('')
  await expect(prompts.getByRole('button', { name: '选择 Markdown 文件', exact: true })).toBeVisible()
  await expect(prompts.getByRole('button', { name: '保存草稿', exact: true })).toBeVisible()
  await expect(prompts.getByRole('button', { name: '发布当前草稿', exact: true })).toBeVisible()
  await expect(prompts.getByLabel('完整提示词预览')).not.toHaveText('')
  const promptStyle = await styledButton(prompts.getByRole('button', { name: '保存草稿', exact: true }))
  await json('/physicsos/developer-prompts/admin')
  await noOverflow(prompts)
  await capture('05-admin-prompt-draft-preview', prompts)
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(prompts)
  await capture('06-admin-prompts-mobile', prompts)
  check('prompt version, Markdown import, draft save, manual publish and full preview remain present', { promptStyle })
  const missing = await context.request.get(base + privatePath)
  expect(missing.status()).toBe(404)
  expect((await missing.json()).error.code).toBe('NOT_FOUND')
  check('authenticated new private code API returns exact missing-artifact response')
  expect(mutations).toEqual([])
  expect(errors).toEqual([])
  check('read-only walk: no submission, publication, model request or unexpected browser errors', { reads: reads.length })
  await writeFile(join(shots, 'acceptance-result.json'), JSON.stringify({ passed: true, checks, evidence: { base, imageId: launch.imageId, selected, reads, mutations, browserErrors: errors } }, null, 2))
  console.log('PASS production read-only UI smoke')
} catch (error) {
  const detail = safeError(error.stack ?? error)
  if (page) await page.screenshot({ path: join(shots, 'failure.png'), animations: 'disabled', timeout: 15000 }).catch(() => {})
  await writeFile(join(shots, 'acceptance-result.json'), JSON.stringify({ passed: false, checks, error: detail, evidence: { base, imageId: launch.imageId, reads, mutations, browserErrors: errors } }, null, 2))
  console.error(detail)
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}
