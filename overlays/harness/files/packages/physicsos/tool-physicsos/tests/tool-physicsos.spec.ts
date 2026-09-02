import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PHYSICS_TOOL_NAMES } from '@physicsos/agent-tools'

import * as plugin from '../src/index.ts'

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
  await ctx.plugin(plugin, { sceneScope: 'session', ...config })
  return ctx
}

interface CallOptions {
  agent?: Agent | undefined
}

async function call(ctx: Context, name: string, args: unknown, options: CallOptions = {}) {
  const agent = 'agent' in options ? options.agent : agentWithSession('student-1')
  return ctx.tools.execute({
    signal,
    callId: CallId(`physics-call-${++callCounter}`),
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
        text: '一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期',
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
    const fiber = await ctx.plugin(plugin, { sceneScope: 'session' })
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
