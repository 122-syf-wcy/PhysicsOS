/** Real candidate-browser acceptance. Never run automatically or on this Mac.
 * Required: COURSEWARE_BASE, COURSEWARE_EXPECTED_FIXTURE and all three authentication states.
 * Root-pinned Playwright Chromium keeps its sandbox; no successful HTML/API response is mocked.
 * Phases: core (scoped/cleaned), before-restart (advanced/retained), after-restart, bridge (read/refuse).
 * Restart is an operator action proven by a full-CID receipt, never an SSH/Docker action here.
 */
import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptanceConfig, fixtureUi, requestJson, readJson, downloadBytes, libraryUi, contentFrame, exportDraft as uiDraft, savedDraft, drawInk, retryIfOffline, actualStage, cleanupResources, sceneIds, operationId, sha256, publicMessage, SOURCE_BYTES, SOURCE_SHA256 } from './courseware-browser-helpers.mjs'
import { classroomTools, casAndLostAck, isolationProbes } from './courseware-browser-advanced.mjs'
import { writeCheckpoint, restartInputs, verifyRestart } from './courseware-browser-restart.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'package.json'))
let output = resolve(process.env.COURSEWARE_OUTPUT ?? resolve(root, '.artifacts/courseware-browser', `${Date.now()}`))
const report = { passed: false, fullAcceptance: false, phase: process.env.COURSEWARE_PHASE ?? 'core', coverage: { teacher: false, student: false, foreignSchool: false, core: false, advanced: false, postgresLane: false }, checks: [], screenshots: [], externalRequests: [], errors: [] }
const check = (name, success, facts) => { report.checks.push({ name, passed: !!success, ...(facts ? { facts } : {}) }); assert.ok(success, name) }
let browser, ui, config, primaryDeck
const resources = new Map()
try {
  config = await acceptanceConfig(root, process.env); output = config.output
  report.candidateOrigin = config.origin
  if (['core', 'before-restart'].includes(config.phase)) assert.equal(config.expected.mode, 'enabled', 'The write flow is enabled-only; bridge must use its separate read-only phase')
  await mkdir(output, { recursive: true, mode: 0o700 })
  const originalPath = resolve(root, 'examples/courseware/sound-properties/sound-properties-guizhou-c.original.html')
  const originalBytes = await readFile(originalPath), sourceHash = sha256(originalBytes)
  check('frozen-original-bytes-and-sha', originalBytes.byteLength === SOURCE_BYTES && sourceHash === SOURCE_SHA256)
  report.sourceSha256 = sourceHash
  const { chromium } = require('@playwright/test')
  browser = await chromium.launch({ headless: true, chromiumSandbox: true })
  ui = await fixtureUi(browser, config, 'teacher', report)
  if (['after-restart', 'bridge'].includes(config.phase)) {
    const inputs = await restartInputs(config, process.env)
    await verifyRestart(ui, inputs, report, check, originalBytes)
    for (const role of ['student', 'foreign']) {
      const other = await fixtureUi(browser, config, role, report)
      try {
        const response = await requestJson(other, `/physicsos/courseware/${inputs.checkpoint.deck.id}`)
        if (role === 'student' && inputs.checkpoint.deck.sharing === 'school') check('student-read-current-school-version', response.ok && response.body.versions.length === 1 && response.body.deck.activeVersionId === inputs.checkpoint.version.id)
        else check(`${role}-checkpoint-deck-denied`, response.status === 404)
      } finally { await other.context.close() }
    }
  } else {
  const { context, page, classroom } = ui
  const capabilities = await readJson(ui, '/physicsos/courseware/capabilities')
  check('real-enabled-write-capabilities', capabilities.capability === 'courseware-v1' && capabilities.schemaVersion === 1 && capabilities.writesEnabled && capabilities.canImport && capabilities.canTeach)
  await libraryUi(ui)
  await classroom.getByRole('button', { name: '导入 HTML 课件', exact: true }).click()
  const importDialog = page.getByRole('dialog'), title = `课件真实验收 ${Date.now()}`
  await importDialog.getByLabel('HTML 文件').setInputFiles(originalPath)
  await importDialog.getByLabel('课件名称').fill(title)
  const importedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/physicsos/courseware' && response.request().method() === 'POST' && response.request().postDataJSON()?.title === title, { timeout: 120000 })
  void importedResponse.catch(() => {})
  await importDialog.getByRole('button', { name: '安全导入课件', exact: true }).click()
  const imported = await importedResponse
  check('actual-server-import', imported.ok())
  const created = await imported.json(); assert.ok(created.deck?.id)
  // Register the exact response ID before later UI waits can fail; never clean up a title search hit alone.
  resources.set(created.deck.id, title)
  await classroom.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 120000 })
  await classroom.getByRole('combobox', { name: '跳转课件页' }).locator('option').filter({ hasText: '声音的特性' }).first().waitFor({ state: 'attached', timeout: 30000 })
  const library = await readJson(ui, `/physicsos/courseware?scope=mine&search=${encodeURIComponent(title)}`)
  const deck = library.items.find(item => item.id === created.deck.id && item.title === title); assert.ok(deck); primaryDeck = deck
  const deckPath = `/physicsos/courseware/${encodeURIComponent(deck.id)}`, record = await readJson(ui, deckPath)
  check('real-original-and-31-stable-ids', record.versions[0].source.digest === sourceHash && record.versions[0].slideIds.length === 31 && record.versions[0].mode === 'slides')
  check('original-byte-exact-retrieval', sha256(await downloadBytes(ui, `${deckPath}/source/${deck.activeVersionId}`)) === sourceHash)
  const wrapperElement = classroom.getByTestId('courseware-player')
  let raw = await contentFrame(ui)
  await raw.waitForFunction(() => document.body.dataset.assetsReady === 'true', undefined, { timeout: 45000 })
  check('actual-images-and-fonts-ready', await raw.evaluate(() => document.fonts.check('700 78px "PhysicsOS Course Serif"') && [...document.images].every(image => image.complete && image.naturalWidth > 0)))
  const childSandbox = await (await wrapperElement.elementHandle()).contentFrame().then(frame => frame.locator('#courseware').getAttribute('sandbox'))
  check('opaque-child-scripts-only', childSandbox === 'allow-scripts')
  const topRaw = await context.newPage(), topRawResponse = await topRaw.goto(raw.url())
  check('raw-content-cannot-execute-as-top-level-document', topRawResponse.status() === 403 && (await topRaw.locator('body').textContent()).includes('EMBED_CONTEXT_REQUIRED'))
  await topRaw.close()
  const opacity = await raw.evaluate(() => { let cookie = false, topAccess = false; try { void document.cookie; cookie = true } catch {} try { void parent.document.body; topAccess = true } catch {} return { cookie, topAccess } })
  check('no-child-cookie-or-parent-dom-access', !opacity.cookie && !opacity.topAccess)
  await classroom.getByRole('button', { name: '新开一堂课', exact: true }).click()
  await savedDraft(ui, { ids: [] })
  const navigation = classroom.getByRole('combobox', { name: '跳转课件页' }), ids = record.versions[0].slideIds
  for (const id of ids) {
    await navigation.selectOption(id)
    await raw.waitForFunction(slide => document.getElementById('deckStage').dataset.slideId === slide, id)
    await page.waitForFunction(slide => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === slide, id)
    await savedDraft(ui, { ids: [] })
  }
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
  await savedDraft(ui, { ids: [] })
  await classroom.getByRole('button', { name: /^画笔：/ }).click()
  const layer = classroom.getByTestId('courseware-annotations')
  const draw = (kind, a, b) => drawInk(ui, kind, a, b)
  const exportDraft = () => uiDraft(ui)
  const penId = await draw('pen', [.25, .35], [.45, .5])
  let draft = await savedDraft(ui), stroke = draft.base.scene.primitives.find(p => p.id === penId && p.type === 'polyline')
  check('pressure-and-stage-normalization', stroke.samples.length >= 21 && stroke.samples.some(p => p.pressure > .7) && Math.abs(stroke.samples[0].x / 1920 - .25) < .01 && Math.abs(stroke.samples[0].y / 1080 - .35) < .01, { logicalStart: [stroke.samples[0].x, stroke.samples[0].y], cssViewport: (await actualStage(ui)).actual, dpr: 2 })
  check('actual-dpr-two-and-complete-raw-sample-fields', await page.evaluate(() => devicePixelRatio === 2) && stroke.samples.some(sample => sample.pressure === 0) && stroke.points.length === stroke.samples.length && stroke.samples.every((sample, index) => sample.x === stroke.points[index][0] && sample.y === stroke.points[index][1] && (index === 0 || sample.time >= stroke.samples[index - 1].time)))
  const screenshot = resolve(output, 'courseware-pressure-stage-1440.png'); await page.screenshot({ path: screenshot }); report.screenshots.push(screenshot)
  await classroom.getByRole('button', { name: '下一页', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'guizhou-question')
  check('next-page-has-no-cover-ink', (await savedDraft(ui, { ids: [] })).base.scene.primitives.length === 0)
  await classroom.getByRole('button', { name: '上一页', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'cover')
  check('return-restores-cover-ink', (await savedDraft(ui, { ids: [stroke.id] })).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '撤销', exact: true }).click(); check('delta-undo', !(await savedDraft(ui, { ids: [] })).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '重做', exact: true }).click(); check('delta-redo', (await savedDraft(ui, { ids: [stroke.id] })).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '清空本页', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  check('clear-cancel-preserves-ink', (await savedDraft(ui, { ids: [stroke.id] })).base.scene.primitives.some(p => p.id === stroke.id))
  await classroom.getByRole('button', { name: '全屏', exact: true }).click(); await page.waitForFunction(() => !!document.fullscreenElement)
  check('real-fullscreen', await page.evaluate(() => !!document.fullscreenElement)); await draw('pen', [.6, .25], [.8, .35])
  draft = await savedDraft(ui); const fullPen = draft.base.scene.primitives.at(-1)
  check('fullscreen-real-stage-coordinate', Math.abs(fullPen.samples[0].x / 1920 - .6) < .01)
  await classroom.getByRole('button', { name: '退出全屏', exact: true }).click(); await page.waitForFunction(() => !document.fullscreenElement)
  const touch = await context.newCDPSession(page)
  try {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    const touchBounds = (await actualStage(ui)).actual
    const touchPoint = (fraction, force) => ({ x: touchBounds.x + touchBounds.width * fraction, y: touchBounds.y + touchBounds.height * .75, force, radiusX: 3, radiusY: 3, id: 1 })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(.2, .25)] }); await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(.3, .8)] }); await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally { await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await touch.detach() }
  const touchInk = (await savedDraft(ui)).base.scene.primitives.at(-1)
  check('real-touch-stage-coordinates', touchInk.samples.length >= 2 && Math.abs(touchInk.samples[0].x / 1920 - .2) < .015 && Math.abs(touchInk.samples[0].y / 1080 - .75) < .015)
  await classroom.getByRole('button', { name: '＋ 空白板页', exact: true }).click(); await classroom.getByTestId('courseware-blank-page').waitFor()
  await savedDraft(ui, { ids: [] }); await draw('pen', [.2, .3], [.3, .4])
  check('blank-page-is-distinct', (await savedDraft(ui)).slideId.startsWith('blank_'))
  await classroom.getByRole('combobox', { name: '选择临时白板页' }).selectOption(''); await page.waitForFunction(() => document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide') === 'cover')
  await savedDraft(ui)
  await context.setOffline(true); await draw('pen', [.1, .65], [.2, .7]); await classroom.locator('[data-save-status="offline"]').waitFor({ timeout: 20000 })
  const offline = await exportDraft(); check('offline-request-and-operation-retained', offline.pending.length > 0 && !!offline.pending[0].request)
  await context.setOffline(false)
  await retryIfOffline(ui)
  check('offline-replay-acknowledged', (await savedDraft(ui, { timeout: 20000 })).pending.length === 0)
  for (const width of [1440, 1280, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 920 : 1000 }); await layer.waitFor({ state: 'visible' })
    const geometry = await classroom.evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, viewport: innerWidth } })
    check(`layout-no-horizontal-overflow-${width}`, geometry.x >= -1 && geometry.right <= geometry.viewport + 1 && geometry.scrollWidth <= geometry.clientWidth + 1, geometry)
    await classroom.getByRole('button', { name: /^画笔：/ }).click(); await draw('mouse', [.42, .62], [.5, .67])
    const actual = (await savedDraft(ui)).base.scene.primitives.at(-1)
    check(`normalized-ink-at-${width}`, Math.abs(actual.samples[0].x / 1920 - .42) < .015 && Math.abs(actual.samples[0].y / 1080 - .62) < .015)
    const path = resolve(output, `courseware-${width}.png`); await page.screenshot({ path }); report.screenshots.push(path)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const lessonId = await classroom.getAttribute('data-lesson-session'); assert.ok(lessonId)
  const beforeReload = await savedDraft(ui)
  await page.reload({ waitUntil: 'domcontentloaded' }); await libraryUi(ui)
  await classroom.getByRole('textbox', { name: '搜索课件' }).fill(title); await classroom.getByRole('button', { name: '搜索', exact: true }).click()
  await classroom.getByRole('heading', { name: title, exact: true }).locator('..').getByRole('button', { name: '打开课件', exact: true }).click()
  raw = await contentFrame(ui); await classroom.getByRole('combobox', { name: '恢复已有授课' }).selectOption(lessonId); await classroom.getByRole('button', { name: '继续这堂课', exact: true }).click()
  check('server-and-idb-reload-keep-version-lesson-and-raw-ink', JSON.stringify((await savedDraft(ui, { ids: sceneIds(beforeReload.base.scene), scene: beforeReload.base.scene })).base.scene) === JSON.stringify(beforeReload.base.scene))
  for (const role of ['student', 'foreign']) {
    const other = await fixtureUi(browser, config, role, report)
    try { check(`${role === 'foreign' ? 'foreign-school' : role}-private-deck-denied`, (await requestJson(other, deckPath)).status === 404) } finally { await other.context.close() }
  }
  const publishResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${deckPath}/manage` && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'publish')
  void publishResponse.catch(() => {})
  await classroom.getByRole('button', { name: '发布到本校', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  check('actual-school-publication', (await publishResponse).ok()); assert.equal((await readJson(ui, deckPath)).deck.sharing, 'school')
  const student = await fixtureUi(browser, config, 'student', report)
  try {
    const read = await requestJson(student, deckPath)
    check('student-read-current-school-version', read.ok && read.body.versions.length === 1)
    const write = await requestJson(student, `${deckPath}/lessons`, { method: 'POST', data: { versionId: record.deck.activeVersionId, operationId: operationId('student') } })
    check('student-cannot-start-durable-lesson', write.status === 403, { code: write.body?.error?.code })
    const source = await requestJson(student, `${deckPath}/source/${record.deck.activeVersionId}`)
    check('student-cannot-read-owner-original-source', [403, 404].includes(source.status))
    const notes = await requestJson(student, `${deckPath}/lessons/${lessonId}`)
    check('student-cannot-read-owner-private-lesson', [403, 404].includes(notes.status))
  } finally { await student.context.close() }
  const foreign = await fixtureUi(browser, config, 'foreign', report)
  try { check('foreign-school-published-deck-still-denied', (await requestJson(foreign, deckPath)).status === 404) } finally { await foreign.context.close() }
  if (config.phase === 'before-restart') {
    await classroomTools(browser, config, ui, deck, title, lessonId, report, check)
    await casAndLostAck(browser, config, ui, deck, title, report, check)
    report.coverage.advanced = true
  }
  await isolationProbes(ui, resources, report, check)
  report.coverage.core = true
  }
  check('real-courseware-no-uncaught-browser-errors', report.errors.length === 0)
  check('real-courseware-no-model-inference-attempts', report.modelRequests.length === 0, { count: report.modelRequests.length })
  check('real-courseware-no-external-requests', report.externalRequests.length === 0, { count: report.externalRequests.length })
  if (config.phase === 'before-restart') {
    // Only the primary dedicated fixture survives. Every hostile probe is verified soft-deleted first.
    const probes = new Map([...resources].filter(([id]) => id !== primaryDeck.id))
    await cleanupResources(ui, probes, check)
    for (const id of probes.keys()) resources.delete(id)
    await writeCheckpoint(ui, primaryDeck.id, report)
    resources.delete(primaryDeck.id)
    report.retainedFixture = { deckId: primaryDeck.id, reason: 'Exact before/after-restart and bridge comparison' }
    report.cleanupScope = 'All probe decks verified; primary fixture deliberately retained'
    report.fullAcceptance = false
  }
  report.passed = true
} catch (error) { report.passed = false; report.fullAcceptance = false; report.failure = publicMessage(error) }
finally {
  if (ui && resources.size) try { await cleanupResources(ui, resources, check); report.cleanupVerified = true } catch (error) { report.cleanupPending = true; report.passed = false; report.fullAcceptance = false; report.cleanupFailure = publicMessage(error) }
  if (browser) try { await browser.close() } catch (error) { report.passed = false; report.fullAcceptance = false; report.browserCloseFailure = publicMessage(error) }
  if (report.errors.length || report.externalRequests.length || report.modelRequests?.length) { report.passed = false; report.fullAcceptance = false; report.failure ??= 'Unexpected browser error, external attempt or forbidden inference request was observed' }
  await mkdir(output, { recursive: true, mode: 0o700 })
  await writeFile(resolve(output, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
}
process.stdout.write(JSON.stringify({ passed: report.passed, fullAcceptance: report.fullAcceptance, phase: report.phase, checks: report.checks.length, output, failure: report.failure }) + '\n')
process.exitCode = report.passed ? 0 : 1
