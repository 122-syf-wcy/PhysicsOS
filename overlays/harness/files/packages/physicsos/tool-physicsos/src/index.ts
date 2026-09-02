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
import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  COMMAND_TYPES,
  DEFAULT_MAX_SCENES,
  PHYSICS_TOOL_DOCS,
  PHYSICS_TOOL_NAMES,
  PHYSICS_TOOL_RENDERERS,
  PhysicsToolRuntime,
  ToolRuntimeError,
  type PhysicsToolName,
} from '@physicsos/agent-tools'

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

/**
 * Register the seven `physics_*` tools on `ctx.tools`.
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
    execute: (args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).createExperiment(args.templateId, args.title)) as unknown as AnyObject,
    ),
    presentCall: args => ({ card: 'generic', title: `打开实验 ${args.templateId}`, kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_solve_question',
    description: PHYSICS_TOOL_DOCS.physics_solve_question.description,
    parameters: {
      text: { type: 'string', required: true, description: '完整的中文题面，包含所有已知量和所求。' },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_solve_question') },
    execute: (args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).solveQuestion(args.text)) as unknown as AnyObject,
    ),
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
    execute: (args, exec) => Promise.resolve(
      guarded(() => runtimeFor(exec).applyCommand(args.sceneId, args.type, args.payload)) as unknown as AnyObject,
    ),
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
