import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as physicsTools from '../src/index.ts'
import { REGENERATE_ROUTE } from '../src/regenerate-route.ts'
import type { CodeGenerationDependencies } from '../src/code-generation.ts'
import { questionCodeContext } from '../../experiment-host/src/question-code-context.ts'
import { PROMPT_SEED } from '../../experiment-host/src/prompt-seed.ts'
import { fixtureArtifactId, mountGenerationJobs } from './generation-jobs-fixture.ts'
import type { QuestionCodeJobs } from '../../experiment-host/src/question-code-jobs.ts'

const source = { title: '本题轨迹', summary: '独立绘制本题引擎快照', rendererJs: `export function renderFrame(snapshot) {
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
  document.getElementById('canvas').replaceChildren(canvas);
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
  const point = snapshot.view.bodies?.[0]?.at || snapshot.view.particles?.[0]?.at;
  ctx.clearRect(0, 0, 800, 480);
  if (point) { ctx.beginPath(); ctx.arc(point.x, point.y, 8, 0, Math.PI * 2); ctx.fill(); }
}`, stylesheet: '.question { color: blue; }' }
const QUESTION = '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。'

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** A real agent loop with the plugin, a captured route handler and the services the route looks up. */
async function host(adapter: MockAdapter): Promise<{ ctx: Context; parent: Agent; handler: Handler; created: unknown[] }> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'student' })
  await ctx.agentPresets.register({ id: 'student', plugins: [] })
  await ctx.plugin(SubagentRuntime)
  let handler: Handler | undefined
  ctx.provide('webServer', {
    register: (route: { path: string; handler: Handler }) => {
      if (route.path === REGENERATE_ROUTE) handler = route.handler
      return () => { handler = undefined }
    },
  } as never)
  ctx.provide('physicsosIdentity', {
    actorOf: (req: IncomingMessage) => req.headers['x-test-account'] === undefined ? null : { userKey: String(req.headers['x-test-account']) },
    sessionOwnerKey: (id: string) => id === 'parent' ? 'school:student' : undefined,
  } as never)
  const created: unknown[] = []
  ctx.provide('questionCodeArtifacts', {
    /* `current()` hands back a published PromptDocument; the seed is only its body,
       and the context builder reads nothing else. Assert at this fixture seam. */
    context: (experimentId: string) => Promise.resolve(questionCodeContext(experimentId, { current: () => PROMPT_SEED as never })),
    create: async (input: Parameters<CodeGenerationDependencies['create']>[0]) => {
      created.push(input)
      const scene = input.scene as PhysicsScene
      return {
        status: 'ready', rendererKind: 'independent', artifactId: `private-${created.length}`, ownerSessionId: input.ownerSessionId,
        sceneId: String(scene.id), sceneRevision: scene.revision, sceneSha256: 'a'.repeat(64),
        sha256: String(created.length).repeat(64), experimentId: input.experimentId,
        childSessionId: input.childSessionId, title: input.source.title, createdAt: '2026-11-04T00:00:00Z',
      }
    },
  } as never)
  await mountGenerationJobs(ctx)
  await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
  ctx.llm.registerAdapter(['mock'], adapter)
  const handle = await ctx.agents.create({
    sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'student') },
  })
  ctx.provide('sessionController', {
    resolveAgent: async (sessionId: string) => sessionId === 'parent'
      ? { agent: handle.agent }
      : { error: { code: 'SESSION_NOT_FOUND', message: `session ${sessionId} not found` } },
  } as never)
  if (handler === undefined) throw new Error('route was not mounted')
  return { ctx, parent: handle.agent, handler, created }
}

/** Drive the handler with a plain JSON body and capture what it answers. */
async function post(handler: Handler, body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const req = Object.assign(Readable.from([Buffer.from(payload)]), {
    method,
    headers: { host: 'physics.test', 'content-type': 'application/json', ...headers },
  }) as unknown as IncomingMessage
  let status = 0
  let text = ''
  const res = {
    writeHead: (code: number) => { status = code },
    end: (chunk?: string) => { text = chunk ?? '' },
  } as unknown as ServerResponse
  await handler(req, res)
  return { status, body: text === '' ? undefined : JSON.parse(text) as { state?: { status: string; jobId?: string }; error?: { code: string } } }
}

const scenesOf = (agent: Agent) =>
  agent.session.snapshotEvents().flatMap(event => (event.type === 'physics/scene' ? [event.data] : []))
const turnsOf = (agent: Agent) =>
  agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length

/* Real agent loops: generous per-test budget so a loaded machine does not fail them on time alone. */
describe('direct regeneration route', { timeout: 30_000 }, () => {
  it('starts the trusted code generation for an owned scene without a model turn', async () => {
    let mainCalls = 0
    let childCalls = 0
    const respond = (options: GenerateOptions) => {
      if (options.tools?.some(tool => tool.name === 'structured_output')) {
        childCalls++
        return toolCallResponse(`code-${childCalls}`, 'structured_output', { ...source, title: `第${childCalls}版` })
      }
      mainCalls++
      return mainCalls === 1
        ? toolCallResponse('solve', 'physics_solve_question', { text: QUESTION })
        : textResponse('已解答。')
    }
    const adapter = new MockAdapter(Array.from({ length: 8 }, () => respond))
    const { ctx, parent, handler, created } = await host(adapter)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: QUESTION }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const before = scenesOf(parent)
    const original = before.at(-1)
    if (original?.visualization?.status !== 'ready') throw new Error('the solve did not produce a ready code experiment')
    expect(turnsOf(parent)).toBe(1)
    const mainCallsAfterSolve = mainCalls

    /* A real child takes minutes; the mock answers within microtasks. Hold the
       artifact store so the route is observed answering while the job runs. */
    let release: (() => void) | undefined
    const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: (input: unknown) => Promise<unknown> }
    const realCreate = artifacts.create
    artifacts.create = async (input: unknown) => { await new Promise<void>((resolve) => { release = resolve }); return realCreate(input) }

    /* Same turn, visualization already ready: the model's tool would reuse it,
       the student's button must start a fresh job. */
    const accepted = await post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
    expect(accepted.status).toBe(202)
    expect(accepted.body?.state?.status).toBe('generating')
    const generatingNow = scenesOf(parent).at(-1)?.visualization
    expect(generatingNow?.status).toBe('generating')
    expect(generatingNow?.status === 'generating' ? generatingNow.jobId : undefined).toBe(accepted.body?.state?.jobId)
    await vi.waitFor(() => { expect(release).toBeDefined() }, { timeout: 10_000 })
    release!()

    /* The second job runs on the same session; no new turn, no main-model request. */
    await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
    const after = scenesOf(parent).slice(before.length)
    expect(after.map(snapshot => snapshot.visualization?.status)).toEqual(['generating', 'ready'])
    expect(after.map(snapshot => snapshot.turn)).toEqual([1, 1])
    expect(turnsOf(parent)).toBe(1)
    expect(mainCalls).toBe(mainCallsAfterSolve)
    expect(childCalls).toBe(2)
    expect(created).toHaveLength(2)
    const regenerated = after.at(-1)?.visualization
    expect(regenerated?.status === 'ready' ? regenerated.title : undefined).toBe('第2版')
    expect(regenerated?.status === 'ready' ? regenerated.artifactId : undefined).toBe(fixtureArtifactId('private-2'))
    /* The scene facts never change across a regeneration. */
    for (const snapshot of after) {
      expect(snapshot.scene).toEqual(original.scene)
      expect(snapshot.revision).toBe(original.revision)
    }
  })

  it('refuses callers who are not the session owner, cross-site requests and malformed bodies', async () => {
    const adapter = new MockAdapter([textResponse('idle')])
    const { handler } = await host(adapter)
    expect((await post(handler, { sessionId: 'parent', sceneId: 'x' })).body?.error?.code).toBe('UNAUTHENTICATED')
    expect((await post(handler, { sessionId: 'parent', sceneId: 'x' }, { 'x-test-account': 'school:other' })).status).toBe(404)
    expect((await post(handler, { sessionId: 'someone-else', sceneId: 'x' }, { 'x-test-account': 'school:student' })).status).toBe(404)
    expect((await post(handler, { sessionId: 'parent', sceneId: 'missing' }, { 'x-test-account': 'school:student' })).body?.error?.code).toBe('SCENE_NOT_FOUND')
    expect((await post(handler, { sessionId: 'parent' }, { 'x-test-account': 'school:student' })).status).toBe(400)
    expect((await post(handler, 'not json', { 'x-test-account': 'school:student' })).status).toBe(400)
    expect((await post(handler, { sessionId: 'parent', sceneId: 'x' }, { 'x-test-account': 'school:student', origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(handler, { sessionId: 'parent', sceneId: 'x' }, { 'x-test-account': 'school:student', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post(handler, { sessionId: 'parent', sceneId: 'x' }, { 'x-test-account': 'school:student' }, 'GET')).status).toBe(404)
  })

  describe('generation lifecycle recovery', () => {
    async function solvedHost() {
      let mainCalls = 0
      const respond = (options: GenerateOptions) => {
        if (options.tools?.some(tool => tool.name === 'structured_output')) return toolCallResponse('code', 'structured_output', source)
        mainCalls++
        return mainCalls === 1 ? toolCallResponse('solve', 'physics_solve_question', { text: QUESTION }) : textResponse('继续讨论，题目条件没有改变。')
      }
      const result = await host(new MockAdapter(Array.from({ length: 12 }, () => respond)))
      result.parent.followup(createUserMessage({ content: [{ type: 'text', text: QUESTION }], source: { kind: 'user' } }))
      await result.parent.whenIdle()
      const original = scenesOf(result.parent).at(-1)!
      expect(original.visualization?.status).toBe('ready')
      return { ...result, original }
    }

    it('waits through durable submit/claim IO and returns its committed marker before child completion', async () => {
      const { ctx, parent, handler, original } = await solvedHost()
      const jobs = ctx.get('questionCodeJobs') as unknown as QuestionCodeJobs
      const submitting = Promise.withResolvers<void>(), claiming = Promise.withResolvers<void>()
      const releaseSubmit = Promise.withResolvers<void>(), releaseClaim = Promise.withResolvers<void>()
      const creating = Promise.withResolvers<void>(), releaseArtifact = Promise.withResolvers<void>()
      const submit = jobs.submit.bind(jobs), claim = jobs.claim.bind(jobs)
      vi.spyOn(jobs, 'submit').mockImplementationOnce(async input => { submitting.resolve(); await releaseSubmit.promise; return submit(input) })
      vi.spyOn(jobs, 'claim').mockImplementationOnce(async id => { claiming.resolve(); await releaseClaim.promise; return claim(id) })
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: CodeGenerationDependencies['create'] }
      const create = artifacts.create
      artifacts.create = async (input, signal) => { creating.resolve(); await releaseArtifact.promise; return create(input, signal) }
      let answered = false
      const pending = post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
        .then(value => { answered = true; return value })
      try {
        await submitting.promise
        expect(answered).toBe(false)
        expect(scenesOf(parent).at(-1)).toEqual(original)
        releaseSubmit.resolve()
        await claiming.promise
        expect(answered).toBe(false)
        expect(scenesOf(parent).at(-1)).toEqual(original)
        releaseClaim.resolve()
        const response = await pending
        expect(response.status).toBe(202)
        const marker = scenesOf(parent).at(-1)?.visualization
        expect(marker).toMatchObject({ status: 'generating', jobId: response.body?.state?.jobId })
        if (marker?.status !== 'generating') throw new Error('the durable marker was not published')
        expect(marker.jobId).not.toBe('')
        expect(jobs.get(marker.jobId, 'school:student').status).toBe('running')
        await creating.promise
        expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('generating')
      } finally {
        releaseSubmit.resolve(); releaseClaim.resolve(); releaseArtifact.resolve()
        await pending
        await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
      }
    })

    it('does not acknowledge a delayed claim with another request’s marker on the same scene', async () => {
      const { ctx, parent, handler, original, created } = await solvedHost()
      const jobs = ctx.get('questionCodeJobs') as unknown as QuestionCodeJobs
      const claiming = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
      const releaseArtifact = Promise.withResolvers<void>()
      vi.spyOn(jobs, 'claim').mockImplementationOnce(async () => { claiming.resolve(); await release.promise; return undefined })
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: CodeGenerationDependencies['create'] }
      const create = artifacts.create
      artifacts.create = async (input, signal) => { await releaseArtifact.promise; return create(input, signal) }
      const scene = { sessionId: 'parent', sceneId: original.sceneId }, headers = { 'x-test-account': 'school:student' }
      const pending = post(handler, { ...scene, instructions: '第一种排版' }, headers)
      try {
        await claiming.promise
        expect(scenesOf(parent).at(-1)).toEqual(original)
        const accepted = await post(handler, { ...scene, instructions: '另一种排版' }, headers)
        expect(accepted.status).toBe(202)
        release.resolve()
        const refused = await pending
        expect(refused.status).toBe(500)
        expect(refused.body).toMatchObject({ error: { code: 'GENERATION_NOT_CLAIMED' } })
        expect(scenesOf(parent).at(-1)?.visualization).toMatchObject({ status: 'generating', jobId: accepted.body?.state?.jobId })
      } finally { release.resolve(); releaseArtifact.resolve(); await pending }
      await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
      expect(created).toHaveLength(2)
    })

    it('checks a live customized request without replacing it with a default request', async () => {
      const { ctx, parent, handler, original, created } = await solvedHost()
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: CodeGenerationDependencies['create'] }
      const create = artifacts.create, release = Promise.withResolvers<void>()
      artifacts.create = async (input, signal) => { await release.promise; return create(input, signal) }
      const headers = { 'x-test-account': 'school:student' }, scene = { sessionId: 'parent', sceneId: original.sceneId }
      try {
        const accepted = await post(handler, { ...scene, instructions: '只强调洛伦兹力方向' }, headers)
        const checked = await post(handler, scene, headers)
        expect(accepted.status).toBe(202)
        expect(checked.status).toBe(202)
        expect(checked.body?.state).toEqual(accepted.body?.state)
      } finally { release.resolve() }
      await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
      expect(created).toHaveLength(2)
    })

    it.each([true, false])('recovers the exact customized candidate without model work (recorded digest: %s)', async recorded => {
      const { ctx, parent, handler, original, created } = await solvedHost()
      const jobs = ctx.get('questionCodeJobs') as unknown as QuestionCodeJobs
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as {
        create: CodeGenerationDependencies['create']
        restoreGeneration?: (input: { generationId: string }) => Promise<Awaited<ReturnType<CodeGenerationDependencies['create']>> | undefined>
      }
      const create = artifacts.create
      let frozen: Awaited<ReturnType<CodeGenerationDependencies['create']>> | undefined, jobId = ''
      artifacts.create = async (input, signal) => {
        const result = await create(input, signal)
        if (input.generationId === jobId) frozen = result
        return result
      }
      const publish = jobs.publishGeneration.bind(jobs)
      vi.spyOn(jobs, 'publishGeneration').mockImplementation(async (...args) => {
        if (recorded && args[3] !== undefined && args[0].id === jobId) throw new Error('fixture publication interrupted')
        return publish(...args)
      })
      const record = jobs.recordCandidate.bind(jobs)
      vi.spyOn(jobs, 'recordCandidate').mockImplementation(async (...args) => {
        if (!recorded && args[0] === jobId) throw new Error('fixture candidate recording interrupted')
        return record(...args)
      })
      const headers = { 'x-test-account': 'school:student' }, scene = { sessionId: 'parent', sceneId: original.sceneId }
      const accepted = await post(handler, { ...scene, instructions: '只强调洛伦兹力方向' }, headers)
      expect(accepted.status).toBe(202)
      jobId = accepted.body?.state?.jobId ?? ''
      expect(jobId).not.toBe('')
      await vi.waitFor(() => { expect(jobs.get(jobId, 'school:student').status).toBe('queued') }, { timeout: 10_000 })
      expect(frozen).toBeDefined()
      expect(jobs.get(jobId, 'school:student').attempts.at(-1)?.candidateSha256).toBe(recorded ? frozen!.sha256 : undefined)
      vi.restoreAllMocks()
      const restore = vi.fn(async (input: { generationId: string }) => input.generationId === jobId ? frozen : undefined)
      artifacts.restoreGeneration = restore
      const recovered = await post(handler, scene, headers)
      expect(recovered.status).toBe(200)
      expect(recovered.body?.state).toEqual(frozen)
      expect(restore).toHaveBeenCalledOnce()
      expect(created).toHaveLength(2)
      expect(scenesOf(parent).at(-1)?.visualization).toEqual(frozen)
      expect(jobs.get(jobId, 'school:student')).toMatchObject({ status: 'queued', attempts: [{ candidateSha256: frozen!.sha256 }] })
    })

    it.each([
      { label: 'a missing deadline', withDeadline: false },
      { label: 'a future deadline but no process job', withDeadline: true },
    ])('restarts an orphan generation with $label', async ({ withDeadline }) => {
      const { ctx, parent, handler, original, created } = await solvedHost()
      const orphan = { status: 'generating' as const, ownerSessionId: 'parent', sceneId: original.sceneId,
        sceneRevision: original.revision, jobId: 'orphan-job', ...(withDeadline ? { deadlineAt: Date.now() + 600_000 } : {}) }
      parent.session.append('physics/scene', { ...original, visualization: orphan })
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: (input: unknown) => Promise<unknown> }
      const create = artifacts.create
      artifacts.create = async input => { await held; return create(input) }
      try {
        const accepted = await post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
        expect(accepted.status).toBe(202)
        expect(accepted.body?.state?.jobId).not.toBe('orphan-job')
      } finally { release() }
      await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
      const latest = scenesOf(parent).at(-1)!
      expect(created).toHaveLength(2)
      expect(latest.scene).toEqual(original.scene)
      expect(latest.solve).toEqual(original.solve)
      expect(latest.revision).toBe(original.revision)
    })

    it('completes its own generation across a newer parent turn when the scene facts are unchanged', async () => {
      const { ctx, parent, handler, original, created } = await solvedHost()
      let release!: () => void
      let entered!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      const creating = new Promise<void>(resolve => { entered = resolve })
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: (input: unknown) => Promise<unknown> }
      const create = artifacts.create
      artifacts.create = async input => { entered(); await held; return create(input) }
      const accepted = await post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
      try {
        expect(accepted.status).toBe(202)
        await creating
        parent.followup(createUserMessage({ content: [{ type: 'text', text: '只解释已有结果，不改变题目条件。' }], source: { kind: 'user' } }))
        await parent.whenIdle()
        expect(turnsOf(parent)).toBe(2)
        expect(scenesOf(parent).at(-1)?.visualization).toMatchObject({
          status: 'generating', jobId: accepted.body?.state?.jobId,
          ownerSessionId: 'parent', sceneId: original.sceneId, sceneRevision: original.revision,
        })
        release()
        await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
        const latest = scenesOf(parent).at(-1)!
        expect(created).toHaveLength(2)
        expect(latest.visualization).toMatchObject({
          status: 'ready', artifactId: fixtureArtifactId('private-2'), ownerSessionId: 'parent',
          sceneId: original.sceneId, sceneRevision: original.revision,
        })
        expect(latest.sceneId).toBe(original.sceneId)
        expect(latest.revision).toBe(original.revision)
        expect(latest.scene).toEqual(original.scene)
        expect(latest.solve).toEqual(original.solve)
      } finally { release() }
    })

    it('keeps the newer job live when a superseded job finishes', async () => {
      const { ctx, parent, handler, original } = await solvedHost()
      let releaseOld!: () => void
      let releaseNew!: () => void
      let enteredOld!: () => void
      let enteredNew!: () => void
      const oldHeld = new Promise<void>(resolve => { releaseOld = resolve })
      const newHeld = new Promise<void>(resolve => { releaseNew = resolve })
      const oldCreating = new Promise<void>(resolve => { enteredOld = resolve })
      const newCreating = new Promise<void>(resolve => { enteredNew = resolve })
      const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: (input: unknown, signal?: AbortSignal) => Promise<unknown> }
      const create = artifacts.create
      let calls = 0
      let oldSignal: AbortSignal | undefined
      artifacts.create = async (input, signal) => {
        calls++
        if (calls === 1) { oldSignal = signal; enteredOld(); await oldHeld }
        else { enteredNew(); await newHeld }
        return create(input, signal)
      }
      try {
        const first = await post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
        await oldCreating
        const old = scenesOf(parent).at(-1)!
        if (old.visualization?.status !== 'generating') throw new Error('Old generation did not start')
        parent.session.append('physics/scene', { ...old, visualization: { ...old.visualization, deadlineAt: Date.now() - 1 } })
        const second = await post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
        expect(second.body?.state?.jobId).not.toBe(first.body?.state?.jobId)
        await newCreating
        releaseOld()
        await vi.waitFor(() => { expect(oldSignal?.aborted).toBe(true) })
        const repeated = await post(handler, { sessionId: 'parent', sceneId: original.sceneId }, { 'x-test-account': 'school:student' })
        expect(repeated.body?.state?.jobId).toBe(second.body?.state?.jobId)
        expect(scenesOf(parent).at(-1)?.visualization).toMatchObject({ status: 'generating', jobId: second.body?.state?.jobId })
        releaseNew()
        await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
        expect(scenesOf(parent).at(-1)?.scene).toEqual(original.scene)
      } finally { releaseOld(); releaseNew() }
    })
  })

  it('returns the live job instead of starting a second one while a generation is still running', async () => {
    let release: (() => void) | undefined
    let childCalls = 0
    let mainCalls = 0
    const respond = (options: GenerateOptions) => {
      if (options.tools?.some(tool => tool.name === 'structured_output')) {
        childCalls++
        return toolCallResponse(`code-${childCalls}`, 'structured_output', source)
      }
      mainCalls++
      return mainCalls === 1 ? toolCallResponse('solve', 'physics_solve_question', { text: QUESTION }) : textResponse('已解答。')
    }
    const adapter = new MockAdapter(Array.from({ length: 8 }, () => respond))
    const { ctx, parent, handler } = await host(adapter)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: QUESTION }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const sceneId = scenesOf(parent).at(-1)!.sceneId
    /* Hold the artifact store so the next job stays in `generating`. */
    const artifacts = ctx.get('questionCodeArtifacts') as unknown as { create: (input: unknown) => Promise<unknown> }
    const realCreate = artifacts.create
    artifacts.create = async (input: unknown) => { await new Promise<void>((resolve) => { release = resolve }); return realCreate(input) }
    const first = await post(handler, { sessionId: 'parent', sceneId }, { 'x-test-account': 'school:student' })
    expect(first.status).toBe(202)
    await vi.waitFor(() => { expect(release).toBeDefined() }, { timeout: 10_000 })
    const second = await post(handler, { sessionId: 'parent', sceneId }, { 'x-test-account': 'school:student' })
    expect(second.status).toBe(202)
    expect(second.body?.state?.jobId).toBe(first.body?.state?.jobId)
    expect(childCalls).toBe(2)
    release!()
    await vi.waitFor(() => { expect(scenesOf(parent).at(-1)?.visualization?.status).toBe('ready') }, { timeout: 10_000 })
    expect(scenesOf(parent).filter(snapshot => snapshot.visualization?.status === 'generating')).toHaveLength(2)
  })
})
