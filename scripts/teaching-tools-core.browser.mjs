/** Real UI + authority reads for the selected core stages; no AI/chat invocation or success mocks. */
import { AVATAR_IDS, PENDULUM_SCENE, avatarPath, canonical, catalog, digest, home, idPath, lifecycleUi, listPages, operationId, xpathLiteral } from './teaching-tools-browser-helpers.mjs'

const DENIAL = [403, 409, 410]
const withoutRecentMetadata = entry => Object.fromEntries(Object.entries(entry).filter(([key]) => !['recentGeneration', 'recentVersion', 'recentState', 'recentRestoreState', 'updatedAt'].includes(key)))
const stateOf = head => !head ? 'unknown' : head.deletedAt ? 'deleted' : head.archivedAt ? 'archived' : 'active'
const exactElement = (root, attribute, id) => root.locator(`xpath=.//*[@${attribute}=${xpathLiteral(id)}]`)

export async function canvasHead(h, ui, id) {
  const heads = await listPages(h, ui, '/physicsos/learning/canvases?state=all')
  const head = heads.find(value => value.id === id)
  h.check('Real canvas head belongs to the exact fixture ID', !!head && Number.isInteger(head.version) && Number.isInteger(head.generation))
  return head
}
function objectReferences(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found
  if (typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest) && ['manifest', 'scene', 'snapshot', 'dataset', 'history'].includes(value.kind)) found.add(value.digest)
  for (const child of Object.values(value)) if (child && typeof child === 'object') objectReferences(child, found)
  return found
}
export async function canvasSnapshot(h, ui, id) {
  const opened = await h.read(ui, `/physicsos/learning/canvases/${idPath(id)}`)
  h.check('Canvas GET returns a complete, correctly bound manifest', opened.head?.id === id && opened.manifest?.id === id && opened.manifest.schemaVersion === 1)
  const queue = [...objectReferences(opened.manifest), opened.head.manifestDigest], objects = {}
  for (let index = 0; index < queue.length; index++) {
    const hash = queue[index]
    if (hash in objects) continue
    h.check('Canvas dependency graph remains within the explicit safety budget', Object.keys(objects).length < 512 && /^[a-f0-9]{64}$/.test(hash))
    const received = await h.read(ui, `/physicsos/learning/canvases/${idPath(id)}/objects/${hash}`)
    const value = typeof received?.digest === 'string' && received.object !== undefined ? received.object : received
    if (received?.object !== undefined) h.check('Object envelope ACK matches the requested digest', received.digest === hash)
    h.check('Complete immutable canvas bytes match their authority digest', digest(value) === hash)
    objects[hash] = value
    for (const reference of objectReferences(value)) if (!(reference in objects)) queue.push(reference)
  }
  h.check('Opened manifest matches its full immutable object', canonical(opened.manifest) === canonical(objects[opened.head.manifestDigest]))
  return { kind: 'canvas', id, head: opened.head, manifest: opened.manifest, objects }
}
export async function whiteboardSnapshot(h, ui, id, retained = false) {
  const value = await h.read(ui, `/physicsos/whiteboards/${idPath(id)}${retained ? '/retained' : ''}`)
  h.check('Complete whiteboard authority document is bound to the exact ID', value.document?.id === id && Number.isInteger(value.revision) && Number.isInteger(value.generation))
  return { kind: 'whiteboard', id, record: value }
}
function compareCanvasContent(h, left, right) {
  h.check('Every complete canvas manifest/dependency object survives lifecycle changes', canonical(left.manifest) === canonical(right.manifest) && canonical(left.objects) === canonical(right.objects))
}
function compareBoardContent(h, left, right) {
  h.check('Complete native whiteboard JSON, including all raw ink, survives lifecycle changes', canonical(left.record.document) === canonical(right.record.document))
}
function advance(h, before, after, kind, action) {
  const version = kind === 'canvas' ? 'version' : 'revision'
  h.check(`${kind} lifecycle ACK advances the actual version and generation once`, after[version] === before[version] + 1 && after.generation === before.generation + 1)
  h.check(`${kind} lifecycle ACK has the requested state`, action === 'delete' ? !!after.deletedAt : action === 'archive' ? !!after.archivedAt && !after.deletedAt : action === 'unarchive' ? !after.archivedAt && !after.deletedAt : !after.deletedAt)
}
async function staleWrite(h, ui, kind, id, request, authoritative) {
  h.check('A stale-write probe reuses a genuinely successful complete edit request', request && typeof request === 'object' && Number.isInteger(request.expectedGeneration))
  const data = { ...request }
  if (kind === 'canvas') { h.check('Canvas edit has a real stable editing session', typeof request.editingSessionId === 'string' && request.editingSessionId.length > 0); data.mutationId = operationId() }
  else { h.check('Whiteboard edit has a real stable editing session', typeof request.editingSessionId === 'string' && request.editingSessionId.length > 0); data.operationId = operationId() }
  const active = stateOf(authoritative) === 'active'
  const completeBefore = active ? kind === 'canvas' ? await canvasSnapshot(h, ui, id) : await whiteboardSnapshot(h, ui, id) : undefined
  if (completeBefore) h.check('Active stale probe starts from the full current authority', canonical(kind === 'canvas' ? completeBefore.head : completeBefore.record) === canonical(authoritative))
  const path = kind === 'canvas' ? `/physicsos/learning/canvases/${idPath(id)}/commit` : `/physicsos/whiteboards/${idPath(id)}`
  const response = await h.api(ui, path, { method: kind === 'canvas' ? 'POST' : 'PUT', data, expectDenied: true })
  const code = response.body?.error?.code ?? response.body?.code
  const validReason = active ? /VERSION|GENERATION|STALE|CONFLICT/i : /ARCHIV|DELET|VERSION|GENERATION|STALE|CONFLICT|LIFECYCLE/i
  h.check('Old complete writes are rejected by real fences, including on active resources', !response.ok && (active ? response.status === 409 : DENIAL.includes(response.status)) && typeof code === 'string' && validReason.test(code), { active, status: response.status, code: typeof code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(code) ? code : '[non-enum-code-redacted]' })
  if (active) {
    const completeAfter = kind === 'canvas' ? await canvasSnapshot(h, ui, id) : await whiteboardSnapshot(h, ui, id)
    h.check('Rejected active old write leaves all head/version/generation/content/dependencies unchanged', canonical(completeAfter) === canonical(completeBefore))
  } else if (kind === 'canvas') h.check('Rejected old canvas write does not alter the real head', canonical(await canvasHead(h, ui, id)) === canonical(authoritative))
  else { const after = await whiteboardSnapshot(h, ui, id, true); h.check('Rejected old whiteboard write does not alter real metadata/content', canonical(after.record) === canonical(authoritative)) }
}
async function organize(h, ui, kind, id, action, before) {
  h.resources(kind, id, before.title ?? before.document?.title, { lastOperation: action, state: `${action}-ack-pending` }); await h.flush()
  const response = await lifecycleUi(h, ui, kind, id, action)
  const observed = kind === 'canvas' ? response.body?.head : response.body
  h.resources(kind, id, before.title ?? before.document?.title, { state: stateOf(observed), observedHead: kind === 'canvas' ? observed : { revision: observed?.revision, generation: observed?.generation, archivedAt: observed?.archivedAt, deletedAt: observed?.deletedAt } }); await h.flush()
  advance(h, before, observed, kind, action)
  return observed
}
async function withUi(h, job) { const ui = await h.createUi('teacher'); try { return await job(ui) } finally { await h.closeUi(ui) } }
async function openAvatar(h, ui) {
  const trigger = ui.page.getByRole('button', { name: '更换头像', exact: true })
  await trigger.focus(); await h.click(trigger)
  const dialog = ui.page.getByRole('dialog', { name: '选择头像', exact: true })
  await dialog.waitFor({ state: 'visible' })
  return { trigger, dialog }
}
async function chooseAvatar(h, dialog, id) { await h.click(dialog.locator(`input[type="radio"][value="${id}"]`).locator('xpath=ancestor::label[1]')) }
export async function avatarStage(h) {
  await withUi(h, async ui => {
    const initial = await h.assertActor(ui), originalId = AVATAR_IDS.find(id => initial.avatarUrl === avatarPath(id)), originalUrl = initial.avatarUrl
    h.resources('avatar', initial.id, 'dedicated teacher avatar', { createdByThisRun: false, beforeAvatarId: originalId ?? null, beforeUrlDigest: digest(originalUrl ?? ''), state: 'unchanged' })
    const others = {}
    for (const role of ['student', 'foreign']) { const other = await h.createUi(role); try { others[role] = (await h.assertActor(other)).avatarUrl } finally { await h.closeUi(other) } }
    let posts = 0
    const observer = request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/physicsos/auth/me/avatar') posts++ }
    ui.context.on('request', observer)
    try {
      let { trigger, dialog } = await openAvatar(h, ui)
      const ids = await dialog.getByRole('radio').evaluateAll(nodes => nodes.map(node => node.value))
      h.check('The actual picker is exactly the closed 12-avatar catalog', ids.length === 12 && new Set(ids).size === 12 && canonical([...ids].sort()) === canonical([...AVATAR_IDS].sort()))
      h.check('The picker uses one native radio group without manufactured roving tabindex', await dialog.getByRole('radio').evaluateAll(nodes => new Set(nodes.map(node => node.name)).size === 1 && nodes.every(node => node.type === 'radio' && !node.hasAttribute('tabindex'))))
      for (const id of AVATAR_IDS) {
        await chooseAvatar(h, dialog, id)
        h.check(`Closed-set draft preview ${id}`, await dialog.locator('[data-avatar-preview]').getAttribute('data-avatar-preview') === id)
        h.check('Preview never mutates the real principal', (await h.assertActor(ui)).avatarUrl === originalUrl && posts === 0)
      }
      await dialog.locator('input[value="discovery"]').focus(); await ui.page.keyboard.press('Tab')
      h.check('The last catalog radio exits to cancel, not a false dialog edge', await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(node => document.activeElement === node))
      await ui.page.keyboard.press('Shift+Tab')
      h.check('Reverse Tab re-enters the single native checked radio stop', await dialog.getByRole('radio').evaluateAll(nodes => nodes.some(node => node.checked && document.activeElement === node)))
      const target = AVATAR_IDS.find(id => id !== originalId)
      await chooseAvatar(h, dialog, target)
      const currentRadio = dialog.locator(`input[value="${target}"]`)
      await currentRadio.focus(); await ui.page.keyboard.press('ArrowRight')
      h.check('Browser-native radio arrows move/check another choice without POST', await dialog.getByRole('radio').evaluateAll((nodes, previous) => nodes.filter(node => node.checked).length === 1 && nodes.some(node => node.checked && node.value !== previous), target) && posts === 0)
      await chooseAvatar(h, dialog, target)
      const close = dialog.getByRole('button', { name: '关闭头像选择', exact: true }), save = dialog.getByRole('button', { name: '保存头像', exact: true })
      await close.focus(); await ui.page.keyboard.press('Shift+Tab')
      h.check('Shift+Tab from close wraps to the enabled save, not the last radio', await save.evaluate(node => document.activeElement === node))
      await ui.page.keyboard.press('Tab')
      h.check('Tab from save wraps to close', await close.evaluate(node => document.activeElement === node))
      await ui.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      h.check('Escape returns focus to the real avatar entry with no POST', await trigger.evaluate(node => document.activeElement === node) && posts === 0)
      ;({ trigger, dialog } = await openAvatar(h, ui))
      await chooseAvatar(h, dialog, target); await h.click(dialog.getByRole('button', { name: '取消', exact: true })); await dialog.waitFor({ state: 'hidden' })
      h.check('Cancel also leaves the real avatar unchanged', (await h.assertActor(ui)).avatarUrl === originalUrl && posts === 0 && await trigger.evaluate(node => document.activeElement === node))
      if (h.config.footprint.avatarSave !== true) { h.unverified('real-avatar-save', 'Footprint did not explicitly authorize changing this isolated account avatar'); return }
      ;({ dialog } = await openAvatar(h, ui)); await chooseAvatar(h, dialog, target)
      h.resources('avatar', initial.id, 'dedicated teacher avatar', { state: 'save-ack-pending', requestedAvatarId: target }); await h.flush()
      const saved = await h.ack(ui, '/physicsos/auth/me/avatar', 'POST', () => h.click(dialog.getByRole('button', { name: '保存头像', exact: true })))
      h.check('Avatar POST contains only the closed avatarId', canonical(saved.requestData) === canonical({ avatarId: target }))
      await dialog.waitFor({ state: 'hidden' })
      const current = await h.assertActor(ui)
      h.check('Successful avatar ACK is the actual expected owner and canonical path', saved.body?.user?.id === initial.id && current.avatarId === target && current.avatarUrl === avatarPath(target) && posts === 1)
      h.resources('avatar', initial.id, 'dedicated teacher avatar', { state: 'saved-and-retained', savedAvatarId: target }); await h.flush()
      const fresh = await h.createUi('teacher')
      try { const user = await h.assertActor(fresh); h.check('A new cache-free context observes the saved avatar through real me', user.avatarId === target && user.avatarUrl === avatarPath(target)) } finally { await h.closeUi(fresh) }
      for (const role of ['student', 'foreign']) { const other = await h.createUi(role); try { h.check(`${role} avatar was not changed by the teacher save`, (await h.assertActor(other)).avatarUrl === others[role]) } finally { await h.closeUi(other) } }
      if (!h.config.credentials) h.unverified('avatar-real-relogin', 'No private teacher loginCredentialsFile was supplied; an existing-session fresh context is not called a relogin')
      else {
        const login = await h.createUi('teacher', { transportOnly: true })
        try {
          // Verify the real cookie-issuing endpoint on the inert page before any native UI/RPC loads.
          const response = await h.api(login, '/physicsos/auth/login', { method: 'POST', data: { username: h.config.credentials.username, password: h.config.credentials.password, rememberDevice: true } })
          h.check('Relogin reached the real cookie-issuing endpoint', response.status === 200 && response.body?.user?.id === initial.id)
          login.transportOnly = false
          const user = await h.assertActor(login)
          h.check('A genuinely reissued session still observes the saved avatar', user.avatarId === target && user.avatarUrl === avatarPath(target))
          await login.page.goto(h.config.origin, { waitUntil: 'domcontentloaded' })
          await login.page.locator('[data-physicsos-auth-gate]').waitFor({ state: 'hidden' })
          h.report.evidence.reloginChannel = 'real browser Origin/Cookie auth endpoint, verified before native UI load'
          h.report.evidence.guiLoginFormValidated = false
        } finally { await h.closeUi(login) }
      }
      await h.capture(ui, 'avatar-12-choice-save')
    } finally { ui.context.off('request', observer) }
  })
}

export async function recentStage(h) {
  if (!h.config.footprint.recentScenes?.length) { h.unverified('recent-lifecycle', 'No existing physical scene IDs were explicitly authorized in the independent footprint'); return }
  if (h.config.footprint.existingWrites !== true) { h.unverified('recent-lifecycle', 'Existing-record lifecycle writes were not explicitly approved'); return }
  await withUi(h, async ui => {
    for (const fixture of h.config.footprint.recentScenes) {
      const path = `/physicsos/learning/product-state/recent-scenes/${idPath(fixture.sceneId)}`
      const original = (await h.read(ui, path)).state
      h.check('Authorized recent record starts live with real fences', original?.sceneId === fixture.sceneId && original.recentState === 'live' && Number.isInteger(original.recentGeneration) && Number.isInteger(original.recentVersion))
      const native = (await listPages(h, ui, '/physicsos/learning/scenes')).find(value => value.sceneId === fixture.sceneId)
      h.check('Existing physical scene identity/title are exact, not a synthetic recent row', native?.title === fixture.title && native.kind === 'experiment')
      h.resources('recent', fixture.sceneId, fixture.title, { createdByThisRun: false, state: 'live', beforeGeneration: original.recentGeneration, beforeVersion: original.recentVersion, nativeContentSha256: digest(withoutRecentMetadata(native)) }); await h.flush()
      await home(h, ui)
      const filter = ui.page.locator('select[aria-label="最近记录状态"]'), root = filter.locator('xpath=ancestor::section[1]')
      await filter.selectOption('live')
      let row = exactElement(root, 'data-recent-scene', fixture.sceneId)
      const remove = row.getByRole('button', { name: `移除 · ${fixture.title}`, exact: true })
      await remove.focus(); await h.click(remove)
      let dialog = ui.page.getByRole('dialog', { name: '移除最近记录', exact: true })
      await ui.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
      h.check('Cancel/Escape does not publish a recent mutation and restores entry focus', canonical((await h.read(ui, path)).state) === canonical(original) && await remove.evaluate(node => document.activeElement === node))
      const mutate = async (action, actionUi, before) => {
        h.resources('recent', fixture.sceneId, fixture.title, { state: `${action}-ack-pending` }); await h.flush()
        const response = await h.ack(ui, path, 'POST', actionUi), after = response.body?.state
        h.resources('recent', fixture.sceneId, fixture.title, { state: after?.recentState ?? 'unknown', observedGeneration: after?.recentGeneration, observedVersion: after?.recentVersion }); await h.flush()
        h.check('Recent ACK advances durable generation/version exactly once', after?.sceneId === fixture.sceneId && after.recentGeneration === before.recentGeneration + 1 && after.recentVersion === before.recentVersion + 1 && after.recentState === (action === 'delete' ? 'deleted' : 'live'))
        const authority = (await h.read(ui, path)).state
        h.check('Recent UI action agrees with a new real authority read', canonical(after) === canonical(authority))
        const retained = (await listPages(h, ui, '/physicsos/learning/scenes')).find(value => value.sceneId === fixture.sceneId)
        h.check('Removing/restoring recent metadata preserves the complete existing physical scene', !!retained && canonical(withoutRecentMetadata(retained)) === canonical(withoutRecentMetadata(native)))
        return after
      }
      const deleted = await mutate('delete', async () => { await h.click(remove); dialog = ui.page.getByRole('dialog', { name: '移除最近记录', exact: true }); await h.click(dialog.getByRole('button', { name: '确认移除', exact: true })) }, original)
      await filter.selectOption('deleted'); row = exactElement(root, 'data-recent-scene', fixture.sceneId)
      const restored = await mutate('restore', () => h.click(row.getByRole('button', { name: `恢复最近记录 · ${fixture.title}`, exact: true })), deleted)
      await filter.selectOption('live'); row = exactElement(root, 'data-recent-scene', fixture.sceneId)
      const second = await mutate('delete', async () => { await h.click(row.getByRole('button', { name: `移除 · ${fixture.title}`, exact: true })); await h.click(ui.page.getByRole('dialog', { name: '移除最近记录', exact: true }).getByRole('button', { name: '确认移除', exact: true })) }, restored)
      await mutate('restore', () => h.click(root.getByRole('button', { name: '撤销', exact: true })), second)
      await filter.selectOption('live'); row = exactElement(root, 'data-recent-scene', fixture.sceneId)
      await h.click(row.locator(':scope > button'))
      const pendulum = PENDULUM_SCENE.test(fixture.sceneId)
      if (pendulum) await ui.page.waitForFunction(sceneId => {
        const route = new URL(location.hash.slice(1), location.origin)
        return route.pathname === '/experiments/simple-pendulum' && route.searchParams.get('scene') === sceneId
      }, fixture.sceneId, { timeout: 10000 })
      const labSelector = `[data-physicsos-surface="lab"][data-physicsos-timeline="true"]${pendulum ? '[data-physicsos-domain="mechanics"]' : ''}`
      const lab = ui.page.locator(labSelector), playName = /^(播放 \/ 暂停|Play \/ pause)$/
      const play = lab.getByRole('button', { name: playName }), timeline = lab.getByRole('slider', { name: /^(时间轴|Timeline)$/ })
      if (pendulum) await lab.locator('[data-community-status="ready"] iframe, [data-workbench-viewport] svg[role="img"]').waitFor({ state: 'visible', timeout: 10000 })
      await play.waitFor({ state: 'visible', timeout: 10000 })
      h.check('The exact physical experiment has one enabled, initially paused playback toggle and real timeline', await play.count() === 1 && await play.isEnabled() && await play.getAttribute('aria-pressed') === 'false' && await lab.getAttribute('data-physicsos-running') === 'false' && Number(await timeline.getAttribute('max')) > 0)
      const initial = Number(await timeline.inputValue())
      h.check('The real timeline starts at a finite value', Number.isFinite(initial))
      await h.recordPendulumRun(ui, fixture, async () => {
        await h.click(play)
        await ui.page.waitForFunction(({ selector, start }) => {
          const lab = document.querySelector(`${selector}[data-physicsos-running="true"]`)
          return Number(lab?.querySelector('input[type="range"][aria-label="时间轴"], input[type="range"][aria-label="Timeline"]')?.value) > start
        }, { selector: labSelector, start: initial }, { timeout: 10000 })
        h.check('The actual timeline advances while the same toggle is pressed and the lab is running', await play.getAttribute('aria-pressed') === 'true')
        await h.click(play)
        const paused = ui.page.locator(`${labSelector}[data-physicsos-running="false"]`).getByRole('button', { name: playName }).and(ui.page.locator('[aria-pressed="false"]'))
        await paused.waitFor({ state: 'visible', timeout: 10000 })
        h.check('The same actual toggle returns the lab to paused', await paused.count() === 1)
      })
      await home(h, ui); await h.capture(ui, `recent-restored-${fixture.sceneId}`)
      const fresh = await h.createUi('teacher')
      try { h.check('Recovered recent state survives a new cache-free context', (await h.read(fresh, path)).state?.recentState === 'live') } finally { await h.closeUi(fresh) }
    }
  })
}

export async function canvasStage(h) {
  if (h.config.footprint.createCanvas !== true) { h.unverified('canvas-real-edit-lifecycle', 'Footprint did not authorize creating an identifiable isolated canvas'); return }
  await withUi(h, async ui => {
    const capabilities = await h.read(ui, '/physicsos/learning/canvases/capabilities')
    h.check('The declared enabled candidate has real canvas lifecycle write capabilities', capabilities.lifecycleWritesEnabled && capabilities.archive && capabilities.delete && capabilities.restore)
    await catalog(h, ui, 'canvas')
    const title = `${h.config.runId} canvas`, root = ui.page.locator('[data-physicsos-canvas-catalog]')
    await h.click(root.getByRole('button', { name: '新建工作台', exact: true }).first())
    const dialog = ui.page.getByRole('dialog'); await dialog.getByRole('textbox').fill(title)
    ui.creation = { kind: 'canvas', title }
    const created = await h.ack(ui, '/physicsos/learning/canvases', 'POST', () => h.click(dialog.getByRole('button', { name: '确认', exact: true })))
    const id = created.body?.head?.id
    h.check('Canvas was genuinely created by this UI request with the exact identifiable title', typeof id === 'string' && created.body.head.title === title && created.requestData.title === title && created.requestData.id === id)
    h.resources('canvas', id, title, { state: 'active', observedHead: created.body.head }); await h.flush(); ui.creation = undefined
    const workspace = ui.page.locator('[data-physicsos-canvas-workspace]'); await workspace.waitFor({ state: 'visible' })
    h.check('Actual native canvas workspace is bound to the created server ID', await workspace.getAttribute('data-canvas-id') === id)
    const commits = []
    const observer = async response => {
      if (new URL(response.url()).pathname === `/physicsos/learning/canvases/${idPath(id)}/commit` && response.request().method() === 'POST' && response.ok()) {
        try { commits.push({ body: await response.json(), data: response.request().postDataJSON() }) } catch {}
      }
    }
    ui.context.on('response', observer)
    try {
      await h.click(workspace.getByRole('button', { name: '添加笔记', exact: true }).first())
      await h.click(workspace.getByRole('button', { name: '编辑', exact: true }).first())
      const marker = `Complete teaching-tools note ${h.config.runId}`
      await workspace.getByRole('textbox', { name: '笔记', exact: true }).fill(marker)
      await h.click(workspace.getByRole('button', { name: '保存', exact: true }).last())
      await h.poll('A real canvas commit contains the entire identifiable note', () => h.api(ui, `/physicsos/learning/canvases/${idPath(id)}`), response => response.ok && response.body?.manifest?.nodes.some(node => node.kind === 'note' && node.body === marker) && response.body.head.version > created.body.head.version)
      const save = workspace.locator('header').getByRole('button', { name: '保存', exact: true })
      await h.poll('Canvas save control becomes enabled after real synchronization', () => save.isEnabled(), Boolean)
      await h.click(save)
      const before = await canvasSnapshot(h, ui, id)
      const commit = await h.poll('The complete real canvas edit has an actual server ACK', () => commits.findLast(value => value.body?.head?.manifestDigest === before.head.manifestDigest), Boolean)
      h.check('Successful note use comes from a real edit receipt, not a visit intent', typeof commit.data.editingSessionId === 'string' && commit.data.editingSessionId.length > 0)
      h.resources('canvas', id, title, { state: 'active', observedHead: before.head, contentSha256: digest({ manifest: before.manifest, objects: before.objects }), editingSessionId: commit.data.editingSessionId, marker }); await h.flush()
      let head = await organize(h, ui, 'canvas', id, 'archive', before.head)
      await staleWrite(h, ui, 'canvas', id, commit.data, head)
      head = await organize(h, ui, 'canvas', id, 'unarchive', head)
      await staleWrite(h, ui, 'canvas', id, commit.data, head)
      const readable = await canvasSnapshot(h, ui, id); compareCanvasContent(h, before, readable)
      head = await organize(h, ui, 'canvas', id, 'delete', head)
      await staleWrite(h, ui, 'canvas', id, commit.data, head)
      head = await organize(h, ui, 'canvas', id, 'restore', head)
      h.check('Restoring a formerly active canvas returns the real active head', stateOf(head) === 'active')
      await staleWrite(h, ui, 'canvas', id, commit.data, head)
      const after = await canvasSnapshot(h, ui, id); compareCanvasContent(h, before, after)
      const fresh = await h.createUi('teacher')
      try { compareCanvasContent(h, after, await canvasSnapshot(h, fresh, id)) } finally { await h.closeUi(fresh) }
      h.resources('canvas', id, title, { state: 'active-retained', observedHead: after.head, completeSnapshot: after }); await h.flush()
      await catalog(h, ui, 'canvas'); await h.capture(ui, 'canvas-real-note-restored')
    } finally { ui.context.off('response', observer) }
  })
}

export async function whiteboardStage(h) {
  if (h.config.footprint.createWhiteboard !== true) { h.unverified('whiteboard-real-edit-lifecycle', 'Footprint did not authorize creating a native isolated whiteboard'); return }
  await withUi(h, async ui => {
    const capabilities = await h.read(ui, '/physicsos/whiteboards/capabilities')
    h.check('The declared enabled candidate has real whiteboard lifecycle capabilities', capabilities.lifecycleWritesEnabled && capabilities.archive && capabilities.delete && capabilities.restore)
    await catalog(h, ui, 'whiteboard')
    const title = `${h.config.runId} whiteboard`, root = ui.page.locator('[data-physicsos-whiteboard-catalog]')
    await h.click(root.getByRole('button', { name: '新建画板', exact: true }).first())
    const dialog = ui.page.getByRole('dialog'); await dialog.getByRole('textbox').fill(title)
    ui.creation = { kind: 'whiteboard', title }
    const created = await h.ack(ui, '/physicsos/whiteboards', 'POST', () => h.click(dialog.getByRole('button', { name: '确认', exact: true })))
    const id = created.body?.document?.id
    h.check('Whiteboard create ACK is a genuine complete document with the exact title', typeof id === 'string' && created.body.document.title === title && created.requestData.title === title)
    h.resources('whiteboard', id, title, { state: 'active', observedHead: { revision: created.body.revision, generation: created.body.generation } }); await h.flush(); ui.creation = undefined
    const board = ui.page.locator('[data-physicsos-whiteboard-workspace]'), canvas = board.locator('[data-whiteboard-canvas]')
    await canvas.waitFor({ state: 'visible' }); await h.hit(canvas)
    const box = await canvas.boundingBox(); h.check('Native editor has a real drawable surface', !!box && box.width > 300 && box.height > 200)
    await h.click(board.getByTestId('toolbar-freedraw'))
    const cdp = await ui.context.newCDPSession(ui.page), start = { x: box.x + box.width * .25, y: box.y + box.height * .3 }
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .1 })
      for (let index = 1; index <= 20; index++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + index * 4, y: start.y + Math.sin(index / 3) * 12, button: 'left', buttons: 1, pointerType: 'pen', force: .1 + index / 25 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + 80, y: start.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
    } finally { await cdp.detach() }
    await h.click(board.getByTestId('toolbar-text')); await ui.page.mouse.click(start.x + 120, start.y + 80)
    const marker = `Teaching-tools native text ${h.config.runId}`
    await board.getByRole('textbox', { name: /^(编辑文字|Edit text)$/ }).fill(marker); await ui.page.keyboard.press('Escape')
    const saved = await h.ack(ui, `/physicsos/whiteboards/${idPath(id)}`, 'PUT', () => h.click(board.getByRole('button', { name: '保存画板', exact: true })))
    const elements = saved.body?.document?.scene?.elements
    h.check('Real save contains identifiable native text and complete raw pen samples', Array.isArray(elements) && elements.some(element => !element.isDeleted && element.type === 'text' && element.text === marker) && elements.some(element => !element.isDeleted && element.type === 'freedraw' && element.points?.length >= 20 && element.customData?.physicsosInk?.samples?.length >= 20))
    const before = await whiteboardSnapshot(h, ui, id)
    h.check('Native editor save and full authority GET agree exactly', canonical(saved.body.document) === canonical(before.record.document))
    h.resources('whiteboard', id, title, { state: 'active', contentSha256: digest(before.record.document), editingSessionId: saved.requestData.editingSessionId, marker }); await h.flush()
    let head = (await whiteboardSnapshot(h, ui, id)).record
    head = await organize(h, ui, 'whiteboard', id, 'archive', head)
    await staleWrite(h, ui, 'whiteboard', id, saved.requestData, head)
    compareBoardContent(h, before, await whiteboardSnapshot(h, ui, id, true))
    head = await organize(h, ui, 'whiteboard', id, 'unarchive', head)
    await staleWrite(h, ui, 'whiteboard', id, saved.requestData, head)
    head = await organize(h, ui, 'whiteboard', id, 'delete', head)
    await staleWrite(h, ui, 'whiteboard', id, saved.requestData, head)
    compareBoardContent(h, before, await whiteboardSnapshot(h, ui, id, true))
    head = await organize(h, ui, 'whiteboard', id, 'restore', head)
    h.check('The restored native whiteboard is active and readable', stateOf(head) === 'active')
    await staleWrite(h, ui, 'whiteboard', id, saved.requestData, head)
    const after = await whiteboardSnapshot(h, ui, id); compareBoardContent(h, before, after)
    const fresh = await h.createUi('teacher')
    try { compareBoardContent(h, after, await whiteboardSnapshot(h, fresh, id)) } finally { await h.closeUi(fresh) }
    h.resources('whiteboard', id, title, { state: 'active-retained', completeSnapshot: after }); await h.flush()
    await catalog(h, ui, 'whiteboard'); await h.capture(ui, 'whiteboard-native-ink-restored')
  })
}

export async function workspaceContent(h, ui, fixture) {
  const native = await h.nativeProbe(ui, fixture.nativeProbe, fixture.workspaceId), materials = []
  for (const material of fixture.materials) {
    const snapshot = material.kind === 'canvas' ? await canvasSnapshot(h, ui, material.id) : await h.nativeProbe(ui, material.nativeProbe, material.id)
    if (fixture.nativeProbe.stream === 'workspace-follow-v1' && material.kind === 'canvas') {
      h.check('Complete declared canvas material is bound to the exact native project', snapshot.head.title === material.title && snapshot.manifest.metadata?.studyProjectId === fixture.workspaceId)
    }
    materials.push({ kind: material.kind, id: material.id, title: material.title, ...(material.nativeProbe ? { nativeProbe: material.nativeProbe } : {}), snapshot })
  }
  return { native, materials }
}

export async function workspaceStage(h) {
  const fixtures = h.config.footprint.workspaces ?? []
  if (!fixtures.length || h.config.footprint.existingWrites !== true) { h.unverified('workspace-lifecycle-material-integrity', 'Explicit native workspace/material IDs and existingWrites authorization are required'); return }
  if (fixtures.some(value => !value.nativeProbe || value.materials.some(item => item.kind === 'session' && !item.nativeProbe))) { h.unverified('workspace-native-integrity', 'A real read-only nativeProbe contract is required before any destructive workspace action; no native backend response is invented'); return }
  await withUi(h, async ui => {
    for (const fixture of fixtures) {
      const path = `/physicsos/learning/product-state/projects/${idPath(fixture.workspaceId)}`, original = (await h.read(ui, path)).state
      h.check('Workspace has a real owned live personal lifecycle head', original?.projectId === fixture.workspaceId && original.state === 'live' && Number.isSafeInteger(original.version) && Number.isSafeInteger(original.generation))
      const baseline = await workspaceContent(h, ui, fixture)
      h.resources('workspace', fixture.workspaceId, fixture.title, { createdByThisRun: false, state: 'live', nativeSnapshotSha256: digest(baseline.native), materialIds: fixture.materials.map(value => value.id), workspaceContentSha256: digest(baseline) }); await h.flush()
      const open = async () => {
        await h.click(ui.page.getByRole('button', { name: /^我的工作区(?: · .+)?$/ }).first())
        const panel = ui.page.locator('[data-physicsos-workspace-panel]'); await panel.waitFor({ state: 'visible' }); return panel
      }
      const validateRetained = async (target = ui) => {
        const value = await workspaceContent(h, target, fixture)
        h.check('Every field of the complete native workspace survives project organization', canonical(value.native) === canonical(baseline.native))
        h.check('The entire original material set, associations, and native snapshots survive workspace organization', canonical(value.materials) === canonical(baseline.materials))
      }
      const mutate = async (action, state, before, actionUi) => {
        h.resources('workspace', fixture.workspaceId, fixture.title, { state: `${action}-ack-pending` }); await h.flush()
        const { body, requestData } = await h.ack(ui, path, 'POST', actionUi), after = body?.state
        h.resources('workspace', fixture.workspaceId, fixture.title, { state: after?.state ?? 'unknown', observedHead: after }); await h.flush()
        h.check('Workspace organization uses the exact action and original fences', requestData?.action === action && requestData.expectedVersion === before.version && requestData.expectedGeneration === before.generation)
        h.check('Workspace organization has a durable exact workspace/generation/version ACK', after?.projectId === fixture.workspaceId && after.state === state && after.version === before.version + 1 && after.generation === before.generation + 1)
        h.check('Workspace organization ACK agrees with the fresh owned lifecycle read', canonical((await h.read(ui, path)).state) === canonical(after))
        await validateRetained()
        return after
      }
      let panel = await open(), filter = panel.getByRole('combobox', { name: '工作区状态', exact: true })
      await filter.selectOption('live')
      let row = exactElement(panel, 'data-workspace-id', fixture.workspaceId)
      h.check('Native header row is the explicitly named workspace', (await row.textContent()).includes(fixture.title))
      const remove = before => mutate('delete', 'deleted', before, async () => {
        await h.click(row.getByRole('button', { name: `删除 · ${fixture.title}`, exact: true }))
        await h.click(panel.getByRole('button', { name: '确认删除工作区', exact: true }))
      })
      let head = await remove(original)
      head = await mutate('restore', 'live', head, () => h.click(panel.getByRole('button', { name: '撤销删除', exact: true })))
      await filter.selectOption('live'); row = exactElement(panel, 'data-workspace-id', fixture.workspaceId); head = await remove(head)
      await ui.page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' })
      await h.click(ui.page.locator('[data-physicsos-navigation]').getByRole('button', { name: '项目', exact: true }))
      const projects = ui.page.locator('[data-physicsos-projects]'); await projects.waitFor({ state: 'visible' })
      await h.click(projects.getByRole('button', { name: /^未分组/ }))
      for (const material of fixture.materials) {
        await h.click(projects.getByRole('button', { name: material.kind === 'canvas' ? '实验工作台' : '对话', exact: true }))
        const entry = projects.locator('li').filter({ hasText: material.title }).getByRole('button').first()
        await h.hit(entry); h.check('Original material remains accessible under Unassigned, not deleted with the workspace', await entry.isEnabled())
      }
      panel = await open(); filter = panel.getByRole('combobox', { name: '工作区状态', exact: true }); await filter.selectOption('deleted'); row = exactElement(panel, 'data-workspace-id', fixture.workspaceId)
      head = await mutate('restore', 'live', head, () => h.click(row.getByRole('button', { name: `恢复工作区 · ${fixture.title}`, exact: true })))
      await ui.page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' })
      await h.click(ui.page.locator('[data-physicsos-navigation]').getByRole('button', { name: '项目', exact: true }))
      const project = projects.locator('aside').getByRole('button', { name: new RegExp(`^${escapeRegex(fixture.title)}`) })
      await h.click(project)
      head = await mutate('archive', 'archived', head, () => h.click(projects.getByRole('button', { name: '归档项目', exact: true })))
      await projects.getByRole('combobox').selectOption('archived')
      await h.click(project)
      const durable = await mutate('unarchive', 'live', head, () => h.click(projects.getByRole('button', { name: '取消归档', exact: true })))
      const fresh = await h.createUi('teacher')
      try {
        h.check('Independent context verifies full final project identity/state/version/generation', canonical((await h.read(fresh, path)).state) === canonical(durable))
        await validateRetained(fresh)
      } finally { await h.closeUi(fresh) }
      h.resources('workspace', fixture.workspaceId, fixture.title, { state: 'live-retained', observedHead: durable }); await h.flush(); await h.capture(ui, `workspace-retained-${fixture.workspaceId}`)
    }
  })
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export async function layoutStage(h) {
  await withUi(h, async ui => {
    for (const theme of ['light', 'dark']) {
      await ui.page.emulateMedia({ colorScheme: theme })
      for (const [width, height] of [[1400, 900], [1280, 800], [1024, 768], [390, 844], [320, 640]]) {
        await ui.page.setViewportSize({ width, height }); await home(h, ui)
        const actualTheme = await ui.page.evaluate(() => ({ dark: document.body.hasAttribute('data-ds-dark-theme'), scheme: getComputedStyle(document.documentElement).colorScheme }))
        if (actualTheme.dark !== (theme === 'dark')) { h.unverified(`actual-theme-${theme}`, 'Media emulation did not select the product theme; no DOM attribute or CSS is injected to fake it'); continue }
        await ui.page.waitForFunction(() => {
          const frame = document.querySelector('[data-product-shell]'), center = document.querySelector('[data-shell-center]')
          return frame && center && frame.hasAttribute('data-product-compact') === (frame.getBoundingClientRect().width <= 600)
        })
        const nav = ui.page.locator('[data-physicsos-navigation]'), buttons = nav.getByRole('button')
        h.check('Current real product navigation has six destinations', await buttons.count() === 6)
        for (let index = 0; index < await buttons.count(); index++) {
          const target = buttons.nth(index), box = await h.hit(target)
          h.check('Real navigation hit areas retain 44px targets', box.width >= 43.5 && box.height >= 43.5)
        }
        // Compare one simultaneous layout snapshot, never boxes from different scroll positions.
        const seen = await buttons.evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
        h.check('Navigation targets do not share the same hit intersection', seen.every((left, index) => seen.slice(index + 1).every(right => !(left.x < right.x + right.width - .5 && left.x + left.width > right.x + .5 && left.y < right.y + right.height - .5 && left.y + left.height > right.y + .5))))
        const trigger = ui.page.getByRole('button', { name: '更换头像', exact: true }); await h.hit(trigger)
        const { dialog } = await openAvatar(h, ui)
        for (const id of AVATAR_IDS) await h.hit(dialog.locator(`input[value="${id}"]`).locator('xpath=ancestor::label[1]'))
        await ui.page.keyboard.press('Escape')
        await h.capture(ui, `layout-${theme}-${width}x${height}`)
      }
    }
  })
}
export const CORE_STAGES = Object.freeze({ avatar: avatarStage, recent: recentStage, canvas: canvasStage, whiteboard: whiteboardStage, workspace: workspaceStage, layout: layoutStage })
