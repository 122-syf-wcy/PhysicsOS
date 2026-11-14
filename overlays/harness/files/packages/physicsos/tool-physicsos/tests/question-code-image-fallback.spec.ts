import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { QuestionCodeAssets } from '../../experiment-host/src/question-code-assets.ts'
import { QuestionCodeArtifactService } from '../../experiment-host/src/question-code-service.ts'
import { openQuestionCodeDomain } from '../../experiment-host/src/question-code-domain.ts'
import { host } from '../../experiment-host/tests/support.ts'
import { contributor } from '../../experiment-host/tests/fixtures.ts'
import * as physicsTools from '../src/index.ts'
import { PhysicsCodeProvider, CODE_PROVIDER_NAME } from '../src/code-provider.ts'
import { questionCodePrompt } from '../src/question-code-prompt.ts'
import type { PhysicsSceneSnapshot } from '../src/types.ts'

/* The physics/scene event payload is plain JSON. PhysicsScene is structurally
   JSON but its interface declares no index signature, so assert at this seam. */
const appendScene = (value: unknown) => value as never


const disposals: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })
const source = { title: '原生题目画面', summary: '仅绘制引擎几何', stylesheet: '',
  rendererJs: `export function renderFrame(snapshot) {
    const canvas = document.createElement('canvas'); document.getElementById('canvas').replaceChildren(canvas);
    const ctx = canvas.getContext('2d');
    for (const item of snapshot.view.opticalObjects || []) { ctx.beginPath(); ctx.arc(item.at.x,item.at.y,3,0,Math.PI*2); ctx.fill(); }
  }` }
const writes = () => [
  toolCallResponse('js', 'physics_write_experiment_code', { file: 'rendererJs', mode: 'replace', content: source.rendererJs }),
  toolCallResponse('css', 'physics_write_experiment_code', { file: 'stylesheet', mode: 'replace', content: source.stylesheet }),
  toolCallResponse('done', 'structured_output', { title: source.title, summary: source.summary }),
]
async function setup(adapter: MockAdapter, fetchImpl: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'code-child-image-fallback-'))
  const loaded = await host(root), domain = await openQuestionCodeDomain(loaded.ctx)
  const artifacts = new QuestionCodeArtifactService(domain, { root: join(root, 'private'),
    imageAssets: new QuestionCodeAssets({ env: { PHYSICSOS_IMAGE_API_KEY: 'fixture-key' }, fetchImpl }),
    identity: () => ({ actorOf: () => contributor, record: async () => {}, sessionOwnerKey: () => contributor.userKey }) })
  disposals.push(async () => { await artifacts.close(); await domain.close(); await loaded.close(); await rm(root, { recursive: true, force: true }) })
  await artifacts.initialize()
  const ctx = new Context(); disposals.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'student' })
  await ctx.agentPresets.register({ id: 'student', plugins: [] })
  await ctx.plugin(SubagentRuntime)
  ctx.provide('physicsosIdentity', { sessionOwnerKey: () => contributor.userKey } as never)
  ctx.provide('questionCodeArtifacts', artifacts)
  await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = (await ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: { provider: 'mock', model: 'image-fallback-test' },
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'student') } })).agent
  const scene = createConvexLensScene({ sceneId: 'exact-child-question', focalLength: 23, objectDistance: 62, now: '2026-11-08T00:00:00.000Z' })
  const snapshot: PhysicsSceneSnapshot = { sceneId: scene.id, revision: scene.revision, domain: 'optics', engineId: 'engine-optics',
    title: '本题透镜', cause: 'solved', turn: 1, scene: appendScene(scene) }
  parent.session.append('physics/scene', { ...snapshot, scene: appendScene(scene), visualization: { status: 'generating', jobId: 'image-job', ownerSessionId: 'parent',
    sceneId: scene.id, sceneRevision: scene.revision, deadlineAt: Date.now() + 600_000 } })
  const start = () => new PhysicsCodeProvider(ctx).start({ parent, signal: new AbortController().signal,
    label: 'native image fallback', prompt: [{ type: 'text', text: '仅绘制本题引擎几何。' }], maxDepth: 1,
    outputSchema: { type: 'object', properties: Object.fromEntries(Object.keys(source).map(key => [key, { type: 'string' }])), required: Object.keys(source) },
    descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: CODE_PROVIDER_NAME, label: 'native image fallback' }) })
  return { ctx, artifacts, scene, start }
}
it('returns trusted native fallback through the real child image tool and still commits complete code', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('image', 'physics_generate_experiment_asset', { prompt: 'Warm Lab wood without text', kind: 'environment' }), ...writes(),
  ])
  const h = await setup(adapter, async () => new Response('private upstream details', { status: 504 }))
  const results: { isError: boolean; value?: unknown }[] = []
  h.ctx.on('tools/result', (exec, result) => { if (exec.name === 'physics_generate_experiment_asset') results.push(result) }, { global: true })
  const run = await h.start()
  try {
    expect((await run.result).structured).toEqual(source)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ isError: false, value: { status: 'unavailable', mode: 'native', code: 'IMAGE_SERVICE_UNAVAILABLE' } })
    expect(JSON.stringify(results)).not.toContain('private upstream details')
  } finally { await run.dispose() }
})
it('keeps a spoofed timeout error as a child tool failure without native permission', async () => {
  const adapter = new MockAdapter([
    toolCallResponse('image', 'physics_generate_experiment_asset', { prompt: 'Warm Lab wood without text', kind: 'environment' }), ...writes(),
  ])
  const h = await setup(adapter, async () => { throw new Error('IMAGE_TIMEOUT') })
  const results: { isError: boolean; value?: unknown }[] = []
  h.ctx.on('tools/result', (exec, result) => { if (exec.name === 'physics_generate_experiment_asset') results.push(result) }, { global: true })
  const run = await h.start()
  try { await run.result; expect(results[0]?.isError).toBe(true); expect(results[0]?.value).toBeUndefined() }
  finally { await run.dispose() }
})
it('offers only code submission when this exact generation already has trusted native fallback', async () => {
  const adapter = new MockAdapter(writes()), h = await setup(adapter, async () => new Response('', { status: 429 }))
  await h.artifacts.generateAsset({ ownerSessionId: 'parent', generationId: 'image-job', scene: h.scene,
    prompt: 'Warm Lab wood without text', kind: 'environment', signal: new AbortController().signal }).catch(() => undefined)
  const run = await h.start()
  try {
    expect((await run.result).structured).toEqual(source)
    expect(adapter.requests[0]?.tools?.map(tool => tool.name).sort()).toEqual(['physics_write_experiment_code', 'structured_output'])
  } finally { await run.dispose() }
})
it('gives a runnable native entry example without waiting for an unavailable image', async () => {
  const scene = createConvexLensScene(), snapshot: PhysicsSceneSnapshot = { sceneId: scene.id, revision: scene.revision,
    domain: 'optics', engineId: 'engine-optics', title: '本题', cause: 'solved', turn: 1, scene: appendScene(scene) }
  const prompt = questionCodePrompt({ experimentId: 'convex-lens', developerPrompt: '', publishedBody: '', styleVersion: 'test',
    renderContract: 'snapshot.view is read-only', allowedAssetPaths: [] }, snapshot, undefined, undefined, [])
  const entry = prompt.slice(prompt.indexOf('export async function renderFrame'), prompt.indexOf('只读snapshot.view'))
  const drawn: { x: number; y: number }[] = []
  const ctx = { setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, fill() {},
    arc(x: number, y: number) { drawn.push({ x, y }) } }
  const board = { width: 0, height: 0, style: {}, getContext: () => ctx }
  const host = { clientWidth: 240, clientHeight: 360, replaceChildren() {} }
  const render = runInNewContext(`${entry.replace('export ', '')}\nfunction drawScene(ctx,view,t,labels) {
    for (const item of view.opticalObjects) { ctx.beginPath(); ctx.arc(item.at.x,item.at.y,3,0,Math.PI*2); ctx.fill(); }
  };renderFrame`, { document: { getElementById: () => host, createElement: () => board }, devicePixelRatio: 1 }) as (snapshot: unknown) => Promise<void>
  await render({ view: { extent: { width: 100, height: 80 }, origin: { x: 0, y: 0 }, bodies: [], opticalObjects: [{ at: { x: 23, y: 62 } }] } })
  expect(drawn).toEqual([{ x: 23, y: 62 }])
})
