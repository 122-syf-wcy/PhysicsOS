/** Candidate-only real model generation, private-source identity and responsive paint. */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { chromium, expect } from '@playwright/test'

const base = process.env.PHYSICSOS_VISUAL_BASE ?? 'http://127.0.0.1:3098'
assert.equal(new URL(base).hostname, '127.0.0.1', 'Real generation acceptance uses isolated loopback candidate')
const diagnosticsOnly = process.argv[2] === '--diagnostics-only'
const name = diagnosticsOnly ? 'incline' : process.argv[2] ?? 'incline'
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
// Diagnostics contain only bounded identities, enums, hashes and counts. Never
// copy exported messages, tool arguments/results, prompts, source or URLs.
const diagnosticHash = value => createHash('sha256').update(value).digest('hex')
const diagnosticId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value) ? value : undefined
const diagnosticCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : undefined
const diagnosticNumber = value => Number.isSafeInteger(value) && value >= 0 && value <= 1e10 ? value : undefined
function diagnosticRef(value) {
  if (!value || !/^qcode_[a-f0-9]{32}$/.test(value.artifactId ?? '') || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')) return undefined
  return { artifactId: value.artifactId, ownerSessionId: diagnosticId(value.ownerSessionId), childSessionId: diagnosticId(value.childSessionId),
    sceneId: diagnosticId(value.sceneId), sceneRevision: diagnosticNumber(value.sceneRevision), experimentId: diagnosticId(value.experimentId),
    sceneSha256: /^[a-f0-9]{64}$/.test(value.sceneSha256 ?? '') ? value.sceneSha256 : undefined, sha256: value.sha256 }
}
function diagnosticSessions(bytes) {
  const limit = 32 * 1024 * 1024
  assert.ok(bytes.length >= 22 && bytes.length <= limit)
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0 && end + 22 <= bytes.length && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length)
  assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0)
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16)
  assert.equal(bytes.readUInt16LE(end + 8), count); assert.ok(count > 0 && count <= 2048 && start + size === end)
  let offset = start, expanded = 0
  const sessions = [], names = new Set()
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= end && bytes.readUInt32LE(offset) === 0x02014b50)
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressedSize = bytes.readUInt32LE(offset + 20), uncompressedSize = bytes.readUInt32LE(offset + 24)
    const nameSize = bytes.readUInt16LE(offset + 28), extraSize = bytes.readUInt16LE(offset + 30), commentSize = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42)
    const next = offset + 46 + nameSize + extraSize + commentSize
    assert.ok(next <= end && !(flags & 1) && bytes.readUInt16LE(offset + 34) === 0)
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8')
    assert.ok(!names.has(name) && !name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'))
    names.add(name); offset = next
    if (!/session(?:\.v\d+)?\.jsonl$/.test(name)) continue
    assert.ok([0, 8].includes(method) && local + 30 <= start && bytes.readUInt32LE(local) === 0x04034b50)
    assert.equal(bytes.readUInt16LE(local + 8), method)
    const localNameSize = bytes.readUInt16LE(local + 26), dataStart = local + 30 + localNameSize + bytes.readUInt16LE(local + 28)
    assert.ok(dataStart + compressedSize <= start && uncompressedSize <= limit - expanded)
    assert.equal(bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8'), name)
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: limit - expanded }) : compressed
    assert.equal(data.length, uncompressedSize); expanded += data.length
    const lines = data.toString('utf8').split(/\r?\n/).filter(Boolean)
    assert.ok(lines.length <= 100000 && sessions.length < 128)
    const events = lines.map(line => { assert.ok(line.length <= 4 * 1024 * 1024); return JSON.parse(line) })
    const header = events.find(event => event.type === 'session')
    const id = diagnosticId(header?.id ?? header?.sessionId)
    assert.ok(id && !sessions.some(session => session.id === id))
    sessions.push({ id, parentSessionId: diagnosticId(header.parentSession), events })
  }
  assert.equal(offset, end)
  return sessions
}
function diagnosticChild(session) {
  const requests = session.events.filter(event => event.type === 'request/header')
  const headers = requests.slice(0, 128).map(event => {
    const config = event.data?.header?.config ?? {}, effort = config.reasoningEffort
    return { maxTokens: diagnosticNumber(config.maxTokens), reasoningEffort: typeof effort === 'string' && ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort.toLowerCase()) ? effort.toLowerCase() : undefined,
      model: typeof config.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/.test(config.model) && !config.model.startsWith('sk-') ? config.model : undefined }
  })
  const end = session.events.findLast(event => event.type === 'turn/end')?.data?.reason
  const reasonKinds = ['completed', 'error', 'aborted', 'interrupted', 'max-tokens', 'cancelled', 'tool-calls']
  const assistant = session.events.filter(event => event.type === 'assistant/message')
  const usage = assistant.map(event => event.data?.usage).filter(value => diagnosticNumber(value?.inputTokens) !== undefined && diagnosticNumber(value?.outputTokens) !== undefined)
  const reasoningChars = assistant.reduce((total, event) => total + (Array.isArray(event.data?.message?.content) ? event.data.message.content : []).reduce((sum, block) => sum + (block.type === 'reasoning' && typeof block.text === 'string' ? block.text.length : 0), 0), 0)
  const results = new Map(session.events.filter(event => event.type === 'tool/result').map(event => [event.data?.message?.toolCallId, event.data?.message]))
  const calls = session.events.filter(event => event.type === 'tool/call')
  const toolCounts = Object.create(null)
  const toolCalls = calls.slice(0, 256).map(event => {
    const tool = typeof event.data?.name === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(event.data.name) ? event.data.name : 'other'
    const message = results.get(event.data?.callId), detail = { name: tool, isError: typeof message?.isError === 'boolean' ? message.isError : null, argumentsParsed: false }
    let args
    try { if (typeof event.data?.arguments === 'string' && event.data.arguments.length <= 256 * 1024) args = JSON.parse(event.data.arguments) } catch {}
    detail.argumentsParsed = args !== null && typeof args === 'object' && !Array.isArray(args)
    if (tool === 'physics_write_experiment_code') {
      detail.codePartChars = typeof args?.content === 'string' ? args.content.length : null
      detail.validCodePart = detail.argumentsParsed && ['rendererJs', 'stylesheet'].includes(args.file) && ['replace', 'append'].includes(args.mode) && typeof args.content === 'string' && args.content.length <= 6000
    }
    return detail
  })
  for (const event of calls) { const key = typeof event.data?.name === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(event.data.name) ? event.data.name : 'other'; toolCounts[key] = (toolCounts[key] ?? 0) + 1 }
  return { sessionId: session.id, parentSessionId: session.parentSessionId, headers, requestCount: requests.length, headersTruncated: requests.length > headers.length,
    terminalReason: end ? { kind: reasonKinds.includes(end.kind) ? end.kind : 'other', code: diagnosticCode(end.error?.code) } : null,
    usageRecords: usage.length, inputTokens: usage.length ? usage.reduce((sum, item) => sum + item.inputTokens, 0) : null, outputTokens: usage.length ? usage.reduce((sum, item) => sum + item.outputTokens, 0) : null,
    reasoningChars, reasoningCountSource: 'durable-assistant-messages', toolCounts, toolCalls, toolCallsTruncated: calls.length > toolCalls.length }
}
async function ownedDiagnostics(api, sessionId) {
  const response = await api.get(base + '/api/session.export?sessionId=' + encodeURIComponent(sessionId) + '&includeDescendants=true', { timeout: 30000 })
  assert.equal(response.status(), 200); assert.match(response.headers()['content-type'] ?? '', /application\/zip/)
  const length = Number(response.headers()['content-length'])
  if (Number.isFinite(length)) assert.ok(length <= 32 * 1024 * 1024)
  const sessions = diagnosticSessions(await response.body()), parent = sessions.find(session => session.id === sessionId)
  assert.ok(parent)
  const owned = new Set([sessionId])
  for (let index = 0; index < sessions.length; index++) for (const session of sessions) if (owned.has(session.parentSessionId)) owned.add(session.id)
  const visualization = parent.events.filter(event => event.type === 'physics/scene').at(-1)?.data?.visualization
  const parentVisualization = visualization ? { status: ['ready', 'generating', 'failed'].includes(visualization.status) ? visualization.status : 'other', code: diagnosticCode(visualization.code ?? visualization.error?.code), ref: diagnosticRef(visualization) } : null
  const diagnostics = { passed: true, parentVisualization, children: sessions.filter(session => session.id !== sessionId && owned.has(session.id)).map(diagnosticChild) }
  if (parentVisualization?.status === 'ready' && parentVisualization.ref) {
    const ref = parentVisualization.ref
    try {
      const sourceResponse = await api.get(base + '/physicsos/question-code/artifacts/' + ref.artifactId + '/source?sha256=' + ref.sha256, { timeout: 30000 })
      assert.equal(sourceResponse.status(), 200)
      const body = await sourceResponse.body(); assert.ok(body.length <= 256 * 1024)
      const source = JSON.parse(body.toString('utf8'))
      assert.deepEqual(diagnosticRef(source.ref), ref)
      assert.equal(typeof source.source?.rendererJs, 'string'); assert.equal(typeof source.source.stylesheet, 'string')
      diagnostics.source = { passed: true, rendererJsChars: source.source.rendererJs.length, rendererJsSha256: diagnosticHash(source.source.rendererJs), stylesheetChars: source.source.stylesheet.length, stylesheetSha256: diagnosticHash(source.source.stylesheet) }
    } catch { diagnostics.source = { passed: false, code: 'OWNED_SOURCE_DIAGNOSTIC_UNAVAILABLE' } }
  }
  return diagnostics
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
  if (diagnosticsOnly) {
    sessionId = diagnosticId(process.env.PHYSICSOS_VISUAL_DIAGNOSTIC_SESSION_ID)
    assert.ok(sessionId, 'An existing owned session is required for diagnostics-only mode')
    report.phase = 'diagnostics-only'; report.diagnosticsOnly = true; report.realGenerationAttempted = false
  } else {
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
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/session/prompt') return
    try { sessionId = diagnosticId(request.postDataJSON()?.payload?.args?.request?.sessionId) ?? sessionId } catch {}
  })
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
  }
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
  if (sessionId) {
    try { report.ownedDiagnostics = await ownedDiagnostics(context.request, sessionId) }
    catch { report.ownedDiagnostics = { passed: false, code: 'OWNED_EXPORT_DIAGNOSTIC_UNAVAILABLE' } }
  }
  if (diagnosticsOnly && report.ownedDiagnostics?.passed) console.log('PASS read-only owned export diagnostics; no generation attempted')
  if (diagnosticsOnly && !report.ownedDiagnostics?.passed) process.exitCode = 1
  report.finishedAt = new Date().toISOString()
  await writeFile(output + '/result.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  await context.close(); await browser.close()
}
