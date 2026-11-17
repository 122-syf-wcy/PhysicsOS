/** Bounded advanced checks over dedicated courseware fixtures. No successful response body is replaced. */
import { strict as assert } from 'node:assert'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixtureUi, requestJson, readJson, pagePath, operationId, sceneIds, sha256, actualStage, renderedIds, exportDraft, savedDraft, drawInk, selectPage, openLessonUi, newLessonUi, retryIfOffline, publicMessage } from './courseware-browser-helpers.mjs'

async function shot(ui, report, name) {
  const path = resolve(ui.config.output, name)
  await ui.page.screenshot({ path }); report.screenshots.push(path)
}
async function unchanged(ui, before) {
  const after = await savedDraft(ui, { ids: sceneIds(before.base.scene), scene: before.base.scene })
  assert.equal(after.base.revision, before.base.revision, 'Temporary effects must not create any durable revision')
  return after
}
export async function classroomTools(browser, config, ui, deck, title, lessonId, report, check) {
  await openLessonUi(ui, title, lessonId)
  let before = await savedDraft(ui)
  const layer = ui.classroom.getByTestId('courseware-annotations')
  await ui.classroom.getByRole('button', { name: /^激光：/ }).click()
  let box = (await actualStage(ui)).actual
  await ui.page.mouse.move(box.x + box.width * .4, box.y + box.height * .4)
  const laser = layer.locator('circle[fill="#f84835"]')
  await laser.waitFor({ state: 'visible' }); await shot(ui, report, 'courseware-laser.png')
  await laser.waitFor({ state: 'detached', timeout: 5000 })
  await unchanged(ui, before); check('laser-real-transient-effect-never-persisted', true)
  await ui.classroom.getByRole('button', { name: /^聚光：/ }).click()
  const radius = ui.classroom.getByRole('slider', { name: '聚光灯半径' })
  for (const [key, expected] of [['Home', '40'], ['End', '600']]) {
    await radius.press(key)
    box = (await actualStage(ui)).actual
    await ui.page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
    const circle = layer.locator('mask circle'); await circle.waitFor({ state: 'attached' })
    assert.equal(await radius.inputValue(), expected)
    assert.equal(await circle.getAttribute('r'), expected)
  }
  await shot(ui, report, 'courseware-spotlight.png'); await unchanged(ui, before)
  check('spotlight-real-radius-and-effect-never-persisted', true)
  await ui.classroom.getByRole('button', { name: /^画笔：/ }).click()
  before = await savedDraft(ui)
  await ui.classroom.getByRole('button', { name: '清空本页', exact: true }).click()
  await ui.page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
  await savedDraft(ui, { ids: [] }); check('clear-confirm-removes-the-complete-current-page', true)
  await ui.classroom.getByRole('button', { name: '撤销', exact: true }).click()
  await savedDraft(ui, { ids: sceneIds(before.base.scene), scene: before.base.scene })
  check('clear-undo-restores-all-original-samples-and-order', true)

  const lessonPath = `/physicsos/courseware/${deck.id}/lessons/${lessonId}`
  const lesson = await readJson(ui, lessonPath); assert.ok(lesson.blankPages.length > 0)
  const firstBlank = lesson.blankPages[0]
  await selectPage(ui, firstBlank); await savedDraft(ui)
  const firstInk = await drawInk(ui, 'pen', [.56, .43], [.68, .52]), firstScene = (await savedDraft(ui)).base.scene
  await ui.classroom.getByRole('button', { name: '＋ 空白板页', exact: true }).click()
  await ui.page.waitForFunction(old => { const id = document.querySelector('[data-courseware-classroom]')?.getAttribute('data-active-slide'); return id?.startsWith('blank_') && id !== old }, firstBlank)
  const secondBlank = await ui.classroom.getAttribute('data-active-slide')
  await savedDraft(ui, { ids: [] })
  const secondInk = await drawInk(ui, 'pen', [.32, .61], [.46, .71]), secondScene = (await savedDraft(ui)).base.scene
  await ui.classroom.getByRole('button', { name: '撤销', exact: true }).click(); await savedDraft(ui, { ids: [] })
  await ui.classroom.getByRole('button', { name: '重做', exact: true }).click(); await savedDraft(ui, { ids: [secondInk], scene: secondScene })
  await selectPage(ui, firstBlank); await savedDraft(ui, { ids: sceneIds(firstScene), scene: firstScene })
  await selectPage(ui, secondBlank); await savedDraft(ui, { ids: [secondInk], scene: secondScene })
  await selectPage(ui, 'cover')
  const cover = await savedDraft(ui)
  check('two-blank-pages-and-cover-retain-distinct-complete-ink', firstBlank !== secondBlank && sceneIds(firstScene).includes(firstInk) && sceneIds(secondScene).includes(secondInk) && !sceneIds(firstScene).includes(secondInk) && !sceneIds(secondScene).includes(firstInk) && !sceneIds(cover.base.scene).includes(firstInk) && !sceneIds(cover.base.scene).includes(secondInk))

  // A deliberately letterboxed real viewport. Click INSIDE the iframe but OUTSIDE the actual stage.
  await ui.page.setViewportSize({ width: 1000, height: 1400 })
  await ui.classroom.getByRole('button', { name: /^画笔：/ }).click()
  const baseline = await savedDraft(ui), stage = (await actualStage(ui)).actual
  const frame = await ui.classroom.getByTestId('courseware-player').boundingBox(); assert.ok(frame)
  let outside
  if (stage.y - frame.y > 8) outside = { x: stage.x + stage.width / 2, y: (frame.y + stage.y) / 2 }
  else if (stage.x - frame.x > 8) outside = { x: (frame.x + stage.x) / 2, y: stage.y + stage.height / 2 }
  else if (frame.y + frame.height - stage.y - stage.height > 8) outside = { x: stage.x + stage.width / 2, y: (stage.y + stage.height + frame.y + frame.height) / 2 }
  else if (frame.x + frame.width - stage.x - stage.width > 8) outside = { x: (stage.x + stage.width + frame.x + frame.width) / 2, y: stage.y + stage.height / 2 }
  assert.ok(outside, 'The acceptance viewport must expose an actual iframe letterbox region')
  await ui.page.mouse.click(outside.x, outside.y)
  assert.deepEqual(await renderedIds(ui), sceneIds(baseline.base.scene), 'Letterbox input must not create even a local stroke')
  await unchanged(ui, baseline); await shot(ui, report, 'courseware-letterbox.png')
  check('actual-letterbox-cannot-start-ink', true, { stage, frame, outside })
  await ui.page.setViewportSize({ width: 1440, height: 1000 })

  const dprOne = await fixtureUi(browser, config, 'teacher', report, { dpr: 1 })
  try {
    await openLessonUi(dprOne, title, lessonId)
    await dprOne.classroom.getByRole('button', { name: /^画笔：/ }).click()
    const id = await drawInk(dprOne, 'pen', [.14, .22], [.18, .26])
    const saved = await savedDraft(dprOne), ink = saved.base.scene.primitives.find(p => p.id === id)
    check('actual-stage-dpr-one-and-raw-pressure-zero', await dprOne.page.evaluate(() => devicePixelRatio === 1) && Math.abs(ink.samples[0].x / 1920 - .14) < .01 && Math.abs(ink.samples[0].y / 1080 - .22) < .01 && ink.samples.some(sample => sample.pressure === 0) && ink.samples.every((sample, index) => index === 0 || sample.time >= ink.samples[index - 1].time))
    await shot(dprOne, report, 'courseware-dpr-one.png')
  } finally { await dprOne.context.close() }
  await openLessonUi(ui, title, lessonId)
}

function mutationRecorder(ui, path) {
  const requests = []
  const listener = request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === path) {
      const raw = request.postData(); requests.push({ raw, data: JSON.parse(raw), hash: sha256(raw) })
    }
  }
  ui.context.on('request', listener)
  return { requests, stop: () => ui.context.off('request', listener) }
}
async function replayUi(ui) {
  await ui.classroom.getByRole('button', { name: '安全重放', exact: true }).click()
  await ui.page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
}
export async function casAndLostAck(browser, config, ui, deck, title, report, check) {
  await ui.classroom.getByRole('button', { name: /^画笔：/ }).click()
  const casLesson = await newLessonUi(ui), path = pagePath(deck.id, casLesson, 'cover')
  const peer = await fixtureUi(browser, config, 'teacher', report)
  try {
    await openLessonUi(peer, title, casLesson)
    await peer.classroom.getByRole('button', { name: /^画笔：/ }).click()
    const capture = mutationRecorder(ui, path)
    try {
      await ui.context.setOffline(true)
      const mineId = await drawInk(ui, 'pen', [.18, .28], [.28, .34])
      await ui.classroom.locator('[data-save-status="offline"]').waitFor({ timeout: 20000 })
      const offline = await exportDraft(ui), issued = structuredClone(offline.pending[0])
      const mine = issued.request.scene.primitives.find(p => p.id === mineId)
      const theirsId = await drawInk(peer, 'pen', [.65, .28], [.78, .33])
      await savedDraft(peer, { ids: [theirsId] })
      await ui.context.setOffline(false); await retryIfOffline(ui)
      await ui.classroom.locator('[data-save-status="conflict"]').waitFor({ timeout: 20000 })
      await replayUi(ui)
      const merged = await savedDraft(ui, { ids: [theirsId, mineId] })
      assert.deepEqual(merged.base.scene.primitives.find(p => p.id === mineId), mine)
      assert.ok(capture.requests.some(request => request.data.operationId !== issued.id && sceneIds(request.data.scene).join('|') === [theirsId, mineId].join('|')))
      check('real-cas-non-overlap-replay-appends-new-ink-with-new-operation', true)
      await ui.classroom.getByRole('button', { name: '撤销', exact: true }).click(); await savedDraft(ui, { ids: [theirsId] })
      await ui.classroom.getByRole('button', { name: '重做', exact: true }).click(); await savedDraft(ui, { ids: [theirsId, mineId], scene: merged.base.scene })
      check('real-cas-rebased-history-retains-exact-undo-redo-order', true)

      // A real authorized peer PUT edits the same primitive; this is not a response/body mock.
      await ui.context.setOffline(true)
      await ui.classroom.getByRole('button', { name: /^橡皮：/ }).click()
      const bounds = (await actualStage(ui)).actual
      await ui.page.mouse.click(bounds.x + bounds.width * .715, bounds.y + bounds.height * .305)
      await ui.classroom.locator('[data-save-status="offline"]').waitFor({ timeout: 20000 })
      const removal = await exportDraft(ui)
      assert.ok(!sceneIds(removal.pending[0].request.scene).includes(theirsId))
      const head = await readJson(peer, path)
      const modifiedScene = { ...head.scene, primitives: head.scene.primitives.map(p => p.id !== theirsId ? p : { ...p, style: { ...p.style, strokeWidth: (p.style?.strokeWidth ?? 4) === 100 ? 99 : (p.style?.strokeWidth ?? 4) + 1 } }) }
      const modified = await requestJson(peer, path, { method: 'PUT', data: { scene: modifiedScene, expectedRevision: head.revision, operationId: operationId('peer_edit') } })
      assert.ok(modified.ok)
      await ui.context.setOffline(false); await retryIfOffline(ui)
      await ui.classroom.locator('[data-save-status="conflict"]').waitFor({ timeout: 20000 })
      const requestCount = capture.requests.length
      await replayUi(ui)
      await ui.page.getByText(/该图元已被另一设备改动/).first().waitFor()
      const stillRemote = await readJson(peer, path)
      assert.equal(stillRemote.revision, modified.body.page.revision)
      assert.deepEqual(stillRemote.scene, modifiedScene)
      assert.equal(capture.requests.length, requestCount, 'Rejected same-primitive replay must not issue another PUT')
      await ui.page.getByRole('dialog').getByRole('button', { name: '关闭对话框', exact: true }).click()
      const retained = await exportDraft(ui); assert.deepEqual(retained.pending, removal.pending)
      await writeFile(resolve(config.output, 'courseware-conflicting-local-draft.json'), `${JSON.stringify(retained, null, 2)}\n`, { mode: 0o600 })
      check('real-cas-same-primitive-replay-refuses-and-retains-full-draft', true)
      // Explicitly abandon ONLY this exported dedicated test draft before creating the next fixture.
      await ui.classroom.getByRole('button', { name: '放弃本机并重载', exact: true }).click()
      await ui.page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
      await savedDraft(ui, { ids: sceneIds(modifiedScene), scene: modifiedScene })
    } finally { capture.stop(); await ui.context.setOffline(false) }

    await ui.classroom.getByRole('button', { name: /^画笔：/ }).click()
    const ackLesson = await newLessonUi(ui), ackPath = pagePath(deck.id, ackLesson, 'cover')
    await openLessonUi(peer, title, ackLesson)
    await peer.classroom.getByRole('button', { name: /^画笔：/ }).click()
    const ackCapture = mutationRecorder(ui, ackPath)
    let injected = false, receipt, injectionError
    const handler = async route => {
      const request = route.request()
      if (request.method() !== 'PUT' || new URL(request.url()).pathname !== ackPath || injected) { await route.fallback(); return }
      injected = true
      try {
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 })
        assert.ok(response.ok(), 'The lost-ACK fault must follow a REAL successful commit')
        receipt = await response.json()
        assert.equal(receipt.operationId, request.postDataJSON().operationId)
        assert.ok(receipt.page.revision >= receipt.appliedRevision)
      } catch (error) { injectionError = publicMessage(error) }
      finally { await route.abort('failed') }
    }
    await ui.context.route('**/*', handler)
    try {
      const mineId = await drawInk(ui, 'pen', [.22, .55], [.33, .62])
      await ui.classroom.locator('[data-save-status="offline"]').waitFor({ timeout: 20000 })
      assert.ok(injected && receipt && !injectionError, injectionError ?? 'Lost ACK injection did not observe the real commit')
      const pending = await exportDraft(ui), first = ackCapture.requests[0]
      assert.equal(pending.pending[0].id, receipt.operationId)
      assert.deepEqual(pending.pending[0].request, { expectedRevision: first.data.expectedRevision, scene: first.data.scene })
      assert.deepEqual((await readJson(peer, ackPath)).scene, first.data.scene)
      report.transportFaults ??= []
      report.transportFaults.push({ kind: 'lost-ack-after-real-commit', deckId: deck.id, lessonId: ackLesson, slideId: 'cover', operationId: receipt.operationId, requestSha256: first.hash, appliedRevision: receipt.appliedRevision })
      await ui.context.unroute('**/*', handler)
      // A second real browser advances the authority head before our durable original request is replayed.
      await selectPage(peer, 'guizhou-question'); await savedDraft(peer, { ids: [] })
      await selectPage(peer, 'cover'); await savedDraft(peer, { ids: [mineId] })
      const theirsId = await drawInk(peer, 'pen', [.67, .55], [.77, .62]); await savedDraft(peer, { ids: [mineId, theirsId] })
      const restored = await openLessonUi(ui, title, ackLesson, 'cover', { ids: [mineId, theirsId] })
      assert.ok(ackCapture.requests.length >= 2)
      const replay = ackCapture.requests.find((request, index) => index > 0 && request.data.operationId === first.data.operationId)
      assert.ok(replay); assert.equal(replay.raw, first.raw, 'The issued request must replay exactly after the same-tab IDB reload')
      assert.deepEqual(restored.base.scene.primitives.find(p => p.id === mineId), first.data.scene.primitives.find(p => p.id === mineId))
      assert.ok(restored.base.revision > receipt.appliedRevision, 'An old receipt must retain the newer real authority head')
      check('lost-ack-exact-issued-request-replays-after-idb-reload-with-latest-head', true)
    } finally { await ui.context.unroute('**/*', handler); ackCapture.stop() }
  } finally { await peer.context.close() }
}

export async function isolationProbes(ui, resources, report, check) {
  const cases = {
    popup: "w['op'+'en'](target,'_blank')",
    fetch: "await w['fet'+'ch'](target).catch(()=>{})",
    frame: "const frame=document.createElement('iframe');frame.id='probe-frame';frame.src=target;document.body.append(frame)",
    self: "w['loca'+'tion']['hr'+'ef']=target",
    top: "w['to'+'p']['loca'+'tion']['hr'+'ef']=target",
  }
  let allBlocked = true
  for (const [kind, attack] of Object.entries(cases)) {
    const program = `<!doctype html><html><head><title>隔离负例 ${kind}</title></head><body><button id="go">触发隔离负例</button><script>document.getElementById('go').addEventListener('click',async()=>{document.body.dataset.probeTriggered='${kind}';const w=window;const target='https://courseware-security-probe.invalid/${kind}';try{${attack}}catch{}requestAnimationFrame(()=>requestAnimationFrame(()=>{document.body.dataset.probeCompleted='${kind}'}))})</script></body></html>`
    const title = `Security probe ${kind} ${Date.now()}`
    const imported = await requestJson(ui, '/physicsos/courseware', { method: 'POST', data: { title, description: 'Dedicated runtime isolation acceptance', operationId: operationId('security'), htmlBase64: Buffer.from(program).toString('base64') } })
    check(kind === 'popup' ? 'negative-probe-admitted-without-running-on-server' : `negative-${kind}-admitted`, imported.ok)
    const record = imported.body; resources.set(record.deck.id, title)
    const ticket = await requestJson(ui, `/physicsos/courseware/${record.deck.id}/tickets`, { method: 'POST', data: { versionId: record.deck.activeVersionId } })
    assert.ok(ticket.ok)
    const page = await ui.context.newPage(); let popup = false
    page.on('popup', () => { popup = true })
    try {
      await page.goto(`${ui.config.origin}${ticket.body.wrapperUrl}`)
      const frame = await (await page.locator('#courseware').elementHandle()).contentFrame()
      await frame.locator('#go').click()
      await frame.waitForFunction(value => document.body.dataset.probeCompleted === value, kind)
      check(`negative-${kind}-actually-triggered`, await frame.evaluate(value => document.body.dataset.probeTriggered === value, kind))
      if (kind === 'frame') assert.equal(await frame.locator('#probe-frame').count(), 1, 'The actual nested-frame attempt must be constructed')
      const blocked = !popup && !report.externalRequests.includes('https://courseware-security-probe.invalid') && new URL(frame.url()).pathname.startsWith('/physicsos/courseware/content/') && new URL(page.url()).pathname.startsWith('/physicsos/courseware/embed/')
      allBlocked &&= blocked
      check(`negative-${kind}-no-request-or-popup-despite-real-trigger`, blocked)
    } finally { await page.close() }
  }
  // Preserve the original aggregate safety assertion as well as proving each independent trigger.
  check('wrapper-blocks-external-self-navigation-popup-frame-fetch', allBlocked)
}
