#!/usr/bin/env node
/**
 * Real-browser release walk against the SERVER'S RESTORED CANDIDATE only.
 *
 * Run after replacing the restored app with the candidate and starting the
 * server-side preview forwarder in this browser runner's network namespace.
 * The sole accepted origin is http://127.0.0.1:13080; production is refused.
 *
 * Required server files:
 *   PHYSICSOS_BROWSER_ADMIN_PASSWORD_FILE — existing admin password file.
 *   PHYSICSOS_BROWSER_LAUNCH_URL_FILE — candidate's current dsh web launch URL.
 * Optional:
 *   PHYSICSOS_BROWSER_ADMIN_USERNAME (admin)
 *   PHYSICSOS_BROWSER_EVIDENCE_DIR (/tmp)
 *
 * Credentials stay in memory. No trace, HAR, storage-state, raw error, user
 * history, model key, or administration screenshot is exported. The only
 * screenshot is the new, known Lab fixture. One new saved scene is retained
 * in the restored database and identified in the result for restart checks.
 * Plugin/model settings, existing scenes, accounts, papers, and chat prompts
 * are not changed. The normal login and notice acknowledgement may persist.
 */
import { chromium, expect } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const base = 'http://127.0.0.1:13080'
const checks = []
const gate = { consoleErrors: 0, pageErrors: 0, rejections: 0, failedRequests: [], errorResponses: [], externalRequests: 0, forbiddenRequests: 0 }
let browser
let page
let authenticated = false
let step = 'read_server_inputs'
let sceneId
let evidence

const check = (label, ok, detail) => {
  checks.push({ label, ok, ...(detail === undefined ? {} : { detail }) })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}\n`)
}
const stage = async (label, run) => {
  step = label
  const detail = await run()
  check(label, true, detail)
}
const smallFile = (file) => {
  if (!file || !statSync(file).isFile() || statSync(file).size > 8192)
    throw new Error('invalid server input file')
  const value = readFileSync(file, 'utf8').trim()
  if (!value) throw new Error('empty server input file')
  return value
}
const pathname = (url) => new URL(url).pathname
const guestPath = (url) => pathname(url) === '/physicsos/auth/me' || pathname(url).startsWith('/api/')
const group = (url) => {
  const parsed = new URL(url)
  if (parsed.origin !== base) return 'external'
  // Endpoint families are enough to diagnose a refusal without exporting IDs.
  return parsed.pathname.split('/').slice(0, 3).join('/')
}
const bodyOf = async (response) => {
  expect(response.status()).toBe(200)
  return response.json()
}
const responseFor = async (predicate, action) => {
  // Attach handlers to both promises immediately, including when the click
  // fails; an orphan response waiter must never print an unhandled raw error.
  const [response] = await Promise.all([page.waitForResponse(predicate), action()])
  return bodyOf(response)
}
const waitForShell = () => page.getByRole('navigation')
  .getByRole('button', { name: '物理实验室', exact: true }).first()
  .waitFor({ state: 'visible', timeout: 30_000 })
const scenes = async () => {
  const items = []
  const seen = new Set()
  let cursor
  for (let count = 0; count < 100; count++) {
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`
    const body = await bodyOf(await page.request.get(`${base}/physicsos/learning/scenes${query}`))
    expect(Array.isArray(body.items)).toBe(true)
    items.push(...body.items)
    if (body.nextCursor === undefined) return items
    expect(seen.has(body.nextCursor)).toBe(false)
    seen.add(body.nextCursor)
    cursor = body.nextCursor
  }
  throw new Error('scene pagination did not terminate')
}

try {
  const password = smallFile(process.env.PHYSICSOS_BROWSER_ADMIN_PASSWORD_FILE)
  const originalLaunch = new URL(smallFile(process.env.PHYSICSOS_BROWSER_LAUNCH_URL_FILE))
  const token = originalLaunch.searchParams.get('token')
  if (!token) throw new Error('candidate launch URL has no token')
  // The launch token mints the transport cookie for the preview authority.
  const launch = new URL(base)
  launch.searchParams.set('token', token)
  const evidenceRoot = process.env.PHYSICSOS_BROWSER_EVIDENCE_DIR ?? tmpdir()
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 })
  evidence = mkdtempSync(path.join(evidenceRoot, 'restored-browser-'))

  step = 'launch_server_chromium'
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const guestRequests = new WeakSet()
  context.on('request', request => { if (!authenticated) guestRequests.add(request) })
  context.on('requestfailed', request => {
    if (request.failure()?.errorText?.includes('ERR_ABORTED')) return
    gate.failedRequests.push({ method: request.method(), group: group(request.url()) })
  })
  context.on('response', response => {
    const status = response.status()
    if (status < 400) return
    if ((status === 401 || status === 403) && guestRequests.has(response.request()) && guestPath(response.url())) return
    gate.errorResponses.push({ status, group: group(response.url()) })
  })
  await context.exposeBinding('__physicsosReleaseRejection', () => { gate.rejections++ })
  await context.addInitScript(() => {
    window.addEventListener('unhandledrejection', () => { void window.__physicsosReleaseRejection() })
  })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue()
    if (url.origin !== base) {
      gate.externalRequests++
      return route.abort()
    }
    const path = url.pathname
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    if (writes && (
      path.startsWith('/physicsos/plugins/') || path.startsWith('/physicsos/model-pool/') ||
      path.startsWith('/physicsos/paper/') || path === '/api/session/prompt'
    )) {
      gate.forbiddenRequests++
      return route.abort()
    }
    return route.continue()
  })
  page = await context.newPage()
  page.on('pageerror', () => { gate.pageErrors++ })
  page.on('console', message => {
    if (message.type() !== 'error') return
    const url = message.location().url
    const text = message.text()
    if (!authenticated && url && guestPath(url) && /401|403|unauthorized|forbidden/i.test(text)) return
    // Pre-auth API refusals surface inside client bundles whose script URL is
    // not a guest path; the refusal itself is expected guest traffic.
    if (!authenticated && /HTTP 4(?:01|03)/.test(text)) return
    if (!authenticated && /WebSocket connection.*\/api\//.test(text)) return
    gate.consoleErrors++
  })

  await stage('candidate_ready', async () => {
    const health = await bodyOf(await page.request.get(`${base}/healthz`))
    const readiness = await bodyOf(await page.request.get(`${base}/readyz`))
    expect(health.status).toBe('ok')
    expect(readiness.status).toBe('ready')
  })
  await stage('browser_login_and_product_shell', async () => {
    await page.goto(launch.href, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const form = page.locator('[data-physicsos-auth-view="login"]')
    await expect(form).toBeVisible({ timeout: 30_000 })
    await form.locator('input[autocomplete="username"]').fill(process.env.PHYSICSOS_BROWSER_ADMIN_USERNAME ?? 'admin')
    await form.locator('input[type="password"]').fill(password)
    await form.getByRole('button', { name: '登录 PhysicsOS', exact: true }).click()
    await expect(page.locator('[data-physicsos-auth-gate]')).toHaveCount(0, { timeout: 30_000 })
    authenticated = true
    await waitForShell()
    const notice = await bodyOf(await page.request.get(`${base}/physicsos/notice/platform-notice`))
    if (notice.notice?.enabled && notice.acknowledgedVersion !== notice.notice.version) {
      const dialog = page.locator('[data-physicsos-platform-notice]')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await dialog.getByRole('button', { name: '继续', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    const user = await bodyOf(await page.request.get(`${base}/physicsos/auth/me`))
    expect(user.user?.role).toBe('SUPER_ADMIN')
    await expect(page).toHaveTitle('PhysicsOS')
  })
  let previousSceneIds
  await stage('restored_scene_baseline', async () => {
    previousSceneIds = new Set((await scenes()).map(item => item.sceneId))
    return { scenes: previousSceneIds.size }
  })

  await stage('plugin_catalog_renders_verified_candidate_entries', async () => {
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: /管理后台/ }).click()
    const admin = page.locator('[data-physicsos-surface="admin"]')
    await expect(admin).toBeVisible()
    const state = await responseFor(
      item => pathname(item.url()) === '/physicsos/plugins/state',
      () => admin.getByRole('tab', { name: '插件', exact: true }).click(),
    )
    expect(state.pinnedHarnessVersion).toBe('0.1.7-rc.2')
    expect(new Set(state.entries.map(entry => entry.id)).size).toBe(state.entries.length)
    const custom = state.entries.filter(entry => entry.source === 'physicsos')
    expect(custom.length).toBeGreaterThan(0)
    expect(custom.every(entry => entry.integrity === 'verified' && entry.compatibility === 'compatible')).toBe(true)
    expect(state.entries.every(entry => entry.status !== 'failed')).toBe(true)
    // Agent preset trees activate separately from host inventory. The headless
    // acceptance proves the real tool call; the idle Web host proves trust.
    expect(custom.some(entry => entry.id === '@deepseek-ai/dsh-tool-physicsos')).toBe(true)
    const required = ['auth-host', 'paper-host', 'health-host', 'learning-host', 'shared-state-host',
      'model-pool-host', 'storage-postgres', 'client-ui-physicsos']
    expect(required.every(id => custom.some(entry => entry.id === `@deepseek-ai/dsh-${id}` && entry.status === 'enabled'))).toBe(true)
    await expect(admin.locator('[data-admin-plugin-center]')).toContainText('0.1.7-rc.2')
    await expect(admin.locator('tr[data-plugin-id]')).toHaveCount(state.entries.length)
    await expect(admin.getByTestId('plugin-group-physicsos')).toBeVisible()
    return { entries: state.entries.length, verifiedPhysicsos: custom.length }
  })
  await stage('model_pool_renders_existing_channels_without_requests_to_models', async () => {
    const admin = page.locator('[data-physicsos-surface="admin"]')
    const state = await responseFor(
      item => pathname(item.url()) === '/physicsos/model-pool/state',
      () => admin.getByRole('tab', { name: '模型通道', exact: true }).click(),
    )
    expect(state.encryptionReady).toBe(true)
    expect(Array.isArray(state.channels)).toBe(true)
    const keys = state.channels.flatMap(channel => channel.keys)
    await expect(admin.locator('[data-admin-model-pool]')).toBeVisible()
    await expect(admin.locator('tr[data-testid^="model-pool-key-"]')).toHaveCount(keys.length)
    return { channels: state.channels.length, keys: keys.length }
  })
  await stage('paper_workspace_loads_restored_data', async () => {
    await page.getByRole('button', { name: '出卷专区', exact: true }).click()
    const paper = page.locator('[data-physicsos-surface="paper"]')
    await expect(paper).toBeVisible()
    await expect(paper.getByRole('navigation', { name: '出卷流程', exact: true })).toBeVisible()
  })
  await stage('new_lab_scene_edit_is_persisted', async () => {
    await page.getByRole('button', { name: '物理实验室', exact: true }).click()
    const picker = page.locator('[data-physicsos-state="picker"]')
    await expect(picker).toBeVisible({ timeout: 20_000 })
    const created = await responseFor(
      response => response.request().method() === 'PUT' &&
        pathname(response.url()).startsWith('/physicsos/learning/scenes/mechanics-uniform-acceleration-'),
      () => picker.locator('button[data-template-id="uniform-acceleration"]').first().click(),
    )
    sceneId = created.item?.sceneId
    expect(typeof sceneId).toBe('string')
    expect(previousSceneIds.has(sceneId)).toBe(false)
    const lab = page.locator('[data-physicsos-surface="lab"][data-physicsos-domain="mechanics"]')
    await expect(lab).toHaveAttribute('data-scene-revision', '0')
    const mass = lab.getByRole('textbox', { name: '质量', exact: true })
    await expect(mass).toHaveValue('1')
    const edited = await responseFor(
      response => response.request().method() === 'PUT' &&
        pathname(response.url()) === `/physicsos/learning/scenes/${encodeURIComponent(sceneId)}`,
      async () => {
        await mass.fill('2')
        await mass.press('Tab')
        await expect(lab).toHaveAttribute('data-scene-revision', '1')
      },
    )
    expect(edited.item?.scene?.revision).toBe(1)
    expect(edited.item?.scene?.bodies?.[0]?.mass?.value).toBe(2)
  })
  await stage('saved_scene_survives_refresh_and_existing_scene_ids_remain', async () => {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await waitForShell()
    await page.getByRole('button', { name: '物理实验室', exact: true }).click()
    const picker = page.locator('[data-physicsos-state="picker"]')
    await expect(picker).toBeVisible({ timeout: 20_000 })
    await picker.locator('[data-physicsos-continue]').click()
    const lab = page.locator('[data-physicsos-surface="lab"][data-physicsos-domain="mechanics"]')
    await expect(lab).toHaveAttribute('data-scene-revision', '1')
    await expect(lab.getByRole('textbox', { name: '质量', exact: true })).toHaveValue('2')
    const saved = await scenes()
    const own = saved.find(item => item.sceneId === sceneId)
    expect(own?.scene?.revision).toBe(1)
    expect(own?.scene?.bodies?.[0]?.mass?.value).toBe(2)
    const after = new Set(saved.map(item => item.sceneId))
    expect([...previousSceneIds].every(id => after.has(id))).toBe(true)
    await lab.screenshot({ path: path.join(evidence, 'lab-fixture.png') })
    return { previousScenes: previousSceneIds.size, currentScenes: after.size }
  })
} catch (error) {
  // Playwright errors can contain typed values, URLs, and page content.
  check(step, false, { errorType: error?.name === 'TimeoutError' ? 'TimeoutError' : 'Error' })
} finally {
  if (authenticated && page) {
    await stage('logout_own_browser_session', async () => {
      await page.goto('about:blank')
      const response = await page.request.post(`${base}/physicsos/auth/logout`, { data: {}, headers: { origin: base } })
      expect((await bodyOf(response)).ok).toBe(true)
    }).catch(() => { check('logout_own_browser_session', false) })
  }
  await browser?.close().catch(() => {})
  for (const [label, value] of Object.entries(gate))
    check(`browser_${label}`, Array.isArray(value) ? value.length === 0 : value === 0)
  const result = { kind: 'physicsos-restored-browser-acceptance', target: base, checks, gate, sceneId }
  if (evidence) writeFileSync(path.join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 })
  const failed = checks.filter(item => !item.ok).length
  process.stdout.write(`${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`)
  if (evidence) process.stdout.write(`server evidence: ${evidence}\n`)
  process.exitCode = failed === 0 ? 0 : 1
}
