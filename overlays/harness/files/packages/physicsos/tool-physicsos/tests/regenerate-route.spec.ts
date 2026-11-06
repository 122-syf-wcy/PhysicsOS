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
    context: (experimentId: string) => Promise.resolve(questionCodeContext(experimentId, { current: () => PROMPT_SEED })),
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
    expect(regenerated?.status === 'ready' ? regenerated.artifactId : undefined).toBe('private-2')
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
