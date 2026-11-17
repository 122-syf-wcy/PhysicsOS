/** Thin, real-browser acceptance helpers. No product imports, successful-response mocks or server commands. */
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

export const SOURCE_BYTES = 3_317_789
export const SOURCE_SHA256 = '9ab882e3643fc669d04138388b590f492151ca48c1022b61dc68627acb92403e'
export const NAV_NAME = /^(课件与授课|Courseware & teaching|课件|HTML 课件|Courseware)$/
// Exact AuthUser wire enum from auth-api.ts; no lowercase role aliases or guessed ID conversion.
export const AUTH_ROLES = Object.freeze(['TEACHER', 'STUDENT', 'SCHOOL_ADMIN', 'SUPER_ADMIN'])
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const sceneIds = scene => scene.primitives.map(primitive => primitive.id)
export const operationId = prefix => `${prefix}_${randomUUID()}`
export const pagePath = (deckId, lessonId, slideId) => `/physicsos/courseware/${encodeURIComponent(deckId)}/lessons/${encodeURIComponent(lessonId)}/pages/${encodeURIComponent(slideId)}`

const productionHost = 'physics.dongsiwei.com'
const publicMessage = error => String(error instanceof Error ? error.message : error).replace(/https?:\/\/[^\s)"']+/g, value => {
  try { const url = new URL(value); return `${url.origin}${url.pathname.replace(/\/(embed|content)\/[^/]+/, '/$1/[redacted]')}` } catch { return '[redacted URL]' }
}).slice(0, 1200)
export { publicMessage }

async function jsonFile(path, label) {
  assert.ok(path && isAbsolute(path), `${label} must be an absolute file path`)
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { throw new Error(`${label} is missing or is not valid JSON`) }
}
function candidateOrigin(value) {
  assert.ok(typeof value === 'string', 'A candidate origin is required')
  const url = new URL(value)
  assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Use an HTTP(S) candidate without URL credentials')
  assert.notEqual(url.hostname.toLowerCase().replace(/\.$/, ''), productionHost, 'The public production hostname is forbidden, including alternate ports')
  return url.origin
}
export async function acceptanceConfig(root, env) {
  const base = env.COURSEWARE_BASE
  const origin = candidateOrigin(base)
  const expected = await jsonFile(env.COURSEWARE_EXPECTED_FIXTURE, 'COURSEWARE_EXPECTED_FIXTURE')
  assert.ok(expected.schemaVersion === 1 && expected.isolatedTestData === true, 'Explicit isolated test-data acknowledgement is required')
  assert.equal(candidateOrigin(expected.candidateOrigin), origin, 'BASE must match the exact candidate origin in the expected fixture')
  assert.ok(['enabled', 'bridge'].includes(expected.mode), 'Expected fixture mode must be enabled or bridge')
  if (expected.restoredFromOrigin !== undefined) assert.equal(candidateOrigin(expected.restoredFromOrigin), expected.restoredFromOrigin, 'An explicit bridge restore origin must be a canonical non-production candidate origin')
  const roles = ['teacher', 'student', 'foreign']
  const stateNames = ['COURSEWARE_STORAGE_STATE', 'COURSEWARE_STUDENT_STATE', 'COURSEWARE_FOREIGN_STATE']
  const states = {}
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index], identity = expected[role]
    assert.ok(identity?.testAccount === true && ['schoolId', 'schoolName', 'username', 'id', 'role'].every(key => typeof identity[key] === 'string' && identity[key].length > 0 && identity[key].length <= 256), `${role} requires an exact, explicitly test-only AuthUser identity`)
    assert.ok(AUTH_ROLES.includes(identity.role), `${role} must use the exact uppercase AuthUser wire role`)
    const state = await jsonFile(env[stateNames[index]], stateNames[index])
    assert.ok(Array.isArray(state.cookies) && Array.isArray(state.origins) && Object.keys(state).every(key => ['cookies', 'origins'].includes(key)), `${role} storage state must contain authentication cookies/localStorage only`)
    assert.ok(state.origins.every(item => item.origin === origin && !('indexedDB' in item) && Object.keys(item).every(key => ['origin', 'localStorage'].includes(key))), `${role} storage state must not restore old IndexedDB or another origin`)
    states[role] = state
  }
  assert.equal(expected.teacher.role, 'TEACHER', 'The write fixture must be a dedicated teacher')
  assert.equal(expected.student.role, 'STUDENT', 'The same-school fixture must be a real student')
  assert.equal(expected.teacher.schoolId, expected.student.schoolId, 'Teacher and student must be in the same test school')
  assert.notEqual(expected.teacher.schoolId, expected.foreign.schoolId, 'Foreign fixture must belong to a different test school')
  assert.notEqual(expected.teacher.id, expected.student.id, 'Teacher and student must be different accounts')
  assert.notEqual(expected.teacher.username, expected.student.username, 'Teacher and student must be different accounts')
  const phase = env.COURSEWARE_PHASE ?? 'core'
  assert.ok(['core', 'before-restart', 'after-restart', 'bridge'].includes(phase), 'Unknown courseware acceptance phase')
  if (env.COURSEWARE_OUTPUT !== undefined) assert.ok(isAbsolute(env.COURSEWARE_OUTPUT), 'COURSEWARE_OUTPUT must be an absolute private path')
  return { base, origin, expected, states, phase, root, output: resolve(env.COURSEWARE_OUTPUT ?? resolve(root, '.artifacts/courseware-browser', `${Date.now()}-${randomUUID()}`)) }
}

export function isModelInferenceRequest(request) {
  if (request.method() !== 'POST') return false
  const path = new URL(request.url()).pathname
  return /^\/physicsos\/whiteboards\/[^/]+\/generations\/?$/.test(path) || /^\/physicsos\/learning\/canvases\/[^/]+\/assistant\/jobs\/?$/.test(path) || /\/v1\/(chat\/completions|responses|messages)\/?$/.test(path)
}
export async function fixtureUi(browser, config, role, report, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 1000 }, deviceScaleFactor: options.dpr ?? 2, storageState: config.states[role], serviceWorkers: 'block' })
  context.on('page', page => page.on('pageerror', error => report.errors.push({ role, message: publicMessage(error) })))
  report.modelRequests ??= []
  const countedModels = new WeakSet()
  const recordModel = request => {
    if (!isModelInferenceRequest(request)) return false
    if (!countedModels.has(request)) { countedModels.add(request); report.modelRequests.push({ role, method: request.method(), path: new URL(request.url()).pathname }) }
    return true
  }
  context.on('request', request => {
    const url = new URL(request.url())
    recordModel(request)
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== config.origin) report.externalRequests.push(url.origin)
  })
  // No success body is supplied. Inference and external attempts are counted BEFORE being aborted.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (recordModel(request)) { await route.abort('blockedbyclient'); return }
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== config.origin) {
      report.externalRequests.push(url.origin)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const page = await context.newPage()
  try {
    await page.goto(config.base, { waitUntil: 'domcontentloaded' })
    const auth = await page.evaluate(async () => { const response = await fetch('/physicsos/auth/me', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' }); if (!response.ok) return { status: response.status }; return { status: response.status, body: await response.json() } })
    assert.equal(auth.status, 200, `${role} must be genuinely authenticated`)
    const user = auth.body?.user
    assert.ok(user && ['id', 'schoolId', 'schoolName', 'username', 'displayName'].every(key => typeof user[key] === 'string') && AUTH_ROLES.includes(user.role), 'Auth me must return {user: AuthUser} with flat school fields and an exact wire role')
    if (role === 'teacher') assert.ok(await page.evaluate(() => isSecureContext && typeof crypto.randomUUID === 'function' && typeof indexedDB !== 'undefined'), 'Use HTTPS or a trustworthy loopback candidate for real stable-tab/IndexedDB acceptance')
    for (const key of ['schoolId', 'schoolName', 'username', 'id', 'role']) assert.equal(user[key], config.expected[role][key], `${role} ${key} does not match the expected test fixture`)
    report.authRoleEncoding = 'AuthUser wire enum: TEACHER/STUDENT/SCHOOL_ADMIN/SUPER_ADMIN; no aliases'
    report.coverage[role === 'foreign' ? 'foreignSchool' : role] = true
    return { context, page, actor: user, config, classroom: page.locator('[data-courseware-classroom]') }
  } catch (error) { await context.close(); throw error }
}
export async function requestJson(ui, path, { method = 'GET', data } = {}) {
  assert.equal(new URL(path, ui.config.origin).origin, ui.config.origin, 'Acceptance API requests must remain same-origin')
  assert.ok(path.startsWith('/physicsos/courseware') || path === '/physicsos/auth/me', 'Only courseware/auth acceptance APIs are allowed')
  // Browser fetch, not APIRequestContext: Chromium generates the actual Origin and Fetch Metadata.
  return ui.page.evaluate(async ({ path, method, data, owner }) => {
    const headers = method === 'GET' ? {} : { 'content-type': 'application/json', 'x-physicsos-courseware-capability': 'courseware-v1', 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify(owner)) }
    const response = await fetch(path, { method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store', ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const text = await response.text()
    let body
    try { body = text ? JSON.parse(text) : undefined } catch { throw new Error(`Acceptance API returned non-JSON (HTTP ${response.status})`) }
    return { ok: response.ok, status: response.status, body }
  }, { path, method, data, owner: { schoolId: ui.actor.schoolId, username: ui.actor.username } })
}
export async function readJson(ui, path) {
  const response = await requestJson(ui, path)
  assert.ok(response.ok, `Real GET failed (${response.status}): ${path}`)
  return response.body
}
export async function downloadBytes(ui, path) {
  const responsePromise = ui.page.waitForResponse(response => response.url() === `${ui.config.origin}${path}` && response.request().method() === 'GET')
  void responsePromise.catch(() => {}) // A failed browser fetch must not leave an unhandled waiter on close.
  const status = await ui.page.evaluate(async path => { const response = await fetch(path, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' }); await response.arrayBuffer(); return response.status }, path)
  const response = await responsePromise
  assert.equal(status, 200, 'The real original source download must succeed')
  return response.body()
}
export async function libraryUi(ui) {
  await ui.page.getByRole('button', { name: NAV_NAME }).first().click()
  const back = ui.classroom.getByRole('button', { name: '返回课件库', exact: true })
  if (await back.count()) await back.click()
  await ui.classroom.getByRole('heading', { name: '课件库', exact: true }).waitFor()
}
export async function contentFrame(ui) {
  const outer = await ui.classroom.getByTestId('courseware-player').elementHandle()
  assert.ok(outer)
  const wrapper = await outer.contentFrame(); assert.ok(wrapper)
  await wrapper.locator('iframe#courseware').waitFor({ state: 'attached' })
  const child = await wrapper.locator('iframe#courseware').elementHandle()
  const frame = await child.contentFrame(); assert.ok(frame)
  return frame
}
export async function exportDraft(ui) {
  const slideId = await ui.classroom.getAttribute('data-active-slide')
  await ui.page.waitForFunction(id => { const root = document.querySelector('[data-courseware-classroom]'); return root?.getAttribute('data-active-slide') === id && root.querySelector('[data-testid="courseware-annotations"]') && !root.querySelector('[data-save-status="loading"]') }, slideId)
  await ui.classroom.getByRole('button', { name: '草稿', exact: true }).click()
  const dialog = ui.page.getByRole('dialog'), text = await dialog.getByRole('textbox', { name: '完整课件批注草稿 JSON' }).inputValue()
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  return JSON.parse(text)
}
export async function renderedIds(ui) {
  return ui.classroom.getByTestId('courseware-annotations').locator('[data-annotation-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-annotation-id')).filter(id => id !== 'active_preview'))
}
export async function savedDraft(ui, { ids, scene, timeout = 30000 } = {}) {
  const lessonId = await ui.classroom.getAttribute('data-lesson-session'), slideId = await ui.classroom.getAttribute('data-active-slide')
  assert.ok(lessonId && slideId, 'A real lesson and page must be selected before save verification')
  await ui.page.waitForFunction(({ lessonId, slideId }) => {
    const root = document.querySelector('[data-courseware-classroom]'), status = root?.querySelector('[data-save-status]')?.getAttribute('data-save-status')
    return root?.getAttribute('data-lesson-session') === lessonId && root.getAttribute('data-active-slide') === slideId && ['ready', 'saving', 'offline'].includes(status)
  }, { lessonId, slideId }, { timeout })
  const expectedIds = ids ?? await renderedIds(ui)
  // ready alone is editable/pending. The exact saved label plus exported queue and authority GET all agree.
  await ui.page.waitForFunction(({ lessonId, slideId }) => {
    const root = document.querySelector('[data-courseware-classroom]'), status = root?.querySelector('[data-save-status]')
    return root?.getAttribute('data-lesson-session') === lessonId && root.getAttribute('data-active-slide') === slideId && status?.getAttribute('data-save-status') === 'ready' && status.textContent.trim() === '批注已保存'
  }, { lessonId, slideId }, { timeout })
  const draft = await exportDraft(ui)
  assert.equal(draft.pending.length, 0, 'The complete local operation queue must be acknowledged')
  assert.equal(draft.namespace, `${encodeURIComponent(ui.actor.schoolId)}|${encodeURIComponent(ui.actor.id)}`, 'The complete draft must belong to the verified actor namespace')
  const head = await readJson(ui, pagePath(draft.deckId, lessonId, slideId))
  assert.equal(head.revision, draft.base.revision, 'The UI base revision must match the actual server head')
  assert.deepEqual(head.scene, draft.base.scene, 'The complete UI base must equal the actual saved scene')
  assert.deepEqual(sceneIds(head.scene), expectedIds, 'All expected primitive IDs must be durably saved in order')
  if (scene) assert.deepEqual(head.scene, scene, 'Complete raw ink must remain byte-for-byte JSON-equivalent')
  return draft
}
export async function actualStage(ui) {
  const layer = ui.classroom.getByTestId('courseware-annotations')
  await layer.waitFor({ state: 'visible' })
  const blank = ui.classroom.getByTestId('courseware-blank-page')
  const actual = await blank.isVisible() ? await blank.boundingBox() : await (await contentFrame(ui)).locator('#deckStage').boundingBox()
  assert.ok(actual, 'The actual authored stage must be visible')
  // Wait for the real resize/state report, not an arbitrary delay. Recheck against a fresh stage box below.
  await ui.page.waitForFunction(expected => {
    const box = document.querySelector('[data-testid="courseware-annotations"]')?.getBoundingClientRect()
    return box && ['x', 'y', 'width', 'height'].every(key => Math.abs(box[key] - expected[key]) <= .75)
  }, actual)
  const current = await blank.isVisible() ? await blank.boundingBox() : await (await contentFrame(ui)).locator('#deckStage').boundingBox()
  const overlay = await layer.boundingBox()
  assert.ok(current && overlay, 'The actual authored stage and annotation layer must both be visible')
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(current[key] - overlay[key]) <= .75, `Annotation ${key} must match the actual stage in main-frame CSS pixels`)
  assert.equal(await layer.getAttribute('viewBox'), '0 0 1920 1080', 'The fixed SVG viewBox must match the authored stage')
  return { actual: current, overlay }
}
export async function drawInk(ui, kind, a, b) {
  await ui.page.bringToFront()
  const layer = ui.classroom.getByTestId('courseware-annotations')
  await layer.waitFor({ state: 'visible' })
  await ui.page.waitForFunction(() => { const layer = document.querySelector('[data-testid="courseware-annotations"]'); return layer && getComputedStyle(layer).pointerEvents === 'auto' })
  const before = await renderedIds(ui), bounds = (await actualStage(ui)).actual
  const cdp = await ui.context.newCDPSession(ui.page), x = bounds.x + bounds.width * a[0], y = bounds.y + bounds.height * a[1]
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: kind, force: .15 })
    for (let n = 1; n <= 20; n++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + bounds.width * (b[0] - a[0]) * n / 20, y: y + bounds.height * (b[1] - a[1]) * n / 20, button: 'left', buttons: 1, pointerType: kind, force: n / 22 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds.x + bounds.width * b[0], y: bounds.y + bounds.height * b[1], button: 'left', buttons: 0, clickCount: 1, pointerType: kind, force: 0 })
  } finally { await cdp.detach() }
  await ui.page.waitForFunction(count => document.querySelectorAll('[data-testid="courseware-annotations"] [data-annotation-id]:not([data-annotation-id="active_preview"])').length === count + 1, before.length)
  const after = await renderedIds(ui); assert.deepEqual(after.slice(0, -1), before)
  return after.at(-1)
}
export async function selectPage(ui, slideId) {
  if (slideId.startsWith('blank_')) await ui.classroom.getByRole('combobox', { name: '选择临时白板页' }).selectOption(slideId)
  else {
    const blank = ui.classroom.getByTestId('courseware-blank-page')
    if (await blank.isVisible()) await ui.classroom.getByRole('combobox', { name: '选择临时白板页' }).selectOption('')
    await ui.classroom.getByRole('combobox', { name: '跳转课件页' }).selectOption(slideId)
    await (await contentFrame(ui)).waitForFunction(id => document.getElementById('deckStage').dataset.slideId === id, slideId)
  }
  await ui.page.waitForFunction(id => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === id, slideId)
}
export async function openLessonUi(ui, title, lessonId, slideId = 'cover', saveOptions = {}) {
  await ui.page.reload({ waitUntil: 'domcontentloaded' }); await libraryUi(ui)
  await ui.classroom.getByRole('textbox', { name: '搜索课件' }).fill(title)
  await ui.classroom.getByRole('button', { name: '搜索', exact: true }).click()
  await ui.classroom.getByRole('heading', { name: title, exact: true }).locator('..').getByRole('button', { name: '打开课件', exact: true }).click()
  await ui.classroom.getByRole('combobox', { name: '恢复已有授课' }).selectOption(lessonId)
  await ui.classroom.getByRole('button', { name: '继续这堂课', exact: true }).click()
  await selectPage(ui, slideId)
  if (saveOptions.readonly) {
    assert.equal(ui.config.expected.mode, 'bridge', 'Readonly lesson verification is reserved for the bridge lane')
    await ui.classroom.locator('[data-save-status="readonly"]').waitFor()
    const draft = await exportDraft(ui); assert.equal(draft.pending.length, 0)
    return draft
  }
  return savedDraft(ui, saveOptions)
}
export async function newLessonUi(ui) {
  assert.equal(ui.config.expected.mode, 'enabled', 'New lessons are forbidden in a bridge acceptance lane')
  const previous = await ui.classroom.getAttribute('data-lesson-session')
  await ui.classroom.getByRole('button', { name: '新开一堂课', exact: true }).click()
  const confirm = ui.page.getByRole('dialog').getByRole('button', { name: '确认', exact: true })
  if (previous) await confirm.click()
  await ui.page.waitForFunction(old => { const id = document.querySelector('[data-courseware-classroom]')?.getAttribute('data-lesson-session'); return id && id !== old }, previous)
  await savedDraft(ui, { ids: [] })
  return ui.classroom.getAttribute('data-lesson-session')
}
export async function retryIfOffline(ui) {
  if (await ui.classroom.locator('[data-save-status]').getAttribute('data-save-status') !== 'offline') return
  try { await ui.classroom.getByRole('button', { name: '重试保存', exact: true }).click({ timeout: 1000 }) }
  catch (error) {
    // The real online listener may have already removed the button. A still-offline UI is a failure.
    if (await ui.classroom.locator('[data-save-status]').getAttribute('data-save-status') === 'offline') throw error
  }
}
export async function cleanupResources(ui, resources, check) {
  await ui.context.setOffline(false)
  for (const [id, title] of resources) {
    const path = `/physicsos/courseware/${encodeURIComponent(id)}`, current = await readJson(ui, path)
    assert.ok(current.deck.mine && current.deck.title === title, 'Cleanup is limited to the exact newly created teacher-owned fixture')
    if (current.deck.lifecycle !== 'deleted') {
      const removed = await requestJson(ui, `${path}/manage`, { method: 'POST', data: { expectedRevision: current.deck.revision, operationId: operationId('cleanup'), action: 'delete' } })
      check(`cleanup-response-${id}`, removed.ok && removed.body?.deck?.lifecycle === 'deleted', { status: removed.status })
    }
    check(`cleanup-tombstone-${id}`, (await readJson(ui, path)).deck.lifecycle === 'deleted')
  }
}
