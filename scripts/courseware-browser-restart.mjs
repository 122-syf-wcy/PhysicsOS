/** Private checkpoint/restart verification. The operator restarts full CIDs; this module never runs server commands. */
import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJson, requestJson, pagePath, operationId, sceneIds, sha256, openLessonUi, selectPage, exportDraft, savedDraft, actualStage, downloadBytes, SOURCE_SHA256, SOURCE_BYTES } from './courseware-browser-helpers.mjs'

async function privateJson(path, label) {
  assert.ok(path && isAbsolute(path), `${label} must be an absolute private file path`)
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { throw new Error(`${label} is missing or invalid`) }
}
const identity = user => Object.fromEntries(['id', 'schoolId', 'schoolName', 'username', 'role'].map(key => [key, user[key]]))
const stableDeck = deck => Object.fromEntries(['id', 'title', 'description', 'revision', 'lifecycle', 'sharing', 'activeVersionId', 'versionCount'].map(key => [key, deck[key]]))

export async function writeCheckpoint(ui, deckId, report) {
  const path = `/physicsos/courseware/${deckId}`, record = await readJson(ui, path)
  const version = record.versions.find(value => value.id === record.deck.activeVersionId); assert.ok(version)
  assert.ok(record.deck.mine && record.deck.lifecycle === 'active')
  const rows = await readJson(ui, `${path}/lessons?versionId=${encodeURIComponent(version.id)}`)
  assert.ok(rows.length > 0 && rows.length <= 200, 'A bounded set of real dedicated lessons is required')
  const lessons = []
  for (const row of rows) {
    const metadata = await readJson(ui, `${path}/lessons/${row.id}`), pages = []
    for (const slideId of [...version.slideIds, ...metadata.blankPages]) {
      const head = await readJson(ui, pagePath(deckId, row.id, slideId))
      pages.push({ slideId, head, sceneSha256: sha256(JSON.stringify(head.scene)) })
    }
    assert.deepEqual(await readJson(ui, `${path}/lessons/${row.id}`), metadata, 'Lesson membership must not change during checkpoint capture')
    lessons.push({ metadata, pages })
  }
  const checkpoint = {
    schemaVersion: 1, kind: 'courseware-before-restart', fixtureKey: `courseware_${randomUUID()}`,
    candidateOrigin: ui.config.origin, completedAt: new Date().toISOString(), beforeResultFile: resolve(ui.config.output, 'result.json'),
    sourceSha256: SOURCE_SHA256, sourceBytes: SOURCE_BYTES, teacher: identity(ui.actor),
    deck: stableDeck(record.deck), version, lessons,
    coverage: { ...report.coverage, independentSecurityProbes: true, noModelRequests: report.modelRequests.length === 0 },
  }
  const checkpointPath = resolve(ui.config.output, 'courseware-before-restart.json')
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 })
  report.fixtureKey = checkpoint.fixtureKey; report.checkpoint = checkpointPath
  return checkpoint
}

export async function restartInputs(config, env) {
  const path = env.COURSEWARE_CHECKPOINT, checkpoint = await privateJson(path, 'COURSEWARE_CHECKPOINT')
  assert.ok(checkpoint.schemaVersion === 1 && checkpoint.kind === 'courseware-before-restart' && typeof checkpoint.fixtureKey === 'string')
  assert.equal(checkpoint.sourceSha256, SOURCE_SHA256); assert.equal(checkpoint.sourceBytes, SOURCE_BYTES)
  const sameOrigin = checkpoint.candidateOrigin === config.origin
  assert.ok(sameOrigin || config.phase === 'bridge' && config.expected.restoredFromOrigin === checkpoint.candidateOrigin, 'Only the same candidate, or an explicitly declared bridge restore origin, may consume a checkpoint')
  assert.deepEqual(checkpoint.teacher, identity(config.expected.teacher), 'The checkpoint must belong to the exact dedicated teacher, not another candidate/account')
  assert.notEqual(dirname(checkpoint.beforeResultFile), config.output, 'Restart output must not overwrite the before-restart evidence')
  const before = await privateJson(checkpoint.beforeResultFile, 'Before-restart result')
  assert.ok(before.passed === true && before.phase === 'before-restart' && before.fixtureKey === checkpoint.fixtureKey && before.coverage?.core === true && before.coverage?.advanced === true && before.coverage?.teacher === true && before.coverage?.student === true && before.coverage?.foreignSchool === true && before.modelRequests?.length === 0, 'The exact before-restart run must have passed all declared pre-restart and identity checks')
  assert.ok(checkpoint.lessons.length > 0 && checkpoint.lessons.length <= 200)
  let receipt
  if (env.COURSEWARE_RESTART_RECEIPT) {
    receipt = await privateJson(env.COURSEWARE_RESTART_RECEIPT, 'COURSEWARE_RESTART_RECEIPT')
    assert.ok(receipt.schemaVersion === 1 && receipt.appRestarted === true)
    assert.equal(receipt.candidateOrigin, config.origin)
    assert.equal(receipt.fixtureKey, checkpoint.fixtureKey)
    assert.equal(receipt.checkpointSha256, sha256(await readFile(path)))
    const completeCids = values => Array.isArray(values) && values.length > 0 && values.length <= 16 && values.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) && new Set(values).size === values.length
    assert.ok(completeCids(receipt.appContainerIds), 'The operator receipt must name complete application CIDs')
    assert.ok(typeof receipt.databaseRestarted === 'boolean')
    if (receipt.databaseRestarted) assert.ok(completeCids(receipt.databaseContainerIds), 'PostgreSQL cold-start evidence requires complete database CIDs')
    assert.ok(Number.isFinite(Date.parse(receipt.completedAt)) && Date.parse(receipt.completedAt) >= Date.parse(checkpoint.completedAt), 'Restart completion must follow this checkpoint')
  } else assert.equal(config.phase, 'bridge', 'after-restart requires the operator full-CID restart receipt')
  return { checkpoint, receipt }
}

export async function verifyRestart(ui, inputs, report, check, originalBytes) {
  const { checkpoint, receipt } = inputs, bridge = ui.config.phase === 'bridge'
  assert.equal(ui.config.expected.mode, bridge ? 'bridge' : 'enabled')
  const capabilities = await readJson(ui, '/physicsos/courseware/capabilities')
  check('restart-mode-capabilities-are-real', capabilities.capability === 'courseware-v1' && capabilities.schemaVersion === 1 && capabilities.writesEnabled === !bridge)
  const deckPath = `/physicsos/courseware/${checkpoint.deck.id}`, record = await readJson(ui, deckPath)
  assert.ok(record.deck.mine)
  assert.deepEqual(stableDeck(record.deck), checkpoint.deck)
  assert.deepEqual(record.versions.find(version => version.id === checkpoint.version.id), checkpoint.version)
  const bytes = await downloadBytes(ui, `${deckPath}/source/${checkpoint.version.id}`)
  check('restart-original-source-bytes-are-unchanged', bytes.byteLength === SOURCE_BYTES && sha256(bytes) === SOURCE_SHA256)
  for (const lesson of checkpoint.lessons) {
    assert.deepEqual(await readJson(ui, `${deckPath}/lessons/${lesson.metadata.id}`), lesson.metadata)
    await openLessonUi(ui, checkpoint.deck.title, lesson.metadata.id, lesson.pages[0].slideId, { readonly: bridge, ids: sceneIds(lesson.pages[0].head.scene), scene: lesson.pages[0].head.scene })
    for (const page of lesson.pages) {
      await selectPage(ui, page.slideId)
      const head = await readJson(ui, pagePath(checkpoint.deck.id, lesson.metadata.id, page.slideId))
      assert.equal(head.revision, page.head.revision)
      assert.deepEqual(head.scene, page.head.scene)
      assert.equal(sha256(JSON.stringify(head.scene)), page.sceneSha256)
      if (head.revision > 0) assert.equal(head.updatedAt, page.head.updatedAt)
      let draft
      if (bridge) {
        await ui.classroom.locator('[data-save-status="readonly"]').waitFor()
        draft = await exportDraft(ui); assert.equal(draft.pending.length, 0)
        assert.equal(draft.namespace, `${encodeURIComponent(ui.actor.schoolId)}|${encodeURIComponent(ui.actor.id)}`)
        assert.equal(draft.base.revision, page.head.revision); assert.deepEqual(draft.base.scene, page.head.scene)
      } else draft = await savedDraft(ui, { ids: sceneIds(page.head.scene), scene: page.head.scene })
      await actualStage(ui)
      check(`fresh-context-raw-page-${lesson.metadata.id}-${page.slideId}`, draft.deckId === checkpoint.deck.id && draft.versionId === checkpoint.version.id && draft.lessonId === lesson.metadata.id && draft.slideId === page.slideId)
    }
  }
  check('fresh-auth-only-context-reads-exact-server-checkpoint-without-old-idb', true)
  report.fixtureKey = checkpoint.fixtureKey
  report.restartReceiptVerified = !!receipt
  report.coverage.postgresLane = receipt?.databaseRestarted === true
  report.coverage.afterRestart = !!receipt
  report.restartUnverified = !receipt
  if (!bridge) {
    report.fullAcceptance = receipt?.databaseRestarted === true && checkpoint.coverage.core && checkpoint.coverage.advanced && checkpoint.coverage.noModelRequests
    return
  }
  const first = checkpoint.lessons[0], firstPage = first.pages.find(page => page.head.revision > 0) ?? first.pages[0]
  await openLessonUi(ui, checkpoint.deck.title, first.metadata.id, firstPage.slideId, { readonly: true })
  const layer = ui.classroom.getByTestId('courseware-annotations')
  check('bridge-classroom-ink-tools-actually-disabled', await ui.classroom.getByRole('button', { name: /^画笔：/ }).isDisabled() && await layer.evaluate(node => getComputedStyle(node).pointerEvents === 'none'))
  const mutations = [
    ['/physicsos/courseware', 'POST', { title: `Bridge refusal ${Date.now()}`, description: 'Dedicated rejected-write fixture', operationId: operationId('bridge_import'), htmlBase64: originalBytes.toString('base64') }],
    [`${deckPath}/lessons`, 'POST', { versionId: checkpoint.version.id, operationId: operationId('bridge_lesson') }],
    [pagePath(checkpoint.deck.id, first.metadata.id, firstPage.slideId), 'PUT', { expectedRevision: firstPage.head.revision, scene: firstPage.head.scene, operationId: operationId('bridge_page') }],
  ]
  // Use valid full requests, not malformed data that could make a broken write gate appear safe.
  for (const [path, method, data] of mutations) {
    const refused = await requestJson(ui, path, { method, data })
    if (refused.ok) { report.unexpectedBridgeWrites ??= []; report.unexpectedBridgeWrites.push({ path, method, operationId: data.operationId, createdDeckId: refused.body?.deck?.id, createdLessonId: refused.body?.id }) }
    check(`bridge-valid-${method.toLowerCase()}-write-refused`, refused.status === 423, { code: refused.body?.error?.code })
  }
  assert.deepEqual(stableDeck((await readJson(ui, deckPath)).deck), checkpoint.deck)
  const head = await readJson(ui, pagePath(checkpoint.deck.id, first.metadata.id, firstPage.slideId))
  assert.equal(head.revision, firstPage.head.revision); assert.deepEqual(head.scene, firstPage.head.scene)
  report.coverage.bridgeReadonly = true
  report.fullAcceptance = false
}
