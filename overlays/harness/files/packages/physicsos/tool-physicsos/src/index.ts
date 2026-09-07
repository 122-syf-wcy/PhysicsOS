/**
 * PhysicsOS physics tools for the DeepSeek Harness agent.
 *
 * Thin glue only: every tool body forwards to `PhysicsToolRuntime` from
 * `@physicsos/agent-tools` (the harness-independent runtime over PhysicsScene,
 * the engines and the Question Runtime) and hands its plain-data result back
 * as the canonical tool value. Names, descriptions AND the model-facing text
 * projection come from the runtime (`PHYSICS_TOOL_DOCS`, `PHYSICS_TOOL_RENDERERS`),
 * so every harness binding presents the same contract and the same wording to
 * the model. No physics is computed here (docs/02 §3, §4).
 *
 * Named exports preserve loader injection metadata (`name` / `inject` / `apply`).
 * @module @deepseek-ai/dsh-tool-physicsos
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  COMMAND_TYPES,
  DEFAULT_MAX_SCENES,
  PHYSICS_TOOL_DOCS,
  PHYSICS_TOOL_NAMES,
  PHYSICS_TOOL_RENDERERS,
  PhysicsToolRuntime,
  ToolRuntimeError,
  type CommandResult,
  type PhysicsToolName,
  type SceneDescription,
} from '@physicsos/agent-tools'
import type { PhysicsSceneSnapshot, PhysicsSceneSnapshotCause, PhysicsScenesProjection } from './types.ts'

// The `physics/scene` event and `physicsScenes` projection-key declarations
// live in src/types.ts (their one home); this re-export projects the type face
// onto the package root AND keeps the module edge in the emitted index.d.ts.
export type * from './types.ts'

export const name = 'tool-physicsos'
export const inject = ['tools']

/** Plugin configuration. */
export interface Config {
  /**
   * Who may see whose scenes. `session` (default) keeps one PhysicsToolRuntime
   * per agent session so a student's experiments never leak into another
   * session; `process` shares one runtime across every session on this host.
   */
  sceneScope: 'session' | 'process'
  /** Live scenes kept per runtime before the oldest is dropped (runtime default 64). */
  maxScenes: number
}

/** Schemastery configuration for the plugin row. */
export const Config: z<Config> = z.object({
  sceneScope: z.union(['session', 'process']).default('session'),
  maxScenes: z.number().min(1).step(1).default(DEFAULT_MAX_SCENES),
})

/** Model-facing tool names this plugin registers (the runtime's own list). */
export const TOOL_NAMES: readonly string[] = PHYSICS_TOOL_NAMES

/** Key under which scenes of agent-less callers (tests, Code Mode without an agent) are held. */
const ANONYMOUS_SCOPE = '__anonymous__'

/**
 * Tool failure carrying the runtime's stable code (`SCENE_NOT_FOUND`,
 * `UNKNOWN_EXPERIMENT`, …) so `tools/result` observers and the model both see
 * WHY the call failed, not just that it did.
 */
export class PhysicsToolCallError extends HarnessError {
  constructor(error: ToolRuntimeError) {
    super(`[${error.code}] ${error.message}`, error.code, { cause: error })
    this.name = 'PhysicsToolCallError'
  }
}

/** The runtime's text projection of one canonical value, as the single model-visible block. */
const renderFor = (tool: PhysicsToolName) => (_args: unknown, value: unknown): ContentBlock[] => [
  { type: 'text', text: PHYSICS_TOOL_RENDERERS[tool](value) },
]

/** Any lossless-JSON object: the runtime returns plain data and its tests pin the round trip. */
const ANY_OBJECT = { type: 'object', additionalProperties: true } as const

type AnyObject = Record<string, JsonValue>

/** Wrap a runtime call so its coded refusals reach the registry as HarnessErrors. */
const guarded = <T>(work: () => T): T => {
  try {
    return work()
  } catch (error: unknown) {
    if (error instanceof ToolRuntimeError) throw new PhysicsToolCallError(error)
    throw error
  }
}

/** Wire schema of the `physicsScenes` projection: whole scenes ride as lossless JSON. */
const physicsScenesProjectionSchema: ZodType<PhysicsScenesProjection> = zod.object({
  latest: zod.union([zod.string(), zod.null()]),
  scenes: zod.record(zod.string(), zod.object({
    sceneId: zod.string(),
    revision: zod.number().int().nonnegative(),
    domain: zod.string(),
    engineId: zod.string(),
    title: zod.string(),
    cause: zod.union([zod.literal('created'), zod.literal('solved'), zod.literal('command')]),
    commandType: zod.string().optional(),
    eventType: zod.string().optional(),
    sourceQuestionId: zod.string().optional(),
    scene: zod.custom<JsonValue>(() => true),
  })),
})

const EMPTY_PROJECTION: PhysicsScenesProjection = { latest: null, scenes: {} }

/**
 * Fold one `physics/scene` event into the projection (last-wins per scene id,
 * `latest` follows the newest). Exported for the companion tests; the host
 * unit below is the only production caller.
 * @param state - previous projection value.
 * @param snapshot - the appended snapshot.
 * @returns the next projection value (a new object; state is never mutated).
 */
export const foldPhysicsScene = (
  state: PhysicsScenesProjection,
  snapshot: PhysicsSceneSnapshot,
): PhysicsScenesProjection => ({
  latest: snapshot.sceneId,
  scenes: { ...state.scenes, [snapshot.sceneId]: snapshot },
})

/**
 * Register the seven `physics_*` tools on `ctx.tools` and, when the
 * session-projection seam is composed, the `physicsScenes` unit that mirrors
 * every scene the agent touches to the browser.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - scene scoping policy.
 */
export function apply(ctx: Context, config: Config): void {
  const runtimes = new Map<string, PhysicsToolRuntime>()
  const runtimeFor = (exec: ToolRunContext): PhysicsToolRuntime => {
    const key = config.sceneScope === 'process'
      ? '__process__'
      : (exec.agent === undefined ? ANONYMOUS_SCOPE : String(exec.agent.id))
    let runtime = runtimes.get(key)
    if (runtime === undefined) {
      runtime = new PhysicsToolRuntime({ maxScenes: config.maxScenes })
      runtimes.set(key, runtime)
    }
    return runtime
  }
  ctx.effect(() => () => {
    runtimes.clear()
  })

  // The unit child activates only when a projection registry is composed
  // (headless assemblies without the seam stay unaffected). Fold: every
  // `physics/scene` upserts its scene and becomes `latest`; every other event
  // returns the same state reference.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'physicsScenes', PhysicsScenesProjection>({
      key: 'physicsScenes',
      schema: physicsScenesProjectionSchema,
      init: () => EMPTY_PROJECTION,
      apply: (state, event) => (event.type === 'physics/scene' ? foldPhysicsScene(state, event.data) : state),
      view: state => state,
      stateVersion: 1,
    })
  })

  /**
   * Publish the scene a tool call just created or moved onto the calling
   * agent's session log, so the student's Lab can mirror it (docs/04 §92
   * `SceneRevisionChanged`). Agent-less callers (tests, Code Mode without an
   * agent) have no log to write to and skip the publication.
   */
  const publish = (
    exec: ToolRunContext,
    runtime: PhysicsToolRuntime,
    description: SceneDescription,
    cause: PhysicsSceneSnapshotCause,
    extra: { commandType?: string; eventType?: string } = {},
  ): void => {
    if (exec.agent === undefined) return
    const snapshot: PhysicsSceneSnapshot = {
      sceneId: description.sceneId,
      revision: description.revision,
      domain: description.domain,
      engineId: description.engineId,
      title: description.title,
      cause,
      ...(extra.commandType === undefined ? {} : { commandType: extra.commandType }),
      ...(extra.eventType === undefined ? {} : { eventType: extra.eventType }),
      ...(description.sourceQuestionId === undefined ? {} : { sourceQuestionId: description.sourceQuestionId }),
      scene: runtime.sceneSnapshot(description.sceneId) as unknown as JsonValue,
    }
    exec.agent.session.append('physics/scene', snapshot)
  }

  ctx.tools.register(defineTool({
    name: 'physics_list_experiments',
    description: PHYSICS_TOOL_DOCS.physics_list_experiments.description,
    parameters: {},
    output: {
      schema: { type: 'array', items: ANY_OBJECT },
      render: renderFor('physics_list_experiments'),
    },
    isConcurrencySafe: () => true,
    execute: (_args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).listExperiments()) as unknown as AnyObject[],
    ),
    presentCall: () => ({ card: 'generic', title: 'PhysicsOS 实验目录', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_create_experiment',
    description: PHYSICS_TOOL_DOCS.physics_create_experiment.description,
    parameters: {
      templateId: { type: 'string', required: true, description: '实验目录 id（见 physics_list_experiments）。' },
      title: { type: 'string', description: '可选：给学生看的场景标题。' },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_create_experiment') },
    execute: (args, exec) => {
      const runtime = runtimeFor(exec)
      const description = guarded(() => runtime.createExperiment(args.templateId, args.title))
      publish(exec, runtime, description, 'created')
      return Promise.resolve(description as unknown as AnyObject)
    },
    presentCall: args => ({ card: 'generic', title: `打开实验 ${args.templateId}`, kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_solve_question',
    description: PHYSICS_TOOL_DOCS.physics_solve_question.description,
    parameters: {
      text: { type: 'string', required: true, description: '完整的中文题面，包含所有已知量和所求。' },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_solve_question') },
    execute: (args, exec) => {
      const runtime = runtimeFor(exec)
      const solved = guarded(() => runtime.solveQuestion(args.text))
      if (solved.scene !== undefined) publish(exec, runtime, solved.scene, 'solved')
      return Promise.resolve(solved as unknown as AnyObject)
    },
    presentCall: args => ({ card: 'generic', title: '题目运行时求解', kind: 'other', rawInput: args.text }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_describe_scene',
    description: PHYSICS_TOOL_DOCS.physics_describe_scene.description,
    parameters: {
      sceneId: { type: 'string', required: true, description: 'physics_create_experiment / physics_solve_question 返回的 sceneId。' },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_describe_scene') },
    isConcurrencySafe: () => true,
    execute: (args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).describeScene(args.sceneId)) as unknown as AnyObject,
    ),
    presentCall: args => ({ card: 'generic', title: `查看场景 ${args.sceneId}`, kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_scene_command',
    description: PHYSICS_TOOL_DOCS.physics_scene_command.description,
    parameters: {
      sceneId: { type: 'string', required: true, description: '目标场景 id。' },
      type: { type: 'string', required: true, enum: [...COMMAND_TYPES], description: 'SceneCommand 类型（见命令参考）。' },
      payload: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: '命令载荷：对象 id 加数量 {"value","unit"} / 矢量 {"x","y","unit"} 等，字段见命令参考。',
      },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_scene_command') },
    execute: (args, exec) => {
      const runtime = runtimeFor(exec)
      const result: CommandResult = guarded(() => runtime.applyCommand(args.sceneId, args.type, args.payload))
      /* A refused command leaves the scene where it was, so there is nothing to mirror. */
      if (result.ok) {
        publish(exec, runtime, guarded(() => runtime.describeScene(args.sceneId)), 'command', {
          commandType: args.type,
          ...(result.eventType === undefined ? {} : { eventType: result.eventType }),
        })
      }
      return Promise.resolve(result as unknown as AnyObject)
    },
    presentCall: args => ({ card: 'generic', title: `${args.type} → ${args.sceneId}`, kind: 'other', rawInput: args.payload }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_simulate',
    description: PHYSICS_TOOL_DOCS.physics_simulate.description,
    parameters: {
      sceneId: { type: 'string', required: true, description: '目标场景 id。' },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_simulate') },
    isConcurrencySafe: () => true,
    execute: (args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).simulate(args.sceneId)) as unknown as AnyObject,
    ),
    presentCall: args => ({ card: 'generic', title: `模拟并校验 ${args.sceneId}`, kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_observe',
    description: PHYSICS_TOOL_DOCS.physics_observe.description,
    parameters: {
      sceneId: { type: 'string', required: true, description: '目标场景 id。' },
      time: { type: 'number', required: true, description: '场景时刻 t，单位秒，≥ 0。' },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_observe') },
    isConcurrencySafe: () => true,
    execute: (args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).observe(args.sceneId, args.time)) as unknown as AnyObject,
    ),
    presentCall: args => ({ card: 'generic', title: `读取 ${args.sceneId} 在 t = ${args.time} s 的状态`, kind: 'read' }),
  }))
}
