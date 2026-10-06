import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PHYSICS_TOOL_NAMES } from '@physicsos/agent-tools'
import { deriveVerificationLevel } from '@physicsos/physics-core'

import * as plugin from '../src/index.ts'
import type { PhysicsSceneSnapshot, PhysicsScenesProjection, PhysicsSolveTrace, PhysicsSolveTracesProjection } from '../src/types.ts'

/**
 * Drives the REAL plugin body on a real `ToolRuntime`: every call goes through
 * `ctx.tools.execute`, so argument validation, output validation and error
 * normalization are the shipping registry's, and every number comes out of the
 * PhysicsOS engines behind `@physicsos/agent-tools`.
 */

const signal = new AbortController().signal
let callCounter = 0

function agentWithSession(id: string): Agent {
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent
}

async function setup(config: Partial<plugin.Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(plugin, { sceneScope: 'session', maxScenes: 64, ...config })
  return ctx
}

interface CallOptions {
  agent?: Agent | undefined
}

async function call(ctx: Context, name: string, args: unknown, options: CallOptions = {}) {
  const agent = 'agent' in options ? options.agent : agentWithSession('student-1')
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`physics-call-${++callCounter}`),
    name,
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the shape it reads
function value<T>(result: { isError: boolean; value?: unknown; content: { type: string; text?: string }[] }): T {
  if (result.isError) throw new Error(`expected success, got: ${text(result)}`)
  return result.value as T
}

interface SceneDescription {
  sceneId: string
  revision: number
  domain: string
  objects: { id: string; kind: string }[]
  commands: string[]
}

async function openExperiment(ctx: Context, templateId: string, agent?: Agent): Promise<SceneDescription> {
  const result = await call(ctx, 'physics_create_experiment', { templateId }, agent === undefined ? {} : { agent })
  return value<SceneDescription>(result)
}

describe('dsh-tool-physicsos', () => {
  it('registers exactly the seven physics_* tools with the runtime\'s own descriptions', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('physics_'))
    expect(names.sort()).toEqual([...PHYSICS_TOOL_NAMES].sort())
    const command = ctx.tools.schemas().find(schema => schema.name === 'physics_scene_command')!
    expect(command.description).toContain('SetWaveHarmonic')
    const params = command.parameters as { properties: Record<string, { enum?: string[] }>; required?: string[] }
    expect(params.required?.sort()).toEqual(['payload', 'sceneId', 'type'])
    expect(params.properties.type?.enum).toContain('SetMagneticFieldStrength')
  })

  it('lists the experiment catalog as canonical JSON and renders the runtime\'s text for the model', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'physics_list_experiments', {})
    const listing = value<{ id: string; domain: string }[]>(result)
    expect(listing.length).toBeGreaterThan(30)
    expect(listing.some(entry => entry.id === 'magnetic-circular')).toBe(true)
    expect(JSON.parse(JSON.stringify(listing))).toEqual(listing)
    expect(text(result)).toContain(`共 ${listing.length} 个实验`)
    expect(text(result)).toContain('magnetic-circular')
  })

  it('opens an experiment, simulates it through the engine and reads the verified orbit', async () => {
    const ctx = await setup()
    const scene = await openExperiment(ctx, 'magnetic-circular')
    expect(scene.revision).toBe(0)
    expect(scene.domain).toBe('magnetic')

    const simulation = value<{
      engineId: string
      verification: { status: string }
      derived: { key: string; value: number | null; unit: string }[]
    }>(await call(ctx, 'physics_simulate', { sceneId: scene.sceneId }))
    expect(simulation.engineId).toBe('engine-magnetic')
    expect(simulation.verification.status).toBe('passed')
    const radius = simulation.derived.find(entry => entry.key === 'cyclotron_radius')
    expect(radius?.value).toBeCloseTo((1.67e-27 * 2e6) / (1.6e-19 * 0.5), 6)
    expect(radius?.unit).toBe('m')
    /* The model reads the runtime's text projection of that same value, units and verdict included. */
    const rendered = text(await call(ctx, 'physics_simulate', { sceneId: scene.sceneId }))
    expect(rendered).toContain('模拟完成')
    expect(rendered).toContain('engine-magnetic')
    expect(rendered).toContain('校验：passed')
    expect(rendered).toMatch(/cyclotron_radius = 0\.04175 m/)
  })

  it('applies a SceneCommand as a real revision and the next simulation reflects it', async () => {
    const ctx = await setup()
    const scene = await openExperiment(ctx, 'magnetic-circular')
    const field = scene.objects.find(object => object.kind === 'uniform_magnetic')!
    const applied = value<{ ok: boolean; revision: number; eventType?: string }>(
      await call(ctx, 'physics_scene_command', {
        sceneId: scene.sceneId,
        type: 'SetMagneticFieldStrength',
        payload: { fieldId: field.id, strength: { value: 1, unit: 'T' } },
      }),
    )
    expect(applied).toEqual({ ok: true, sceneId: scene.sceneId, revision: 1, eventType: 'MagneticFieldStrengthChanged' })
    const simulation = value<{ revision: number; derived: { key: string; value: number | null }[] }>(
      await call(ctx, 'physics_simulate', { sceneId: scene.sceneId }),
    )
    expect(simulation.revision).toBe(1)
    expect(simulation.derived.find(entry => entry.key === 'cyclotron_radius')?.value)
      .toBeCloseTo((1.67e-27 * 2e6) / (1.6e-19 * 1), 6)
  })

  it('returns a refused command as a successful ok:false value, not as a tool error', async () => {
    const ctx = await setup()
    const scene = await openExperiment(ctx, 'wave-standing')
    const bench = scene.objects.find(object => object.kind.startsWith('wave_bench'))!
    const result = await call(ctx, 'physics_scene_command', {
      sceneId: scene.sceneId,
      type: 'SetWaveFrequency',
      payload: { benchId: bench.id, frequency: { value: 30, unit: 'Hz' } },
    })
    expect(result.isError).toBe(false)
    const refused = result.value as { ok: boolean; error?: { code: string } }
    expect(refused.ok).toBe(false)
    expect(refused.error?.code).toBe('WAVE_WRONG_SUBMODEL')
  })

  it('rejects a command type outside the frozen SceneCommand list at the schema boundary', async () => {
    const ctx = await setup()
    const scene = await openExperiment(ctx, 'series-circuit')
    const result = await call(ctx, 'physics_scene_command', { sceneId: scene.sceneId, type: 'SetWarpFactor', payload: {} })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('type')
  })

  it('reads the engine state at a time', async () => {
    const ctx = await setup()
    const scene = await openExperiment(ctx, 'projectile-horizontal')
    const observed = value<{ time: number; objects: { position?: { x: number; y: number } }[] }>(
      await call(ctx, 'physics_observe', { sceneId: scene.sceneId, time: 1 }),
    )
    const body = observed.objects.find(object => object.position !== undefined)!
    expect(body.position!.x).toBeCloseTo(10, 9)
    expect(body.position!.y).toBeCloseTo(20 - 0.5 * 9.8, 9)
  })

  it('solves a question through the Question Runtime and registers its scene for follow-ups', async () => {
    const ctx = await setup()
    const solved = value<{ status: string; answers: { key: string }[]; scene?: { sceneId: string } }>(
      await call(ctx, 'physics_solve_question', {
        text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期 4. 判断运动方向 5. 显示运动轨迹',
      }),
    )
    expect(solved.status).toBe('solved')
    expect(solved.answers.length).toBeGreaterThan(0)
    expect(solved.scene?.sceneId).toBeDefined()
    const described = value<SceneDescription>(await call(ctx, 'physics_describe_scene', { sceneId: solved.scene!.sceneId }))
    expect(described.domain).toBe('magnetic')
  })

  it('surfaces runtime refusals as coded tool errors the model and observers can route on', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'physics_describe_scene', { sceneId: 'ghost' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('SCENE_NOT_FOUND')
    expect(result.error?.info?.name).toBe('PhysicsToolCallError')
    expect(text(result)).toContain('[SCENE_NOT_FOUND]')
    const unknown = await call(ctx, 'physics_create_experiment', { templateId: 'no-such-rig' })
    expect(unknown.error?.info?.code).toBe('UNKNOWN_EXPERIMENT')
  })

  it('rejects malformed arguments before any runtime call', async () => {
    const ctx = await setup()
    const missing = await call(ctx, 'physics_simulate', {})
    expect(missing.isError).toBe(true)
    const wrongType = await call(ctx, 'physics_observe', { sceneId: 'x', time: 'now' })
    expect(wrongType.isError).toBe(true)
  })

  it('keeps scenes per agent session by default and shares them under sceneScope: process', async () => {
    const perSession = await setup()
    const alice = agentWithSession('alice')
    const bob = agentWithSession('bob')
    const scene = await openExperiment(perSession, 'uniform-linear', alice)
    expect((await call(perSession, 'physics_describe_scene', { sceneId: scene.sceneId }, { agent: alice })).isError).toBe(false)
    const crossed = await call(perSession, 'physics_describe_scene', { sceneId: scene.sceneId }, { agent: bob })
    expect(crossed.isError).toBe(true)
    expect(crossed.error?.info?.code).toBe('SCENE_NOT_FOUND')

    const shared = await setup({ sceneScope: 'process' })
    const sharedScene = await openExperiment(shared, 'uniform-linear', alice)
    expect((await call(shared, 'physics_describe_scene', { sceneId: sharedScene.sceneId }, { agent: bob })).isError).toBe(false)
  })

  it('serves agent-less callers from one anonymous scope', async () => {
    const ctx = await setup()
    const scene = value<SceneDescription>(
      await call(ctx, 'physics_create_experiment', { templateId: 'incline' }, { agent: undefined }),
    )
    expect((await call(ctx, 'physics_describe_scene', { sceneId: scene.sceneId }, { agent: undefined })).isError).toBe(false)
  })

  it('unregisters every tool when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(plugin, { sceneScope: 'session', maxScenes: 64 })
    expect(ctx.tools.schemas().some(schema => schema.name === 'physics_simulate')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name.startsWith('physics_'))).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in plugin).toBe(false)
    expect(plugin.name).toBe('tool-physicsos')
    expect(plugin.inject).toEqual(['tools'])
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(typeof unwrapped.apply).toBe('function')
  })
})

/**
 * Scene mirroring (docs/04 §92 SceneRevisionChanged): every tool call that
 * creates or moves a scene appends a `physics/scene` snapshot to the calling
 * agent's session log, and the `physicsScenes` projection folds them so the
 * browser Lab can mount the scene without reaching into the host process.
 */
async function benchWithSession(): Promise<{ ctx: Context; session: Session; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(plugin, { sceneScope: 'session', maxScenes: 64 })
  const session = ctx.sessions.create()
  const agent = { id: session.id, session } as unknown as Agent
  return { ctx, session, agent }
}

describe('dsh-tool-physicsos scene mirroring', () => {
  const bench = benchWithSession

  const snapshots = (session: Session): PhysicsSceneSnapshot[] =>
    session.snapshotEvents().flatMap(event => (event.type === 'physics/scene' ? [event.data] : []))

  const projectionOf = (ctx: Context, session: Session): PhysicsScenesProjection | undefined =>
    ctx.sessionProjections.snapshot(session).values.physicsScenes

  it('publishes the created scene with its embedded PhysicsScene and folds it into physicsScenes', async () => {
    const { ctx, session, agent } = await bench()
    expect(projectionOf(ctx, session)).toEqual({ latest: null, scenes: {} })

    const scene = await openExperiment(ctx, 'magnetic-circular', agent)
    const published = snapshots(session)
    expect(published).toHaveLength(1)
    const snapshot = published[0]!
    expect(snapshot).toMatchObject({
      sceneId: scene.sceneId,
      revision: 0,
      domain: 'magnetic',
      engineId: 'engine-magnetic',
      cause: 'created',
    })
    const embedded = snapshot.scene as { id: string; revision: number; schemaVersion: string; particles: unknown[] }
    expect(embedded.schemaVersion).toBe('physics-scene/1.0')
    expect(embedded.id).toBe(scene.sceneId)
    expect(embedded.revision).toBe(0)
    expect(embedded.particles).toHaveLength(1)
    /* Lossless JSON: what the log carries is what the wire and the Lab receive. */
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)

    const projection = projectionOf(ctx, session)
    expect(projection?.latest).toBe(scene.sceneId)
    expect(projection?.scenes[scene.sceneId]).toEqual(snapshot)
  })

  it('publishes each accepted command at its new revision, and nothing for a refused one', async () => {
    const { ctx, session, agent } = await bench()
    const scene = await openExperiment(ctx, 'magnetic-circular', agent)
    const field = scene.objects.find(object => object.kind === 'uniform_magnetic')!
    await call(ctx, 'physics_scene_command', {
      sceneId: scene.sceneId,
      type: 'SetMagneticFieldStrength',
      payload: { fieldId: field.id, strength: { value: 1, unit: 'T' } },
    }, { agent })
    const afterAccepted = snapshots(session)
    expect(afterAccepted).toHaveLength(2)
    expect(afterAccepted[1]).toMatchObject({
      sceneId: scene.sceneId,
      revision: 1,
      cause: 'command',
      commandType: 'SetMagneticFieldStrength',
      eventType: 'MagneticFieldStrengthChanged',
    })
    interface EmbeddedScene {
      revision: number
      fields: { type: string; magneticFluxDensity?: { vector: { z: number } } }[]
    }
    const embedded = afterAccepted[1]!.scene as unknown as EmbeddedScene
    expect(embedded.revision).toBe(1)
    const magnetic = embedded.fields.find(entry => entry.type === 'uniform_magnetic')!
    expect(Math.abs(magnetic.magneticFluxDensity!.vector.z)).toBe(1)

    /* A refusal keeps the scene at revision 1 and appends no snapshot. */
    await call(ctx, 'physics_scene_command', {
      sceneId: scene.sceneId,
      type: 'SetParticleMass',
      payload: { particleId: 'particle-1', mass: { value: -1, unit: 'kg' } },
    }, { agent })
    expect(snapshots(session)).toHaveLength(2)
    expect(projectionOf(ctx, session)?.scenes[scene.sceneId]?.revision).toBe(1)
  })

  it('publishes a solved question\'s scene and keeps every touched scene in the projection, latest last', async () => {
    const { ctx, session, agent } = await bench()
    const first = await openExperiment(ctx, 'uniform-linear', agent)
    const solved = value<{ scene?: { sceneId: string } }>(await call(ctx, 'physics_solve_question', {
      text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期 4. 判断运动方向 5. 显示运动轨迹',
    }, { agent }))
    const questionSceneId = solved.scene!.sceneId
    const published = snapshots(session)
    expect(published.map(entry => entry.cause)).toEqual(['created', 'solved'])
    expect(published[1]!.sourceQuestionId).toBeDefined()
    /* The solved snapshot carries the structured solve so the chat card can
       render knowns/steps/verification without re-running the question. */
    const solve = published[1]!.solve!
    expect(solve.knowns.map(known => known.symbol)).toContain('q')
    expect(solve.targets).toContain('radius')
    expect(solve.answers.length).toBeGreaterThan(0)
    expect(solve.steps.length).toBeGreaterThan(0)
    expect(solve.verification?.status).toBe('passed')
    expect(solve.goldenQuestionId).toBe('01-proton-basic')
    /* Every answer carries the simulation's canonical provenance — engine,
       revision, verifier and the checks that passed — so the client names the
       engine behind the number instead of the scene domain. */
    const answer = solve.answers[0]
    if (answer === undefined) throw new Error('solved snapshot has no answer')
    const provenance = answer.provenance
    if (provenance === null) throw new Error('solved answer carries no provenance')
    expect(provenance.engineId).toBe('engine-magnetic')
    expect(provenance.engineVersion).not.toBe('')
    expect(provenance.verifierId).toBe('physics-verifier')
    expect(provenance.sceneRevision).toBe(0)
    expect(provenance.evidence.length).toBeGreaterThan(0)
    expect(provenance.evidence.every(entry => entry.passed)).toBe(true)
    expect(provenance.verificationLevel).toBe(
      deriveVerificationLevel(provenance.evidence),
    )
    const projection = projectionOf(ctx, session)!
    expect(Object.keys(projection.scenes).sort()).toEqual([first.sceneId, questionSceneId].sort())
    expect(projection.latest).toBe(questionSceneId)
  })

  it('keeps the golden link when questionId accompanies a paraphrased stem', async () => {
    const { ctx, session, agent } = await bench()
    /* The practice hand-off wraps the stem in instructions; the model may not
       echo it verbatim, so the bank identity travels in `questionId`. */
    const solved = value<{ goldenQuestionId?: string; status: string }>(
      await call(ctx, 'physics_solve_question', {
        text: '质子在匀强磁场中做圆周运动，已知速度、磁场、质量和电荷量，求半径与周期。',
        questionId: '01-proton-basic',
      }, { agent }),
    )
    expect(solved.status).toBe('solved')
    expect(solved.goldenQuestionId).toBe('01-proton-basic')
    const published = snapshots(session)
    expect(published[0]!.cause).toBe('solved')
    expect(published[0]!.solve!.goldenQuestionId).toBe('01-proton-basic')
  })

  it('publishes nothing for agent-less callers, which have no session log', async () => {
    const { ctx, session } = await bench()
    const scene = value<SceneDescription>(
      await call(ctx, 'physics_create_experiment', { templateId: 'incline' }, { agent: undefined }),
    )
    expect(scene.revision).toBe(0)
    expect(snapshots(session)).toHaveLength(0)
  })

  it('folds last-wins per scene id with latest following the newest snapshot', () => {
    const a = { sceneId: 'a', revision: 0, domain: 'mechanics', engineId: 'engine-mechanics', title: 'A', cause: 'created', scene: {} } as const
    const b = { ...a, sceneId: 'b' } as const
    const a1 = { ...a, revision: 1, cause: 'command' } as const
    const state0 = { latest: null, scenes: {} }
    const state1 = plugin.foldPhysicsScene(state0, a)
    const state2 = plugin.foldPhysicsScene(state1, b)
    const state3 = plugin.foldPhysicsScene(state2, a1)
    expect(state3).toEqual({ latest: 'a', scenes: { a: a1, b } })
    expect(state0).toEqual({ latest: null, scenes: {} })
  })
})

/**
 * Solve tracing: every `physics_solve_question` attempt — solved OR rejected —
 * appends a `physics/solve-trace` event with run-level diagnostics, and the
 * `physicsSolveTraces` projection folds them into a bounded newest-last tail.
 * The scene mirror only carries READY solves; the trace is what keeps rejected
 * attempts (parse failures, verification failures) visible in the session log.
 */
describe('dsh-tool-physicsos solve tracing', () => {
  const bench = benchWithSession

  const traces = (session: Session): PhysicsSolveTrace[] =>
    session.snapshotEvents().flatMap(event => (event.type === 'physics/solve-trace' ? [event.data] : []))

  const projectionOf = (ctx: Context, session: Session): PhysicsSolveTracesProjection | undefined =>
    ctx.sessionProjections.snapshot(session).values.physicsSolveTraces

  it('appends a solved trace with the engine verdict and folds it into physicsSolveTraces', async () => {
    const { ctx, session, agent } = await bench()
    expect(projectionOf(ctx, session)).toEqual({ traces: [] })

    const solved = value<{ scene?: { sceneId: string } }>(await call(ctx, 'physics_solve_question', {
      text: '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期 4. 判断运动方向 5. 显示运动轨迹',
    }, { agent }))
    const published = traces(session)
    expect(published).toHaveLength(1)
    const trace = published[0]!
    expect(trace).toMatchObject({
      status: 'solved',
      workflowState: 'READY',
      domain: 'magnetic',
      goldenQuestionId: '01-proton-basic',
      attempt: 1,
      sceneId: solved.scene!.sceneId,
    })
    expect(trace.verification).toMatchObject({ status: 'passed', failed: [] })
    expect(trace.verification!.passed).toBe(trace.verification!.total)
    expect(trace.verification!.total).toBeGreaterThan(0)
    expect(trace.answers.length).toBeGreaterThan(0)
    expect(trace.retryGuidance).toHaveLength(0)
    expect(trace.durationMs).toBeGreaterThanOrEqual(0)
    /* Lossless JSON: what the log carries is what the wire receives. */
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace)

    expect(projectionOf(ctx, session)?.traces).toEqual([trace])
  })

  it('appends a rejected trace with retry-guidance codes — rejected attempts stay in the log too', async () => {
    const { ctx, session, agent } = await bench()
    const result = value<{ status: string }>(await call(ctx, 'physics_solve_question', {
      text: '声音的音调是由什么决定的？请说明。', // 概念题：解析器必须拒收而不是编数字
    }, { agent }))
    expect(result.status).toBe('rejected')
    const trace = traces(session)[0]!
    expect(trace.status).toBe('rejected')
    expect(trace.workflowState).toBe('PARSE_FAILED')
    expect(trace.verification).toBeUndefined()
    expect(trace.answers).toHaveLength(0)
    expect(trace.retryGuidance.map(hint => hint.code)).toContain('RETRY_REWRITE_STEM')
    expect(trace.issues.length).toBeGreaterThan(0)
    expect(projectionOf(ctx, session)?.traces).toHaveLength(1)
  })

  it('folds traces newest-last and caps the tail at SOLVE_TRACES_CAP', () => {
    const base: PhysicsSolveTrace = {
      status: 'rejected',
      workflowState: 'PARSE_FAILED',
      answers: [],
      issues: [],
      retryGuidance: [],
      durationMs: 1,
    }
    let state = { traces: [] }
    for (let index = 0; index < plugin.SOLVE_TRACES_CAP + 2; index += 1) {
      state = plugin.foldPhysicsSolveTrace(state, { ...base, workflowState: `attempt-${index}` })
    }
    expect(state.traces).toHaveLength(plugin.SOLVE_TRACES_CAP)
    expect(state.traces[0]!.workflowState).toBe('attempt-2')
    const newest = state.traces[plugin.SOLVE_TRACES_CAP - 1]!
    expect(newest.workflowState).toBe(`attempt-${plugin.SOLVE_TRACES_CAP + 1}`)
  })
})
