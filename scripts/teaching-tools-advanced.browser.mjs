/** Optional real statistics/role and external-restart evidence. No server execution or success mocks. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { AVATAR_IDS, avatarPath, canonical, checkpointManifest, digest, identityFields, listPages, privateJson, operationId } from './teaching-tools-browser-helpers.mjs'
import { canvasHead, canvasSnapshot, whiteboardSnapshot } from './teaching-tools-core.browser.mjs'

const fileDigest = bytes => createHash('sha256').update(bytes).digest('hex')
const query = values => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()
const userPath = (actor, days = 7) => `/physicsos/admin/activity/v1/users?${query({ schoolId: actor.schoolId, username: actor.username, days })}`
const rankPath = values => `/physicsos/admin/activity/v1/schools?${query({ days: 7, page: 1, pageSize: 20, sort: 'uses', order: 'desc', ...values })}`
const roleKey = (h, role, sameSchool) => Object.keys(h.config.states).find(key => h.config.expected[key].role === role && (sameSchool === undefined || (h.config.expected[key].schoolId === h.config.expected.teacher.schoolId) === sameSchool))
const counts = value => ({ visits: value.visits, opens: value.opens, uses: value.uses })
function validCounts(h, value) { h.check('Real activity counts are nonnegative integers', ['visits', 'opens', 'uses'].every(key => Number.isInteger(value[key]) && value[key] >= 0)) }
async function adminUi(h, ui) {
  await h.click(ui.page.getByRole('button', { name: '账户菜单', exact: true }))
  await h.click(ui.page.getByRole('menuitem', { name: '管理后台', exact: true }))
  const root = ui.page.locator('[data-physicsos-surface="admin"]'); await root.waitFor({ state: 'visible' }); return root
}
async function allRanking(h, ui) {
  const rows = [], seen = new Set()
  let first
  for (let page = 1; page <= 1000; page++) {
    const value = await h.read(ui, rankPath({ page }))
    h.check('School ranking uses a real paginated wire response', Array.isArray(value.rows) && value.page === page && value.pageSize === 20 && Number.isInteger(value.total))
    first ??= value
    for (const row of value.rows) {
      h.check('Ranking pages do not duplicate schools', !seen.has(row.schoolId)); seen.add(row.schoolId); rows.push(row)
      validCounts(h, row)
      const avatars = row.avatars
      h.check('Current avatar snapshot is exactly the closed 12-avatar distribution', Array.isArray(avatars?.distribution) && avatars.distribution.length === 12 && canonical(avatars.distribution.map(item => item.id).sort()) === canonical([...AVATAR_IDS].sort()) && avatars.distribution.every(item => item.path === avatarPath(item.id) && Number.isInteger(item.users) && item.users >= 0))
      const adopted = avatars.distribution.reduce((sum, item) => sum + item.users, 0)
      h.check('Avatar adoption is a current eligible-account snapshot, not a time-window use count', adopted === avatars.adoptedUsers && adopted + avatars.otherUsers === avatars.eligibleUsers)
    }
    if (rows.length >= value.total) { h.check('Ranking exhausts exactly the declared authorized school count', rows.length === value.total); return { ...first, rows } }
    h.check('Ranking cannot hide missing pages behind an empty response', value.rows.length > 0)
  }
  h.check('Ranking stays within its declared safety budget', false)
}
const actorKey = actor => canonical([actor.schoolId, actor.username])
async function fixtureUserCounts(h, ui) {
  const users = {}, missing = [], reader = h.config.expected[ui.role]
  for (const [role, actor] of Object.entries(h.config.expected)) {
    if (!h.config.states[role] || actor.role === 'SUPER_ADMIN' || users[actorKey(actor)]) continue
    if (reader.role !== 'SUPER_ADMIN' && reader.schoolId !== actor.schoolId) { missing.push(role); continue }
    const value = await h.read(ui, userPath(actor))
    validCounts(h, value)
    h.check('Aggregate baseline/query remains bound to the exact affected fixture actor', value.schoolId === actor.schoolId && value.username === actor.username)
    users[actorKey(actor)] = { schoolId: actor.schoolId, username: actor.username, counts: value }
  }
  return { users, missing }
}
function checkModuleAggregate(h, value) {
  h.check('User uses is the sum of the actual authoritative module uses', Array.isArray(value.modules) && new Set(value.modules.map(row => row.module)).size === value.modules.length && value.modules.every(row => Number.isInteger(row.uses) && row.uses >= 0) && value.uses === value.modules.reduce((sum, row) => sum + row.uses, 0))
}
async function metricsUi(h, region, value) {
  for (const key of ['visits', 'opens', 'uses']) {
    const rendered = region.locator(`[data-activity-metric="${key}"] dd`)
    await h.poll(`Real UI ${key} agrees with the selected user's authority response`, () => rendered.textContent(), text => text?.trim() === value[key].toLocaleString('zh-CN'))
  }
}
async function statisticsUi(h, ui, teacher) {
  const root = await adminUi(h, ui)
  await h.click(root.getByRole('tab', { name: '学校排行', exact: true }))
  const ranking = root.getByRole('region', { name: '学校用量排行', exact: true }); await ranking.waitFor({ state: 'visible' })
  await ranking.getByRole('searchbox', { name: '搜索学校', exact: true }).fill(teacher.schoolName)
  const row = ranking.getByRole('row').filter({ hasText: teacher.schoolName }).filter({ hasText: teacher.schoolId })
  await row.waitFor({ state: 'visible' }); await h.click(row.getByRole('button', { name: '查看12款', exact: true }))
  const distribution = ranking.getByRole('region', { name: `${teacher.schoolName} 当前头像分布`, exact: true }); await distribution.waitFor({ state: 'visible' })
  h.check('Actual ranking expands twelve current avatar rows', await distribution.locator('li').count() === 12)
  const seven = await h.read(ui, rankPath({ schoolId: teacher.schoolId, days: 7 })), thirty = await h.read(ui, rankPath({ schoolId: teacher.schoolId, days: 30 }))
  const a = seven.rows.find(value => value.schoolId === teacher.schoolId)?.avatars, b = thirty.rows.find(value => value.schoolId === teacher.schoolId)?.avatars
  h.check('Changing the activity time range does not reinterpret current avatar adoption', !!a && !!b && canonical({ adopted: a.adoptedUsers, other: a.otherUsers, eligible: a.eligibleUsers, distribution: a.distribution }) === canonical({ adopted: b.adoptedUsers, other: b.otherUsers, eligible: b.eligibleUsers, distribution: b.distribution }))
  await h.click(root.getByRole('tab', { name: '用户', exact: true }))
  const search = root.getByRole('textbox').first(); await search.fill(teacher.username)
  const userRow = root.getByRole('row').filter({ hasText: teacher.username }).filter({ hasText: teacher.schoolName })
  await userRow.waitFor({ state: 'visible' }); await h.click(userRow.getByRole('button', { name: teacher.username, exact: true }))
  const region = root.getByRole('region', { name: `${teacher.username} 的使用统计`, exact: true }); await region.waitFor({ state: 'visible' })
  const detail = await h.read(ui, userPath(teacher)); await metricsUi(h, region, detail)
  await h.capture(ui, 'admin-real-school-avatar-and-user-statistics')
  return detail
}
export async function statisticsStage(h) {
  const key = roleKey(h, 'SUPER_ADMIN') ?? roleKey(h, 'SCHOOL_ADMIN', true)
  if (!key) { h.unverified('statistics-authorized-actor', 'No exact live SUPER_ADMIN or teacher-school SCHOOL_ADMIN storage fixture was supplied'); return }
  const ui = await h.createUi(key)
  try {
    const capabilities = await h.read(ui, '/physicsos/activity/v1/capabilities')
    if (!capabilities.collectionEnabled || !capabilities.queryCapacityVerified) h.unverified('activity-capacity-and-collection', 'The real host has not declared collection/capacity verified; figures are not promoted to complete acceptance')
    const teacher = h.config.expected.teacher, detail = await h.read(ui, userPath(teacher)), ranking = await allRanking(h, ui)
    validCounts(h, detail)
    h.check('User detail is the exact expected tenant/user, not legacy use:view', detail.schoolId === teacher.schoolId && detail.username === teacher.username && detail.version === 1)
    const school = ranking.rows.find(value => value.schoolId === teacher.schoolId)
    if (!school) { h.unverified('teacher-school-ranking', 'Fixture school is excluded/missing from the actual authorized ranking; no row is fabricated'); return }
    const beforeWrites = !h.report.stages.some(value => ['avatar', 'recent', 'canvas', 'whiteboard', 'workspace', 'layout'].includes(value.id))
    const actors = await fixtureUserCounts(h, ui)
    checkModuleAggregate(h, detail)
    if (actors.missing.length) h.unverified('aggregate-actor-baseline-coverage', 'The permitted reader cannot baseline every affected fixture actor; school/overview causal aggregate claims remain unverified')
    h.report.statistics = { verdict: 'baseline_only_not_verified', baselineBeforeWrites: beforeWrites, adminKey: key, eventIndex: h.report.activityAcks.length,
      baseline: { teacher: detail, school, overview: ranking.overview, rankingScope: ranking.scope, rankingRows: ranking.rows, actors }, capturedAt: new Date().toISOString() }
    if (!beforeWrites) h.unverified('statistics-baseline-order', 'Statistics was requested after mutations; snapshots alone cannot prove these operations caused increments')
    else h.unverified('statistics-delta-pending', 'Real baseline captured before actions; request statistics first and roles last to reconcile actual business-source deltas')
    await statisticsUi(h, ui, teacher)
  } finally { await h.closeUi(ui) }
}
async function reconcileStatistics(h) {
  const proof = h.report.statistics
  if (!proof?.baselineBeforeWrites) { h.unverified('statistics-causal-delta', 'No pre-action actual baseline exists; operation intents are not substituted for durable success events'); return }
  if (h.config.footprint.activityExclusive !== true) { h.unverified('statistics-exclusive-fixture', 'The footprint must affirm activityExclusive=true before attributing count deltas to this runner'); return }
  const unverifiedAtStart = h.report.unverified.length
  const ui = await h.createUi(proof.adminKey)
  try {
    const teacher = h.config.expected.teacher
    const current = await h.poll('Activity durable business receipts catch up', () => h.read(ui, userPath(teacher)), value => value.integrity?.state === 'complete' && value.integrity.pendingReceipts === 0, 60000)
    validCounts(h, current)
    if (current.from !== proof.baseline.teacher.from || current.to !== proof.baseline.teacher.to) { h.unverified('statistics-window-rollover', 'The real Shanghai-day query window changed; no unchecked cross-window delta is asserted'); return }
    const events = h.report.activityAcks.slice(proof.eventIndex).filter(value => value.role === 'teacher')
    h.check('Observed event acknowledgements use only the real visit/open protocol', events.every(value => ['visit', 'open'].includes(value.kind) && ['recorded', 'duplicate'].includes(value.status)))
    const recorded = events.filter(value => value.status === 'recorded'), before = proof.baseline.teacher
    h.check('Visits equal acknowledged successful client visits, not logins or intentions', current.visits - before.visits === recorded.filter(value => value.kind === 'visit').length)
    h.check('Opens equal acknowledged actual entry opens, not administrative removal', current.opens - before.opens === recorded.filter(value => value.kind === 'open').length)
    if (!recorded.some(value => value.kind === 'visit')) h.unverified('accepted-visits', 'No successful visit acknowledgement was observed in the selected stages')
    if (!recorded.some(value => value.kind === 'open')) h.unverified('accepted-opens', 'No successful open acknowledgement was observed in the selected stages')
    checkModuleAggregate(h, before); checkModuleAggregate(h, current)
    const modules = new Map(current.modules.map(value => [value.module, value])), original = new Map(before.modules.map(value => [value.module, value]))
    const verifiedSources = {}
    for (const [kind, module] of [['canvas', 'canvas'], ['whiteboard', 'whiteboard']]) {
      const sessions = new Set(h.report.resources.filter(value => value.kind === kind && value.createdByThisRun && typeof value.editingSessionId === 'string').map(value => value.editingSessionId))
      if (!sessions.size) { h.unverified(`${module}-durable-use-source`, 'No genuine successful edit receipt/session was produced by this selected run'); continue }
      const delta = (modules.get(module)?.uses ?? 0) - (original.get(module)?.uses ?? 0)
      h.check(`${module} uses count unique durable edit sessions; archive/delete/restore/stale writes add none`, delta === sessions.size, { durableEditingSessions: sessions.size, actualUsesDelta: delta })
      verifiedSources[module] = { durableEditingSessions: sessions.size, actualUsesDelta: delta }
    }
    for (const module of ['home', 'projects', 'profile', 'app']) h.check(`${module} management/view intentions do not become effective uses`, (modules.get(module)?.uses ?? 0) === (original.get(module)?.uses ?? 0))
    const labDelta = (modules.get('lab')?.uses ?? 0) - (original.get('lab')?.uses ?? 0)
    if (labDelta > 0) h.unverified('experiment-run-receipt-correlation', 'Real lab uses increased, but this core delivery does not enumerate their durable experiment-run receipt IDs; playback intent is not called a receipt')
    const provenUses = Object.values(verifiedSources).reduce((sum, value) => sum + value.durableEditingSessions, 0)
    const otherUseDeltas = [...new Set([...modules.keys(), ...original.keys()])].filter(module => !['canvas', 'whiteboard'].includes(module)).map(module => ({ module, delta: (modules.get(module)?.uses ?? 0) - (original.get(module)?.uses ?? 0) }))
    const userAggregateProven = otherUseDeltas.every(value => value.delta === 0) && provenUses > 0
    if (userAggregateProven) h.check('Aggregate user uses advances only by the proven successful durable-source sessions', current.uses - before.uses === provenUses, { provenUses, actualDelta: current.uses - before.uses })
    else h.unverified('aggregate-user-uses-source-coverage', 'Aggregate user uses cannot be called verified while another source has an uncorrelated delta or no durable source was proven')
    const ranking = await allRanking(h, ui), school = ranking.rows.find(value => value.schoolId === teacher.schoolId), avatar = h.report.resources.find(value => value.kind === 'avatar' && value.savedAvatarId)
    const actorsAfter = await fixtureUserCounts(h, ui), actorsBefore = proof.baseline.actors
    const roleCoverage = actorsBefore && actorsBefore.missing.length === 0 && actorsAfter.missing.length === 0 && canonical(Object.keys(actorsBefore.users).sort()) === canonical(Object.keys(actorsAfter.users).sort())
    const cohortStable = canonical(proof.baseline.teacher.rankingExclusions) === canonical(current.rankingExclusions) && proof.baseline.rankingScope === ranking.scope && canonical(proof.baseline.rankingRows.map(value => value.schoolId).sort()) === canonical(ranking.rows.map(value => value.schoolId).sort())
    if (userAggregateProven && roleCoverage && cohortStable && h.config.footprint.aggregateActivityExclusive === true) {
      const expectedSchoolDeltas = new Map()
      for (const [key, entry] of Object.entries(actorsBefore.users)) {
        const afterActor = actorsAfter.users[key].counts, beforeActor = entry.counts
        checkModuleAggregate(h, beforeActor); checkModuleAggregate(h, afterActor)
        h.check('Every affected fixture actor retains the same actual query window', beforeActor.from === afterActor.from && beforeActor.to === afterActor.to)
        const expected = key === actorKey(teacher) ? provenUses : 0
        h.check('Other fixture actors do not gain uses from read/admin/lifecycle intentions', afterActor.uses - beforeActor.uses === expected)
        const excluded = current.rankingExclusions.schoolIds.includes(entry.schoolId) || current.rankingExclusions.accounts.some(account => account.schoolId === entry.schoolId && account.username === entry.username)
        if (!excluded) expectedSchoolDeltas.set(entry.schoolId, (expectedSchoolDeltas.get(entry.schoolId) ?? 0) + expected)
      }
      for (const beforeSchool of proof.baseline.rankingRows) {
        const afterSchool = ranking.rows.find(value => value.schoolId === beforeSchool.schoolId)
        h.check('Each school aggregate uses delta equals proven eligible fixture-source deltas', afterSchool.uses - beforeSchool.uses === (expectedSchoolDeltas.get(beforeSchool.schoolId) ?? 0))
      }
      const expectedOverview = ranking.rows.reduce((sum, value) => sum + (expectedSchoolDeltas.get(value.schoolId) ?? 0), 0)
      h.check('Overview aggregate uses delta equals the same complete proven school/source set', ranking.overview.uses - proof.baseline.overview.uses === expectedOverview)
      h.check('Overview uses is the actual sum of the complete authorized school rows', ranking.overview.uses === ranking.rows.reduce((sum, value) => sum + value.uses, 0) && proof.baseline.overview.uses === proof.baseline.rankingRows.reduce((sum, value) => sum + value.uses, 0))
      proof.aggregateUses = { user: true, school: true, overview: true, provenUses }
    } else {
      h.unverified('aggregate-school-uses-source-coverage', 'School aggregate attribution needs all affected role baselines/after reads, a stable cohort, complete successful sources and aggregateActivityExclusive=true')
      h.unverified('aggregate-overview-uses-source-coverage', 'Overview uses remains unverified when any affected fixture role/source or authorized cohort is not covered')
      proof.aggregateUses = { user: userAggregateProven, school: false, overview: false, provenUses }
    }
    if (avatar && school) {
      const previous = proof.baseline.school.avatars, after = school.avatars
      h.check('Avatar eligibility remains the real stable account cohort', after.eligibleUsers === previous.eligibleUsers)
      const added = avatar.beforeAvatarId === null ? 1 : 0
      h.check('Current avatar adoption is a snapshot delta, not an activity use increment', after.adoptedUsers - previous.adoptedUsers === added && after.otherUsers - previous.otherUsers === -added)
      for (const id of AVATAR_IDS) {
        const expected = (id === avatar.savedAvatarId ? 1 : 0) - (id === avatar.beforeAvatarId ? 1 : 0)
        h.check(`Actual current avatar distribution ${id} reconciles the saved principal`, after.distribution.find(value => value.id === id).users - previous.distribution.find(value => value.id === id).users === expected)
      }
    } else h.unverified('current-avatar-adoption-delta', 'No real avatar save and authorized school snapshot pair exists')
    await statisticsUi(h, ui, teacher)
    proof.after = current; proof.testedDurableSources = verifiedSources; proof.acceptedClientEvents = recorded.map(value => ({ kind: value.kind, module: value.module, status: value.status, occurredAt: value.occurredAt }))
    const completeSelectedProof = h.report.unverified.length === unverifiedAtStart
    proof.verdict = completeSelectedProof ? 'actual_baseline_and_selected_source_deltas_checked' : 'partial_source_deltas_checked'
    if (completeSelectedProof) {
      h.report.unverified = h.report.unverified.filter(value => value.label !== 'statistics-delta-pending')
      const stage = h.report.stages.find(value => value.id === 'statistics')
      if (stage && !h.report.unverified.some(value => value.stage === 'statistics')) stage.status = 'passed'
    }
  } finally { await h.closeUi(ui) }
}
async function rejectedRead(h, ui, path, label, statuses = [401, 403]) {
  const response = await h.api(ui, path, { expectDenied: true })
  const privateFields = ['user', 'rows', 'modules', 'overview', 'visits', 'opens', 'uses', 'schoolId', 'username']
  h.check(label, !response.ok && statuses.includes(response.status) && (!response.body || privateFields.every(key => !Object.hasOwn(response.body, key))), { status: response.status })
}
export async function rolesStage(h) {
  const teacher = h.config.expected.teacher, matrix = []
  const required = { superAdmin: roleKey(h, 'SUPER_ADMIN'), schoolAdmin: roleKey(h, 'SCHOOL_ADMIN', true), foreignAdmin: roleKey(h, 'SCHOOL_ADMIN', false), teacher: 'teacher', student: 'student' }
  for (const [label, key] of Object.entries(required)) {
    if (!key) { h.unverified(`role-${label}`, 'An exact authenticated fixture/state for this role was not supplied'); matrix.push({ role: label, verified: false }); continue }
    const ui = await h.createUi(key)
    try {
      const actor = await h.assertActor(ui), admin = ['SUPER_ADMIN', 'SCHOOL_ADMIN'].includes(actor.role)
      await h.click(ui.page.getByRole('button', { name: '账户菜单', exact: true }))
      h.check(`${label} admin entry agrees with the actual authenticated role`, await ui.page.getByRole('menuitem', { name: '管理后台', exact: true }).count() === (admin ? 1 : 0)); await ui.page.keyboard.press('Escape')
      if (!admin) {
        await rejectedRead(h, ui, userPath(teacher), `${label} cannot read administrator user statistics`, [403])
        await rejectedRead(h, ui, rankPath({}), `${label} cannot read administrator school ranking`, [403])
      } else {
        const ranking = await h.read(ui, rankPath({}))
        h.check(`${label} real ranking scope matches server authority`, ranking.scope === (actor.role === 'SUPER_ADMIN' ? 'platform' : 'school'))
        if (actor.role === 'SCHOOL_ADMIN') h.check(`${label} sees only the authenticated tenant's school data`, ranking.rows.every(row => row.schoolId === actor.schoolId))
        if (actor.role === 'SCHOOL_ADMIN' && actor.schoolId !== teacher.schoolId) {
          await rejectedRead(h, ui, userPath(teacher), 'Foreign school administrator cannot read teacher-school user detail', [403])
          await rejectedRead(h, ui, rankPath({ schoolId: teacher.schoolId }), 'Foreign school administrator cannot select another tenant ranking', [403])
        } else {
          const detail = await h.read(ui, userPath(teacher)); h.check(`${label} actual user detail is precisely the permitted fixture`, detail.schoolId === teacher.schoolId && detail.username === teacher.username)
          if (actor.role === 'SUPER_ADMIN') { const foreign = await h.read(ui, userPath(h.config.expected.foreign)); h.check('Super administrator can read the separate authorized test school', foreign.schoolId === h.config.expected.foreign.schoolId && foreign.username === h.config.expected.foreign.username) }
        }
      }
      matrix.push({ role: label, verified: true, actualRole: actor.role, tenant: actor.schoolId })
    } finally { await h.closeUi(ui) }
  }
  const anonymous = await h.createUi('teacher', { transportOnly: true })
  try {
    await rejectedRead(h, anonymous, '/physicsos/auth/me', 'Anonymous context has no product identity', [401])
    await rejectedRead(h, anonymous, userPath(teacher), 'Anonymous context cannot read administrator user statistics')
    await rejectedRead(h, anonymous, rankPath({}), 'Anonymous context cannot read administrator ranking')
    matrix.push({ role: 'anonymous', verified: true, productCookieRestored: false })
  } finally { await h.closeUi(anonymous) }
  h.report.roleMatrix = matrix
  if (h.report.statistics) await reconcileStatistics(h)
  else h.unverified('statistics-causal-delta', 'Request statistics before real core actions and roles last; no pre-action baseline was captured')
}

function sameTeacher(h, actual) { for (const field of identityFields) h.check(`Checkpoint teacher ${field} is exact`, actual[field] === h.config.expected.teacher[field]) }
function sourceFixtureKey(h, origin) { return digest({ origin, identities: Object.fromEntries(Object.keys(h.config.states).sort().map(key => [key, Object.fromEntries(identityFields.map(field => [field, h.config.expected[key][field]]))])) }) }
async function snapshots(h, ui) {
  const result = []
  for (const resource of h.report.resources) {
    if (resource.kind === 'canvas' && resource.createdByThisRun) result.push({ kind: 'canvas', id: resource.id, title: resource.title, snapshot: await canvasSnapshot(h, ui, resource.id) })
    if (resource.kind === 'whiteboard' && resource.createdByThisRun) result.push({ kind: 'whiteboard', id: resource.id, title: resource.title, snapshot: await whiteboardSnapshot(h, ui, resource.id) })
  }
  const nativeScenes = h.config.footprint.recentScenes?.length ? await listPages(h, ui, '/physicsos/learning/scenes') : []
  for (const recent of h.config.footprint.recentScenes ?? []) {
    const native = nativeScenes.find(value => value.sceneId === recent.sceneId)
    h.check('Restart checkpoint includes the full original physical scene, not only recent metadata', native?.title === recent.title && native.kind === 'experiment')
    result.push({ kind: 'recent', id: recent.sceneId, snapshot: { state: (await h.read(ui, `/physicsos/learning/product-state/recent-scenes/${encodeURIComponent(recent.sceneId)}`)).state, native } })
  }
  for (const workspace of h.config.footprint.workspaces ?? []) if (workspace.nativeProbe) {
    const materialSnapshots = []
    for (const material of workspace.materials) materialSnapshots.push({ ...material, snapshot: material.kind === 'canvas' ? await canvasSnapshot(h, ui, material.id) : await h.nativeProbe(ui, material.nativeProbe, material.id) })
    result.push({ kind: 'workspace', id: workspace.workspaceId, nativeProbe: workspace.nativeProbe, snapshot: { state: await h.read(ui, `/physicsos/learning/product-state/projects/${encodeURIComponent(workspace.workspaceId)}`), native: await h.nativeProbe(ui, workspace.nativeProbe, workspace.workspaceId), materials: materialSnapshots } })
  }
  return result
}
async function readCheckpoint(h) {
  const proof = h.config.checkpointProof
  h.check('Checkpoint/output/before-result binding was validated before the first report write', !!proof)
  const file = proof.file, bytes = await readFile(file), checkpoint = JSON.parse(bytes.toString('utf8'))
  h.check('Checkpoint bytes still match the original preflight/before-report SHA', fileDigest(bytes) === proof.bytesSha256 && fileDigest(bytes) === proof.before.restart.checkpointSha256)
  h.check('Original before result has not been replaced after preflight', fileDigest(await readFile(proof.beforeFile)) === proof.beforeSha256)
  h.check('Checkpoint retains the original complete nonempty resource coverage', canonical(checkpointManifest(checkpoint.resources)) === canonical(proof.resourceManifest))
  sameTeacher(h, checkpoint.teacher)
  h.check('Checkpoint identity fingerprint remains bound to the complete expected roster', checkpoint.fixtureKey === sourceFixtureKey(h, checkpoint.candidateOrigin))
  return { file, bytes, checkpoint }
}
async function reread(h, ui, resource, retained = false) {
  if (resource.kind === 'canvas') return canvasSnapshot(h, ui, resource.id)
  if (resource.kind === 'whiteboard') return whiteboardSnapshot(h, ui, resource.id, retained)
  if (resource.kind === 'recent') {
    const native = (await listPages(h, ui, '/physicsos/learning/scenes')).find(value => value.sceneId === resource.id)
    h.check('Independent read includes the original complete physical scene', !!native)
    return { state: (await h.read(ui, `/physicsos/learning/product-state/recent-scenes/${encodeURIComponent(resource.id)}`)).state, native }
  }
  if (resource.kind === 'workspace') {
    const materials = []
    for (const material of resource.snapshot.materials) materials.push({ ...material, snapshot: material.kind === 'canvas' ? await canvasSnapshot(h, ui, material.id) : await h.nativeProbe(ui, material.nativeProbe, material.id) })
    return { state: await h.read(ui, `/physicsos/learning/product-state/projects/${encodeURIComponent(resource.id)}`), native: await h.nativeProbe(ui, resource.nativeProbe, resource.id), materials }
  }
  h.check('Checkpoint never selects an unknown resource kind', false)
}
async function realBridgeDenial(h, ui, resource) {
  const current = await reread(h, ui, resource), path = resource.kind === 'canvas' ? `/physicsos/learning/canvases/${encodeURIComponent(resource.id)}/archive`
    : resource.kind === 'whiteboard' ? `/physicsos/whiteboards/${encodeURIComponent(resource.id)}/archive`
      : resource.kind === 'recent' ? `/physicsos/learning/product-state/recent-scenes/${encodeURIComponent(resource.id)}` : `/physicsos/learning/product-state/projects/${encodeURIComponent(resource.id)}`
  const data = resource.kind === 'canvas' ? { expectedVersion: current.head.version, expectedGeneration: current.head.generation, mutationId: operationId() }
    : resource.kind === 'whiteboard' ? { expectedRevision: current.record.revision, expectedGeneration: current.record.generation, operationId: operationId() }
      : resource.kind === 'recent' ? { action: 'archive', expectedVersion: current.state.recentVersion, expectedGeneration: current.state.recentGeneration, operationId: operationId() }
        : { action: 'archive', expectedVersion: current.state.state.version, expectedGeneration: current.state.state.generation, operationId: operationId() }
  // The single central guard authorizes only this preflight-bound checkpoint ID and exact archive/fence shape.
  // No later route override can bypass method/model/owner authorization.
  h.resources('bridge-probe', resource.id, resource.title ?? resource.id, { createdByThisRun: false, state: 'valid-new-organization-denial-pending', kindUnderTest: resource.kind }); await h.flush()
  const response = await h.api(ui, path, { method: 'POST', data, expectDenied: true })
  h.resources('bridge-probe', resource.id, resource.title ?? resource.id, { state: response.ok ? 'unexpectedly-accepted-retained-for-inspection' : 'server-denied', status: response.status }); await h.flush()
  const code = response.body?.error?.code ?? response.body?.code
  h.check('Read-only bridge rejects valid new organization for explicit bridge/write-policy reasons', !response.ok && [403, 409, 501, 503].includes(response.status) && typeof code === 'string' && /BRIDGE|READ.?ONLY|DISABLED|UPGRADE_REQUIRED|NOT_ENABLED|COMPATIBILITY/i.test(code), { status: response.status, code: typeof code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(code) ? code : '[non-enum-code-redacted]' })
  h.check('Rejected bridge organization preserves real full head/version/content', canonical(await reread(h, ui, resource)) === canonical(current))
}
export async function restartPhase(h) {
  if (h.config.phase === 'before-restart') {
    h.check('Only fully successful selected core stages create a restart baseline', h.report.stages.filter(value => value.id !== 'before-restart').every(value => value.status === 'passed'))
    const ui = await h.createUi('teacher')
    try {
      const actor = await h.assertActor(ui), resources = await snapshots(h, ui)
      const resourceManifest = checkpointManifest(resources)
      h.check('Restart baseline has a nonempty complete original resource set', resourceManifest.length > 0)
      const teacher = Object.fromEntries(identityFields.map(field => [field, actor[field]])), avatarId = AVATAR_IDS.find(id => actor.avatarUrl === avatarPath(id))
      const checkpoint = { schemaVersion: 1, kind: 'teaching-tools-before-restart', fixtureKey: h.config.fixtureKey, candidateOrigin: h.config.origin, completedAt: new Date().toISOString(), beforeResultFile: h.reportFile,
        teacher, revision: h.config.footprint.revision, expectedAppContainerId: h.config.footprint.appContainerId, expectedDatabaseContainerId: h.config.footprint.databaseContainerId,
        selectedStageCoverage: h.report.stages.filter(value => value.id !== 'before-restart').map(value => ({ id: value.id, status: value.status })), fullAcceptance: false,
        avatar: { id: avatarId ?? null, urlDigest: digest(actor.avatarUrl ?? '') }, resources, resourceManifest }
      const file = h.config.checkpointFile ?? join(h.config.output, 'checkpoint.json')
      h.check('Checkpoint output is an explicit/new private absolute file', isAbsolute(file))
      await writeFile(file, JSON.stringify(checkpoint, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      h.report.restart = { phase: 'before-restart', checkpoint: file, checkpointSha256: fileDigest(await readFile(file)), resourceManifest, restartPerformed: false, databaseRestartVerified: false, fullAcceptance: false }
    } finally { await h.closeUi(ui) }
    return
  }
  const { bytes, checkpoint } = await readCheckpoint(h)
  let receipt
  if (h.config.phase === 'after-restart') {
    const receiptBytes = await readFile(h.config.restartReceiptFile)
    h.check('External receipt cannot change after first-write isolation/binding', fileDigest(receiptBytes) === h.config.checkpointProof.receiptSha256)
    receipt = JSON.parse(receiptBytes.toString('utf8'))
    h.check('External restart receipt binds exact candidate/fixture/original checkpoint bytes', receipt.schemaVersion === 1 && receipt.candidateOrigin === h.config.origin && receipt.fixtureKey === checkpoint.fixtureKey && receipt.checkpointSha256 === fileDigest(bytes) && receipt.checkpointSha256 === h.config.checkpointProof.before.restart.checkpointSha256)
    h.check('External receipt names complete application CIDs and an actual later restart', receipt.appRestarted === true && Array.isArray(receipt.appContainerIds) && receipt.appContainerIds.length > 0 && receipt.appContainerIds.every(id => /^[a-f0-9]{64}$/.test(id)) && receipt.appContainerIds.includes(h.config.footprint.appContainerId) && receipt.appContainerIds.includes(checkpoint.expectedAppContainerId) && typeof receipt.databaseRestarted === 'boolean' && Number.isFinite(Date.parse(receipt.completedAt)) && Date.parse(receipt.completedAt) > Date.parse(checkpoint.completedAt))
    h.check('Restart compares the same externally attested source revision', checkpoint.revision === h.config.footprint.revision)
    if (receipt.databaseRestarted === true) {
      const beforeDatabase = checkpoint.expectedDatabaseContainerId, afterDatabase = h.config.footprint.databaseContainerId
      if (!h.config.checkpointProof.databasePinsComplete) h.unverified('pinned-database-restart', 'Both the original before database CID and current after CID are required; no database proof is claimed from only the current/arbitrary receipt')
      else {
        h.check('Database restart requires both complete before and after pins', typeof beforeDatabase === 'string' && /^[a-f0-9]{64}$/.test(beforeDatabase) && typeof afterDatabase === 'string' && /^[a-f0-9]{64}$/.test(afterDatabase))
        h.check('Database restart receipt is the exact original-before/current-after CID set', Array.isArray(receipt.databaseContainerIds) && new Set(receipt.databaseContainerIds).size === receipt.databaseContainerIds.length && receipt.databaseContainerIds.every(id => /^[a-f0-9]{64}$/.test(id)) && canonical([...new Set(receipt.databaseContainerIds)].sort()) === canonical([...new Set([beforeDatabase, afterDatabase])].sort()))
      }
    } else h.unverified('database-restart', 'Only application restart was externally attested; PostgreSQL restart/durability was not verified')
  }
  const ui = await h.createUi('teacher')
  try {
    const actor = await h.assertActor(ui)
    h.check('Saved avatar survives a genuinely new post-restart/bridge context', digest(actor.avatarUrl ?? '') === checkpoint.avatar.urlDigest)
    for (const resource of checkpoint.resources) {
      const current = await reread(h, ui, resource)
      h.check('Independent authority reads retain the entire saved head/version/content', canonical(current) === canonical(resource.snapshot))
      if (h.config.phase === 'bridge') await realBridgeDenial(h, ui, resource)
    }
    h.report.restart = { phase: h.config.phase, checkpointSha256: fileDigest(bytes), independentNewContext: true, serverCommandsExecuted: false,
      applicationRestartExternallyAttested: receipt?.appRestarted === true, databaseRestartExternallyAttested: receipt?.databaseRestarted === true,
      fullContentCompared: true, fullAcceptance: false }
    if (h.config.phase === 'bridge') h.unverified('restart-not-performed-in-bridge-lane', 'This is independent read-only/valid-denial bridge evidence, not an application or database restart verdict')
  } finally { await h.closeUi(ui) }
}
export const ADVANCED_STAGES = Object.freeze({ statistics: statisticsStage, roles: rolesStage })
