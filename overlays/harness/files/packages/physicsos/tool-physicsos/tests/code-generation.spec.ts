import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JsonlSessionPersistence from '../../../session/session-persistence-jsonl/src/index.ts'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as physicsTools from '../src/index.ts'
import { PhysicsCodeProvider, CODE_PROVIDER_NAME } from '../src/code-provider.ts'
import { generateQuestionCode, type CodeGenerationDependencies } from '../src/code-generation.ts'
import type { PhysicsSceneSnapshot } from '../src/types.ts'

const source = { title: '本题轨迹', summary: '按本题场景标注', rendererJs: 'export function renderFrame(snapshot) { return []; }', stylesheet: '.question { color: blue; }' }
const snapshot = (): PhysicsSceneSnapshot => ({ sceneId: 'question-scene', revision: 2, domain: 'magnetic', engineId: 'engine-magnetic', title: '本题', cause: 'solved', turn: 4,
  scene: { schemaVersion: 'physics-scene/1.0', id: 'question-scene', revision: 2, particles: [{ charge: { value: 3, unit: 'C' } }], metadata: {} },
  solve: { knowns: [], targets: ['轨道半径'], answers: [], steps: [], issues: [], verification: { status: 'passed', checks: [] } },
})
function dependencies() {
  const original = snapshot()
  let latest = original
  const states: PhysicsSceneSnapshot[] = []
  const dispose = vi.fn(async () => {})
  const create = vi.fn(async () => ({ status: 'ready' as const, artifactId: 'private-1', ownerSessionId: 'parent', sceneId: original.sceneId, sceneRevision: 2, sceneSha256: 'a'.repeat(64), experimentId: 'magnetic-circular', sha256: 'b'.repeat(64), title: '本题轨迹', childSessionId: 'child', createdAt: '2026-11-04T00:00:00Z' }))
  const start = vi.fn(async (_request: Parameters<CodeGenerationDependencies['start']>[0]) => ({ id: 'child', result: Promise.resolve({ stopReason: 'completed', structured: source, output: [] }), dispose }))
  const deps = { ownerSessionId: 'parent', snapshot: original, signal: new AbortController().signal, experimentId: 'magnetic-circular',
    context: async () => ({ experimentId: 'magnetic-circular', developerPrompt: 'latest V3 prompt', publishedBody: 'current published body', styleVersion: 'V3', baseRenderer: 'base renderer', baseStylesheet: 'base CSS', allowedAssetPaths: [] }),
    start, create, current: () => latest, publish: (value: PhysicsSceneSnapshot) => { latest = value; states.push(value) },
  } as unknown as CodeGenerationDependencies
  return { deps, original, states, dispose, create, start, setLatest: (value: PhysicsSceneSnapshot) => { latest = value } }
}
describe('parent question code generation', () => {
  it('delegates the exact solved scene and publishes only metadata while retaining cause and evidence', async () => {
    const h = dependencies()
    const result = await generateQuestionCode(h.deps)
    expect(result.status).toBe('ready')
    expect(h.states.map(s => s.visualization?.status)).toEqual(['generating', 'ready'])
    expect(h.states[1]?.scene).toEqual(h.original.scene)
    expect(h.states[1]?.solve).toEqual(h.original.solve)
    expect(h.states[1]?.cause).toBe('solved')
    expect(JSON.stringify(h.states)).not.toContain('rendererJs')
    expect(JSON.stringify(h.start.mock.calls)).toContain('latest V3 prompt')
    const delegated = h.start.mock.calls[0]?.[0]?.prompt[0]
    expect(delegated?.type === 'text' ? delegated.text : undefined).toContain('"value":3')
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })
  it.each([
    'export { renderPlatformFrame as renderFrame } from "../vendor/platform-renderer.js";',
    `// 本题专用
export { renderPlatformFrame as renderFrame } from "../vendor/platform-renderer.js";
/* 题目说明 */`,
  ])('rejects a renderer that only reexports the platform template', async (rendererJs) => {
    const h = dependencies()
    h.start.mockImplementation(async () => ({ id: 'child', result: Promise.resolve({ stopReason: 'completed', structured: { ...source, rendererJs }, output: [] }), dispose: h.dispose }))
    const result = await generateQuestionCode(h.deps)
    expect(result.status === 'failed' && result.code).toBe('INVALID_SOURCE')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.start).toHaveBeenCalledTimes(2)
    expect(h.dispose).toHaveBeenCalledTimes(2)
  })
  it('rejects an unchanged base renderer before artifact creation', async () => {
    const h = dependencies()
    h.deps.context = async () => ({ experimentId: 'magnetic-circular', developerPrompt: 'V3', publishedBody: '', styleVersion: 'V3', baseRenderer: source.rendererJs, baseStylesheet: '', allowedAssetPaths: [] })
    const result = await generateQuestionCode(h.deps)
    expect(result.status === 'failed' && result.code).toBe('INVALID_SOURCE')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.start).toHaveBeenCalledTimes(2)
  })
  it('persists a generation deadline and never rewrites a later question after timeout', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
    const session = ctx.sessions.create(SessionId('deadline-parent'))
    const h = dependencies()
    h.deps.ownerSessionId = String(session.id)
    h.deps.timeoutMs = 20
    h.deps.publish = value => session.append('physics/scene', value)
    h.deps.current = () => ctx.sessionProjections.stateOf(session, 'physicsScenes')?.scenes[h.original.sceneId]
    h.deps.isCurrent = () => ctx.sessionProjections.stateOf(session, 'physicsScenes')?.latest === h.original.sceneId
    const later = { ...h.original, sceneId: 'later-question', title: '后续题目', revision: 0, scene: { ...(h.original.scene as object), id: 'later-question', revision: 0 } }
    h.start.mockImplementation(async () => {
      session.append('physics/scene', later)
      return { id: 'child', result: new Promise(() => {}), dispose: h.dispose }
    })
    const started = Date.now()
    const result = await generateQuestionCode(h.deps)
    const events = session.snapshotEvents().flatMap(event => event.type === 'physics/scene' ? [event.data] : [])
    const generating = events[0]?.visualization
    expect(generating?.status).toBe('generating')
    expect(generating?.status === 'generating' && generating.deadlineAt).toBeGreaterThanOrEqual(started + 20)
    expect(generating?.status === 'generating' && generating.deadlineAt).toBeLessThanOrEqual(started + 1020)
    const replay = ctx.sessions.create(SessionId('deadline-replay'), { seed: session.snapshotEvents() })
    const wire = ctx.sessionProjections.snapshot(replay).values.physicsScenes
    expect(wire?.scenes[h.original.sceneId]?.visualization).toEqual(generating)
    expect(wire?.latest).toBe('later-question')
    expect(events.map(event => event.sceneId)).toEqual([h.original.sceneId, 'later-question'])
    expect(result.status === 'failed' && result.code).toBe('GENERATION_TIMEOUT')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })
  it('keeps older generating events without a deadline readable', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
    const session = ctx.sessions.create()
    const original = snapshot()
    const visualization = { status: 'generating' as const, ownerSessionId: String(session.id), sceneId: original.sceneId, sceneRevision: original.revision, jobId: 'historical-job' }
    session.append('physics/scene', { ...original, visualization })
    expect(ctx.sessionProjections.snapshot(session).values.physicsScenes?.scenes[original.sceneId]?.visualization).toEqual(visualization)
  })
  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])('refuses unsafe deadline value %s before persistence', async (deadlineAt) => {
    const ctx = new Context(); contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
    const session = ctx.sessions.create()
    const original = snapshot()
    expect(() => session.append('physics/scene', { ...original, visualization: { status: 'generating', ownerSessionId: String(session.id), sceneId: original.sceneId, sceneRevision: original.revision, jobId: 'invalid-deadline', deadlineAt } })).toThrow()
    expect(ctx.sessionProjections.snapshot(session).values.physicsScenes?.latest).toBeNull()
  })
  it('disposes and refuses a stale scene revision before creating an artifact', async () => {
    const h = dependencies()
    h.start.mockImplementation(async () => {
      h.setLatest({ ...h.original, revision: 3 })
      return { id: 'child', result: Promise.resolve({ stopReason: 'completed', structured: source, output: [] }), dispose: h.dispose }
    })
    expect((await generateQuestionCode(h.deps)).status).toBe('failed')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.states.map(s => s.visualization?.status)).toEqual(['generating'])
    expect(h.dispose).toHaveBeenCalledTimes(1)
  })
  it('bounds validation repair to one fresh run and disposes both child runs', async () => {
    const h = dependencies()
    h.create.mockRejectedValueOnce(Object.assign(new Error('source invalid'), { code: 'INVALID_CODE_SOURCE' }))
    expect((await generateQuestionCode(h.deps)).status).toBe('ready')
    expect(h.start).toHaveBeenCalledTimes(2)
    expect(h.dispose).toHaveBeenCalledTimes(2)
  })
  it('does not let an older job replace a newer completed artifact', async () => {
    const h = dependencies()
    h.start.mockImplementation(async () => {
      h.setLatest({ ...h.original, visualization: { status: 'ready', artifactId: 'newer', ownerSessionId: 'parent', sceneId: h.original.sceneId, sceneRevision: 2, sceneSha256: 'a'.repeat(64), experimentId: 'magnetic-circular', sha256: 'b'.repeat(64), title: 'newer', childSessionId: 'child-2', createdAt: '2026-11-04T00:00:00Z' } })
      return { id: 'child', result: Promise.resolve({ stopReason: 'completed', structured: source, output: [] }), dispose: h.dispose }
    })
    expect((await generateQuestionCode(h.deps)).status).toBe('failed')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.states).toHaveLength(1)
  })
  it('times out a hanging child and waits for its disposal', async () => {
    const h = dependencies()
    h.deps.timeoutMs = 20
    h.start.mockImplementation(async () => ({ id: 'child', result: new Promise(() => {}), dispose: h.dispose }))
    const result = await generateQuestionCode(h.deps)
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.code).toBe('GENERATION_TIMEOUT')
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(h.create).not.toHaveBeenCalled()
  })
  it('aborts without publishing a ready result and releases the real run', async () => {
    const h = dependencies()
    const controller = new AbortController()
    h.deps.signal = controller.signal
    h.start.mockImplementation(async () => { controller.abort(); return { id: 'child', result: Promise.resolve({ stopReason: 'completed', structured: source, output: [] }), dispose: h.dispose } })
    expect((await generateQuestionCode(h.deps)).status).toBe('failed')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.dispose).toHaveBeenCalledTimes(1)
    expect(h.states.at(-1)?.visualization?.status).toBe('failed')
  })
})

const contexts: Context[] = []
const persistenceRoots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of persistenceRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function presentationHost(adapter: MockAdapter, options: AgentOptions = { provider: 'mock', model: 'presentation-test' }): Promise<{
  ctx: Context
  parent: Agent
}> {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'student' })
  await ctx.agentPresets.register({ id: 'student', plugins: [] })
  await ctx.plugin(SubagentRuntime)
  ctx.provide('physicsosIdentity', { sessionOwnerKey: (id: string) => id === 'parent' ? 'school:student' : undefined } as never)
  ctx.provide('questionCodeArtifacts', {
    context: async (id: string) => ({ ...await dependencies().deps.context(id), experimentId: id }),
    create: async (input: Parameters<CodeGenerationDependencies['create']>[0]) => ({
      status: 'ready', artifactId: input.childSessionId, ownerSessionId: input.ownerSessionId,
      sceneId: String((input.scene as PhysicsScene).id), sceneRevision: (input.scene as PhysicsScene).revision,
      sceneSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), experimentId: input.experimentId,
      childSessionId: input.childSessionId, title: input.source.title, createdAt: '2026-11-04T00:00:00Z',
    }),
  } as never)
  await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
  ctx.llm.registerAdapter(['mock'], adapter)
  const handle = await ctx.agents.create({
    sessionId: SessionId('parent'), agentOptions: options,
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'student') },
  })
  return { ctx, parent: handle.agent }
}
describe('the real code child provider', () => {
  it('reaches the model and dispatches with structured_output as its sole tool, even when the parent preset owns physics and question tools', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentPresets, { default: 'student' })
    await ctx.agentPresets.register({ id: 'student', plugins: [{ name: new URL('./fixtures/student-tools.js', import.meta.url).href }] })
    const handle = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'mock' }, setup: async (childCtx) => { await ctx.agentPresets.mount(childCtx, 'student') } })
    const parent = handle.agent
    const adapter = new MockAdapter([toolCallResponse('oversized', 'structured_output', { ...source, title: 'x'.repeat(121) }), toolCallResponse('result', 'structured_output', source)])
    ctx.llm.registerAdapter(['mock'], adapter)
    const provider = new PhysicsCodeProvider(ctx)
    const request = { label: 'question code', parent, signal: new AbortController().signal, prompt: [{ type: 'text' as const, text: 'Render the exact question.' }], outputSchema: { type: 'object' as const, properties: Object.fromEntries(Object.keys(source).map(key => [key, { type: 'string' }])), required: Object.keys(source), additionalProperties: false }, toolFilter: { allow: [] }, maxDepth: 1, descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: CODE_PROVIDER_NAME, label: 'question code' }) }
    const run = await provider.start(request)
    try {
      expect((await run.result).structured).toEqual(source)
      expect(adapter.requests).toHaveLength(2)
      expect(adapter.requests.at(-1)?.tools?.map(t => t.name)).toEqual(['structured_output'])
      expect(ctx.tools.schemas(run.localAgent).map(t => t.name)).toEqual(['structured_output'])
      expect(run.localAgent?.session.snapshotEvents().some(e => e.type === 'agent-preset/selected' && e.data.agentPreset === 'physics-code-only')).toBe(true)
      const denied = await ctx.tools.execute({ name: 'ask_user_question', arguments: {}, signal: request.signal, callId: 'denied' as never, agent: run.localAgent })
      expect(denied.isError).toBe(true)
    } finally { await run.dispose() }
    expect(ctx.agents.get(run.id as never)).toBeUndefined()
    expect(ctx.tools.schemas(parent).map(t => t.name)).toContain('ask_user_question')
  })
  it('cancels a real hanging child and reaches quiescence before returning failure', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentPresets, { default: 'student' })
    await ctx.agentPresets.register({ id: 'student', plugins: [{ name: new URL('./fixtures/student-tools.js', import.meta.url).href }] })
    const handle = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'mock' }, setup: async (childCtx) => { await ctx.agentPresets.mount(childCtx, 'student') } })
    const adapter = new MockAdapter(['hang-slow'])
    ctx.llm.registerAdapter(['mock'], adapter)
    const provider = new PhysicsCodeProvider(ctx)
    const h = dependencies()
    h.deps.timeoutMs = 100
    let childId: string | undefined
    h.deps.start = async (request) => {
      const run = await provider.start({ ...request, parent: handle.agent, descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: CODE_PROVIDER_NAME, label: request.label }) })
      childId = String(run.id)
      return run
    }
    const result = await generateQuestionCode(h.deps)
    expect(result.status === 'failed' && result.code).toBe('GENERATION_TIMEOUT')
    expect(childId).toBeDefined()
    expect(adapter.requests.at(-1)?.tools?.map(t => t.name)).toEqual(['structured_output'])
    expect(ctx.agents.get(childId as never)).toBeUndefined()
    expect(h.create).not.toHaveBeenCalled()
  })
  it('automatically generates after a real engine solve and retains visualization plus engine provenance on the wire', async () => {
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentPresets, { default: 'student' })
    await ctx.agentPresets.register({ id: 'student', plugins: [] })
    await ctx.plugin(SubagentRuntime)
    ctx.provide('physicsosIdentity', { sessionOwnerKey: (id: string) => id === 'parent' ? 'school:student' : undefined } as never)
    const inputs: { scene: unknown }[] = []
    ctx.provide('questionCodeArtifacts', {
      context: async () => ({ experimentId: 'magnetic-circular', developerPrompt: 'latest V3', publishedBody: 'editable prompt', styleVersion: 'latest', baseRenderer: 'base renderer', baseStylesheet: '', allowedAssetPaths: [] }),
      create: async (input: {
        scene: { id: string; revision: number }
        ownerSessionId: string
        experimentId: string
        childSessionId: string
        source: typeof source
      }) => {
        inputs.push(input)
        return { status: 'ready', artifactId: 'private', ownerSessionId: input.ownerSessionId, sceneId: input.scene.id, sceneRevision: input.scene.revision, sceneSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), experimentId: input.experimentId, childSessionId: input.childSessionId, title: input.source.title, createdAt: '2026-11-04T00:00:00Z' }
      },
    } as never)
    const startErrors: string[] = []
    // oxlint-disable-next-line typescript/unbound-method -- The spy preserves the receiver through apply(this, args).
    const ordinaryStart = SubagentRuntime.prototype.start
    const observeStart = vi.spyOn(SubagentRuntime.prototype, 'start').mockImplementation(async function (this: SubagentRuntime, ...args: Parameters<SubagentRuntime['start']>) {
      try { return await ordinaryStart.apply(this, args) }
      catch (error) { startErrors.push(String(error)); throw error }
    })
    await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
    const handle = await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'mock' }, setup: async (childCtx) => { await ctx.agentPresets.mount(childCtx, 'student') } })
    const question = '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。'
    const adapter = new MockAdapter([toolCallResponse('solve', 'physics_solve_question', { text: question }), toolCallResponse('generated', 'structured_output', source), textResponse('本题结果来自物理引擎。')])
    ctx.llm.registerAdapter(['mock'], adapter)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const scenes = handle.agent.session.snapshotEvents().flatMap(e => e.type === 'physics/scene' ? [e.data] : [])
    observeStart.mockRestore()
    expect(startErrors).toEqual([])
    expect(JSON.stringify(scenes[2]?.visualization)).toContain('"status":"ready"')
    expect(scenes.map(e => e.visualization?.status)).toEqual([undefined, 'generating', 'ready'])
    expect(inputs[0]?.scene).toEqual(scenes[0]?.scene)
    expect(scenes[2]?.solve?.answers[0]?.provenance?.engineId).toBe('engine-magnetic')
    const wire = ctx.sessionProjections.snapshot(handle.agent.session).values.physicsScenes
    expect(wire?.scenes[scenes[0]!.sceneId]?.solve).toEqual(scenes[0]?.solve)
    expect(wire?.scenes[scenes[0]!.sceneId]?.visualization?.status).toBe('ready')
    expect(JSON.stringify(scenes)).not.toContain('rendererJs')
    expect(adapter.requests[1]?.tools?.map(t => t.name)).toEqual(['structured_output'])
  })

  it('publishes cold regeneration statuses on the real second parent turn without rewriting first-turn facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'physics-code-cold-turn-'))
    persistenceRoots.push(root)
    const inputs: Parameters<CodeGenerationDependencies['create']>[0][] = []
    async function boot(adapter: MockAdapter): Promise<Context> {
      const ctx = new Context(); contexts.push(ctx)
      await ctx.plugin(Loader); ctx.loader.builtins.include = Include
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(JsonlSessionPersistence, { root })
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(AgentPresets, { default: 'student' })
      await ctx.agentPresets.register({ id: 'student', plugins: [] })
      await ctx.plugin(SubagentRuntime)
      ctx.provide('physicsosIdentity', { sessionOwnerKey: (id: string) => id === 'parent' ? 'school:student' : undefined } as never)
      ctx.provide('questionCodeArtifacts', {
        context: (experimentId: string) => dependencies().deps.context(experimentId),
        create: async (input: Parameters<CodeGenerationDependencies['create']>[0]) => {
          inputs.push(input)
          const scene = input.scene as PhysicsScene
          return {
            status: 'ready', artifactId: `private-${inputs.length}`, ownerSessionId: input.ownerSessionId,
            sceneId: String(scene.id), sceneRevision: scene.revision, sceneSha256: 'a'.repeat(64),
            sha256: String(inputs.length).repeat(64), experimentId: input.experimentId,
            childSessionId: input.childSessionId, title: input.source.title, createdAt: '2026-11-04T00:00:00Z',
          }
        },
      } as never)
      await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
      ctx.llm.registerAdapter(['mock'], adapter)
      return ctx
    }
    const question = '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。'
    const firstAdapter = new MockAdapter([
      toolCallResponse('solve-first', 'physics_solve_question', { text: question }),
      toolCallResponse('code-first', 'structured_output', source), textResponse('第一题已验证。'),
    ])
    const first = await boot(firstAdapter)
    const firstHandle = await first.agents.create({
      sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => { await first.agentPresets.mount(agentCtx, 'student') },
    })
    firstHandle.agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
    await firstHandle.agent.whenIdle()
    const originalEvents = firstHandle.agent.session.snapshotEvents()
    const originalScenes = originalEvents.flatMap(event => event.type === 'physics/scene' ? [event.data] : [])
    const original = originalScenes.at(-1)
    if (original === undefined || original.visualization?.status !== 'ready') throw new Error('First code experiment was not ready')
    expect(originalScenes.map(snapshot => snapshot.turn)).toEqual([1, 1, 1])
    await firstHandle.dispose()
    await first.fiber.dispose()

    const nextAdapter = new MockAdapter([
      toolCallResponse('regenerate-second', 'physics_generate_experiment', { sceneId: original.sceneId }),
      toolCallResponse('code-second', 'structured_output', { ...source, title: '冷重生成' }), textResponse('代码已重新生成。'),
    ])
    const next = await boot(nextAdapter)
    const resumed = await next.agents.resume({
      resumeSessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => { await next.agentPresets.mount(agentCtx, 'student') },
    })
    const regeneratedPrompt = createUserMessage({ content: [{ type: 'text', text: '重新生成本题代码实验。' }], source: { kind: 'user' } })
    resumed.agent.followup(regeneratedPrompt)
    await resumed.agent.whenIdle()
    const restoredEvents = resumed.agent.session.snapshotEvents()
    const newScenes = restoredEvents.slice(originalEvents.length).flatMap(event => event.type === 'physics/scene' ? [event.data] : [])
    expect(restoredEvents.some(event => event.type === 'turn/start' && event.data.turn === 2)).toBe(true)
    expect(newScenes.map(snapshot => snapshot.visualization?.status)).toEqual(['generating', 'ready'])
    expect(newScenes.map(snapshot => snapshot.turn)).toEqual([2, 2])
    expect(restoredEvents.slice(0, originalEvents.length)).toEqual(originalEvents)
    for (const snapshot of newScenes) {
      expect(snapshot.scene).toEqual(original.scene)
      expect(snapshot.solve).toEqual(original.solve)
      expect(snapshot.revision).toBe(original.revision)
      if (snapshot.visualization?.status === 'ready') expect(snapshot.visualization.sceneSha256).toBe(original.visualization.sceneSha256)
    }
    expect(inputs.map(input => input.scene)).toEqual([original.scene, original.scene])
    await resumed.dispose()
  })

  it.each([
    { advertised: ['high', 'off', 'low'], expected: 'off', parentCap: 32768, childCap: 8192 },
    { advertised: ['high', 'medium'], expected: 'high', parentCap: 32768, childCap: 8192 },
    { advertised: ['high', 'low'], expected: 'low', parentCap: 4096, childCap: 4096 },
  ])('uses advertised $expected effort and cap $childCap without changing the main route', async ({ advertised, expected, parentCap, childCap }) => {
    const reasoning: LlmModelReasoningInfo = {
      efforts: advertised.map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId('high'),
    }
    const adapter = new MockAdapter([textResponse('parent idle'), toolCallResponse('child-output', 'structured_output', source)], reasoning)
    const { ctx, parent } = await presentationHost(adapter, {
      provider: 'mock', model: 'presentation-test', reasoningEffort: ReasoningEffortId('high'), maxTokens: parentCap,
    })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: '建立真实主请求头。' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const optionsBefore = { ...parent.options }
    const headerBefore = parent.session.requestHeader()?.config
    const provider = new PhysicsCodeProvider(ctx)
    const run = await provider.start({
      parent, signal: new AbortController().signal, label: 'presentation child', prompt: [{ type: 'text', text: '绘制已验证场景标签。' }],
      outputSchema: { type: 'object', properties: Object.fromEntries(Object.keys(source).map(key => [key, { type: 'string' }])), required: Object.keys(source), additionalProperties: false },
      maxDepth: 1, descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: CODE_PROVIDER_NAME, label: 'presentation child' }),
    })
    try {
      expect((await run.result).structured).toEqual(source)
      expect(adapter.requests[1]?.reasoningEffort).toBe(expected)
      expect(adapter.requests[1]?.maxTokens).toBe(childCap)
      expect(adapter.requests[1]?.provider).toBe(headerBefore?.provider)
      expect(adapter.requests[1]?.model).toBe(headerBefore?.model)
      expect(parent.options).toEqual(optionsBefore)
      expect(parent.session.requestHeader()?.config).toEqual(headerBefore)
    } finally { await run.dispose() }
  })
  it('reuses failed status in the same real turn and allows one manual retry in the next turn', async () => {
    let childCalls = 0
    let mainCalls = 0
    let sceneId = ''
    const respond = (options: GenerateOptions) => {
      if (options.tools?.some(tool => tool.name === 'structured_output')) {
        childCalls++
        return childCalls === 1 ? textResponse('No structured code.') : toolCallResponse('manual-code', 'structured_output', source)
      }
      mainCalls++
      if (mainCalls === 1) return toolCallResponse('solve', 'physics_solve_question', { text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。' })
      sceneId = ctx.sessionProjections.stateOf(parent.session, 'physicsScenes')?.latest ?? ''
      if (mainCalls === 2 || mainCalls === 4) return toolCallResponse(`generate-${mainCalls}`, 'physics_generate_experiment', { sceneId })
      return textResponse('使用手动重新生成入口。')
    }
    const adapter = new MockAdapter(Array.from({ length: 9 }, () => respond))
    const { ctx, parent } = await presentationHost(adapter)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: '解题并生成实验。' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(childCalls).toBe(1)
    expect(ctx.sessionProjections.stateOf(parent.session, 'physicsScenes')?.scenes[sceneId]?.visualization?.status).toBe('failed')
    parent.followup(createUserMessage({ content: [{ type: 'text', text: '手动重新生成。' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(childCalls).toBe(2)
    const events = parent.session.snapshotEvents().flatMap(event => event.type === 'physics/scene' ? [event.data] : [])
    expect(events.filter(snapshot => snapshot.visualization !== undefined).map(snapshot => snapshot.turn)).toEqual([1, 1, 2, 2])
    expect(events.at(-1)?.visualization?.status).toBe('ready')
  })
  it('returns a ready reference on same-turn repetition without starting another child', async () => {
    let childCalls = 0
    let mainCalls = 0
    const respond = (options: GenerateOptions) => {
      if (options.tools?.some(tool => tool.name === 'structured_output')) {
        childCalls++
        return toolCallResponse('ready-code', 'structured_output', source)
      }
      mainCalls++
      if (mainCalls === 1) return toolCallResponse('solve', 'physics_solve_question', { text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。' })
      if (mainCalls === 2) {
        return toolCallResponse('same-turn-ready', 'physics_generate_experiment', { sceneId: ctx.sessionProjections.stateOf(parent.session, 'physicsScenes')?.latest ?? '' })
      }
      return textResponse('代码已就绪。')
    }
    const { ctx, parent } = await presentationHost(new MockAdapter(Array.from({ length: 7 }, () => respond)))
    parent.followup(createUserMessage({ content: [{ type: 'text', text: '生成本题实验。' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(childCalls).toBe(1)
    expect(parent.session.snapshotEvents().filter(event => event.type === 'physics/scene')).toHaveLength(3)
  })

  it('falls back to inherited effort when advisory model metadata lookup fails', async () => {
    const reasoning: LlmModelReasoningInfo = {
      efforts: ['high', 'off'].map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId('high'),
    }
    const adapter = new MockAdapter([toolCallResponse('fallback-code', 'structured_output', source)], reasoning)
    const { ctx, parent } = await presentationHost(adapter, {
      provider: 'mock', model: 'presentation-test', reasoningEffort: ReasoningEffortId('high'), maxTokens: 32768,
    })
    const lookup = vi.spyOn(ctx.llm, 'resolveModelInfo').mockRejectedValueOnce(new Error('Advisory metadata unavailable'))
    const provider = new PhysicsCodeProvider(ctx)
    const run = await provider.start({
      parent, signal: new AbortController().signal, prompt: [{ type: 'text', text: '简短呈现。' }],
      outputSchema: { type: 'object', properties: Object.fromEntries(Object.keys(source).map(key => [key, { type: 'string' }])), required: Object.keys(source), additionalProperties: false },
      maxDepth: 1, descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: CODE_PROVIDER_NAME }),
    })
    try {
      expect((await run.result).structured).toEqual(source)
      expect(adapter.requests[0]?.reasoningEffort).toBe('high')
      expect(adapter.requests[0]?.maxTokens).toBe(8192)
    } finally { await run.dispose(); lookup.mockRestore() }
  })
  it('cancels a hung metadata lookup before child creation and releases its abort listener', async () => {
    const adapter = new MockAdapter([])
    const { ctx, parent } = await presentationHost(adapter)
    const lookup = vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const removed = vi.spyOn(controller.signal, 'removeEventListener')
    const starting = new PhysicsCodeProvider(ctx).start({
      parent, signal: controller.signal, prompt: [{ type: 'text', text: '简短呈现。' }],
      outputSchema: { type: 'object', properties: Object.fromEntries(Object.keys(source).map(key => [key, { type: 'string' }])), required: Object.keys(source), additionalProperties: false },
      maxDepth: 1, descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: CODE_PROVIDER_NAME }),
    })
    await vi.waitFor(() => { expect(lookup).toHaveBeenCalledTimes(1) })
    controller.abort()
    const rejected = await Promise.race([
      starting.then(() => false, () => true), new Promise<boolean>((resolve) => { setTimeout(() => { resolve(false) }, 200) }),
    ])
    expect(rejected).toBe(true)
    expect(ctx.agents.list().filter(agent => agent.session.header.parentSession === parent.id)).toHaveLength(0)
    expect(adapter.requests).toHaveLength(0)
    expect(removed.mock.calls.some(call => call[0] === 'abort')).toBe(true)
    lookup.mockRestore(); removed.mockRestore()
  })
  it('honors an explicitly different style even when a same-turn ready reference exists', async () => {
    let mainCalls = 0
    let childCalls = 0
    const respond = (options: GenerateOptions) => {
      if (options.tools?.some(tool => tool.name === 'structured_output')) {
        childCalls++
        return toolCallResponse('styled-code', 'structured_output', source)
      }
      mainCalls++
      if (mainCalls === 1) return toolCallResponse('solve', 'physics_solve_question', { text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求轨道半径。' })
      if (mainCalls === 2) {
        return toolCallResponse('explicit-style', 'physics_generate_experiment', {
          sceneId: ctx.sessionProjections.stateOf(parent.session, 'physicsScenes')?.latest ?? '', experimentId: 'solenoid-field',
        })
      }
      return textResponse('不同风格已生成。')
    }
    const { ctx, parent } = await presentationHost(new MockAdapter(Array.from({ length: 7 }, () => respond)))
    parent.followup(createUserMessage({ content: [{ type: 'text', text: '本题代码实验。' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(childCalls).toBe(2)
    const latest = ctx.sessionProjections.stateOf(parent.session, 'physicsScenes')?.latest ?? ''
    const state = ctx.sessionProjections.stateOf(parent.session, 'physicsScenes')?.scenes[latest]?.visualization
    expect(state?.status === 'ready' && state.experimentId).toBe('solenoid-field')
  })

})
