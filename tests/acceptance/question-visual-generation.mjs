/** Candidate-only real model generation, private-source identity and responsive paint. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'

const base = process.env.PHYSICSOS_VISUAL_BASE ?? 'http://127.0.0.1:3098'
assert.equal(new URL(base).hostname, '127.0.0.1', 'Real generation acceptance uses isolated loopback candidate')
const name = process.argv[2] ?? 'incline'
const prompts = {
  incline: '请用 physics_create_experiment 创建 incline 斜面实验，标题为“斜面上的受力与运动”。保留模板的真实物理条件，调用 physics_generate_experiment 生成可视化：完整显示斜面、物块、重力、支持力和摩擦力箭头，中文标注，装置占画面主体。这是当前场景演示，不是整道复合场题的解答。',
  lens: '请用 physics_create_experiment 创建 convex-lens 实验，标题为“凸透镜成像观察”。保留模板的真实条件，调用 physics_generate_experiment 生成完整光具座、物体、透镜、光屏与引擎光线的清晰可视化，中文标注，适配手机。',
  projectile: '请调用 physics_solve_question 解题并自动生成本题可视化：物体从地面以20 m/s竖直向上抛出，g=9.8 m/s²，求最大高度、飞行时间和射程。只使用引擎结果。',
}
assert.ok(prompts[name], 'Unknown candidate case')
const output = process.env.PHYSICSOS_VISUAL_OUTPUT ?? `/tmp/physicsos-question-visual-${name}`
await mkdir(output, { recursive: true, mode: 0o700 })
const secrets = []
function safe(error) {
  let value = String(error?.message ?? error)
  for (const secret of secrets) value = value.replaceAll(secret, '[redacted]')
  return value.replace(/https?:\/\/[^\s"'<>]+/g, raw => { try { const u = new URL(raw); return u.origin + u.pathname.replace(/\/question\/[^/]+/, '/question/[private]') } catch { return '[url]' } }).slice(0, 2400)
}
async function privateText(path) {
  const info = await stat(path); assert.equal(info.mode & 0o077, 0)
  const text = (await readFile(path, 'utf8')).trim(); secrets.push(text); return text
}
const password = await privateText(process.env.PHYSICSOS_VISUAL_PASSWORD_FILE)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-http2'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const report = { name, base, passed: false, errors: [], sessionCreates: [], phase: 'login', startedAt: new Date().toISOString() }
let sessionId, page
try {
  const login = await context.request.post(base + '/physicsos/auth/login', { data: { username: process.env.PHYSICSOS_VISUAL_USERNAME ?? 'chat-review-20261104', schoolId: 'PHYSICSOS-OPEN', password }, headers: { origin: base } })
  assert.equal(login.status(), 200)
  const shell = await context.request.get(base + '/')
  if (shell.status() !== 200) {
    const launch = JSON.parse(await privateText(process.env.PHYSICSOS_VISUAL_LAUNCH_FILE))
    const url = new URL(launch.authUrl); secrets.push(url.searchParams.get('token') ?? '')
    assert.equal((await context.request.get(base + url.pathname + url.search)).status(), 200)
  }
  await context.addInitScript(() => {
    window.__visualSnapshots = []
    const Native = MessageChannel
    window.MessageChannel = class extends Native {
      constructor() { super(); const send = this.port1.postMessage.bind(this.port1); this.port1.postMessage = (message, ...rest) => {
        if (message?.type === 'experiment/snapshot') { window.__visualSnapshots.push(message.snapshot); if (window.__visualSnapshots.length > 30) window.__visualSnapshots.shift() }
        return send(message, ...rest)
      } }
    }
  })
  page = await context.newPage()
  page.on('pageerror', error => report.errors.push(safe(error)))
  page.on('response', async response => {
    if (new URL(response.url()).pathname === '/api/session/create') {
      try {
        const result = (await response.json()).result
        report.sessionCreates.push({ status: response.status(), ok: result?.ok, errorCode: result?.error?.code })
        if (result?.value?.sessionId) sessionId = result.value.sessionId
      } catch {}
    }
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const noticeState = await context.request.get(base + '/physicsos/notice/platform-notice')
  const notice = await noticeState.json()
  if (notice.notice?.enabled && notice.acknowledgedVersion !== notice.notice.version) {
    await page.locator('[data-physicsos-platform-notice]').getByRole('button', { name: '继续', exact: true }).click()
  }
  report.phase = 'new-session'
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  const input = page.locator('[data-composer-input]').first()
  await expect(input).toBeVisible({ timeout: 30000 })
  // Blank-session reuse can replace a stale session after a candidate restart.
  // A visible composer remains disabled while that asynchronous navigation settles.
  await expect(input).toHaveAttribute('contenteditable', 'true', { timeout: 30000 }).catch(() => {})
  if (await input.getAttribute('contenteditable') !== 'true') {
    report.phase = 'workspace'
    await page.getByRole('button', { name: '选择工作区', exact: true }).click()
    const panel = page.locator('[data-physicsos-workspace-panel]')
    await expect(panel).toBeVisible({ timeout: 30000 })
    if (await panel.getByRole('button', { name: '打开', exact: true }).count()) await panel.getByRole('button', { name: '打开', exact: true }).first().click()
    else {
      if (!await panel.getByLabel('工作区名称', { exact: true }).count()) await panel.getByRole('button', { name: '新建工作区', exact: true }).click()
      await panel.getByLabel('工作区名称', { exact: true }).fill('可视化修复验收')
      await panel.getByRole('button', { name: '创建并进入', exact: true }).click()
    }
    await expect(panel).toBeHidden({ timeout: 30000 })
  }
  report.phase = 'composer'
  await expect(input).toHaveAttribute('contenteditable', 'true', { timeout: 30000 })
  await input.fill(prompts[name])
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  report.phase = 'generation'
  console.log(`Started real ${name} generation`)
  const card = page.locator('[data-code-experiment-shell]').last()
  const status = card.locator('[data-question-code-status]')
  await expect.poll(async () => await status.count() ? status.getAttribute('data-question-code-status') : 'pending', { timeout: 780000, intervals: [1000, 3000, 5000] }).toMatch(/^(ready|failed|interrupted|render-failed)$/)
  report.status = await status.getAttribute('data-question-code-status')
  if (report.status !== 'ready') {
    report.failureText = safe(await status.innerText()); throw new Error(`Generation ended ${report.status}`)
  }
  report.phase = 'paint'
  const frame = card.frameLocator('iframe').frameLocator('iframe')
  const latest = () => page.evaluate(() => window.__visualSnapshots.at(-1))
  const first = await latest(); assert.equal(first.source, 'platform-engine'); report.domain = first.domain; report.experimentId = first.experimentId
  if (name !== 'projectile') await expect(card.locator('[data-question-scope="scene"]')).toBeVisible()
  const canvas = frame.locator('#canvas')
  const paint = async () => {
    const picture = await canvas.screenshot()
    const info = await frame.locator('body').evaluate(body => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      canvases: body.querySelectorAll('canvas').length, svgPrimitives: body.querySelectorAll('svg path,svg circle,svg line,svg rect,svg polygon').length,
      bounds: Array.from(body.querySelectorAll('canvas,svg')).map(el => { const b = el.getBoundingClientRect(); return { width: b.width, height: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom } }) }))
    assert.ok(info.canvases || info.svgPrimitives > 3); assert.equal(info.overflow, false)
    for (const box of info.bounds) { assert.ok(box.width > 0 && box.height > 0); assert.ok(box.left >= -1 && box.right <= info.width + 1 && box.top >= -1 && box.bottom <= info.height + 1) }
    return { ...info, sha256: createHash('sha256').update(picture).digest('hex') }
  }
  report.desktop = await paint(); await card.screenshot({ path: output + '/desktop.png' })
  if (first.clock.total > 0) {
    report.phase = 'timeline'
    const seek = card.getByRole('slider', { name: '时间轴', exact: true })
    const time = first.clock.total * 0.4
    await seek.evaluate((el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value)); el.dispatchEvent(new Event('input', { bubbles: true })) }, time)
    await expect.poll(async () => (await latest()).clock.time).toBeCloseTo(time, 2)
    await expect.poll(async () => (await paint()).sha256).not.toBe(report.desktop.sha256)
    report.evolved = await paint()
  }
  report.phase = 'mobile'
  await page.setViewportSize({ width: 390, height: 844 }); await expect(status).toHaveAttribute('data-question-code-status', 'ready')
  report.mobile = await paint(); await card.screenshot({ path: output + '/mobile.png' })
  report.sessionId = sessionId; report.passed = report.errors.length === 0
  assert.equal(report.passed, true)
  console.log(`PASS real ${name}: engine frame, authored paint, desktop/mobile, applicable timeline`)
} catch (error) {
  if (page && !page.isClosed()) {
    try {
      report.uiState = await page.evaluate(() => ({
        composers: Array.from(document.querySelectorAll('[data-composer-input]')).map(el => ({ editable: el.getAttribute('contenteditable'), visible: el.getBoundingClientRect().width > 0 })),
        workspacePanel: !!document.querySelector('[data-physicsos-workspace-panel]'),
        statuses: Array.from(document.querySelectorAll('[data-question-code-status]')).map(el => el.getAttribute('data-question-code-status')),
      }))
      await page.screenshot({ path: output + '/failure.png', fullPage: true, timeout: 10000 })
    } catch (diagnosticError) { report.diagnosticError = safe(diagnosticError) }
  }
  report.error = safe(error); report.sessionId = sessionId; console.log(`FAIL ${name}: ${report.error}`); process.exitCode = 1
} finally {
  report.finishedAt = new Date().toISOString()
  await writeFile(output + '/result.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  await context.close(); await browser.close()
}
