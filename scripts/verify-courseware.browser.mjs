/** Real candidate-browser acceptance. Source only; never run automatically or on this Mac.
 * Required: COURSEWARE_BASE, COURSEWARE_STORAGE_STATE (isolated teacher acceptance account).
 * Optional: COURSEWARE_STUDENT_STATE / COURSEWARE_FOREIGN_STATE / COURSEWARE_OUTPUT.
 * Run from the main repository with its pinned @playwright/test Chromium. No mocked HTML/API,
 * no disabling Chromium's sandbox, no cookie/password/token output. New data is left soft-deleted.
 */
import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))
const { chromium } = require('@playwright/test')
const base = process.env.COURSEWARE_BASE
const storageState = process.env.COURSEWARE_STORAGE_STATE
assert.ok(base && /^https?:\/\//.test(base), 'Set COURSEWARE_BASE to the isolated candidate URL')
assert.ok(storageState, 'Set COURSEWARE_STORAGE_STATE for a dedicated teacher acceptance account')
const origin = new URL(base).origin
const output = resolve(process.env.COURSEWARE_OUTPUT ?? resolve(root, '.artifacts/courseware-browser'))
await mkdir(output, { recursive: true })
const originalPath = resolve(root, 'examples/courseware/sound-properties/sound-properties-guizhou-c.original.html')
const originalBytes = await readFile(originalPath)
const sourceHash = createHash('sha256').update(originalBytes).digest('hex')
const browser = await chromium.launch({ headless: true, chromiumSandbox: true })
const report = { passed: false, sourceSha256: sourceHash, coverage: { teacher: true, student: !!process.env.COURSEWARE_STUDENT_STATE, foreignSchool: !!process.env.COURSEWARE_FOREIGN_STATE, postgresLane: false }, checks: [], screenshots: [], externalRequests: [], errors: [] }
let cleanupDeck
let cleanupContext
const check = (name, success, facts) => { report.checks.push({ name, passed: !!success, ...(facts ? { facts } : {}) }); assert.ok(success, name) }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, storageState })
  cleanupContext = context
  const page = await context.newPage()
  const externalRequests = []
  context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(new URL(request.url()).origin) })
  page.on('pageerror', error => report.errors.push(error.message.slice(0, 240)))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /^(课件|HTML 课件|Courseware)$/ }).first().click()
  const classroom = page.locator('[data-courseware-classroom]')
  await classroom.getByRole('heading', { name: '课件库', exact: true }).waitFor()
  await classroom.getByRole('button', { name: '导入 HTML 课件', exact: true }).click()
  const importDialog = page.getByRole('dialog')
  const title = `课件真实验收 ${Date.now()}`
  await importDialog.getByLabel('HTML 文件').setInputFiles(originalPath)
  await importDialog.getByLabel('课件名称').fill(title)
  await importDialog.getByRole('button', { name: '安全导入课件', exact: true }).click()
  await classroom.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 120000 })
  await classroom.getByRole('combobox', { name: '跳转课件页' }).locator('option').filter({ hasText: '声音的特性' }).first().waitFor({ state: 'attached', timeout: 30000 })
  const owner = await page.evaluate(async () => { const response = await fetch('/physicsos/auth/me', { credentials: 'same-origin' }); if (!response.ok) throw new Error('Auth me failed'); const value = await response.json(); const user = value.user ?? value; return { schoolId: user.schoolId, username: user.username } })
  const headers = { 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify(owner)), 'x-physicsos-courseware-capability': 'courseware-v1' }
  const libraryResponse = await context.request.get(`${origin}/physicsos/courseware?scope=mine&search=${encodeURIComponent(title)}`, { headers })
  check('actual-server-import', libraryResponse.ok())
  const library = await libraryResponse.json(); const deck = library.items.find(item => item.title === title); assert.ok(deck); cleanupDeck = deck.id
  const recordResponse = await context.request.get(`${origin}/physicsos/courseware/${deck.id}`, { headers }); const record = await recordResponse.json()
  check('real-original-and-31-stable-ids', record.versions[0].source.digest === sourceHash && record.versions[0].slideIds.length === 31 && record.versions[0].mode === 'slides')
  const download = await context.request.get(`${origin}/physicsos/courseware/${deck.id}/source/${deck.activeVersionId}`, { headers })
  check('original-byte-exact-retrieval', createHash('sha256').update(await download.body()).digest('hex') === sourceHash)
  const wrapperElement = classroom.getByTestId('courseware-player')
  const contentFrame = async () => { const outer = await wrapperElement.elementHandle(); const wrapper = await outer.contentFrame(); assert.ok(wrapper); const child = await wrapper.$('iframe#courseware'); assert.ok(child); const raw = await child.contentFrame(); assert.ok(raw); return raw }
  let raw = await contentFrame()
  await raw.waitForFunction(() => document.body.dataset.assetsReady === 'true', undefined, { timeout: 45000 })
  check('actual-images-and-fonts-ready', await raw.evaluate(() => document.fonts.check('700 78px "PhysicsOS Course Serif"') && [...document.images].every(image => image.complete && image.naturalWidth > 0)))
  const childSandbox = await (await wrapperElement.elementHandle()).contentFrame().then(frame => frame.locator('#courseware').getAttribute('sandbox'))
  check('opaque-child-scripts-only', childSandbox === 'allow-scripts')
  const topRaw = await context.newPage(); const topRawResponse = await topRaw.goto(raw.url()); check('raw-content-cannot-execute-as-top-level-document', topRawResponse.status() === 403 && (await topRaw.locator('body').textContent()).includes('EMBED_CONTEXT_REQUIRED')); await topRaw.close()
  const opacity = await raw.evaluate(() => { let cookie = false; let topAccess = false; try { void document.cookie; cookie = true } catch {} try { void parent.document.body; topAccess = true } catch {} return { cookie, topAccess } })
  check('no-child-cookie-or-parent-dom-access', !opacity.cookie && !opacity.topAccess)
  await classroom.getByRole('button', { name: '新开一堂课', exact: true }).click()
  await classroom.locator('[data-save-status="ready"]').waitFor()
  const navigation = classroom.getByRole('combobox', { name: '跳转课件页' })
  const ids = record.versions[0].slideIds
  for (const id of ids) { await navigation.selectOption(id); await raw.waitForFunction(slide => document.getElementById('deckStage').dataset.slideId === slide, id) }
  check('all-31-parent-navigation-acks-drive-real-showPage', (await navigation.locator('option').count()) === 31)
  await navigation.selectOption('pitch-lab'); await raw.waitForFunction(() => document.getElementById('deckStage').dataset.slideId === 'pitch-lab')
  const modelInput = raw.locator('.slide.active input[data-parameter]').first()
  await modelInput.evaluate(input => { input.value = '660'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  check('real-model-slider-still-interactive', await raw.locator('.slide.active').evaluate(node => node.textContent.includes('660')))
  await raw.locator('.slide.active button[data-action="play"]').first().click()
  await raw.locator('.slide.active .audio-status[data-playing="true"]').waitFor({ timeout: 5000 })
  check('real-webaudio-voice-started', (await raw.locator('.slide.active .audio-status').textContent()).includes('660 Hz'))
  await classroom.getByRole('button', { name: '下一页', exact: true }).click()
  await navigation.selectOption('cover'); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'cover')
  await classroom.getByRole('button', { name: /^画笔：/ }).click()
  const layer = classroom.getByTestId('courseware-annotations')
  await layer.waitFor({ state: 'visible' })
  const draw = async (kind, a, b) => {
    await layer.waitFor({ state: 'visible' }); await page.waitForFunction(() => { const layer = document.querySelector('[data-testid="courseware-annotations"]'); return layer && getComputedStyle(layer).pointerEvents === 'auto' })
    const bounds = await layer.boundingBox(); assert.ok(bounds)
    const cdp = await context.newCDPSession(page)
    const x = bounds.x + bounds.width * a[0]; const y = bounds.y + bounds.height * a[1]
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: kind, force: .15 })
    for (let n = 1; n <= 20; n++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + bounds.width * (b[0] - a[0]) * n / 20, y: y + bounds.height * (b[1] - a[1]) * n / 20, button: 'left', buttons: 1, pointerType: kind, force: n / 22 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + bounds.width * b[0], y: bounds.y + bounds.height * b[1], button: 'left', buttons: 0, clickCount: 1, pointerType: kind, force: 0 }); await cdp.detach()
  }
  const exportDraft = async () => {
    const slideId = await classroom.getAttribute('data-active-slide')
    await page.waitForFunction(id => { const root = document.querySelector('[data-courseware-classroom]'); const layer = root?.querySelector('[data-testid="courseware-annotations"]'); return root?.getAttribute('data-active-slide') === id && layer && !root.querySelector('[data-save-status="loading"]') }, slideId)
    await classroom.getByRole('button', { name: '草稿', exact: true }).click(); const dialog = page.getByRole('dialog'); const text = await dialog.getByRole('textbox', { name: '完整课件批注草稿 JSON' }).inputValue(); await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click(); return JSON.parse(text)
  }
  await draw('pen', [.25, .35], [.45, .5]); await classroom.locator('[data-save-status="ready"]').waitFor()
  let draft = await exportDraft(); const stroke = draft.base.scene.primitives.find(p => p.type === 'polyline')
  check('pressure-and-stage-normalization', stroke.samples.length >= 21 && stroke.samples.some(p => p.pressure > .7) && Math.abs(stroke.samples[0].x / 1920 - .25) < .01 && Math.abs(stroke.samples[0].y / 1080 - .35) < .01, { logicalStart: [stroke.samples[0].x, stroke.samples[0].y], cssViewport: await layer.boundingBox(), dpr: 2 })
  const screenshot = resolve(output, 'courseware-pressure-stage-1440.png'); await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot)
  await classroom.getByRole('button', { name: '下一页', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'guizhou-question'); check('next-page-has-no-cover-ink', (await exportDraft()).base.scene.primitives.length === 0)
  await classroom.getByRole('button', { name: '上一页', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'cover'); check('return-restores-cover-ink', (await exportDraft()).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '撤销', exact: true }).click(); await classroom.locator('[data-save-status="ready"]').waitFor(); check('delta-undo', !(await exportDraft()).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '重做', exact: true }).click(); await classroom.locator('[data-save-status="ready"]').waitFor(); check('delta-redo', (await exportDraft()).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '清空本页', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); check('clear-cancel-preserves-ink', (await exportDraft()).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '全屏', exact: true }).click(); check('real-fullscreen', await page.evaluate(() => !!document.fullscreenElement)); await draw('pen', [.6, .25], [.8, .35]); await classroom.locator('[data-save-status="ready"]').waitFor()
  draft = await exportDraft(); const fullPen = draft.base.scene.primitives.at(-1); check('fullscreen-real-stage-coordinate', Math.abs(fullPen.samples[0].x / 1920 - .6) < .01)
  await classroom.getByRole('button', { name: '退出全屏', exact: true }).click()
  const touch = await context.newCDPSession(page); await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await layer.waitFor({ state: 'visible' }); const touchBounds = await layer.boundingBox(); assert.ok(touchBounds)
  const touchPoint = (fraction, force) => ({ x: touchBounds.x + touchBounds.width * fraction, y: touchBounds.y + touchBounds.height * .75, force, radiusX: 3, radiusY: 3, id: 1 })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(.2, .25)] }); await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(.3, .8)] }); await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await touch.detach()
  await classroom.locator('[data-save-status="ready"]').waitFor(); const touchInk = (await exportDraft()).base.scene.primitives.at(-1)
  check('real-touch-stage-coordinates', touchInk.samples.length >= 2 && Math.abs(touchInk.samples[0].x / 1920 - .2) < .015 && Math.abs(touchInk.samples[0].y / 1080 - .75) < .015)
  await classroom.getByRole('button', { name: '＋ 空白板页', exact: true }).click(); await classroom.getByTestId('courseware-blank-page').waitFor(); await draw('pen', [.2, .3], [.3, .4]); await classroom.locator('[data-save-status="ready"]').waitFor(); check('blank-page-is-distinct', (await exportDraft()).slideId.startsWith('blank_'))
  await classroom.getByRole('combobox', { name: '选择临时白板页' }).selectOption(''); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'cover'); await layer.waitFor({ state: 'visible' })
  await context.setOffline(true); await draw('pen', [.1, .65], [.2, .7]); await classroom.locator('[data-save-status="offline"]').waitFor({ timeout: 20000 }); const offline = await exportDraft(); check('offline-request-and-operation-retained', offline.pending.length > 0 && !!offline.pending[0].request)
  await context.setOffline(false); await classroom.getByRole('button', { name: '重试保存', exact: true }).click(); await classroom.locator('[data-save-status="ready"]').waitFor({ timeout: 20000 })
  check('offline-replay-acknowledged', (await exportDraft()).pending.length === 0)
  for (const width of [1440, 1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 920 : 1000 }); await layer.waitFor({ state: 'visible' })
    const geometry = await classroom.evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, viewport: innerWidth } })
    check(`layout-no-horizontal-overflow-${width}`, geometry.x >= -1 && geometry.right <= geometry.viewport + 1 && geometry.scrollWidth <= geometry.clientWidth + 1, geometry)
    await classroom.getByRole('button', { name: /^画笔：/ }).click(); await draw('mouse', [.42, .62], [.5, .67]); await classroom.locator('[data-save-status="ready"]').waitFor()
    const actual = (await exportDraft()).base.scene.primitives.at(-1); check(`normalized-ink-at-${width}`, Math.abs(actual.samples[0].x / 1920 - .42) < .015 && Math.abs(actual.samples[0].y / 1080 - .62) < .015)
    const path = resolve(output, `courseware-${width}.png`); await page.screenshot({ path }); report.screenshots.push(path)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const lessonId = await classroom.getAttribute('data-lesson-session'); assert.ok(lessonId)
  const beforeReload = await exportDraft()
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: /^(课件|HTML 课件|Courseware)$/ }).first().click()
  await classroom.getByRole('textbox', { name: '搜索课件' }).fill(title); await classroom.getByRole('button', { name: '搜索', exact: true }).click()
  await classroom.getByRole('heading', { name: title, exact: true }).locator('..').getByRole('button', { name: '打开课件', exact: true }).click()
  raw = await contentFrame(); await classroom.getByRole('combobox', { name: '恢复已有授课' }).selectOption(lessonId); await classroom.getByRole('button', { name: '继续这堂课', exact: true }).click()
  await classroom.locator('[data-save-status="ready"]').waitFor(); check('server-and-idb-reload-keep-version-lesson-and-raw-ink', JSON.stringify((await exportDraft()).base.scene) === JSON.stringify(beforeReload.base.scene))
  // Private/school authorization is verified by actual endpoint responses, not a mocked role.
  for (const [role, statePath] of [['student', process.env.COURSEWARE_STUDENT_STATE], ['foreign-school', process.env.COURSEWARE_FOREIGN_STATE]]) if (statePath) {
    const other = await browser.newContext({ storageState: statePath }); const response = await other.request.get(`${origin}/physicsos/courseware/${deck.id}`); check(`${role}-private-deck-denied`, response.status() === 404); await other.close()
  }
  await classroom.getByRole('button', { name: '发布到本校', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  if (process.env.COURSEWARE_STUDENT_STATE) {
    const student = await browser.newContext({ storageState: process.env.COURSEWARE_STUDENT_STATE }); const read = await student.request.get(`${origin}/physicsos/courseware/${deck.id}`); check('student-read-current-school-version', read.ok() && (await read.json()).versions.length === 1); const write = await student.request.post(`${origin}/physicsos/courseware/${deck.id}/lessons`, { headers: { 'content-type': 'application/json', 'x-physicsos-courseware-capability': 'courseware-v1' }, data: { versionId: record.deck.activeVersionId, operationId: `student_${Date.now()}` } }); check('student-cannot-start-durable-lesson', write.status() === 403); await student.close()
  }
  check('real-courseware-no-uncaught-browser-errors', report.errors.length === 0)
  // Runtime defense in depth: obfuscated APIs pass syntax inspection, but CSP/sandbox MUST block them.
  // The target is never visited or mocked. A request event itself is a failure.
  const evil = `<!doctype html><html><head><title>隔离自导航负例</title></head><body><button id="go">触发隔离负例</button><script>document.getElementById('go').addEventListener('click',()=>{const w=window;const target='https://courseware-security-probe.invalid/never-request';try{w['op'+'en'](target,'_blank')}catch{}try{w['fet'+'ch'](target)}catch{}try{const frame=document.createElement('iframe');frame.src=target;document.body.append(frame)}catch{}try{w['loca'+'tion']['hr'+'ef']=target}catch{}})</script></body></html>`
  const negativeImport = await context.request.post(`${origin}/physicsos/courseware`, { headers: { ...headers, 'content-type': 'application/json', origin }, data: { title: `Security probe ${Date.now()}`, description: 'Isolation acceptance', operationId: `security_${Date.now()}`, htmlBase64: Buffer.from(evil).toString('base64') } })
  check('negative-probe-admitted-without-running-on-server', negativeImport.ok()); const negative = await negativeImport.json()
  const ticketRes = await context.request.post(`${origin}/physicsos/courseware/${negative.deck.id}/tickets`, { headers: { ...headers, 'content-type': 'application/json' }, data: { versionId: negative.deck.activeVersionId } }); const negativeTicket = await ticketRes.json()
  const probePage = await context.newPage(); let popup = false; probePage.on('popup', () => { popup = true })
  await probePage.goto(`${origin}${negativeTicket.wrapperUrl}`)
  const evilChild = await (await probePage.locator('#courseware').elementHandle()).contentFrame(); await evilChild.locator('#go').click(); await probePage.waitForTimeout(1000)
  check('wrapper-blocks-external-self-navigation-popup-frame-fetch', !popup && !externalRequests.includes('https://courseware-security-probe.invalid') && new URL(evilChild.url()).pathname.startsWith('/physicsos/courseware/content/'))
  await probePage.close()
  await context.request.post(`${origin}/physicsos/courseware/${negative.deck.id}/manage`, { headers: { ...headers, 'content-type': 'application/json' }, data: { expectedRevision: negative.deck.revision, operationId: `cleanup_security_${Date.now()}`, action: 'delete' } })
  check('real-courseware-no-external-requests', externalRequests.length === 0, { count: externalRequests.length })
  report.externalRequests = [...new Set(externalRequests)]
  report.passed = true
} catch (error) { report.failure = error instanceof Error ? error.message : 'courseware-browser-failed' }
finally {
  if (cleanupContext && cleanupDeck) try { const response = await cleanupContext.request.get(`${origin}/physicsos/courseware/${cleanupDeck}`); if (response.ok()) { const current = await response.json(); await cleanupContext.request.post(`${origin}/physicsos/courseware/${cleanupDeck}/manage`, { headers: { 'content-type': 'application/json', 'x-physicsos-courseware-capability': 'courseware-v1', origin }, data: { expectedRevision: current.deck.revision, operationId: `cleanup_${Date.now()}`, action: 'delete' } }) } } catch { report.cleanupPending = true }
  await browser.close()
  await writeFile(resolve(output, 'result.json'), `${JSON.stringify(report, null, 2)}\n`)
}
process.stdout.write(JSON.stringify({ passed: report.passed, checks: report.checks.length, output, failure: report.failure }) + '\n')
process.exitCode = report.passed ? 0 : 1
