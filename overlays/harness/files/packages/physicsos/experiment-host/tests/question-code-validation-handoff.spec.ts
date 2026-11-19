import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { MECHANICS_VALIDATION_PROFILE, requiredValidationChecks, validationProfileKey } from '@physicsos/shared'
import { openQuestionCodeDomain, QUESTION_CODE_VALIDATION_HISTORY_LIMIT, type QuestionCodeRecord } from '../src/question-code-domain.ts'
import { QuestionCodeArtifactService, canonicalQuestionJson, questionSceneSha256 } from '../src/question-code-service.ts'
import { QuestionCodeJobs, QuestionCodeJobError, type ValidationSourceBinding } from '../src/question-code-jobs.ts'
import { currentCandidateSource, validateFrozenCandidate, retryFrozenCandidate } from '../src/question-code-validation.ts'
import { questionCodeRoutes } from '../src/question-code-routes.ts'
import { contributor, other, admin } from './fixtures.ts'
import { host } from './support.ts'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const dispose of disposals.splice(0).reverse()) await dispose()
})
const config = { url: 'http://worker:8099', token: 'v'.repeat(32), timeoutMs: 5_000 }
const report = { passed: true, durationMs: 1, validationProfile: MECHANICS_VALIDATION_PROFILE,
  checks: requiredValidationChecks(MECHANICS_VALIDATION_PROFILE).map(name => ({ name, passed: true,
    ...(name === 'profile-binding' ? { detail: validationProfileKey(MECHANICS_VALIDATION_PROFILE) } : {}) })) }
const rejectedReport = { ...report, passed: false,
  checks: report.checks.map(check => check.name === 'geometry-follows-engine' ? { ...check, passed: false, detail: 'fixture rejection' } : check), screenshot: 's'.repeat(101) }
const respond = (body: unknown = report, status = 200): typeof fetch => (async () => Response.json(body, { status })) as typeof fetch
const renderer = `export function renderFrame(snapshot) {
  const view = snapshot.view, root = document.getElementById('canvas');
  const canvas = document.createElement('canvas'); root.replaceChildren(canvas);
  const ctx = canvas.getContext('2d');
  for (const body of view.bodies || []) {
    ctx.beginPath(); ctx.arc(body.at.x, body.at.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}`

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'qcode-validation-handoff-'))
  const loaded = await host(root), domain = await openQuestionCodeDomain(loaded.ctx)
  let owner: string | undefined = contributor.userKey
  let clock = new Date('2026-11-16T00:00:00Z')
  const identity = {
    actorOf: (req: { headers: Record<string, unknown> }) => ({ contributor, other, admin })[req.headers['x-test-account'] as 'contributor'] ?? null,
    sessionOwnerKey: (id: string) => id === 'parent-session' ? owner : undefined,
    record: async () => {},
  }
  const artifacts = new QuestionCodeArtifactService(domain, { root: join(root, 'private'), identity: () => identity })
  const jobs = new QuestionCodeJobs(domain, { now: () => clock })
  disposals.push(async () => { await artifacts.close(); await domain.close(); await loaded.close(); await rm(root, { recursive: true, force: true }) })
  await artifacts.initialize()
  const scene = createMechanicsScene({ sceneId: 'frozen-motion', revision: 1, model: 'projectile_motion',
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 10, z: 0 }, gravity: { x: 0, y: -10, z: 0 },
    endTime: 2, now: '2026-11-16T00:00:00Z', sourceQuestionId: 'question-frozen', title: 'Frozen upward throw' })
  const ref = await artifacts.create({ ownerSessionId: 'parent-session', childSessionId: 'child', scene, experimentId: 'projectile-oblique',
    source: { title: 'Frozen renderer', summary: '', rendererJs: renderer, stylesheet: '' } })
  // Associate an already verified fixture with a durable generation without requesting an image/model.
  // The production builder freezes this generationId before computing the record digest.
  const original = domain.table('artifacts').get(ref.artifactId)!
  const { sha256: _digest, ...fields } = original
  const source = { ...fields, generationId: 'gen-frozen', requestSha256: 'b'.repeat(64) }
  const row: QuestionCodeRecord = { ...source, sha256: createHash('sha256').update(canonicalQuestionJson(source)).digest('hex') }
  const submitted = await jobs.submit({ id: row.generationId!, ownerSessionId: row.ownerSessionId, ownerKey: row.ownerKey,
    sceneId: row.sceneId, sceneRevision: row.sceneRevision, sceneSha256: row.sceneSha256, requestSha256: source.requestSha256 })
  const started = await jobs.claim(submitted.id)
  if (started === undefined) throw new Error('fixture generation was not claimed')
  await domain.table('artifacts').put(row.id, row)
  const candidate = artifacts.describe('parent-session', row.id, row.sha256)
  await jobs.recordCandidate(submitted.id, started.epoch, { candidateSha256: row.sha256 })
  let current = { scene, ref: candidate }
  const sourceFence = (binding: ValidationSourceBinding): void => {
    if (owner !== binding.ownerKey || current.ref.ownerSessionId !== binding.ownerSessionId
      || current.ref.artifactId !== binding.artifactId || current.ref.sha256 !== binding.candidateSha256
      || current.ref.requestSha256 !== binding.requestSha256
      || current.scene.id !== binding.sceneId || current.scene.revision !== binding.sceneRevision
      || questionSceneSha256(current.scene) !== binding.sceneSha256) throw new QuestionCodeJobError('STALE_SOURCE', 'source changed')
  }
  const ticket = (ttlMs?: number) => jobs.issueTicket(submitted.id, started.epoch, ttlMs)
  const input = (token: string) => ({ jobId: submitted.id, epoch: started.epoch, candidateSha256: row.sha256,
    sceneSha256: row.sceneSha256, sceneRevision: row.sceneRevision, ticket: token })
  const deps = (fetchImpl: typeof fetch = respond()) => ({ jobs, artifacts, publicOrigin: 'http://app:3080', sourceFence, fetchImpl })
  const retryDeps = (fetchImpl: typeof fetch = respond()) => ({ ...deps(fetchImpl), currentSource: async (binding: ValidationSourceBinding) => () => sourceFence(binding) })
  const queue = async () => { await jobs.finish(submitted.id, started.epoch, { status: 'infrastructure-failed', code: 'WORKER_400' }) }
  return { root, artifacts, jobs, domain, row, candidate, scene, started, submitted, identity, ticket, input, deps, retryDeps, queue,
    setOwner: (value: string | undefined) => { owner = value }, setClock: (value: Date) => { clock = value },
    setCurrent: (value: typeof current) => { current = value } }
}

async function rejectCandidate(h: Awaited<ReturnType<typeof setup>>) {
  const ticket = h.ticket()
  expect(await validateFrozenCandidate(config, h.input(ticket.token), h.deps(respond(rejectedReport)))).toMatchObject({ kind: 'rejected' })
  const job = structuredClone(h.jobs.get(h.submitted.id, contributor.userKey))
  expect(job).toMatchObject({ status: 'failed', code: 'ACCEPTANCE_REJECTED', validation: { passed: false, leaseEpoch: h.started.epoch, sourceRef: h.row.id } })
  expect(job.attempts.at(-1)?.status).toBe('rejected')
  return job
}

function generationSpies(h: Awaited<ReturnType<typeof setup>>) {
  const spies = [vi.spyOn(h.artifacts, 'create'), vi.spyOn(h.artifacts, 'restoreGeneration'), vi.spyOn(h.artifacts, 'generateAsset'),
    vi.spyOn(h.jobs, 'submit'), vi.spyOn(h.jobs, 'startAttempt')]
  return () => { for (const spy of spies) expect(spy).not.toHaveBeenCalled() }
}

async function routeOrigin(h: Awaited<ReturnType<typeof setup>>, fetchImpl: typeof fetch = respond(), configured = true) {
  const api = questionCodeRoutes({ service: h.artifacts, identity: () => h.identity, jobs: h.jobs,
    retryValidation: (jobId, actor) => retryFrozenCandidate(configured ? config : undefined, jobId, actor, h.retryDeps(fetchImpl)) })
  const server = createServer((req, res) => { void api(req, res) })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  disposals.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve() }) }) })
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}
const post = (base: string, account = 'contributor', body: unknown = {}, extraHeaders: Record<string, string> = {}) => fetch(`${base}/physicsos/question-code/jobs/gen-frozen/validate`, {
  method: 'POST', headers: { 'x-test-account': account, 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin', ...extraHeaders }, body: JSON.stringify(body),
})

describe('frozen candidate → isolated worker handoff', () => {
  it('sends only its canonical frozen scene, ignores injected scene/frames/URLs and binds passed to the correct source', async () => {
    const h = await setup(), ticket = h.ticket()
    const fetchMock = vi.fn(respond())
    const injected = { ...h.input(ticket.token), validationProfile: { id: 'optics-thin-lens-real-static', version: 1 },
      experimentId: 'attacker-template', scene: { id: 'attacker' }, frames: [{ frameId: 'fake', snapshot: {} }], entryUrl: 'http://attacker' }
    expect(await validateFrozenCandidate(config, injected, h.deps(fetchMock as unknown as typeof fetch))).toMatchObject({ kind: 'passed' })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.scene).toEqual(JSON.parse(canonicalQuestionJson(h.scene)))
    expect(body.experimentId).toBe(h.row.experimentId)
    expect(body.experimentId).not.toBe(injected.experimentId)
    expect(body.validationProfile).toEqual(MECHANICS_VALIDATION_PROFILE)
    expect(body.validationProfile).not.toEqual(injected.validationProfile)
    expect(body).not.toHaveProperty('frames')
    expect(body).not.toHaveProperty('changedFrame')
    expect(body.entryUrl).toContain(`/${h.row.sha256}/dist/index.html`)
    expect(body.entryUrl).toContain(`/${ticket.token}/`)
    expect(body.token).toMatch(/^[a-zA-Z0-9-]{16,80}$/)
    expect(body.token).not.toBe(ticket.token)
    expect(body.expected).toEqual({ candidateSha256: h.row.sha256, sceneSha256: h.row.sceneSha256, sceneRevision: 1 })
    expect(h.jobs.get(h.submitted.id, contributor.userKey)).toMatchObject({ status: 'ready', resultRef: h.row.id, resultSha256: h.row.sha256,
      validation: { version: 1, passed: true, sourceRef: h.row.id, leaseEpoch: h.started.epoch, sceneSha256: h.row.sceneSha256, sceneRevision: 1 } })
    expect(() => h.jobs.validationTicket(ticket.token, h.row.sha256)).toThrow()
  })

  it('rejects missing frozen scene bytes before any worker request instead of using the mutable scene', async () => {
    const h = await setup(), ticket = h.ticket(), fetchMock = vi.fn(respond())
    const file = h.row.files.find(value => value.name === 'question-scene.json')!
    await unlink(join(h.root, 'private', 'blobs', file.sha256))
    await expect(validateFrozenCandidate(config, h.input(ticket.token), h.deps(fetchMock as unknown as typeof fetch)))
      .rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.jobs.get(h.submitted.id, contributor.userKey).validation).toBeUndefined()
    expect(() => h.jobs.validationTicket(ticket.token, h.row.sha256)).toThrow()
  })

  it.each(['candidate', 'hash', 'revision', 'epoch'] as const)('rejects request %s mismatch before dispatch', async field => {
    const h = await setup(), ticket = h.ticket(), fetchMock = vi.fn(respond())
    const input = { ...h.input(ticket.token), ...(field === 'candidate' ? { candidateSha256: 'f'.repeat(64) }
      : field === 'hash' ? { sceneSha256: 'f'.repeat(64) } : field === 'revision' ? { sceneRevision: 0 } : { epoch: 0 }) }
    await expect(validateFrozenCandidate(config, input, h.deps(fetchMock as unknown as typeof fetch))).rejects.toBeInstanceOf(Error)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.jobs.get(h.submitted.id, contributor.userKey).status).not.toBe('ready')
  })

  it.each(['owner', 'revision', 'hash', 'source', 'lease', 'expiry'] as const)('fences a late passed response after %s changes', async change => {
    const h = await setup(), ticket = h.ticket(1000)
    const fetchImpl = (async () => {
      if (change === 'owner') h.setOwner(other.userKey)
      if (change === 'revision') h.setCurrent({ scene: { ...h.scene, revision: 2 }, ref: h.candidate })
      if (change === 'hash') h.setCurrent({ scene: { ...h.scene, metadata: { ...h.scene.metadata, title: 'changed facts' } }, ref: h.candidate })
      if (change === 'source') h.setCurrent({ scene: h.scene, ref: { ...h.candidate, artifactId: 'qcode_' + 'f'.repeat(32) } })
      if (change === 'lease') await h.jobs.supersede(h.submitted.id, 'new revision')
      if (change === 'expiry') h.setClock(new Date('2026-11-16T00:00:02Z'))
      return Response.json(report)
    }) as typeof fetch
    await expect(validateFrozenCandidate(config, h.input(ticket.token), h.deps(fetchImpl))).rejects.toBeInstanceOf(Error)
    expect(h.jobs.get(h.submitted.id, contributor.userKey).status).not.toBe('ready')
    expect(h.jobs.get(h.submitted.id, contributor.userKey).validation).toBeUndefined()
    expect(() => h.jobs.validationTicket(ticket.token, h.row.sha256)).toThrow()
  })

  it('permits parallel wrapper/entry/dependency reads only during one bounded validation session', async () => {
    const h = await setup(), ticket = h.ticket()
    const binding = h.jobs.redeemTicket(ticket.token, h.submitted.id, h.row.sha256)
    expect(h.artifacts.validatorEntry(binding)).toBe('dist/index.html')
    const paths = ['dist/index.html', 'dist/runtime/main.js', 'dist/runtime/renderer.js', 'dist/assets/experiment.css']
    const files = await Promise.all(paths.map(path => h.artifacts.validatorPackage(h.jobs.validationTicket(ticket.token, h.row.sha256), path)))
    expect(files.every(file => file !== undefined)).toBe(true)
    for (const path of ['question-scene.json', 'src/renderer.js', '../dist/index.html', 'dist/../src/renderer.js']) {
      expect(await h.artifacts.validatorPackage(binding, path)).toBeUndefined()
    }
    expect(() => h.jobs.validationTicket(ticket.token, 'f'.repeat(64))).toThrow()
    expect(() => h.jobs.redeemTicket(ticket.token, h.submitted.id, h.row.sha256)).toThrow()
    h.setOwner(other.userKey)
    await expect(h.artifacts.validatorPackage(binding, 'dist/index.html')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    h.jobs.revokeTicket(ticket.token)
    expect(() => h.jobs.validationTicket(ticket.token, h.row.sha256)).toThrow()
  })

  it('serves ticket-scoped runtime modules to Origin:null but never source or another candidate, then refuses every read after revoke', async () => {
    const h = await setup(), ticket = h.ticket()
    h.jobs.redeemTicket(ticket.token, h.submitted.id, h.row.sha256)
    const api = questionCodeRoutes({ service: h.artifacts, identity: () => h.identity, jobs: h.jobs, validator: {
      packageFor: async ({ ticket: token, digest, path }) => {
        try {
          const binding = h.jobs.validationTicket(token, digest)
          const result = await h.artifacts.validatorPackage(binding, path)
          h.jobs.validationTicket(token, digest)
          return result
        } catch { return undefined }
      }, shell: async () => undefined,
    } })
    const server = createServer((req, res) => { void api(req, res) })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    disposals.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve() }) }) })
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/physicsos/question-code/validation/${ticket.token}`
    const urls = ['dist/index.html', 'dist/runtime/main.js', 'dist/runtime/renderer.js', 'dist/assets/experiment.css']
    const responses = await Promise.all(urls.map(path => fetch(`${base}/${h.row.sha256}/${path}`, { headers: { origin: 'null' } })))
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200])
    expect(responses[1]?.headers.get('access-control-allow-origin')).toBe('*')
    expect(responses[1]?.headers.get('access-control-allow-credentials')).toBeNull()
    expect((await fetch(`${base}/${h.row.sha256}/question-scene.json`)).status).toBe(404)
    expect((await fetch(`${base}/${h.row.sha256}/src/renderer.js`)).status).toBe(404)
    expect((await fetch(`${base}/${'f'.repeat(64)}/dist/index.html`)).status).toBe(404)
    h.jobs.revokeTicket(ticket.token)
    expect((await fetch(`${base}/${h.row.sha256}/dist/runtime/main.js`)).status).toBe(404)
  })

  it.each([400, 503])('keeps HTTP worker %s failure queued and preserves an owner-only preview without validated state', async status => {
    const h = await setup(), ticket = h.ticket()
    expect(await validateFrozenCandidate(config, h.input(ticket.token), h.deps(respond({ error: 'invalid request' }, status))))
      .toMatchObject({ kind: 'infrastructure', code: `WORKER_${status}` })
    const job = h.jobs.get(h.submitted.id, contributor.userKey)
    expect(job.status).toBe('queued')
    expect(job.validation).toBeUndefined()
    expect(job.resultSha256).toBeUndefined()
    expect(h.artifacts.preview(contributor, h.row.id, h.row.sha256)).toMatchObject({ jobId: h.submitted.id })
    expect(() => h.jobs.validationTicket(ticket.token, h.row.sha256)).toThrow()
  })

  it('times out, revokes reads, and never turns a late response into passed', async () => {
    const h = await setup(), ticket = h.ticket()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let late!: (response: Response) => void
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { late = resolve; started() })) as unknown as typeof fetch
    const pending = validateFrozenCandidate({ ...config, timeoutMs: 10 }, h.input(ticket.token), h.deps(fetchImpl))
    await entered
    expect(fetchImpl).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(11)
    expect(await pending).toMatchObject({ kind: 'infrastructure', code: 'WORKER_TIMEOUT' })
    late(Response.json(report))
    expect(h.jobs.get(h.submitted.id, contributor.userKey)).toMatchObject({ status: 'queued', code: 'WORKER_TIMEOUT' })
    expect(h.jobs.get(h.submitted.id, contributor.userKey).validation).toBeUndefined()
    expect(() => h.jobs.validationTicket(ticket.token, h.row.sha256)).toThrow()
  })

  it('without configuration leaves the original private candidate and writes no fake passed', async () => {
    const h = await setup(), ticket = h.ticket(), before = structuredClone(h.jobs.get(h.submitted.id, contributor.userKey))
    const fetchMock = vi.fn(respond())
    expect(await validateFrozenCandidate(undefined, h.input(ticket.token), h.deps(fetchMock as unknown as typeof fetch))).toBeUndefined()
    expect(h.jobs.get(h.submitted.id, contributor.userKey)).toEqual(before)
    expect(fetchMock).not.toHaveBeenCalled()
    h.jobs.revokeTicket(ticket.token)
  })
})

describe('owner-only validate-only retry route', () => {
  it('reads a cold own-session source without resolving/resuming an Agent and fences refreshed source moves', async () => {
    const h = await setup(), binding = h.artifacts.validationSource(h.submitted.id, contributor)
    const data = { sceneId: h.scene.id, revision: h.scene.revision, scene: h.scene, visualization: h.candidate }
    let events = [{ type: 'physics/scene', seq: 0, data }]
    const inspect = vi.fn(async () => ({ meta: { id: 'parent-session' }, inheritedEventCount: 0, events }))
    const resolveAgent = vi.fn(() => { throw new Error('must not activate a model') })
    const deps = { identity: () => h.identity, lookup: (key: string) => key === 'sessions' ? { get: () => undefined }
      : key === 'sessionController' ? { inspect, resolveAgent } : undefined }
    const fence = await currentCandidateSource(binding, deps)
    expect(() => fence()).not.toThrow()
    expect(inspect).toHaveBeenCalledWith('parent-session')
    expect(resolveAgent).not.toHaveBeenCalled()
    events = [{ type: 'physics/scene', seq: 1, data: { ...data, revision: 2, scene: { ...h.scene, revision: 2 } } }]
    const refreshed = await currentCandidateSource(binding, deps)
    expect(() => refreshed()).toThrow(expect.objectContaining({ code: 'STALE_SOURCE' }))
    expect(resolveAgent).not.toHaveBeenCalled()
  })

  it('refuses inherited scenes even when their artifact and hash look correct', async () => {
    const h = await setup(), binding = h.artifacts.validationSource(h.submitted.id, contributor)
    const fence = await currentCandidateSource(binding, { identity: () => h.identity, lookup: key => key === 'sessionController' ? {
      inspect: async () => ({ meta: { id: 'parent-session' }, inheritedEventCount: 1, events: [{ type: 'physics/scene', seq: 0,
        data: { sceneId: h.scene.id, revision: h.scene.revision, scene: h.scene, visualization: h.candidate } }] }),
    } : undefined })
    expect(() => fence()).toThrow(expect.objectContaining({ code: 'STALE_SOURCE' }))
  })

  it('revalidates a queued frozen candidate with zero generation/model calls and unchanged source/attempt budget', async () => {
    const h = await setup()
    await h.queue()
    const before = structuredClone(h.row), fetchMock = vi.fn(respond())
    const generate = vi.spyOn(h.artifacts, 'create'), restore = vi.spyOn(h.artifacts, 'restoreGeneration'), image = vi.spyOn(h.artifacts, 'generateAsset')
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch), response = await post(base)
    expect(response.status).toBe(200)
    const body = await response.json() as { job: Record<string, unknown> }
    expect(body.job).toMatchObject({ jobId: h.submitted.id, status: 'ready', sceneId: h.row.sceneId, sceneRevision: 1,
      sceneSha256: h.row.sceneSha256, resultSha256: h.row.sha256, validation: { passed: true } })
    for (const internal of ['ownerKey', 'ownerSessionId', 'sourceRef', 'resultRef', 'ticket', 'scene', 'diagnostics']) expect(body.job).not.toHaveProperty(internal)
    expect(h.jobs.get(h.submitted.id, contributor.userKey).attempts).toHaveLength(1)
    expect(h.jobs.get(h.submitted.id, contributor.userKey).leaseEpoch).toBe(h.started.epoch + 1)
    expect(h.domain.table('artifacts').get(h.row.id)).toEqual(before)
    expect(generate).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled(); expect(image).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((await post(base)).status).toBe(409)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects unauthenticated, other-account and admin retries plus cross-site requests and injected JSON', async () => {
    const h = await setup(), fetchMock = vi.fn(respond())
    await h.queue()
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    expect((await post(base, 'unknown')).status).toBe(401)
    expect((await post(base, 'other')).status).toBe(404)
    expect((await post(base, 'admin')).status).toBe(404)
    expect((await post(base, 'contributor', {}, { origin: 'http://attacker.example' })).status).toBe(403)
    expect((await post(base, 'contributor', {}, { 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect((await post(base, 'contributor', { scene: h.scene })).status).toBe(413)
    for (const body of [{ scene: { id: 'injected-scene' } }, { entryUrl: 'http://attacker' }, { code: renderer }, { ownerSessionId: 'parent-session' }, null, []]) {
      expect((await post(base, 'contributor', body)).status).toBe(400)
    }
    expect((await post(base, 'contributor', {}, { 'content-type': 'text/plain' })).status).toBe(415)
    h.setOwner(other.userKey)
    expect((await post(base)).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['revision', 'hash', 'source', 'candidate', 'configuration'] as const)('refuses retry with changed %s without a new job or model call', async change => {
    const h = await setup(), fetchMock = vi.fn(respond())
    await h.queue()
    if (change === 'revision') h.setCurrent({ scene: { ...h.scene, revision: 2 }, ref: h.candidate })
    if (change === 'hash') h.setCurrent({ scene: { ...h.scene, metadata: { ...h.scene.metadata, title: 'new scene' } }, ref: h.candidate })
    if (change === 'source') h.setCurrent({ scene: h.scene, ref: { ...h.candidate, sha256: 'f'.repeat(64) } })
    if (change === 'candidate') await h.domain.table('artifacts').delete(h.row.id)
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch, change !== 'configuration')
    expect((await post(base)).status).toBe(change === 'configuration' ? 503 : 409)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.jobs.get(h.submitted.id, contributor.userKey).leaseEpoch).toBe(h.started.epoch)
    expect(h.jobs.get(h.submitted.id, contributor.userKey).attempts).toHaveLength(1)
    expect(h.domain.table('jobs').size).toBe(1)
  })

  it('does not create a candidate for a merely queued job', async () => {
    const h = await setup(), fetchMock = vi.fn(respond())
    await h.jobs.submit({ id: 'empty-job', ownerSessionId: h.submitted.ownerSessionId, ownerKey: h.submitted.ownerKey,
      sceneId: h.submitted.sceneId, sceneRevision: h.submitted.sceneRevision, sceneSha256: h.submitted.sceneSha256,
      ...(h.submitted.requestSha256 === undefined ? {} : { requestSha256: h.submitted.requestSha256 }) })
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    const response = await fetch(`${base}/physicsos/question-code/jobs/empty-job/validate`, { method: 'POST',
      headers: { 'x-test-account': 'contributor', 'content-type': 'application/json', origin: base }, body: '{}' })
    expect(response.status).toBe(409)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.jobs.get('empty-job', contributor.userKey).attempts).toHaveLength(0)
  })

  it('allows one concurrent retry, preserves a failed worker candidate and clears the run capability', async () => {
    const h = await setup()
    await h.queue()
    let release!: (response: Response) => void
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(resolve => { release = resolve }))
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    const first = post(base)
    for (let index = 0; index < 100 && fetchMock.mock.calls.length === 0; index++) await new Promise<void>(resolve => { setTimeout(resolve, 5) })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((await post(base)).status).toBe(409)
    const token = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).token as string
    release(Response.json({ error: 'invalid request' }, { status: 400 }))
    const response = await first
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ job: { status: 'queued', code: 'WORKER_400' } })
    expect(h.jobs.get(h.submitted.id, contributor.userKey).validation).toBeUndefined()
    expect(h.jobs.get(h.submitted.id, contributor.userKey).attempts).toHaveLength(1)
    expect(() => h.jobs.validationTicket(token, h.row.sha256)).toThrow()
  })

  it.each([true, false])('owner revalidates the same rejected source to passed=%s without generation and retains every rejection', async passed => {
    const h = await setup(), rejected = await rejectCandidate(h), artifact = structuredClone(h.row), assertNoGeneration = generationSpies(h)
    const fetchMock = vi.fn(respond(passed ? report : rejectedReport)), base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    const response = await post(base)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ job: { status: passed ? 'ready' : 'failed', validation: { passed } } })
    expect(body).not.toHaveProperty('job.validationHistory')
    const current = structuredClone(h.jobs.get(h.submitted.id, contributor.userKey))
    expect(current.validation).toMatchObject({ passed, leaseEpoch: rejected.leaseEpoch + 1, sourceRef: h.row.id,
      candidateSha256: h.row.sha256, sceneSha256: h.row.sceneSha256, sceneRevision: h.row.sceneRevision })
    expect(current.validationHistory).toEqual([rejected.validation])
    expect(h.domain.table('jobs').get(rejected.id)).not.toHaveProperty('validationHistory')
    expect(current.attempts).toHaveLength(rejected.attempts.length)
    expect(current.attempts.at(-1)).toMatchObject({ index: 0, startedAt: rejected.attempts[0]!.startedAt, candidateSha256: h.row.sha256 })
    expect(h.domain.table('artifacts').get(h.row.id)).toEqual(artifact)
    expect(h.domain.table('jobs').size).toBe(1)
    expect((await post(base)).status).toBe(passed ? 409 : 200)
    const next = h.jobs.get(h.submitted.id, contributor.userKey)
    expect(next.validationHistory).toEqual(passed ? [rejected.validation] : [rejected.validation, current.validation])
    expect(h.domain.table('validation_history').size).toBe(passed ? 1 : 2)
    expect(h.domain.table('jobs').get(rejected.id)).not.toHaveProperty('validationHistory')
    expect(next.attempts).toHaveLength(rejected.attempts.length)
    expect(h.domain.table('artifacts').get(h.row.id)).toEqual(artifact)
    expect(fetchMock).toHaveBeenCalledTimes(passed ? 1 : 2)
    assertNoGeneration()
  })

  it.each(['ready', 'cancelled', 'superseded', 'model-failed'] as const)('refuses %s on the owner route without generation or a worker request', async kind => {
    const h = await setup()
    if (kind === 'ready') { const ticket = h.ticket(); await validateFrozenCandidate(config, h.input(ticket.token), h.deps()) }
    if (kind === 'cancelled') await h.jobs.cancel(h.submitted.id, contributor.userKey)
    if (kind === 'superseded') await h.jobs.supersede(h.submitted.id, 'source moved')
    if (kind === 'model-failed') await h.jobs.finish(h.submitted.id, h.started.epoch, { status: 'rejected', code: 'MODEL_FAILED' })
    const before = structuredClone(h.jobs.get(h.submitted.id, contributor.userKey)), assertNoGeneration = generationSpies(h)
    const fetchMock = vi.fn(respond()), base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    expect((await post(base)).status).toBe(409)
    expect(h.jobs.get(h.submitted.id, contributor.userKey)).toEqual(before)
    expect(fetchMock).not.toHaveBeenCalled(); assertNoGeneration()
  })

  it.each(['missing', 'old-lease', 'passed', 'wrong-source', 'empty-checks', 'history-full'] as const)('refuses rejected-candidate retry with %s evidence before changing its lease', async kind => {
    const h = await setup(), rejected = await rejectCandidate(h), assertNoGeneration = generationSpies(h)
    const record = h.domain.table('jobs').get(rejected.id)!, { validation, ...rest } = record
    await h.domain.table('jobs').put(rejected.id, kind === 'missing' ? rest : { ...record,
      ...(kind === 'history-full' ? { leaseEpoch: QUESTION_CODE_VALIDATION_HISTORY_LIMIT + 1 } : {}),
      validation: { ...validation!, ...(kind === 'old-lease' ? { leaseEpoch: 0 } : kind === 'passed' ? { passed: true }
        : kind === 'wrong-source' ? { sourceRef: 'qcode_' + 'f'.repeat(32) } : kind === 'empty-checks' ? { checks: [] }
          : kind === 'history-full' ? { leaseEpoch: QUESTION_CODE_VALIDATION_HISTORY_LIMIT + 1 } : {}) } })
    if (kind === 'history-full') for (let index = 0; index < QUESTION_CODE_VALIDATION_HISTORY_LIMIT; index++) {
      await h.domain.table('validation_history').put(`full-history-${index + 1}`, { jobId: rejected.id, ownerKey: rejected.ownerKey,
        leaseEpoch: index + 1, validation: { ...validation!, leaseEpoch: index + 1 } })
    }
    const before = structuredClone(h.jobs.get(rejected.id, contributor.userKey))
    const fetchMock = vi.fn(respond()), base = await routeOrigin(h, fetchMock as unknown as typeof fetch), response = await post(base)
    expect(response.status).toBe(409)
    if (kind === 'history-full') expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_HISTORY_FULL' } })
    expect(h.jobs.get(rejected.id, contributor.userKey)).toEqual(before)
    expect(fetchMock).not.toHaveBeenCalled(); assertNoGeneration()
  })

  it.each(['owner', 'revision', 'hash', 'source', 'request', 'candidate', 'scene-bytes', 'configuration'] as const)(
    'refuses a rejected-source retry after %s moves without archiving or regeneration', async change => {
      const h = await setup(), rejected = await rejectCandidate(h), assertNoGeneration = generationSpies(h), fetchMock = vi.fn(respond())
      if (change === 'owner') h.setOwner(other.userKey)
      if (change === 'revision') h.setCurrent({ scene: { ...h.scene, revision: 2 }, ref: h.candidate })
      if (change === 'hash') h.setCurrent({ scene: { ...h.scene, metadata: { ...h.scene.metadata, title: 'new facts' } }, ref: h.candidate })
      if (change === 'source') h.setCurrent({ scene: h.scene, ref: { ...h.candidate, artifactId: 'qcode_' + 'f'.repeat(32) } })
      if (change === 'request') h.setCurrent({ scene: h.scene, ref: { ...h.candidate, requestSha256: 'f'.repeat(64) } })
      if (change === 'candidate') await h.domain.table('artifacts').delete(h.row.id)
      if (change === 'scene-bytes') await unlink(join(h.root, 'private', 'blobs', h.row.files.find(file => file.name === 'question-scene.json')!.sha256))
      const base = await routeOrigin(h, fetchMock as unknown as typeof fetch, change !== 'configuration')
      expect((await post(base)).status).toBe(change === 'owner' ? 404 : change === 'configuration' ? 503 : 409)
      expect(h.jobs.get(rejected.id, contributor.userKey)).toEqual(rejected)
      expect(h.domain.table('jobs').size).toBe(1)
      expect(fetchMock).not.toHaveBeenCalled(); assertNoGeneration()
    })

  it('keeps failed-candidate owner scope and request-injection guards unchanged', async () => {
    const h = await setup(), rejected = await rejectCandidate(h), assertNoGeneration = generationSpies(h), fetchMock = vi.fn(respond())
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    for (const [account, status] of [['unknown', 401], ['other', 404], ['admin', 404]] as const) expect((await post(base, account)).status).toBe(status)
    expect((await post(base, 'contributor', {}, { origin: 'http://attacker.example' })).status).toBe(403)
    expect((await post(base, 'contributor', { entryUrl: 'http://attacker' })).status).toBe(400)
    expect(h.jobs.get(rejected.id, contributor.userKey)).toEqual(rejected)
    expect(fetchMock).not.toHaveBeenCalled(); assertNoGeneration()
  })

  it('claims a rejected candidate once, hides old/current history during the new lease and revokes its real capability', async () => {
    const h = await setup(), rejected = await rejectCandidate(h), assertNoGeneration = generationSpies(h)
    let release!: (response: Response) => void, entered!: () => void
    const dispatched = new Promise<void>(resolve => { entered = resolve })
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(resolve => { release = resolve; entered() }))
    const base = await routeOrigin(h, fetchMock as unknown as typeof fetch), pending = post(base)
    await dispatched
    expect((await post(base)).status).toBe(409)
    const current = h.jobs.get(rejected.id, contributor.userKey)
    expect(current).toMatchObject({ status: 'validating', leaseEpoch: rejected.leaseEpoch + 1 })
    expect(current.validation).toEqual(rejected.validation)
    expect(current.validationHistory).toEqual([rejected.validation])
    const projected = await (await fetch(`${base}/physicsos/question-code/jobs/${rejected.id}`, { headers: { 'x-test-account': 'contributor' } })).json()
    expect(projected).not.toHaveProperty('job.validation'); expect(projected).not.toHaveProperty('job.validationHistory')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    const capability = new URL(body.entryUrl).pathname.split('/')[4]!
    expect(h.jobs.validationTicket(capability, h.row.sha256).epoch).toBe(current.leaseEpoch)
    release(Response.json(report))
    expect((await pending).status).toBe(200)
    expect(h.jobs.get(rejected.id, contributor.userKey)).toMatchObject({ status: 'ready', validation: { passed: true, leaseEpoch: current.leaseEpoch } })
    expect(h.jobs.get(rejected.id, contributor.userKey).validationHistory).toEqual([rejected.validation])
    expect(() => h.jobs.validationTicket(capability, h.row.sha256)).toThrow(QuestionCodeJobError)
    expect(fetchMock).toHaveBeenCalledOnce(); assertNoGeneration()
  })

  it.each(['revision', 'source', 'request', 'lease', 'expiry'] as const)('never publishes a failed candidate from a late passed response after %s moves', async change => {
    const h = await setup(), rejected = await rejectCandidate(h), assertNoGeneration = generationSpies(h)
    const fetchMock = vi.fn((async () => {
      if (change === 'revision') h.setCurrent({ scene: { ...h.scene, revision: 2 }, ref: h.candidate })
      if (change === 'source') h.setCurrent({ scene: h.scene, ref: { ...h.candidate, artifactId: 'qcode_' + 'f'.repeat(32) } })
      if (change === 'request') h.setCurrent({ scene: h.scene, ref: { ...h.candidate, requestSha256: 'f'.repeat(64) } })
      if (change === 'lease') await h.jobs.supersede(rejected.id, 'new source')
      if (change === 'expiry') h.setClock(new Date('2026-11-16T00:05:01Z'))
      return Response.json(report)
    }) as typeof fetch)
    await expect(retryFrozenCandidate(config, rejected.id, contributor, h.retryDeps(fetchMock as unknown as typeof fetch))).rejects.toBeInstanceOf(Error)
    const current = h.jobs.get(rejected.id, contributor.userKey)
    expect(current.status).toBe(change === 'expiry' ? 'queued' : 'superseded')
    expect(current.validation).toEqual(rejected.validation)
    expect(current.validationHistory).toEqual([rejected.validation])
    expect(h.domain.table('jobs').get(rejected.id)).not.toHaveProperty('validationHistory')
    expect(current.attempts).toHaveLength(rejected.attempts.length)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(() => h.jobs.validationTicket(new URL(body.entryUrl).pathname.split('/')[4]!, h.row.sha256)).toThrow()
    assertNoGeneration()
  })

  it('never projects or publishes a passed historical report as acceptance for a new lease', async () => {
    const h = await setup()
    await h.jobs.recordValidation(h.submitted.id, h.started.epoch, { passed: true, candidateSha256: h.row.sha256, checks: report.checks })
    await h.jobs.finish(h.submitted.id, h.started.epoch, { status: 'infrastructure-failed', code: 'WRITE_FAILED' })
    const previous = structuredClone(h.jobs.get(h.submitted.id, contributor.userKey).validation), assertNoGeneration = generationSpies(h)
    const binding = h.artifacts.validationSource(h.submitted.id, contributor)
    const claimed = await h.jobs.claimValidation(h.submitted.id, contributor.userKey, () => { h.artifacts.assertValidationSource(binding); h.deps().sourceFence(binding) })
    expect(claimed.job.validationHistory).toEqual([previous])
    const fetchMock = vi.fn(respond()), base = await routeOrigin(h, fetchMock as unknown as typeof fetch)
    const response = await fetch(`${base}/physicsos/question-code/jobs/${h.submitted.id}`, { headers: { 'x-test-account': 'contributor' } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toHaveProperty('job.validation'); expect(body).not.toHaveProperty('job.validationHistory')
    await expect(h.jobs.finish(h.submitted.id, claimed.epoch, { status: 'passed', resultRef: h.row.id, resultSha256: h.row.sha256 }))
      .rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    expect(fetchMock).not.toHaveBeenCalled(); assertNoGeneration()
  })

  it('keeps old passed evidence stored but does not advertise an unbound or earlier-lease report as this preview passed', async () => {
    const h = await setup(), base = await routeOrigin(h)
    const job = h.jobs.get(h.submitted.id, contributor.userKey)
    const historical = { ...job, status: 'ready' as const, resultRef: h.row.id, resultSha256: h.row.sha256,
      validation: { version: 1 as const, passed: true, candidateSha256: h.row.sha256, checks: [{ name: 'render', passed: true }], finishedAt: job.updatedAt } }
    await h.domain.table('jobs').put(job.id, historical)
    const response = await fetch(`${base}/physicsos/question-code/jobs/${job.id}`, { headers: { 'x-test-account': 'contributor' } })
    expect(response.status).toBe(200)
    expect(await response.json()).not.toHaveProperty('job.validation')
    expect(h.jobs.get(job.id, contributor.userKey)).toEqual(historical)
    expect(h.artifacts.preview(contributor, h.row.id, h.row.sha256).jobId).toBe(job.id)
  })

  it('preview jobId is present only for its exact current candidate; old records remain readable', async () => {
    const h = await setup()
    expect(h.artifacts.preview(contributor, h.row.id, h.row.sha256).jobId).toBe(h.submitted.id)
    const job = h.jobs.get(h.submitted.id, contributor.userKey)
    await h.domain.table('jobs').put(job.id, { ...job, sceneRevision: 2 })
    expect(h.artifacts.preview(contributor, h.row.id, h.row.sha256)).not.toHaveProperty('jobId')
    expect((await h.artifacts.source(contributor, h.row.id, h.row.sha256)).source.rendererJs).toBe(renderer)
    await h.domain.table('jobs').delete(job.id)
    expect(h.artifacts.preview(contributor, h.row.id, h.row.sha256)).not.toHaveProperty('jobId')
  })
})
