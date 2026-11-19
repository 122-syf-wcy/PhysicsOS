import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as physicsTools from '../src/index.ts'
import { isQuestionCodeGenerationActive, type CodeGenerationDependencies } from '../src/code-generation.ts'
import type { PhysicsSceneSnapshot } from '../src/types.ts'
import { mountGenerationJobs } from './generation-jobs-fixture.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose() })

async function producer() {
  const ctx = new Context(); contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const session = ctx.sessions.create(SessionId('parent'))
  const agent = { id: session.id, session } as unknown as Agent
  let owner = 'school:student'
  ctx.provide('physicsosIdentity', { sessionOwnerKey: () => owner } as never)
  const context = vi.fn(async (experimentId: string) => ({ experimentId, developerPrompt: '', publishedBody: '',
    styleVersion: 'test', renderContract: 'Only draw engine snapshots.', allowedAssetPaths: [] }))
  const create = vi.fn(async (input: Parameters<CodeGenerationDependencies['create']>[0]) => ({
    status: 'ready' as const, rendererKind: 'independent' as const, artifactId: `artifact-${input.childSessionId}`,
    ownerSessionId: input.ownerSessionId, sceneId: 'scene', sceneRevision: 1, sceneSha256: 'a'.repeat(64),
    sha256: 'b'.repeat(64), experimentId: input.experimentId, childSessionId: input.childSessionId,
    title: input.source.title, createdAt: '2026-11-19T00:00:00.000Z',
  }))
  const dispose = vi.fn(async () => {})
  const source = { title: 'Owned frame', summary: '', rendererJs: 'export function renderFrame(snapshot) { return snapshot.view; }', stylesheet: '' }
  let children = 0
  const start = vi.fn(async () => ({ id: `child-${++children}`, result: Promise.resolve({ stopReason: 'completed', structured: source, output: [] }), dispose }))
  const validateCandidate = vi.fn(async () => undefined)
  ctx.provide('questionCodeArtifacts', { context, create } as never)
  ctx.provide('subagents', { start } as never)
  ctx.provide('questionCodeValidation', { configured: true, validateCandidate } as never)
  const fixture = await mountGenerationJobs(ctx)
  await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
  const original: PhysicsSceneSnapshot = { sceneId: 'scene', revision: 1, domain: 'magnetic', engineId: 'engine-magnetic',
    title: 'Owned scene', cause: 'solved', turn: 1,
    scene: { schemaVersion: 'physics-scene/1.0', id: 'scene', revision: 1, metadata: {} } }
  session.append('turn/start', { turn: 1 })
  session.append('physics/scene', original)
  let calls = 0
  const call = (instructions?: string) => ctx.tools.execute({ agent, signal: new AbortController().signal,
    callId: ToolCallId(`publication-${++calls}`), name: 'physics_generate_experiment',
    arguments: { sceneId: 'scene', ...(instructions === undefined ? {} : { instructions }) } })
  const current = () => ctx.sessionProjections.stateOf(session, 'physicsScenes')!.scenes.scene!
  return { ctx, session, ...fixture, context, create, start, validateCandidate, original, call, current,
    setOwner: (value: string) => { owner = value } }
}

describe('durable producer publication', () => {
  it.each(['submit', 'claim-error', 'claim-refused'] as const)('does not spend model work after %s admission failure', async failure => {
    const h = await producer()
    if (failure === 'submit') vi.spyOn(h.jobs, 'submit').mockRejectedValueOnce(new Error('fixture storage unavailable'))
    else if (failure === 'claim-error') vi.spyOn(h.jobs, 'claim').mockRejectedValueOnce(new Error('fixture lease unavailable'))
    else vi.spyOn(h.jobs, 'claim').mockResolvedValueOnce(undefined)
    const result = await h.call()
    expect(result.isError).toBe(true)
    expect(h.context).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.validateCandidate).not.toHaveBeenCalled()
    expect(h.current()).toEqual(h.original)
  })

  it('retains the verified solve when automatic visualization cannot be admitted', async () => {
    const h = await producer()
    vi.spyOn(h.jobs, 'submit').mockRejectedValueOnce(new Error('fixture storage unavailable'))
    const result = await h.ctx.tools.execute({ agent: { id: h.session.id, session: h.session, ctx: h.ctx } as unknown as Agent,
      signal: new AbortController().signal, callId: ToolCallId('solve-before-admission'), name: 'physics_solve_question',
      arguments: { text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。' } })
    expect(result).toMatchObject({ isError: false, value: { status: 'solved', verification: { status: 'passed' },
      visualization: { status: 'failed', code: 'GENERATION_FAILED' } } })
    expect(h.start).not.toHaveBeenCalled()
    expect(h.session.snapshotEvents()).toContainEqual(expect.objectContaining({ type: 'physics/solve-trace' }))
  })

  it('settles a failed first-marker publication without spending model work or leaving running work', async () => {
    const h = await producer()
    vi.spyOn(h.jobs, 'publishGeneration').mockRejectedValueOnce(new Error('fixture marker write unavailable'))
    expect((await h.call()).isError).toBe(true)
    expect(h.context).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
    expect(h.current()).toEqual(h.original)
    expect([...h.domain.table('jobs').entries()].map(([, job]) => job)).toMatchObject([
      { status: 'failed', code: 'GENERATION_PUBLICATION_FAILED', attempts: [{ status: 'rejected' }] },
    ])
  })

  it('retires its unused lease when another same-request admission lands a live marker during IO', async () => {
    const h = await producer(), firstClaim = Promise.withResolvers<void>(), secondClaim = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>(), releaseSecond = Promise.withResolvers<void>()
    const childStarted = Promise.withResolvers<void>(), childDone = Promise.withResolvers<{ stopReason: string; structured: { title: string; summary: string; rendererJs: string; stylesheet: string }; output: never[] }>()
    const claim = h.jobs.claim.bind(h.jobs)
    let claims = 0
    vi.spyOn(h.jobs, 'claim').mockImplementation(async id => {
      const started = await claim(id)
      if (++claims === 1) { firstClaim.resolve(); await releaseFirst.promise }
      else { secondClaim.resolve(); await releaseSecond.promise }
      return started
    })
    const completed = await h.start()
    h.start.mockClear()
    h.start.mockImplementationOnce(async () => { childStarted.resolve(); return { ...completed, result: childDone.promise } })
    const first = h.call()
    let second: ReturnType<typeof h.call> | undefined
    try {
      await firstClaim.promise
      second = h.call()
      await secondClaim.promise
      releaseFirst.resolve()
      await childStarted.promise
      releaseSecond.resolve()
      expect(await second).toMatchObject({ isError: false, value: { status: 'generating' } })
      expect(h.start).toHaveBeenCalledTimes(1)
      const rows = [...h.domain.table('jobs').entries()].map(([, job]) => job)
      expect(rows.filter(job => job.status === 'running')).toHaveLength(1)
      expect(rows.filter(job => job.code === 'GENERATION_SUPERSEDED')).toMatchObject([{ status: 'failed', attempts: [{ status: 'rejected' }] }])
      childDone.resolve(await completed.result)
      expect(await first).toMatchObject({ isError: false, value: { status: 'ready' } })
      expect([...h.domain.table('jobs').entries()].some(([, job]) => job.status === 'running')).toBe(false)
    } finally {
      releaseFirst.resolve(); releaseSecond.resolve(); childDone.resolve(await completed.result)
      await Promise.allSettled([first, second])
    }
  })

  it('waits for the first fenced marker before context/model work', async () => {
    const h = await producer(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const publish = h.jobs.publishGeneration.bind(h.jobs)
    vi.spyOn(h.jobs, 'publishGeneration').mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; await publish(...args)
    })
    const pending = h.call()
    try {
      await entered.promise
      expect(h.current()).toEqual(h.original)
      expect(h.context).not.toHaveBeenCalled()
      expect(h.start).not.toHaveBeenCalled()
      release.resolve()
      expect(await pending).toMatchObject({ isError: false, value: { status: 'ready' } })
      expect(h.context).toHaveBeenCalledTimes(1)
      expect(h.start).toHaveBeenCalledTimes(1)
    } finally { release.resolve(); await pending }
  })

  it('awaits terminal publication and durable candidate recording before validation or returning a receipt', async () => {
    const h = await producer(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const publish = h.jobs.publishGeneration.bind(h.jobs)
    let jobId = ''
    vi.spyOn(h.jobs, 'publishGeneration').mockImplementation(async (...args) => {
      if (args[3] !== undefined) { jobId = args[0].id; entered.resolve(); await release.promise }
      await publish(...args)
    })
    let settled = false
    const pending = h.call().then(value => { settled = true; return value })
    try {
      await entered.promise
      expect(h.jobs.get(jobId, 'school:student')).toMatchObject({ status: 'candidate', attempts: [{ candidateSha256: 'b'.repeat(64) }] })
      expect(h.current().visualization).toMatchObject({ status: 'generating', jobId })
      expect(settled).toBe(false)
      expect(h.validateCandidate).not.toHaveBeenCalled()
      await vi.waitFor(() => { expect(isQuestionCodeGenerationActive('parent', h.current())).toBe(false) })
      expect(await h.call()).toMatchObject({ isError: false, value: { status: 'generating', jobId } })
      expect(h.start).toHaveBeenCalledTimes(1)
      expect(h.domain.table('jobs').size).toBe(1)
      release.resolve()
      expect(await pending).toMatchObject({ isError: false, value: { status: 'ready' } })
      expect(h.validateCandidate).toHaveBeenCalledTimes(1)
      // A preview never substitutes for a browser acceptance report.
      expect(h.jobs.get(jobId, 'school:student').status).toBe('candidate')
    } finally { release.resolve(); await pending }
  })

  it('does not append ready when durable candidate recording fails', async () => {
    const h = await producer()
    vi.spyOn(h.jobs, 'recordCandidate').mockRejectedValueOnce(new Error('fixture candidate write unavailable'))
    expect((await h.call()).isError).toBe(true)
    expect(h.current().visualization?.status).toBe('generating')
    expect(h.validateCandidate).not.toHaveBeenCalled()
    expect(h.domain.table('artifacts').size).toBe(1)
    const jobs = [...h.domain.table('jobs').entries()].map(([, job]) => job)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ status: 'queued', code: 'GENERATION_PUBLICATION_FAILED',
      attempts: [{ status: 'infrastructure-failed' }] })
    expect(jobs[0]!.status).not.toBe('ready')
  })

  it.each(['owner', 'revision', 'facts', 'request', 'job', 'latest scene'] as const)(
    'rechecks %s at the actual terminal append after candidate durability', async change => {
      const h = await producer(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
      const publish = h.jobs.publishGeneration.bind(h.jobs)
      let jobId = ''
      vi.spyOn(h.jobs, 'publishGeneration').mockImplementation(async (...args) => {
        if (args[3] !== undefined) { jobId = args[0].id; entered.resolve(); await release.promise }
        await publish(...args)
      })
      const pending = h.call()
      try {
        await entered.promise
        const current = h.current(), marker = current.visualization
        if (marker?.status !== 'generating') throw new Error('expected owned marker')
        if (change === 'owner') h.setOwner('other:student')
        else if (change === 'revision' || change === 'latest scene') {
          const { visualization: _oldMarker, ...next } = current
          const revision = change === 'revision' ? current.revision + 1 : current.revision
          const sceneId = change === 'latest scene' ? 'newer-scene' : current.sceneId
          h.session.append('physics/scene', { ...next, sceneId, revision, scene: { ...(current.scene as object), id: sceneId, revision } })
        } else if (change === 'facts') h.session.append('physics/scene', { ...current, scene: { ...(current.scene as object), corrected: true } })
        else if (change === 'request') h.session.append('physics/scene', { ...current, visualization: { ...marker, requestSha256: 'f'.repeat(64) } })
        else if (change === 'job') h.session.append('physics/scene', { ...current, visualization: { ...marker, jobId: 'newer-job' } })
        const before = ctxProjection(h), events = h.session.snapshotEvents().filter(event => event.type === 'physics/scene').length
        release.resolve()
        expect(await pending).toMatchObject({ isError: true, error: { info: { code: 'STALE_GENERATION' } } })
        expect(ctxProjection(h)).toEqual(before)
        expect(h.session.snapshotEvents().filter(event => event.type === 'physics/scene')).toHaveLength(events)
        expect(h.jobs.get(jobId, 'school:student')).toMatchObject({ status: 'superseded', attempts: [{ status: 'cancelled', candidateSha256: 'b'.repeat(64) }] })
        expect(h.validateCandidate).not.toHaveBeenCalled()
      } finally { release.resolve(); await pending }
    })

  it.each(['cancelled', 'deadline'] as const)('refuses a %s generation at the terminal append boundary', async change => {
    const h = await producer(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const publish = h.jobs.publishGeneration.bind(h.jobs)
    let jobId = ''
    vi.spyOn(h.jobs, 'publishGeneration').mockImplementation(async (...args) => {
      if (args[3] !== undefined) { jobId = args[0].id; entered.resolve(); await release.promise }
      await publish(...args)
    })
    const pending = h.call()
    try {
      await entered.promise
      if (change === 'cancelled') await h.jobs.cancel(jobId, 'school:student')
      else {
        const current = h.current(), marker = current.visualization
        if (marker?.status !== 'generating') throw new Error('expected owned marker')
        h.session.append('physics/scene', { ...current, visualization: { ...marker, deadlineAt: 0 } })
      }
      release.resolve()
      expect((await pending).isError).toBe(true)
      expect(h.current().visualization?.status).toBe('generating')
      expect(h.jobs.get(jobId, 'school:student').status).toBe(change === 'cancelled' ? 'cancelled' : 'queued')
      expect(h.domain.table('artifacts').size).toBe(1)
      expect(h.validateCandidate).not.toHaveBeenCalled()
    } finally { release.resolve(); await pending }
  })

  it('cannot overwrite a newer job ready after the old candidate was already recorded', async () => {
    const h = await producer(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const publish = h.jobs.publishGeneration.bind(h.jobs)
    let oldJob = ''
    vi.spyOn(h.jobs, 'publishGeneration').mockImplementation(async (...args) => {
      if (args[3] !== undefined && oldJob === '') { oldJob = args[0].id; entered.resolve(); await release.promise }
      await publish(...args)
    })
    const old = h.call('first drawing')
    try {
      await entered.promise
      const newer = await h.call('second drawing')
      expect(newer).toMatchObject({ isError: false, value: { status: 'ready' } })
      const ready = h.current(), events = h.session.snapshotEvents().filter(event => event.type === 'physics/scene').length
      expect(ready.visualization).toMatchObject({ status: 'ready', childSessionId: 'child-2' })
      release.resolve()
      expect(await old).toMatchObject({ isError: true, error: { info: { code: 'STALE_GENERATION' } } })
      expect(h.current()).toEqual(ready)
      expect(h.session.snapshotEvents().filter(event => event.type === 'physics/scene')).toHaveLength(events)
      expect(h.jobs.get(oldJob, 'school:student')).toMatchObject({ status: 'superseded', attempts: [{ status: 'cancelled', candidateSha256: 'b'.repeat(64) }] })
      expect(h.validateCandidate).toHaveBeenCalledTimes(1)
      expect(h.domain.table('artifacts').size).toBe(2)
    } finally { release.resolve(); await old }
  })
})

function ctxProjection(h: Awaited<ReturnType<typeof producer>>) {
  return h.ctx.sessionProjections.stateOf(h.session, 'physicsScenes')
}
