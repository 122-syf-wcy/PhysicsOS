#!/usr/bin/env node
/**
 * Actual authenticated Web → physics tool → restricted child → private V3 code → chat UI.
 * Run against freshly built candidate artifacts in the designated server Docker container:
 *   PHYSICSOS_CHAT_CODE_SERVER_DOCKER=1 node tests/acceptance/chat-code-experiment.mjs
 * Default mode uses a scripted model and an isolated home. --real-smoke uses
 * the configured model and an owned account through private launch/password files.
 */
import { chromium, expect, request } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants as zlibConstants, inflateRawSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { startChatCodeWeb } from '../agent/chat-code-web-bootstrap.mjs'
import { CHAT_CODE_QUESTION, CHAT_CODE_MARKER, CHAT_CODE_SOURCE } from '../agent/chat-code-mock-llm.mjs'
import { loginUser, waitForShell } from './support.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const inspectArtifact = process.argv.includes('--inspect-artifact')
const realSmoke = process.argv.includes('--real-smoke') || inspectArtifact
const styleReplay = process.argv.includes('--style-replay')
const smokeLabel = (process.env.PHYSICSOS_CHAT_CODE_SMOKE_LABEL ?? 'candidate-real').replace(/[^a-zA-Z0-9_-]/g, '')
const shots = join(root, 'docs/reports/screenshots/chat-code-experiment', ...(realSmoke || styleReplay || process.env.PHYSICSOS_CHAT_CODE_SMOKE_LABEL ? [smokeLabel] : []))
await mkdir(shots, { recursive: true })
const checks = []
const privateLoads = []
const check = (label, evidence) => { checks.push({ label, passed: true, ...(evidence === undefined ? {} : { evidence }) }); console.log('PASS ' + label) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
const cleanUrl = value => {
  try { const url = new URL(value); return url.origin + url.pathname.replace(/(\/question\/)[^/]+/, '$1[capability]').replace(/(\/embed\/question\/)[^/]+/, '$1[capability]') }
  catch { return String(value).replace(/([?&]token=)[^\s]+/g, '$1[redacted]') }
}
const cleanError = value => String(value).replace(/https?:\/\/[^\s"')]+/g, cleanUrl)

async function logs(home) {
  const files = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (/^session(?:\.v\d+)?\.jsonl\.zstd$/.test(entry.name)) files.push(path)
    }
  }
  await walk(join(home, 'sessions'))
  const sessions = []
  for (const path of files) {
    const buffer = await readFile(path), magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), starts = []
    for (let offset = buffer.indexOf(magic); offset >= 0; offset = buffer.indexOf(magic, offset + 4)) starts.push(offset)
    const text = starts.map((offset, index) => zstdDecompressSync(buffer.subarray(offset, starts[index + 1] ?? buffer.length)).toString('utf8')).join('')
    const events = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    const header = events.find(event => event.type === 'session')
    sessions.push({ path, events, header, modified: (await stat(path)).mtimeMs })
  }
  return sessions.sort((a, b) => b.modified - a.modified)
}
async function sessionLog(home, sessionId) {
  const all = await logs(home)
  const selected = all.filter(log => log.header?.id === sessionId || log.header?.sessionId === sessionId || log.path.includes('/' + sessionId + '/'))
  if (!selected.length) throw new Error('No durable session log for ' + sessionId)
  return selected[0]
}
async function rewriteSession(log, transform) {
  for (const event of log.events) transform(event)
  const replacement = log.path + '.acceptance'
  const compression = { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } }
  await writeFile(replacement, Buffer.concat([
    zstdCompressSync(Buffer.from(JSON.stringify(log.events[0]) + '\n'), compression),
    zstdCompressSync(Buffer.from(log.events.slice(1).map(event => JSON.stringify(event)).join('\n') + '\n'), compression),
  ]), { mode: 0o600 })
  await rename(replacement, log.path)
}
const sceneEvents = log => log.events.filter(event => event.type === 'physics/scene')
const finalScene = log => sceneEvents(log).at(-1)?.data
const toolText = event => (event?.data?.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')

async function secureText(file) {
  const info = await stat(file)
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Smoke credentials/launch metadata must be private regular files')
  return readFile(file, 'utf8')
}
async function ownedExport(sessionId) {
  const response = await context.request.get(fixture.base + '/api/session.export?sessionId=' + encodeURIComponent(sessionId) + '&includeDescendants=true')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/zip')
  const bytes = await response.body()
  expect(bytes.length).toBeLessThan(32 * 1024 * 1024)
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('Owned export has no ZIP directory')
  let offset = bytes.readUInt32LE(end + 16)
  const sessions = []
  for (let count = 0; count < bytes.readUInt16LE(end + 10); count++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Owned export ZIP directory is invalid')
    const method = bytes.readUInt16LE(offset + 10), compressedSize = bytes.readUInt32LE(offset + 20)
    const nameSize = bytes.readUInt16LE(offset + 28), extraSize = bytes.readUInt16LE(offset + 30), commentSize = bytes.readUInt16LE(offset + 32)
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8')
    const local = bytes.readUInt32LE(offset + 42)
    if (/session(?:\.v\d+)?\.jsonl$/.test(name)) {
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
      const compressed = bytes.subarray(start, start + compressedSize)
      if (![0, 8].includes(method)) throw new Error('Owned export ZIP compression is unsupported')
      const text = (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8')
      const events = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
      sessions.push({ header: events.find(event => event.type === 'session'), events })
    }
    offset += 46 + nameSize + extraSize + commentSize
  }
  return sessions
}
const fixture = realSmoke ? await (async () => {
  if (process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER !== '1') throw new Error('Real smoke runs only in designated server Docker')
  const launch = JSON.parse(await secureText(process.env.PHYSICSOS_CHAT_CODE_LAUNCH_FILE))
  const original = new URL(launch.authUrl)
  const base = new URL(process.env.PHYSICSOS_CHAT_CODE_BASE ?? launch.base).origin
  const authUrl = new URL(original.pathname + original.search + original.hash, base).href
  return { base, authUrl, stop: async () => {} }
})() : await startChatCodeWeb({ port: Number(process.env.PHYSICSOS_CHAT_CODE_PORT ?? 3097), home: process.env.PHYSICSOS_CHAT_CODE_HOME, keep: process.env.PHYSICSOS_CHAT_CODE_KEEP === '1', ...(styleReplay ? { sourceOverride: JSON.parse(await secureText(process.env.PHYSICSOS_CHAT_CODE_REPLAY_SOURCE_FILE)) } : {}) })
if (inspectArtifact) {
  const api = await request.newContext()
  try {
    const artifactId = process.env.PHYSICSOS_CHAT_CODE_ARTIFACT_ID
    expect(artifactId).toMatch(/^qcode_[a-f0-9]{32}$/)
    expect((await api.get(fixture.authUrl)).ok()).toBe(true)
    expect((await api.post(fixture.base + '/physicsos/auth/login', { data: {
      username: process.env.PHYSICSOS_CHAT_CODE_USERNAME,
      password: (await secureText(process.env.PHYSICSOS_CHAT_CODE_PASSWORD_FILE)).trim(),
    } })).ok()).toBe(true)
    const endpoint = fixture.base + '/physicsos/question-code/artifacts/' + artifactId
    const sourceResponse = await api.get(endpoint + '/source')
    expect(sourceResponse.ok()).toBe(true)
    const source = await sourceResponse.json()
    expect(source.ref.artifactId).toBe(artifactId)
    expect(source.ref.rendererKind).toBe('independent')
    if (process.env.PHYSICSOS_CHAT_CODE_OWNER_SESSION_ID) expect(source.ref.ownerSessionId).toBe(process.env.PHYSICSOS_CHAT_CODE_OWNER_SESSION_ID)
    if (process.env.PHYSICSOS_CHAT_CODE_CHILD_SESSION_ID) expect(source.ref.childSessionId).toBe(process.env.PHYSICSOS_CHAT_CODE_CHILD_SESSION_ID)
    if (process.env.PHYSICSOS_CHAT_CODE_REF_SHA256) expect(source.ref.sha256).toBe(process.env.PHYSICSOS_CHAT_CODE_REF_SHA256)
    if (process.env.PHYSICSOS_CHAT_CODE_REPLAY_SOURCE_FILE) expect(source.source).toEqual(JSON.parse(await secureText(process.env.PHYSICSOS_CHAT_CODE_REPLAY_SOURCE_FILE)))
    const snapshot = { ref: source.ref, rendererSha256: hash(source.source.rendererJs), stylesheetSha256: hash(source.source.stylesheet) }
    if (process.env.PHYSICSOS_CHAT_CODE_EXPECTED_FILE) {
      const previous = JSON.parse(await readFile(process.env.PHYSICSOS_CHAT_CODE_EXPECTED_FILE, 'utf8'))
      expect(snapshot).toEqual(previous.snapshot)
    }
    const previewResponse = await api.get(endpoint + '/preview?sha256=' + source.ref.sha256)
    expect(previewResponse.ok()).toBe(true)
    const preview = await previewResponse.json()
    expect(preview.expiresAt).toBeGreaterThan(Date.now())
    const wrapper = await api.get(new URL(preview.entryUrl, fixture.base).href)
    expect(wrapper.ok()).toBe(true)
    expect(wrapper.headers()['content-security-policy']).toContain('sandbox allow-scripts allow-same-origin')
    const rawEntry = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), fixture.base)
    const blobHashes = {}
    for (const [name, path] of [['renderer', 'runtime/renderer.js'], ['stylesheet', 'assets/experiment.css'], ['bootstrap', 'runtime/main.js'], ['viewportStylesheet', 'assets/platform-base.css']]) {
      const response = await api.get(new URL(path, rawEntry).href)
      expect(response.ok()).toBe(true)
      blobHashes[name] = hash(await response.body())
    }
    expect(blobHashes.renderer).toBe(snapshot.rendererSha256)
    expect(blobHashes.stylesheet).toBe(snapshot.stylesheetSha256)
    const generatedPaths = [...new Set((source.source.rendererJs + '\n' + source.source.stylesheet).match(/(?:\.\/)?(?:assets\/)?generated\/[a-f0-9]+\.png/g) ?? [])]
    for (const path of generatedPaths) {
      const normalized = './assets/' + path.replace(/^\.\//, '').replace(/^assets\//, '')
      const response = await api.get(new URL(normalized, rawEntry).href)
      expect(response.ok()).toBe(true)
      blobHashes[normalized] = hash(await response.body())
    }
    const guest = await request.newContext()
    try {
      expect((await guest.get(endpoint + '/source')).status()).toBe(401)
      expect((await guest.get(endpoint + '/preview')).status()).toBe(401)
    } finally { await guest.dispose() }
    expect((await api.get(endpoint + '/source?sha256=' + '0'.repeat(64))).status()).toBe(409)
    if (process.env.PHYSICSOS_CHAT_CODE_EXPECTED_FILE) {
      const previous = JSON.parse(await readFile(process.env.PHYSICSOS_CHAT_CODE_EXPECTED_FILE, 'utf8'))
      if (previous.blobHashes) expect(blobHashes).toEqual(previous.blobHashes)
    }
    const result = { passed: true, readOnly: true, snapshot, blobHashes, exactRawChildSource: Boolean(process.env.PHYSICSOS_CHAT_CODE_REPLAY_SOURCE_FILE), guestRejected: true, staleHashRejected: true, signedPreviewRenewed: true, wrapperStatus: wrapper.status(), persistenceCompared: Boolean(process.env.PHYSICSOS_CHAT_CODE_EXPECTED_FILE) }
    await writeFile(join(shots, 'artifact-inspection.json'), JSON.stringify(result, null, 2))
    console.log('PASS read-only owned artifact source/integrity/preview' + (result.persistenceCompared ? ' after real candidate restart' : ' baseline'))
  } catch (error) {
    await writeFile(join(shots, 'artifact-inspection.json'), JSON.stringify({ passed: false, readOnly: true, error: cleanError(error.stack ?? error.message) }, null, 2))
    throw new Error(cleanError(error.stack ?? error.message))
  } finally { await api.dispose() }
  process.exit(0)
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-http2'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const errors = []
const expectedClientAborts = []
const privateFrameAborts = []
const loadedPrivateFrames = new Set()
const isPrivateFrameDocument = url => /^\/physicsos\/experiment-assets\/embed\/question\/[^/]+\/dist\/index\.html$/.test(new URL(url).pathname)
const checkBrowserErrors = async () => {
  for (const abort of privateFrameAborts) {
    expect(loadedPrivateFrames.has(abort.path)).toBe(true)
    expectedClientAborts.push({ ...abort, reason: 'private iframe navigation canceled; same resource loaded and final authored frames painted' })
  }
  privateFrameAborts.length = 0
  expect(errors).toEqual([])
}
let authenticated = false, navigating = false
let lastPromptSessionId
let lastCreatedSessionId
const sessionTitles = new Map()
context.on('page', page => {
  page.on('request', request => {
    if (/^\/physicsos\/question-code\/artifacts\//.test(new URL(request.url()).pathname)) privateLoads.push(cleanUrl(request.url()))
    if (new URL(request.url()).pathname !== '/api/session/prompt') return
    const message = request.postDataJSON()
    lastPromptSessionId = message?.payload?.args?.request?.sessionId
  })
  page.on('pageerror', error => errors.push({ kind: 'pageerror', error: cleanError(error.message) }))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text(), url = message.location().url
    if (!authenticated && (/401|403/.test(text) || /unauthorized|forbidden/i.test(text)) && (/\/physicsos\/auth\/me|\/api\//.test(url + text))) return
    errors.push({ kind: 'console', error: cleanError(text) })
  })
  page.on('requestfailed', request => {
    if (navigating && request.failure()?.errorText === 'net::ERR_ABORTED') return
    if (request.method() === 'GET' && request.failure()?.errorText === 'net::ERR_ABORTED'
      && /^\/physicsos\/question-code\/artifacts\/qcode_[a-f0-9]{32}\/(preview|source)$/.test(new URL(request.url()).pathname)) {
      expectedClientAborts.push({ path: cleanUrl(request.url()), reason: 'private loader AbortController cleanup' })
      return
    }
    if (request.method() === 'GET' && request.isNavigationRequest() && request.failure()?.errorText === 'net::ERR_ABORTED' && isPrivateFrameDocument(request.url())) {
      privateFrameAborts.push({ path: cleanUrl(request.url()), kind: 'navigation-abort', error: request.failure().errorText })
      return
    }
    if (!authenticated && /\/api\/events/.test(request.url())) return
    errors.push({ kind: 'requestfailed', path: cleanUrl(request.url()), error: request.failure()?.errorText })
  })
  page.on('response', response => {
    if (response.ok() && response.request().isNavigationRequest() && isPrivateFrameDocument(response.url())) loadedPrivateFrames.add(cleanUrl(response.url()))
    if (new URL(response.url()).pathname === '/api/session/create' && response.ok()) {
      void response.json().then(message => { lastCreatedSessionId = message?.result?.value?.sessionId }).catch(error => { errors.push({ kind: 'session-create-response', error: cleanError(error.message) }) })
    }
    if (response.status() < 400) return
    if (!authenticated && [401, 403].includes(response.status()) && /\/physicsos\/auth\/me|\/api\//.test(response.url())) return
    errors.push({ kind: 'response', path: cleanUrl(response.url()), status: response.status() })
  })
})
await context.addInitScript(() => {
  window.__chatCodeSnapshots = []
  window.__chatCodeReplies = []
  window.__chatCodeDrawStats = { calls: {}, lastArcs: [], geometry: [] }
  for (const method of ['clearRect', 'fillRect', 'stroke', 'fill', 'arc', 'ellipse', 'fillText', 'lineTo', 'moveTo', 'rect', 'bezierCurveTo', 'quadraticCurveTo', 'strokeRect', 'drawImage']) {
    const native = CanvasRenderingContext2D.prototype[method]
    CanvasRenderingContext2D.prototype[method] = function (...args) {
      const stats = window.__chatCodeDrawStats
      stats.calls[method] = (stats.calls[method] ?? 0) + 1
      const matrix = this.getTransform()
      const background = method === 'fillRect' && args[0] === 0 && args[1] === 0 && Math.abs(args[2] * matrix.a) >= this.canvas.width - 2 && Math.abs(args[3] * matrix.d) >= this.canvas.height - 2
      if (method === 'clearRect' || background) { stats.lastArcs = []; stats.geometry = [] }
      if (!background && ['arc', 'ellipse', 'lineTo', 'moveTo', 'rect', 'bezierCurveTo', 'quadraticCurveTo', 'fillRect', 'strokeRect', 'drawImage'].includes(method)) {
        stats.geometry.push({ method, coordinates: args.map(value => typeof value === 'number' ? Number(value.toFixed(8)) : typeof value === 'object' ? { type: value?.constructor?.name, width: value?.width, height: value?.height } : value), matrix: ['a', 'b', 'c', 'd', 'e', 'f'].map(key => Number(matrix[key].toFixed(8))), canvasId: this.canvas.id })
        if (stats.geometry.length > 20000) stats.geometry.splice(0, stats.geometry.length - 20000)
      }
      if (method === 'arc') stats.lastArcs.push({ x: args[0], y: args[1], radius: args[2], canvasId: this.canvas.id })
      return native.apply(this, args)
    }
  }
  const Native = window.MessageChannel
  window.MessageChannel = class extends Native {
    constructor() {
      super()
      const post = this.port1.postMessage.bind(this.port1)
      this.port1.postMessage = (data, ...rest) => {
        if (data?.type === 'experiment/snapshot') window.__chatCodeSnapshots.push(data.snapshot)
        return post(data, ...rest)
      }
      this.port1.addEventListener('message', event => {
        if (event.data?.type?.startsWith('experiment/')) window.__chatCodeReplies.push({ type: event.data.type, protocolVersion: event.data.protocolVersion, revision: event.data.revision, code: event.data.code })
      })
    }
  }
})
const page = await context.newPage()
const go = async url => { navigating = true; try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }) } finally { navigating = false } }
const shot = async name => {
  const target = name.includes('source') ? card().locator('pre').first() : card().locator('[data-question-code-status]').first()
  if (await target.count() > 0 && await target.isVisible()) await target.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, name + '.png'), fullPage: false, animations: 'disabled', timeout: 30000 })
}
const dismissNotice = async () => {
  const response = await context.request.get(fixture.base + '/physicsos/notice/platform-notice')
  expect(response.ok()).toBe(true)
  const data = await response.json()
  if (data.notice?.enabled && data.acknowledgedVersion !== data.notice.version) {
    const notice = page.locator('[data-physicsos-platform-notice]')
    await expect(notice).toBeVisible({ timeout: 30000 })
    await notice.getByRole('button', { name: '继续', exact: true }).click()
    await expect(notice).toBeHidden()
  }
}
const registerOwnedStudent = async () => {
  const username = 'chat_code_owner_' + Date.now().toString(36)
  const gate = page.locator('[data-physicsos-auth-gate]')
  await expect(gate).toBeVisible({ timeout: 30000 })
  await page.locator('[data-physicsos-auth-view="login"]').getByRole('button', { name: '立即注册' }).click()
  const form = page.locator('[data-physicsos-auth-view="register"]')
  await form.locator('input[autocomplete="organization"]').fill('PhysicsOS 开放学校')
  await form.locator('[data-school-id="PHYSICSOS-OPEN"]').click({ timeout: 15000 })
  await form.locator('input[autocomplete="username"]').fill(username)
  await form.locator('input[autocomplete="name"]').fill('题目代码验收学生')
  await form.locator('input[type="email"]').fill(username + '@example.invalid')
  await form.locator('input[type="password"]').nth(0).fill('accept-pw-2026')
  await form.locator('input[type="password"]').nth(1).fill('accept-pw-2026')
  await form.locator('input[type="checkbox"]').check()
  await form.getByRole('button', { name: '创建 PhysicsOS 账号', exact: true }).click()
  await expect(gate).toBeHidden({ timeout: 30000 })
  await waitForShell(page)
}
const newChat = async ({ createWorkspace = false } = {}) => {
  lastCreatedSessionId = undefined
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  const input = page.locator('[data-composer-input]').first()
  await expect(input).toBeVisible({ timeout: 30000 })
  if (await input.getAttribute('contenteditable') !== 'true') {
    await input.click()
    const panel = page.locator('[data-physicsos-workspace-panel]')
    await expect(panel).toBeVisible({ timeout: 15000 })
    if (createWorkspace || await panel.getByRole('button', { name: '打开', exact: true }).count() === 0) {
      if (await panel.getByLabel('工作区名称', { exact: true }).count() === 0) await panel.getByRole('button', { name: '新建工作区', exact: true }).click()
      await panel.getByLabel('工作区名称', { exact: true }).fill('本题代码实验验收')
      await panel.getByRole('button', { name: '创建并进入', exact: true }).click()
    } else {
      await panel.getByRole('button', { name: '打开', exact: true }).first().click()
    }
    await expect(panel).toBeHidden({ timeout: 30000 })
  }
  await expect.poll(() => typeof lastCreatedSessionId, { timeout: 30000 }).toBe('string')
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('dsh.sessions.current') ?? '{}').sessionId === id, lastCreatedSessionId, { timeout: 30000 })
  await expect(input).toHaveAttribute('contenteditable', 'true', { timeout: 30000 })
  await expect(input).toHaveText('')
}
const send = async text => {
  lastPromptSessionId = undefined
  const input = page.locator('[data-composer-input]').first()
  await input.fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect.poll(() => typeof lastPromptSessionId, { timeout: 30000 }).toBe('string')
  expect(lastPromptSessionId).toBe(lastCreatedSessionId)
  return lastPromptSessionId
}
const card = () => page.locator('[data-code-experiment-shell]').last()
const codeReady = async () => {
  const statusOf = async () => {
    const holder = card().locator('[data-question-code-status]')
    return await holder.count() ? await holder.getAttribute('data-question-code-status') : 'pending'
  }
  const terminal = /^(ready|failed|interrupted|render-failed|stale|owner-mismatch|upgrade-required)$/
  const painted = async () => {
    const state = await statusOf()
    if (state !== 'ready' && terminal.test(state)) return state
    const frame = card().locator('[data-community-status]')
    return await frame.count() ? (await frame.getAttribute('data-community-status')) === 'failed' ? 'render-failed' : await frame.getAttribute('data-community-status') : 'loading'
  }
  await expect.poll(painted, { timeout: realSmoke ? 780000 : 180000 }).toMatch(terminal)
  expect(await painted()).toBe('ready')
  const frame = card().frameLocator('iframe').frameLocator('iframe')
  if (!realSmoke && !styleReplay) {
    await expect(frame.locator('#question-authored-marker')).toContainText(CHAT_CODE_MARKER, { timeout: 60000 })
    await expect(frame.locator('#question-independent-canvas')).toBeVisible()
    await expect(frame.locator('svg')).toHaveCount(0)
  }
  return frame
}
const latestSnapshot = () => page.evaluate(() => window.__chatCodeSnapshots.at(-1))
const seekPlatform = async time => {
  const timeline = card().getByRole('slider', { name: '时间轴', exact: true })
  await timeline.evaluate((node, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, String(value))
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, time)
  await expect.poll(async () => (await latestSnapshot())?.clock.time, { timeout: 15000 }).toBeCloseTo(time, 2)
}
const authoredPaint = async frame => frame.locator('body').evaluate(body => {
  const canvas = Array.from(body.querySelectorAll('canvas')).map(element => {
    const rect = element.getBoundingClientRect(), ctx = element.getContext('2d')
    let pixelHash = 2166136261, opaquePixels = 0, colors = new Set()
    if (ctx && element.width && element.height) {
      const data = ctx.getImageData(0, 0, element.width, element.height).data
      for (let y = 0; y < element.height; y += Math.max(1, Math.floor(element.height / 64))) {
        for (let x = 0; x < element.width; x += Math.max(1, Math.floor(element.width / 96))) {
          const offset = (y * element.width + x) * 4
          for (let channel = 0; channel < 4; channel++) { pixelHash ^= data[offset + channel]; pixelHash = Math.imul(pixelHash, 16777619) >>> 0 }
          if (data[offset + 3]) opaquePixels++
          colors.add([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]].join(','))
        }
      }
    }
    return { id: element.id, width: element.width, height: element.height, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, pixelHash: pixelHash.toString(16), opaquePixels, distinctColors: colors.size,
      bodyY: element.getAttribute('data-body-y'), clockTime: element.getAttribute('data-clock-time') }
  })
  const svg = Array.from(body.querySelectorAll('svg')).map(element => ({ markup: element.outerHTML, primitives: element.querySelectorAll('path,circle,ellipse,line,polyline,polygon,rect').length,
    geometry: Array.from(element.querySelectorAll('g,path,circle,ellipse,line,polyline,polygon,rect')).map(node => ({ tag: node.tagName, cssTransform: getComputedStyle(node).transform, attributes: Object.fromEntries(['x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points','width','height','transform'].filter(name => node.hasAttribute(name)).map(name => [name, node.getAttribute(name)])) })) }))
  return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: body.scrollWidth, canvas, svg, drawStats: window.__chatCodeDrawStats }
})
const geometryOf = paint => ({
  canvas: Array.from(new Set((paint.drawStats?.geometry ?? []).map(command => canonical(command)))).sort(),
  svg: paint.svg.flatMap(svg => svg.geometry ?? []),
})
const verifyIndependentMotion = async (frame, label) => {
  await card().locator('[data-question-code-status]').scrollIntoViewIfNeeded()
  const first = await latestSnapshot()
  expect(first.source).toBe('platform-engine')
  const apex = first.events.find(event => event.kind === 'apex')
  const impact = first.events.find(event => event.kind === 'impact')
  expect(apex).toBeTruthy(); expect(impact).toBeTruthy()
  const frames = []
  for (const [name, time] of [['t0', 0], ['apex', apex.time], ['impact', impact.time]]) {
    await seekPlatform(time)
    await expect.poll(async () => {
      const paint = await authoredPaint(frame)
      return paint.canvas.some(canvas => canvas.opaquePixels > 0 && canvas.distinctColors > 8) || paint.svg.some(svg => svg.primitives > 3)
    }, { timeout: 15000 }).toBe(true)
    await frame.locator('body').evaluate(() => new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(resolve)); setTimeout(resolve, 100) }))
    const snapshot = await latestSnapshot()
    const paint = await authoredPaint(frame)
    const stamped = paint.canvas.find(canvas => canvas.bodyY !== null)
    if (stamped) {
      await expect.poll(async () => Number((await authoredPaint(frame)).canvas.find(canvas => canvas.bodyY !== null).bodyY), { timeout: 15000 }).toBeCloseTo(snapshot.view.bodies[0].at.y, 8)
      await expect.poll(async () => Number((await authoredPaint(frame)).canvas.find(canvas => canvas.bodyY !== null).clockTime), { timeout: 15000 }).toBeCloseTo(snapshot.clock.time, 2)
    }
    expect(snapshot.source).toBe('platform-engine')
    frames.push({ name, snapshot, paint: await authoredPaint(frame) })
    await writeFile(join(shots, label + '-snapshot-' + name + '.json'), JSON.stringify(snapshot, null, 2))
    await shot(label + '-' + name)
  }
  expect(frames[0].snapshot.view.bodies[0].at.y).toBeCloseTo(0, 8)
  expect(frames[1].snapshot.view.bodies[0].at.y).toBeGreaterThan(frames[0].snapshot.view.bodies[0].at.y)
  expect(frames[2].snapshot.view.bodies[0].at.y).toBeCloseTo(0, 8)
  expect(frames[1].snapshot.clock.time).toBeLessThan(frames[2].snapshot.clock.time)
  expect(canonical({ canvas: frames[1].paint.canvas.map(canvas => canvas.pixelHash), svg: frames[1].paint.svg })).not.toBe(canonical({ canvas: frames[0].paint.canvas.map(canvas => canvas.pixelHash), svg: frames[0].paint.svg }))
  expect(geometryOf(frames[0].paint).canvas.length + geometryOf(frames[0].paint).svg.length).toBeGreaterThan(0)
  expect(canonical(geometryOf(frames[1].paint))).not.toBe(canonical(geometryOf(frames[0].paint)))
  await writeFile(join(shots, label + '-native-geometry.json'), JSON.stringify(frames.map(item => ({ name: item.name, clock: item.snapshot.clock, engineBody: item.snapshot.view.bodies[0], geometrySha256: hash(canonical(geometryOf(item.paint))), geometry: geometryOf(item.paint) })), null, 2))
  await seekPlatform(0)
  check('independent authored pixels and native geometry follow true V3 t0, apex and impact frames', { label, samples: frames.map(item => ({ name: item.name, time: item.snapshot.clock.time, body: item.snapshot.view.bodies[0], pixelHashes: item.paint.canvas.map(canvas => canvas.pixelHash), geometrySha256: hash(canonical(geometryOf(item.paint))) })) })
  return frames
}
const verifyMobileAndParameters = async (frame, label, source) => {
  const before = await latestSnapshot()
  const speed = card().locator('[data-question-code-controls] label').filter({ hasText: '初速度' }).locator('input[type="number"]')
  await speed.fill('25'); await speed.blur()
  await expect.poll(async () => (await latestSnapshot()).inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === 'speed').value, { timeout: 15000 }).toBe(25)
  const changed = await latestSnapshot()
  await seekPlatform(changed.events.find(event => event.kind === 'apex').time)
  const changedApex = await latestSnapshot()
  expect(changedApex.view.bodies[0].at.y).toBeGreaterThan(before.view.keyPoints.find(point => point.kind === 'apex').at.y)
  await writeFile(join(shots, label + '-snapshot-changed-speed.json'), JSON.stringify(changedApex, null, 2))
  await shot(label + '-changed-speed')
  await expect(card().getByRole('button', { name: '恢复原题', exact: true })).toBeEnabled()
  await card().getByRole('button', { name: '恢复原题', exact: true }).click()
  await expect.poll(async () => (await latestSnapshot()).inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === 'speed').value).toBe(20)
  expect((await latestSnapshot()).clock.time).toBeCloseTo(0, 8)
  await page.setViewportSize({ width: 375, height: 812 })
  await card().scrollIntoViewIfNeeded()
  await card().getByRole('button', { name: '播放 / 暂停', exact: true }).click()
  await expect.poll(async () => (await latestSnapshot()).clock.time, { timeout: 15000 }).toBeGreaterThan(0)
  await card().getByRole('button', { name: '播放 / 暂停', exact: true }).click()
  await expect(card().getByRole('button', { name: '播放 / 暂停', exact: true })).toHaveAttribute('aria-pressed', 'false')
  const mobile = await authoredPaint(frame)
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewport.width + 1)
  for (const canvas of mobile.canvas) {
    expect(canvas.rect.x).toBeGreaterThanOrEqual(-1)
    expect(canvas.rect.x + canvas.rect.width).toBeLessThanOrEqual(mobile.viewport.width + 1)
  }
  const controlBounds = await card().getByRole('button', { name: '播放 / 暂停', exact: true }).boundingBox()
  expect(controlBounds.width).toBeGreaterThanOrEqual(32)
  await writeFile(join(shots, label + '-mobile-document-geometry.json'), JSON.stringify(await page.evaluate(() => ({scrollX,innerWidth,rootWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,wide:[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().width>innerWidth+5).slice(0,12).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width,scroll:n.scrollWidth,overflow:getComputedStyle(n).overflowX})),ancestors:(()=>{const rows=[];let n=document.querySelector('[data-code-experiment-shell]');while(n){const r=n.getBoundingClientRect();rows.push({tag:n.tagName,cls:n.className,x:r.x,width:r.width,scroll:n.scrollWidth,left:n.scrollLeft,overflow:getComputedStyle(n).overflowX});n=n.parentElement}return rows})()})), null, 2))
  await card().locator('[data-question-code-status]').scrollIntoViewIfNeeded()
  await expect.poll(() => card().evaluate(node => node.getBoundingClientRect().x)).toBeGreaterThanOrEqual(0)
  await shot(label + '-mobile-play-controls')
  const mobileGeometry = await card().evaluate(element => {
    const rect = node => { const box = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') ?? node.textContent?.trim(), x: box.x, y: box.y, width: box.width, height: box.height } }
    const transport = Array.from(element.querySelector('[data-running]').querySelectorAll('button')).map(rect)
    const source = Array.from(element.querySelectorAll('summary')).find(node => node.textContent.includes('本题实验代码'))
    const regenerate = Array.from(element.querySelectorAll('button')).find(node => node.textContent.trim() === '重新生成本题实验')
    const actions = [source, regenerate].filter(Boolean).map(rect)
    return { viewportWidth: innerWidth, transport, actions }
  })
  const collisions = []
  for (const [group, rectangles] of Object.entries({ transport: mobileGeometry.transport, actions: mobileGeometry.actions })) {
    for (let left = 0; left < rectangles.length; left++) for (let right = left + 1; right < rectangles.length; right++) {
      const a = rectangles[left], b = rectangles[right]
      if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) collisions.push({ group, a, b })
    }
    for (const rectangle of rectangles) expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(mobileGeometry.viewportWidth + 1)
  }
  await writeFile(join(shots, label + '-mobile-control-geometry.json'), JSON.stringify({ mobileGeometry, collisions }, null, 2))
  expect(collisions).toEqual([])
  await seekPlatform(0)
  await page.setViewportSize({ width: 1440, height: 1080 })
  await card().scrollIntoViewIfNeeded()
  await expect.poll(() => frame.locator('canvas').evaluateAll(nodes => nodes.every(canvas => {
    const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2)
    return Math.abs(canvas.width - box.width * dpr) <= 2 && Math.abs(canvas.height - box.height * dpr) <= 2
  })), { timeout: 15000 }).toBe(true)
  check('live condition changes, restore-origin and mobile playback operate on the same engine runtime', { changedApex: { time: changedApex.clock.time, body: changedApex.view.bodies[0] }, mobile: { viewport: mobile.viewport, scrollWidth: mobile.scrollWidth, canvasBounds: mobile.canvas.map(canvas => canvas.rect), controlBounds, mobileGeometry, collisions } })
  return { changedApex, mobile, sourceSha256: hash(source.rendererJs) }
}
const openSession = async id => {
  const title = sessionTitles.get(id)
  if (!title) throw new Error('Test history title is missing')
  const button = page.locator('section[aria-label="最近空间"]').getByRole('button', { name: new RegExp('^' + title) })
  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'true')
}
const nameSession = async (id, prefix) => {
  const title = prefix + '-' + id.slice(-6)
  const response = await context.request.post(fixture.base + '/api/session/rename', { data: { type: 'client-request', rpcId: 'chat-code-rename-' + Date.now(), method: 'session/rename', payload: { args: { request: { sessionId: id, title } } } } })
  expect(response.ok()).toBe(true)
  expect((await response.json()).result.value.title).toBe(title)
  sessionTitles.set(id, title)
}

let evidence = { question: CHAT_CODE_QUESTION }
try {
  await go(fixture.authUrl)
  if (realSmoke && process.env.PHYSICSOS_CHAT_CODE_USERNAME) {
    await loginUser(page, { username: process.env.PHYSICSOS_CHAT_CODE_USERNAME, password: (await secureText(process.env.PHYSICSOS_CHAT_CODE_PASSWORD_FILE)).trim() })
  } else await registerOwnedStudent()
  authenticated = true
  expect((await context.cookies()).some(cookie => cookie.name === 'physicsos_session')).toBe(true)
  await dismissNotice()
  check('authenticated student Web shell and product session cookie')
  if (styleReplay) {
    const originalSource = JSON.parse(await secureText(process.env.PHYSICSOS_CHAT_CODE_REPLAY_SOURCE_FILE))
    await newChat({ createWorkspace: true })
    const ownerSessionId = await send('请用物理工具解题并显示本题最新V3实验：' + CHAT_CODE_QUESTION)
    const frame = await codeReady()
    const parent = await sessionLog(fixture.home, ownerSessionId), snapshot = finalScene(parent), ref = snapshot.visualization
    expect(ref.status).toBe('ready')
    expect(ref.rendererKind).toBe('independent')
    expect(snapshot.scene.bodies[0].velocity.vector.y).toBeCloseTo(20, 10)
    const sourceResponse = await context.request.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/source?sha256=${ref.sha256}`)
    expect(sourceResponse.ok()).toBe(true)
    const source = await sourceResponse.json()
    expect(source.source).toEqual(originalSource)
    const child = await sessionLog(fixture.home, ref.childSessionId)
    expect(JSON.parse(child.events.find(event => event.type === 'tool/call').data.arguments)).toEqual(originalSource)
    const styles = await frame.locator('body').evaluate(body => ({ bodyFont: getComputedStyle(body).fontFamily, bodyMargin: getComputedStyle(body).margin,
      trustedBaseLinks: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(link => link.getAttribute('href')?.endsWith('/platform-base.css')).length }))
    expect(styles.bodyFont).toMatch(/system-ui|sans-serif/)
    expect(styles.bodyMargin).toBe('0px')
    expect(styles.trustedBaseLinks).toBe(1)
    const liveFrames = await verifyIndependentMotion(frame, 'real-source-replay')
    const exploration = await verifyMobileAndParameters(frame, 'real-source-replay', originalSource)
    const snapshots = await page.evaluate(() => window.__chatCodeSnapshots)
    const params = snapshots.at(-1).inspector.flatMap(section => section.parameters ?? [])
    expect(params.find(param => param.id === 'speed').value).toBeCloseTo(20, 10)
    expect(params.find(param => param.id === 'angle').value).toBeCloseTo(90, 10)
    expect(params.find(param => param.id === 'gravity').value).toBeCloseTo(9.8, 10)
    await shot('01-real-source-independent-canvas')
    await card().locator('summary').filter({ hasText: '本题实验代码' }).first().click()
    await expect(card().locator('pre code').first()).toHaveText(originalSource.rendererJs)
    await shot('02-original-real-source-preserved')
    await checkBrowserErrors()
    check('unchanged real child source replay: independent V3 Canvas/SVG painted with original source, zero paid model requests')
    await writeFile(join(shots, 'acceptance-result.json'), JSON.stringify({ passed: true, checks, evidence: { paidModelRequests: 0, scriptedProviderRequests: fixture.mock.requests.length, replayedRealSource: true, ref, sourceSha256: hash(originalSource.rendererJs), stylesheetSha256: hash(originalSource.stylesheet), styles, liveFrames: liveFrames.map(item => ({ name: item.name, clock: item.snapshot.clock, body: item.snapshot.view.bodies[0], paint: item.paint })), exploration, browserErrors: errors, expectedClientAborts } }, null, 2))
    console.log('PASS unchanged real-source independent V3 replay')
  } else if (realSmoke) {
    const existingSessionId = process.env.PHYSICSOS_CHAT_CODE_EXISTING_SESSION_ID
    let ownerSessionId
    if (existingSessionId) {
      ownerSessionId = existingSessionId
      await page.evaluate(id => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id })) }, ownerSessionId)
      navigating = true
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }) } finally { navigating = false }
    } else {
      await newChat()
      ownerSessionId = await send('请调用 physics_solve_question 解这道题，并用自动调用的受限代码子代理生成最新 V3 本题私有实验；最终数值只引用物理引擎结果。物体从地面（初始高度 0 m）以初速度 20 m/s 竖直向上抛出（抛射角 90°），g = 9.8 m/s²。求最大高度、落回地面的飞行时间和射程。')
    }
    evidence = { realModel: true, base: fixture.base, ownerSessionId }
    const frame = await codeReady()
    let exported = await ownedExport(ownerSessionId)
    let parent = exported.find(log => log.header?.id === ownerSessionId)
    expect(parent).toBeTruthy()
    if (!existingSessionId) {
      await expect.poll(async () => {
        exported = await ownedExport(ownerSessionId)
        parent = exported.find(log => log.header?.id === ownerSessionId)
        return parent.events.some(event => event.type === 'turn/end' && event.data.reason?.kind === 'completed')
      }, { timeout: 90000 }).toBe(true)
    }
    const parentStopReason = parent.events.filter(event => event.type === 'turn/end').at(-1)?.data.reason?.kind ?? 'running'
    const original = finalScene(parent), ref = original.visualization
    expect(ref.status).toBe('ready')
    expect(ref.rendererKind).toBe('independent')
    expect(ref.ownerSessionId).toBe(ownerSessionId)
    expect(ref.experimentId).toBe('projectile-oblique')
    expect(ref.sceneSha256).toBe(hash(canonical(original.scene)))
    expect(original.scene.bodies[0].velocity.vector.y).toBeCloseTo(20, 10)
    expect(original.scene.bodies[0].velocity.vector.x).toBeCloseTo(0, 10)
    const calls = parent.events.filter(event => event.type === 'tool/call')
    expect(calls.filter(event => event.data.name === 'physics_solve_question')).toHaveLength(1)
    const text = parent.events.filter(event => event.type === 'tool/result').map(toolText).find(value => value.includes('已求解（mechanics / projectile_motion）'))
    expect(text).toMatch(/校验：passed（(\d+)\/\1 项通过）/)
    expect(text).toContain('最大高度 H = 20.41 m')
    expect(text).toMatch(/(?:落地时间|飞行时间) t = 4\.08 s/)
    expect(text).toContain('t = 2*vy0/g')
    const child = exported.find(log => log.header?.id === ref.childSessionId)
    expect(child?.header.parentSession).toBe(ownerSessionId)
    const codeChildren = exported.filter(log => log.header?.parentSession === ownerSessionId)
    expect(codeChildren.length).toBeGreaterThanOrEqual(1)
    expect(codeChildren.length).toBeLessThanOrEqual(2)
    for (const [index, codeChild] of codeChildren.entries()) {
      expect(codeChild.events.find(event => event.type === 'request/header').data.header.tools.map(tool => tool.name).sort()).toEqual(index === 0 ? ['physics_generate_experiment_asset', 'physics_write_experiment_code', 'structured_output'] : ['physics_write_experiment_code', 'structured_output'])
      expect(codeChild.events.filter(event => event.type === 'tool/call').every(event => ['structured_output', 'physics_generate_experiment_asset', 'physics_write_experiment_code'].includes(event.data.name))).toBe(true)
    }
    if (codeChildren.length === 2) {
      expect(JSON.stringify(child.events)).toMatch(/上次封闭代码校验未通过（(?:INVALID_SOURCE|INVALID_CODE_SOURCE|INVALID_PACKAGE|INVALID_METADATA|UNSAFE_RESOURCES|IMAGE_REQUIRED|IMAGE_UNUSED|MISSING_STRUCTURED_OUTPUT)(?:[^）]*)）/)
      expect(JSON.stringify(child.events)).toMatch(/本次为(?:同一任务的)?唯一修复机会/)
    }
    const generationEvents = sceneEvents(parent)
    expect(generationEvents.filter(event => event.data.visualization?.status === 'generating')).toHaveLength(1)
    expect(generationEvents.filter(event => event.data.visualization?.status === 'failed')).toHaveLength(0)
    const jobStart = generationEvents.find(event => event.data.visualization?.status === 'generating').time
    const jobEnd = generationEvents.find(event => event.data.visualization?.status === 'ready').time
    const jobDurationMs = jobEnd - jobStart
    expect(jobDurationMs).toBeLessThan(600000)
    const childHeader = child.events.find(event => event.type === 'request/header').data.header
    expect(childHeader.tools.map(tool => tool.name).sort()).toEqual(codeChildren.length === 1 ? ['physics_generate_experiment_asset', 'physics_write_experiment_code', 'structured_output'] : ['physics_write_experiment_code', 'structured_output'])
    const childConfig = childHeader.config
    const parentConfig = parent.events.find(event => event.type === 'request/header').data.header.config
    expect(childConfig.maxTokens).toBeLessThanOrEqual(Math.min(8192, parentConfig.maxTokens))
    const catalogResponse = await context.request.post(fixture.base + '/api/session/modelCatalog', { data: { type: 'client-request', rpcId: 'chat-code-model-metadata', method: 'session/modelCatalog', payload: { args: {} } } })
    expect(catalogResponse.ok()).toBe(true)
    const catalog = (await catalogResponse.json()).result.value
    const group = catalog.groups.find(group => group.id === childConfig.provider) ?? catalog.groups.find(group => group.models.some(model => model.id === childConfig.model))
    const model = group?.models.find(model => model.id === childConfig.model)
    const advertisedEfforts = (model?.reasoning?.efforts ?? []).map(effort => effort.id)
    const lightEffort = ['off', 'none', 'minimal', 'low'].map(level => advertisedEfforts.find(effort => effort.toLowerCase() === level)).find(Boolean)
    expect(lightEffort).toBeTruthy()
    expect(childConfig.reasoningEffort).toBe(lightEffort)
    const structured = child.events.filter(event => event.type === 'tool/call' && event.data.name === 'structured_output')
    expect(structured.length).toBeGreaterThanOrEqual(1)
    expect(structured.length).toBeLessThanOrEqual(2)
    expect(structured.every(event => event.data.name === 'structured_output')).toBe(true)
    const submitted = JSON.parse(structured.at(-1).data.arguments)
    const written = { rendererJs: '', stylesheet: '' }
    const sourceWrites = child.events.filter(event => event.type === 'tool/call' && event.data.name === 'physics_write_experiment_code')
    for (const write of sourceWrites) {
      const outcome = child.events.find(event => event.type === 'tool/result' && event.data.message?.toolCallId === write.data.callId)
      if (outcome?.data.message.isError !== false) continue
      const part = JSON.parse(write.data.arguments)
      expect(part.content.length).toBeLessThanOrEqual(2400)
      written[part.file] = part.mode === 'append' ? written[part.file] + part.content : part.content
    }
    expect(sourceWrites.length).toBeGreaterThan(0)
    expect(sourceWrites.length).toBeLessThanOrEqual(10)
    const childSource = { ...submitted, ...written }
    const response = await context.request.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/source?sha256=${ref.sha256}`)
    expect(response.ok()).toBe(true)
    const source = await response.json()
    expect(source.ref).toEqual(ref)
    expect(source.source.rendererJs).toBe(childSource.rendererJs)
    expect(source.source.stylesheet).toBe(childSource.stylesheet)
    expect(source.source.rendererJs).toContain('renderFrame')
    expect(source.source.rendererJs).not.toMatch(/renderPlatformFrame|platform-renderer|\bimport\s|\bfrom\s*['"]/)
    const badHash = await context.request.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/source?sha256=${'0'.repeat(64)}`)
    expect(badHash.status()).toBe(409)
    const guest = await request.newContext()
    try {
      expect((await guest.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/source`)).status()).toBe(401)
      expect((await guest.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/preview`)).status()).toBe(401)
    } finally { await guest.dispose() }
    const signedPreview = await (await context.request.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/preview?sha256=${ref.sha256}`)).json()
    const privateWrapper = await context.request.get(new URL(signedPreview.entryUrl, fixture.base).href)
    expect(privateWrapper.ok()).toBe(true)
    expect(privateWrapper.headers()['cache-control']).toBe('no-store')
    expect(privateWrapper.headers()['content-security-policy']).toContain('sandbox allow-scripts allow-same-origin')
    expect((await context.request.get(new URL(signedPreview.entryUrl.replace('/embed/question/', '/question/'), fixture.base).href)).status()).toBe(403)
    const imageCalls = codeChildren.flatMap(log => log.events).filter(event => event.type === 'tool/call' && event.data.name === 'physics_generate_experiment_asset')
    expect(imageCalls.length).toBeGreaterThanOrEqual(1)
    expect(imageCalls.length).toBeLessThanOrEqual(2)
    const imageAssets = codeChildren.flatMap(log => log.events).filter(event => event.type === 'tool/result').flatMap(event => { try { const value = JSON.parse(toolText(event)); return value.path?.startsWith('./assets/generated/') ? [value] : [] } catch { return [] } })
    expect(imageAssets.length).toBeGreaterThanOrEqual(1)
    const rawEntry = new URL(signedPreview.entryUrl.replace('/embed/question/', '/question/'), fixture.base)
    for (const asset of imageAssets) {
      expect(asset.model).toBe('gpt-image-2.5-sunburst')
      expect(source.source.rendererJs.includes(asset.path) || source.source.stylesheet.includes(asset.cssPath)).toBe(true)
      const response = await context.request.get(new URL(asset.path, rawEntry).href)
      expect(response.ok()).toBe(true)
      const bytes = await response.body()
      expect(hash(bytes)).toBe(asset.sha256)
      await writeFile(join(shots, 'generated-' + asset.sha256.slice(0, 12) + '.png'), bytes)
    }
    check('real PhysicsOS child calls configured Sunburst and freezes referenced image bytes in owned experiment', { imageAssets, imageCalls: imageCalls.length })
    check('real candidate private source requires owner cookie, exact hash and signed sandbox preview')
    await expect(card().frameLocator('iframe').frameLocator('iframe').locator('canvas, svg').first()).toBeVisible({ timeout: 30000 })
    await expect(page.locator('[data-physicsos-surface="lab"]')).toBeHidden()
    const snapshots = await page.evaluate(() => window.__chatCodeSnapshots)
    const parameters = snapshots.at(-1).inspector.flatMap(section => section.parameters ?? [])
    expect(parameters.find(parameter => parameter.id === 'speed').value).toBeCloseTo(20, 10)
    expect(parameters.find(parameter => parameter.id === 'angle').value).toBeCloseTo(90, 10)
    expect(parameters.find(parameter => parameter.id === 'gravity').value).toBeCloseTo(9.8, 10)
    const liveFrames = await verifyIndependentMotion(frame, 'independent-real')
    const exploration = await verifyMobileAndParameters(frame, 'independent-real', source.source)
    const refreshedExport = await ownedExport(ownerSessionId)
    expect(finalScene(refreshedExport.find(log => log.header?.id === ownerSessionId))).toEqual(original)
    expect((await (await context.request.get(fixture.base + `/physicsos/question-code/artifacts/${ref.artifactId}/source?sha256=${ref.sha256}`)).json()).source).toEqual(source.source)
    await shot('01-real-model-owned-code')
    await card().locator('summary').filter({ hasText: '本题实验代码' }).first().click()
    await expect(card().locator('pre code').first()).toHaveText(source.source.rendererJs)
    await shot('02-real-model-frozen-source')
    await checkBrowserErrors()
    check('one real configured-model question: engine → real restricted child → private source → V3 rendered frame', { ownerSessionId, childSessionId: ref.childSessionId, artifactId: ref.artifactId, sourceSha256: hash(source.source.rendererJs) })
    evidence = { realModel: true, base: fixture.base, ref, sourceSha256: hash(source.source.rendererJs), rendererKind: ref.rendererKind, liveFrames: liveFrames.map(item => ({ name: item.name, clock: item.snapshot.clock, body: item.snapshot.view.bodies[0], paint: item.paint })), exploration, toolCalls: calls.map(event => event.data.name), firstChildTools: ['physics_generate_experiment_asset', 'physics_write_experiment_code', 'structured_output'], imageAssets, childStarts: codeChildren.length, finalChildSourceAttempts: structured.length, exportIncludesRealChild: true, generationJobs: 1, jobDurationMs, reusedExistingOwnedSession: Boolean(existingSessionId), sentNewPrompt: !existingSessionId, parentStopReason, childConfig: { model: childConfig.model, maxTokens: childConfig.maxTokens, reasoningEffort: childConfig.reasoningEffort }, advertisedEfforts, browserErrors: errors, expectedClientAborts }
    await writeFile(join(shots, 'acceptance-result.json'), JSON.stringify({ passed: true, checks, evidence }, null, 2))
    console.log('PASS real configured-model private owned chat smoke (' + smokeLabel + ')')
  } else {
  const communityBefore = await (await context.request.get(fixture.base + '/physicsos/experiments/projectile-oblique')).json()
  await newChat({ createWorkspace: true })
  const ownerSessionId = await send('请用物理引擎解题，并生成本题专属的最新 V3 代码实验：\n' + CHAT_CODE_QUESTION)
  const frame = await codeReady()
  await expect(frame.locator('#question-authored-speed')).toContainText('20 m/s')
  await expect(frame.locator('#question-authored-angle')).toContainText('90 °')
  await expect(frame.locator('#question-authored-gravity')).toContainText('9.8 m/s²')
  const sceneWidth = await frame.locator('#question-independent-scene').evaluate(node => ({ scene: node.clientWidth, viewport: innerWidth }))
  expect(sceneWidth.scene).toBeGreaterThanOrEqual(sceneWidth.viewport - 2)
  await expect(frame.getByRole('region', { name: '独立实验玻璃控件' })).toBeVisible()
  await expect(page.locator('[data-physicsos-surface="lab"]')).toBeHidden()
  await expect(card().getByRole('button', { name: '在实验室中探索', exact: true })).toBeEnabled()
  check('new chat paints authored V3 code with exact 20 m/s, 90°, g=9.8, without automatic Lab navigation')
  await shot('01-authenticated-question-code')
  const liveFrames = await verifyIndependentMotion(frame, 'independent-mock')
  const exploration = await verifyMobileAndParameters(frame, 'independent-mock', CHAT_CODE_SOURCE)

  const parent = await sessionLog(fixture.home, ownerSessionId)
  const original = finalScene(parent)
  expect(original.visualization.status).toBe('ready')
  const ref = original.visualization
  expect(ref.rendererKind).toBe('independent')
  expect(ref.ownerSessionId).toBe(ownerSessionId)
  expect(ref.experimentId).toBe('projectile-oblique')
  expect(ref.sceneId).toBe(original.sceneId)
  expect(ref.sceneRevision).toBe(original.revision)
  expect(ref.sceneSha256).toBe(hash(canonical(original.scene)))
  const velocity = original.scene.bodies[0].velocity.vector
  expect(velocity.y).toBeCloseTo(20, 10)
  expect(velocity.x).toBeCloseTo(0, 10)
  const solveCalls = parent.events.filter(event => event.type === 'tool/call')
  expect(solveCalls.map(event => event.data.name)).toEqual(['physics_solve_question'])
  const parentHeader = parent.events.find(event => event.type === 'request/header')?.data.header
  expect(parentHeader.tools.map(tool => tool.name).sort()).toEqual([
    'ask_user_question',
    'physics_create_experiment', 'physics_describe_scene', 'physics_generate_experiment', 'physics_list_experiments',
    'physics_observe', 'physics_scene_command', 'physics_simulate', 'physics_solve_question',
  ])
  const solvedText = toolText(parent.events.find(event => event.type === 'tool/result'))
  expect(solvedText).toContain('已求解（mechanics / projectile_motion）')
  expect(solvedText).toMatch(/校验：passed（(\d+)\/\1 项通过）/)
  expect(solvedText).toContain('最大高度 H = 20.41 m')
  expect(solvedText).toMatch(/(?:落地时间|飞行时间) t = 4\.08 s/)
  expect(solvedText).toContain('射程 R = 0.00 m')
  expect(solvedText).toContain('t = 2*vy0/g')
  expect(solvedText).not.toContain('t = √(2h/g)')
  await expect.poll(async () => (await sessionLog(fixture.home, ownerSessionId)).events.some(event => event.type === 'turn/end' && event.data.reason?.kind === 'completed'), { timeout: 30000 }).toBe(true)
  await nameSession(ownerSessionId, '代码验收原题')
  const child = await sessionLog(fixture.home, ref.childSessionId)
  expect(child.header.parentSession).toBe(ownerSessionId)
  const childHeaders = child.events.filter(event => event.type === 'request/header')
  expect(childHeaders.length).toBeGreaterThan(0)
  expect(childHeaders[0].data.header.tools.map(tool => tool.name)).toEqual(['structured_output'])
  expect(child.events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['structured_output'])
  expect(JSON.parse(child.events.find(event => event.type === 'tool/call').data.arguments)).toEqual(CHAT_CODE_SOURCE)
  expect(sceneEvents(parent).some(event => /rendererJs|entryUrl/.test(JSON.stringify(event.data)))).toBe(false)
  const childRequest = fixture.mock.requests.find(request => request.kind === 'code-child')
  expect(childRequest.tools).toEqual(['structured_output'])
  expect(childRequest.firstCodeRequest).toBe(true)
  expect(childRequest.personaRestricted).toBe(true)
  expect(childRequest.latestV3).toBe(true)
  expect(childRequest.independentContract).toBe(true)
  expect(childRequest.hasVerifiedAnswer).toBe(true)
  expect(childRequest.scene).toEqual(original.scene)
  check('durable parent tool result is engine verified; real first-level child advertises only structured_output on its first request', { ownerSessionId, childSessionId: ref.childSessionId, artifactId: ref.artifactId, sha256: ref.sha256, sceneSha256: ref.sceneSha256 })

  const sourcePath = `/physicsos/question-code/artifacts/${ref.artifactId}/source`
  const sourceResponse = await context.request.get(fixture.base + sourcePath + '?sha256=' + ref.sha256)
  expect(sourceResponse.ok()).toBe(true)
  const source = await sourceResponse.json()
  expect(source.ref).toEqual(ref)
  expect(source.source).toEqual(CHAT_CODE_SOURCE)
  expect(source.source.rendererJs).not.toMatch(/renderPlatformFrame|platform-renderer|\bimport\s|\bfrom\s*['"]/)
  await expect(card().getByRole('heading', { name: CHAT_CODE_SOURCE.title, exact: true })).toBeVisible()
  await expect(card().locator('[data-question-code-layout="independent"]')).toBeVisible()
  await card().locator('summary').filter({ hasText: '本题实验代码' }).first().click()
  await expect(card().locator('pre code').first()).toHaveText(CHAT_CODE_SOURCE.rendererJs)
  expect(source.source.rendererJs).not.toContain('template-v2')
  await shot('02-private-source-visible')
  const originalFacts = canonical({ scene: original.scene, solve: original.solve })
  const speedInput = frame.locator('#question-authored-speed-input')
  await speedInput.fill('25'); await speedInput.blur()
  await expect(frame.locator('#question-authored-speed')).toContainText('25 m/s')
  await expect(frame.locator('#question-authored-angle')).toContainText('90 °')
  const apexTime = (await page.evaluate(() => window.__chatCodeSnapshots.at(-1))).events.find(event => event.kind === 'apex').time
  await frame.locator('#question-authored-seek').evaluate((node, time) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(node, String(time)); node.dispatchEvent(new Event('input', { bubbles: true })) }, apexTime)
  await expect.poll(async () => Number(await frame.locator('#question-independent-canvas').getAttribute('data-clock-time'))).toBeCloseTo(apexTime, 2)
  await expect.poll(async () => Number(await frame.locator('#question-independent-canvas').getAttribute('data-body-y'))).toBeGreaterThan(25)
  const changedSnapshots = await page.evaluate(() => window.__chatCodeSnapshots)
  expect(changedSnapshots.some(snapshot => snapshot.inspector.some(section => section.parameters?.some(parameter => parameter.id === 'speed' && parameter.value === 25)))).toBe(true)
  const afterExploration = finalScene(await sessionLog(fixture.home, ownerSessionId))
  expect(canonical({ scene: afterExploration.scene, solve: afterExploration.solve })).toBe(originalFacts)
  expect(afterExploration.visualization).toEqual(ref)
  check('source pane is the frozen child module; live parameter change reaches code while original question and verified answer stay immutable')
  await shot('03-local-parameter-exploration')

  await card().getByRole('button', { name: '在实验室中探索', exact: true }).click()
  const lab = page.locator('[data-physicsos-surface="lab"]')
  await expect(lab).toBeVisible({ timeout: 30000 })
  await expect(lab.locator('[data-question-code-status="ready"]')).toBeVisible({ timeout: 60000 })
  await expect(lab.frameLocator('iframe').frameLocator('iframe').locator('#question-authored-angle')).toContainText('90 °')
  await expect(lab.frameLocator('iframe').frameLocator('iframe').locator('#question-authored-speed')).toContainText('20 m/s')
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await codeReady()
  check('explicit Lab exploration uses the same private question code and frozen original conditions')

  const badHash = await context.request.get(fixture.base + sourcePath + '?sha256=' + '0'.repeat(64))
  expect(badHash.status()).toBe(409)
  expect((await badHash.json()).error.code).toBe('ARTIFACT_REF_MISMATCH')
  const foreign = await browser.newContext()
  const foreignName = 'chat_code_foreign_' + Date.now().toString(36)
  const registered = await foreign.request.post(fixture.base + '/physicsos/auth/register', { data: { username: foreignName, schoolId: 'PHYSICSOS-OPEN', password: 'test-only-foreign-2026', displayName: '另一个验收学生', email: foreignName + '@example.invalid' } })
  expect(registered.status()).toBe(201)
  expect((await foreign.request.get(fixture.base + sourcePath + '?sha256=' + ref.sha256)).status()).toBe(404)
  expect((await foreign.request.get(fixture.base + sourcePath.replace('/source', '/preview'))).status()).toBe(404)
  await foreign.close()
  const admin = await browser.newContext()
  expect((await admin.request.post(fixture.base + '/physicsos/auth/login', { data: { username: 'admin', schoolId: 'PHYSICSOS-OPEN', password: fixture.password } })).ok()).toBe(true)
  expect((await admin.request.get(fixture.base + sourcePath)).status()).toBe(404)
  expect((await admin.request.get(fixture.base + sourcePath.replace('/source', '/preview'))).status()).toBe(404)
  await admin.close()
  const guest = await browser.newContext()
  expect((await guest.request.get(fixture.base + sourcePath)).status()).toBe(401)
  await guest.close()
  const communityAfter = await (await context.request.get(fixture.base + '/physicsos/experiments/projectile-oblique')).json()
  expect(communityAfter).toEqual(communityBefore)
  check('private source/preview reject other users and stale hashes; code artifact never changes community release or active pointer')

  const firstPreview = await (await context.request.get(fixture.base + sourcePath.replace('/source', '/preview') + '?sha256=' + ref.sha256)).json()
  expect(firstPreview.entryUrl).toMatch(/^\/physicsos\/experiment-assets\/embed\/question\//)
  const wrapper = await context.request.get(new URL(firstPreview.entryUrl, fixture.base).href)
  expect(wrapper.ok()).toBe(true)
  expect(wrapper.headers()['cache-control']).toBe('no-store')
  expect(wrapper.headers()['content-security-policy']).toContain('sandbox allow-scripts allow-same-origin')
  expect(wrapper.headers()['content-security-policy']).toContain('frame-src')
  expect((await context.request.get(new URL(firstPreview.entryUrl.replace('/embed/question/', '/question/'), fixture.base).href)).status()).toBe(403)
  navigating = true
  try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }) } finally { navigating = false }
  const reloaded = await codeReady()
  await expect(reloaded.locator('#question-authored-speed')).toContainText('20 m/s')
  expect((await (await context.request.get(fixture.base + sourcePath)).json()).ref).toEqual(ref)
  const renewedPreview = await (await context.request.get(fixture.base + sourcePath.replace('/source', '/preview'))).json()
  expect(renewedPreview.entryUrl).not.toBe(firstPreview.entryUrl)
  expect(renewedPreview.expiresAt).toBeGreaterThan(Date.now())
  check('reload renews private preview and restores the frozen original question')

  // No existing physicsMap remains after this real compiled-process restart.
  await go('about:blank')
  await fixture.restart()
  await go(fixture.authUrl)
  await openSession(ownerSessionId)
  await codeReady()
  expect((await (await context.request.get(fixture.base + sourcePath)).json()).ref).toEqual(ref)
  check('private artifact, owner and executable V3 preview survive real Web server restart')
  const beforeRegeneration = fixture.mock.requests.length
  await card().getByRole('button', { name: '重新生成本题实验', exact: true }).click()
  await expect.poll(async () => {
    const current = finalScene(await sessionLog(fixture.home, ownerSessionId))?.visualization
    return current?.status === 'ready' && current.artifactId !== ref.artifactId
  }, { timeout: 180000 }).toBe(true)
  await codeReady()
  const regenerated = finalScene(await sessionLog(fixture.home, ownerSessionId))
  expect(canonical({ scene: regenerated.scene, solve: regenerated.solve })).toBe(originalFacts)
  expect(fixture.mock.requests.slice(beforeRegeneration).filter(request => request.kind === 'parent-solve')).toHaveLength(0)
  expect(fixture.mock.requests.slice(beforeRegeneration).filter(request => request.kind === 'parent-generate')).toHaveLength(1)
  check('existing history regenerates through physics_generate_experiment after restart, without a fresh solve or changed physics facts')

  fixture.mock.setMode('invalid-always')
  const failureStart = fixture.mock.requests.length
  await newChat()
  const failedSessionId = await send('再次解题并生成本题代码实验：' + CHAT_CODE_QUESTION)
  await expect(card().locator('[data-question-code-status="failed"]')).toBeVisible({ timeout: 180000 })
  await expect(card().locator('iframe')).toHaveCount(0)
  await expect(card().getByRole('button', { name: '在实验室中探索', exact: true })).toBeDisabled()
  await expect(card().getByRole('button', { name: '重新生成本题实验', exact: true })).toBeEnabled()
  const failures = fixture.mock.requests.slice(failureStart).filter(request => request.kind === 'code-child')
  expect(failures).toHaveLength(2)
  expect(failures.map(request => request.repair)).toEqual([false, true])
  const failedScene = finalScene(await sessionLog(fixture.home, failedSessionId))
  expect(failedScene.visualization.status).toBe('failed')
  expect(failedScene.solve).toBeTruthy()
  check('invalid generated source has one bounded repair and a visible failed state with retained solve, retry and no old canvas')
  await shot('04-bounded-code-generation-failure')

  // Legacy references are gated before any preview/source request or renderer mount.
  fixture.mock.setMode('good')
  await go('about:blank')
  await fixture.stopWeb()
  const legacy = await sessionLog(fixture.home, ownerSessionId)
  await rewriteSession(legacy, event => { if (event.type === 'physics/scene' && event.data.visualization?.status === 'ready') delete event.data.visualization.rendererKind })
  await fixture.startWeb()
  await go(fixture.authUrl)
  const loadCount = privateLoads.length
  await openSession(ownerSessionId)
  await expect(card().locator('[data-question-code-status="upgrade-required"]')).toBeVisible({ timeout: 60000 })
  await expect(card().locator('iframe')).toHaveCount(0)
  expect(privateLoads.length).toBe(loadCount)
  await card().getByRole('button', { name: '升级为独立实验', exact: true }).click()
  await expect(card().locator('[data-question-code-status]')).not.toHaveAttribute('data-question-code-status', 'upgrade-required', { timeout: 60000 })
  await codeReady()
  expect(finalScene(await sessionLog(fixture.home, ownerSessionId)).visualization.rendererKind).toBe('independent')
  await shot('05-legacy-manually-upgraded-independent-canvas')
  await go('about:blank')
  await fixture.stopWeb()
  await rewriteSession(await sessionLog(fixture.home, ownerSessionId), event => { if (event.type === 'physics/scene') delete event.data.visualization })
  await fixture.startWeb()
  await go(fixture.authUrl)
  await openSession(ownerSessionId)
  await expect(card().locator('[data-question-code-status="historical"]')).toBeVisible({ timeout: 60000 })
  await expect(card().locator('iframe')).toHaveCount(0)
  await expect(card().getByRole('button', { name: '在实验室中探索', exact: true })).toBeDisabled()
  await shot('05-old-history-no-template-fallback')
  const historicalStart = fixture.mock.requests.length
  await card().getByRole('button', { name: '生成本题实验', exact: true }).click()
  await codeReady()
  const recovered = finalScene(await sessionLog(fixture.home, ownerSessionId))
  expect(canonical({ scene: recovered.scene, solve: recovered.solve })).toBe(originalFacts)
  expect(fixture.mock.requests.slice(historicalStart).filter(request => request.kind === 'parent-solve')).toHaveLength(0)
  expect(fixture.mock.requests.slice(historicalStart).filter(request => request.kind === 'code-child')).toHaveLength(1)
  check('legacy kind has no fetch/mount until manual upgrade; missing-artifact history generates independent code without old-template fallback')
  await shot('06-history-regenerated-private-code')

  await checkBrowserErrors()
  check('browser gate: zero unexpected console/page/request/HTTP errors')
  evidence = { ...evidence, initialRef: ref, regeneratedRef: regenerated.visualization, recoveredRef: recovered.visualization, failed: { sessionId: failedSessionId, code: failedScene.visualization.code, childAttempts: failures.length }, childFirstRequest: childRequest, sourceSha256: hash(CHAT_CODE_SOURCE.rendererJs), liveFrames: liveFrames.map(item => ({ name: item.name, clock: item.snapshot.clock, body: item.snapshot.view.bodies[0], paint: item.paint })), exploration, snapshots: changedSnapshots.map(snapshot => ({ domain: snapshot.domain, title: snapshot.title, revision: snapshot.revision, inspector: snapshot.inspector, clock: snapshot.clock })), browserErrors: errors, expectedClientAborts }
  await writeFile(join(shots, 'acceptance-result.json'), JSON.stringify({ passed: true, checks, evidence }, null, 2))
  console.log('PASS authenticated Web chat code acceptance (' + checks.length + ' gates)')
  }
} catch (error) {
  await writeFile(join(shots, 'acceptance-result.json'), JSON.stringify({ passed: false, checks, error: cleanError(error.stack ?? error.message), evidence, browserErrors: errors, expectedClientAborts }, null, 2))
  try { await shot('failure') } catch {}
  throw new Error(cleanError(error.stack ?? error.message))
} finally {
  await context.close(); await browser.close(); await fixture.stop()
}
