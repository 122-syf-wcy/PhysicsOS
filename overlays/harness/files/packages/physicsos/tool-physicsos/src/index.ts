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

import { isDeepStrictEqual } from 'node:util'
import { PhysicsCodeProvider, CODE_PROVIDER_NAME } from './code-provider.ts'
import { generateQuestionCode, type CodeStyleContext } from './code-generation.ts'
import { codeStyleFor } from './code-style-selection.ts'
import type {} from '@deepseek-ai/dsh-subagent'
import type { CodeExperimentRef, CodeVisualizationSource, CodeVisualizationState } from '@physicsos/agent-tools'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { HarnessError, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
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
import type {
  PhysicsSceneSnapshot,
  PhysicsSceneSnapshotCause,
  PhysicsSceneSolveSummary,
  PhysicsScenesProjection,
  PhysicsSolveTrace,
  PhysicsSolveTracesProjection,
} from './types.ts'

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
export const TOOL_NAMES: readonly string[] = [...PHYSICS_TOOL_NAMES, 'physics_generate_experiment']

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

const codeSummary = (value: CodeVisualizationState): string => value.status === 'ready'
  ? value.rendererKind === 'independent'
    ? '本题独立代码实验已生成，正在当前对话中呈现。物理条件与已验证答案保持一致。本轮已就绪，不要再次生成；需调整展示请点击「手动重新生成」开启新轮次。'
    : '此历史版本使用旧渲染方式，尚未升级为独立代码实验。请提示学生点击「升级为独立代码实验」开启新轮次，本轮不要重复生成。'
  : '本题独立代码实验本轮未完成，不能声称已显示动画；失败或中断请点击「手动重新生成」开启新轮次，本轮不要重复调用 physics_generate_experiment。'

/** The runtime's text projection of one canonical value, as the single model-visible block. */
const renderFor = (tool: PhysicsToolName) => (_args: unknown, value: unknown): ContentBlock[] => [
  { type: 'text', text: PHYSICS_TOOL_RENDERERS[tool](value) + (tool === 'physics_solve_question' && typeof value === 'object' && value !== null && 'visualization' in value
    ? '\n\n' + codeSummary(value.visualization as CodeVisualizationState) : '') },
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
    experimentId: zod.string().optional(),
    model: zod.string().optional(),
    cause: zod.union([zod.literal('created'), zod.literal('solved'), zod.literal('command')]),
    commandType: zod.string().optional(),
    eventType: zod.string().optional(),
    sourceQuestionId: zod.string().optional(),
    turn: zod.number().optional(),
    solve: zod.custom<PhysicsSceneSolveSummary>(() => true).optional(),
    visualization: zod.union([
      zod.object({ status: zod.literal('ready'), rendererKind: zod.literal('independent').optional(), artifactId: zod.string(), ownerSessionId: zod.string(), sceneId: zod.string(), sceneRevision: zod.number().int().nonnegative(), sceneSha256: zod.string(), experimentId: zod.string(), sha256: zod.string(), title: zod.string(), childSessionId: zod.string(), createdAt: zod.string() }),
      zod.object({ status: zod.literal('generating'), jobId: zod.string(), deadlineAt: zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), ownerSessionId: zod.string(), sceneId: zod.string(), sceneRevision: zod.number().int().nonnegative() }),
      zod.object({ status: zod.literal('failed'), jobId: zod.string().optional(), ownerSessionId: zod.string(), sceneId: zod.string(), sceneRevision: zod.number().int().nonnegative(), code: zod.string(), message: zod.string() }),
    ]).optional(),
    scene: zod.custom<JsonValue>(() => true),
  })),
})

/** Wire schema of the `physicsSolveTraces` projection. */
const physicsSolveTracesProjectionSchema: ZodType<PhysicsSolveTracesProjection> = zod.object({
  traces: zod.array(zod.object({
    turn: zod.number().optional(),
    status: zod.union([zod.literal('solved'), zod.literal('rejected')]),
    workflowState: zod.string(),
    domain: zod.string().optional(),
    model: zod.string().optional(),
    goldenQuestionId: zod.string().optional(),
    attempt: zod.number().optional(),
    sceneId: zod.string().optional(),
    reusedScene: zod.boolean().optional(),
    verification: zod.object({
      status: zod.string(),
      passed: zod.number(),
      total: zod.number(),
      failed: zod.array(zod.object({
        id: zod.string(),
        message: zod.string().optional(),
      })),
    }).optional(),
    answers: zod.array(zod.object({
      key: zod.string(),
      value: zod.string(),
      unit: zod.string(),
    })),
    issues: zod.array(zod.object({
      code: zod.string(),
      severity: zod.string(),
    })),
    retryGuidance: zod.array(zod.object({ code: zod.string() })),
    durationMs: zod.number(),
  })),
})

const EMPTY_PROJECTION: PhysicsScenesProjection = { latest: null, scenes: {} }
const EMPTY_SOLVE_TRACES: PhysicsSolveTracesProjection = { traces: [] }

/**
 * The turn a physics event should ride: read back off the session's open
 * `turn/start`, newest first. Shared by the scene mirror and the solve trace
 * so both dock at the answer that produced them.
 */
const currentTurnOf = (exec: ToolRunContext): number | undefined => {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing open-turn lookup; projection migration deferred.
  const events = exec.agent?.session.snapshotEvents()
  if (events === undefined) return undefined
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start') return event.data.turn
  }
  return undefined
}

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

/** Newest solve traces kept per session — a bounded tail, not an unbounded log. */
export const SOLVE_TRACES_CAP = 50

/**
 * Fold one `physics/solve-trace` event into the projection (append, then trim
 * to the newest {@link SOLVE_TRACES_CAP}). Exported for the companion tests.
 * @param state - previous projection value.
 * @param trace - the appended trace.
 * @returns the next projection value (a new object; state is never mutated).
 */
export const foldPhysicsSolveTrace = (
  state: PhysicsSolveTracesProjection,
  trace: PhysicsSolveTrace,
): PhysicsSolveTracesProjection => ({
  traces: [...state.traces, trace].slice(-SOLVE_TRACES_CAP),
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
  const lookup = ctx.get.bind(ctx) as (service: string) => unknown
  ctx.inject(['subagents', 'agentPresets'], async (child) => {
    if (child.subagents.getProvider(CODE_PROVIDER_NAME) !== undefined) return
    const provider = new PhysicsCodeProvider(child)
    child.subagents.registerProvider(provider)
    await provider.initialize()
  })
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
  // `physics/scene` upserts its scene and becomes `latest`; every
  // `physics/solve-trace` appends to the capped attempt tail; every other
  // event returns the same state reference.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'physicsScenes', PhysicsScenesProjection>({
      key: 'physicsScenes',
      stateSchema: physicsScenesProjectionSchema,
      init: () => EMPTY_PROJECTION,
      apply: (state, event) => (event.type === 'physics/scene' ? foldPhysicsScene(state, event.data) : state),
      wire: { viewSchema: physicsScenesProjectionSchema, view: state => state },
      stateVersion: 2,
    })
    projectionCtx.sessionProjections.register<'physicsSolveTraces', PhysicsSolveTracesProjection>({
      key: 'physicsSolveTraces',
      stateSchema: physicsSolveTracesProjectionSchema,
      init: () => EMPTY_SOLVE_TRACES,
      apply: (state, event) => (event.type === 'physics/solve-trace' ? foldPhysicsSolveTrace(state, event.data) : state),
      wire: { viewSchema: physicsSolveTracesProjectionSchema, view: state => state },
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
    extra: { commandType?: string; eventType?: string; solve?: PhysicsSceneSolveSummary; experimentId?: string; model?: string } = {},
  ): void => {
    if (exec.agent === undefined) return
    /* The snapshot rides the owning turn so the chat card can dock at the
       answer: the tool call's own events carry the turn, this one does not —
       read it back off the open turn/start. */
    const turn = currentTurnOf(exec)
    const snapshot: PhysicsSceneSnapshot = {
      sceneId: description.sceneId,
      revision: description.revision,
      domain: description.domain,
      engineId: description.engineId,
      title: description.title,
      cause,
      ...(turn === undefined ? {} : { turn }),
      ...(extra.commandType === undefined ? {} : { commandType: extra.commandType }),
      ...(extra.eventType === undefined ? {} : { eventType: extra.eventType }),
      ...(description.sourceQuestionId === undefined ? {} : { sourceQuestionId: description.sourceQuestionId }),
      ...(extra.solve === undefined ? {} : { solve: extra.solve }),
      ...(extra.experimentId === undefined ? {} : { experimentId: extra.experimentId }),
      ...(extra.model === undefined ? {} : { model: extra.model }),
      scene: runtime.sceneSnapshot(description.sceneId) as unknown as JsonValue,
    }
    exec.agent.session.append('physics/scene', snapshot)
  }

  /** Recover only this session's persisted scene projection when the process runtime is empty. */
  const persistedScene = (exec: ToolRunContext, sceneId: string): PhysicsSceneSnapshot | undefined => {
    if (exec.agent === undefined) return undefined
    const projected = ctx.get('sessionProjections')?.stateOf(exec.agent.session, 'physicsScenes')
    if (projected !== undefined) return projected.scenes[sceneId]
    // Compatibility for headless assemblies without projections. Existing physics
    // logs remain the source of truth; no catalog factory is used to recover facts.
    // oxlint-disable-next-line typescript/no-deprecated -- Existing physics event-reader fallback.
    const events = exec.agent.session.snapshotEvents()
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      if (event?.type === 'physics/scene' && event.data.sceneId === sceneId && exec.agent.session.isOwnSeq(event.seq)) return event.data
    }
    return undefined
  }
  const generate = async (
    exec: ToolRunContext, sceneId: string, experimentId?: string, instructions?: string,
  ): Promise<CodeVisualizationState> => {
    const parent = exec.agent
    if (parent === undefined) throw new HarnessError('题目代码实验需要当前对话。', 'SESSION_REQUIRED')
    if (parent.session.header.parentSession !== undefined) throw new HarnessError('题目代码生成只能由主对话发起。', 'GENERATION_DEPTH_LIMIT')
    const ownerSessionId = String(parent.id)
    const identity = lookup('physicsosIdentity') as { sessionOwnerKey(sessionId: string): string | undefined } | undefined
    if (identity?.sessionOwnerKey(ownerSessionId) === undefined) throw new HarnessError('当前对话的账号身份不可用。', 'SESSION_OWNER_REQUIRED')
    const snapshot = persistedScene(exec, sceneId)
    if (snapshot === undefined) throw new HarnessError('当前对话没有这个题目场景。', 'SCENE_NOT_FOUND')
    const turn = currentTurnOf(exec)
    const existing = snapshot.visualization
    if (snapshot.turn === turn && existing?.ownerSessionId === ownerSessionId
      && existing.sceneId === sceneId && existing.sceneRevision === snapshot.revision) {
      return existing
    }
    type Artifacts = {
      context(id: string): Promise<CodeStyleContext>
      create(input: {
        ownerSessionId: string
        scene: unknown
        experimentId: string
        childSessionId: string
        source: CodeVisualizationSource
        generationId: string
      }, signal?: AbortSignal): Promise<CodeExperimentRef>
      assetManifest?(input: { ownerSessionId: string; generationId: string; scene: unknown }): unknown
    }
    const artifacts = lookup('questionCodeArtifacts') as Artifacts | undefined
    const selected = codeStyleFor(snapshot, experimentId)
    return generateQuestionCode({
      ownerSessionId, snapshot, signal: exec.signal, experimentId: selected, instructions,
      current: () => persistedScene(exec, sceneId),
      isCurrent: () => currentTurnOf(exec) === turn && (ctx.get('sessionProjections')?.stateOf(parent.session, 'physicsScenes')?.latest ?? sceneId) === sceneId,
      publish: (value) => {
        parent.session.append('physics/scene', { ...value, ...(turn === undefined ? {} : { turn }) })
      },
      context: id => artifacts === undefined ? Promise.reject(Object.assign(new Error('Code artifacts unavailable'), { code: 'ARTIFACTS_UNAVAILABLE' })) : artifacts.context(id),
      assetManifest: generationId => artifacts?.assetManifest?.({ ownerSessionId, generationId, scene: snapshot.scene }),
      start: (request) => {
        const subagents = ctx.get('subagents')
        if (subagents === undefined) return Promise.reject(Object.assign(new Error('Code child unavailable'), { code: 'CHILD_UNAVAILABLE' }))
        return subagents.start(CODE_PROVIDER_NAME, { ...request, parent })
      },
      create: (input, signal) => {
        if (artifacts === undefined) {
          return Promise.reject(Object.assign(new Error('Code artifacts unavailable'), { code: 'ARTIFACTS_UNAVAILABLE' }))
        }
        return artifacts.create(input, signal)
      },
    })
  }
  ctx.tools.register(defineTool({
    name: 'physics_generate_experiment',
    description: '调用专用受限代码子代理，独立绘制当前题目的Canvas/SVG实验场景和现代界面，禁止调用旧平台绘图模板。解题成功后已自动尝试；同一场景版本本轮无论已就绪、失败或正在生成，都只复用状态，不再次启动子任务。失败、旧版本升级或需调整展示请提示学生点击生成入口后在新轮次调用。只生成展示代码，不改变物理条件或答案。',
    parameters: {
      sceneId: { type: 'string', required: true, description: '当前对话的 physics_solve_question / physics_create_experiment 返回的 sceneId。' },
      experimentId: { type: 'string', description: '可选：已注册的同物理域实验风格 id；默认按当前题目模型选择。' },
      instructions: { type: 'string', description: '可选：展示和标注要求；不用于修改物理条件。' },
    },
    output: { schema: ANY_OBJECT, render: (_args, value) => [{ type: 'text', text: codeSummary(value as unknown as CodeVisualizationState) }] },
    execute: async (args, exec) => await generate(exec, args.sceneId, args.experimentId, args.instructions) as unknown as AnyObject,
    presentCall: () => ({ card: 'generic', title: '生成本题代码实验', kind: 'other' }),
  }))

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
      publish(exec, runtime, description, 'created', { experimentId: args.templateId })
      return Promise.resolve(description as unknown as AnyObject)
    },
    presentCall: args => ({ card: 'generic', title: `打开实验 ${args.templateId}`, kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'physics_solve_question',
    description: PHYSICS_TOOL_DOCS.physics_solve_question.description,
    parameters: {
      text: { type: 'string', required: true, description: '完整的中文题面，包含所有已知量和所求。' },
      questionId: {
        type: 'string',
        description: '可选：题库题 id（练习链路附在题面后）；命中题库时按题库原文求解。',
      },
    },
    output: { schema: ANY_OBJECT, render: renderFor('physics_solve_question') },
    execute: async (args, exec) => {
      const runtime = runtimeFor(exec)
      const startedAt = Date.now()
      const solved = guarded(() => runtime.solveQuestion(args.text, args.questionId))
      const durationMs = Date.now() - startedAt
      if (solved.scene !== undefined) {
        const previous = solved.reusedScene === true ? persistedScene(exec, solved.scene.sceneId) : undefined
        const sameTurnVisualization = exec.agent !== undefined && previous !== undefined
          && previous.turn === currentTurnOf(exec) && previous.sceneId === solved.scene.sceneId
          && previous.revision === solved.scene.revision
          && previous.visualization?.ownerSessionId === String(exec.agent.id)
          && previous.visualization.sceneId === solved.scene.sceneId
          && previous.visualization.sceneRevision === solved.scene.revision
          && isDeepStrictEqual(
            JSON.parse(JSON.stringify(previous.scene)) as unknown,
            JSON.parse(JSON.stringify(runtime.sceneSnapshot(solved.scene.sceneId))) as unknown,
          )
        // A cached engine result must not clear this turn's completed/failed code job.
        // Compare every serialized scene fact; new turns and revisions still publish normally.
        if (!sameTurnVisualization) {
          publish(exec, runtime, solved.scene, 'solved', {
            ...(solved.model === undefined ? {} : { model: solved.model }),
            solve: {
              knowns: solved.knowns,
              targets: solved.targets,
              /* Each answer carries the simulation's provenance — engine
                 id/version, scene revision, verifier and checks — so the client
                 names the engine behind the number instead of the scene domain.
                 An answer with no engine behind it forwards the honest null. */
              answers: solved.answers.map(answer => ({
                key: answer.key,
                label: answer.label,
                symbol: answer.symbol,
                value: answer.value,
                unit: answer.unit,
                provenance: answer.provenance,
              })),
              steps: solved.steps,
              ...(solved.verification === undefined ? {} : {
                verification: {
                  status: solved.verification.status,
                  checks: solved.verification.checks,
                },
              }),
              issues: solved.issues,
              ...(solved.goldenQuestionId === undefined ? {} : { goldenQuestionId: solved.goldenQuestionId }),
            },
          })
        }
      }
      /* Every attempt — solved or rejected — leaves a trace: the scene mirror
         only carries READY solves, so without this a rejected attempt (parse
         failure, verification failure) would vanish from the session log the
         moment the model re-asks. */
      if (exec.agent !== undefined) {
        const failedChecks = (solved.verification?.checks ?? [])
          .filter(check => !check.passed)
          .map(check => ({ id: check.id, ...(check.message === undefined ? {} : { message: check.message }) }))
        const verificationSummary = solved.verification === undefined ? undefined : {
          status: solved.verification.status,
          passed: solved.verification.checks.length - failedChecks.length,
          total: solved.verification.checks.length,
          failed: failedChecks,
        }
        const trace: PhysicsSolveTrace = {
          ...(currentTurnOf(exec) === undefined ? {} : { turn: currentTurnOf(exec) }),
          status: solved.status,
          workflowState: solved.workflowState,
          ...(solved.domain === undefined ? {} : { domain: solved.domain }),
          ...(solved.model === undefined ? {} : { model: solved.model }),
          ...(solved.goldenQuestionId === undefined ? {} : { goldenQuestionId: solved.goldenQuestionId }),
          ...(solved.attempt === undefined ? {} : { attempt: solved.attempt }),
          ...(solved.scene === undefined ? {} : { sceneId: solved.scene.sceneId }),
          ...(solved.reusedScene === true ? { reusedScene: true } : {}),
          ...(verificationSummary === undefined ? {} : { verification: verificationSummary }),
          answers: solved.answers.map(answer => ({ key: answer.key, value: answer.value, unit: answer.unit })),
          issues: solved.issues.map(issue => ({ code: issue.code, severity: issue.severity })),
          retryGuidance: (solved.retryGuidance ?? []).map(hint => ({ code: hint.code })),
          durationMs,
        }
        exec.agent.session.append('physics/solve-trace', trace)
      }
      if (solved.status === 'solved' && solved.scene !== undefined && solved.verification?.status === 'passed' && exec.agent?.ctx !== undefined) {
        const visualization = await generate(exec, solved.scene.sceneId)
        return { ...solved, visualization: {
          status: visualization.status,
          ...(visualization.status === 'ready' && visualization.rendererKind !== undefined ? { rendererKind: visualization.rendererKind } : {}),
          ...(visualization.status === 'failed' ? { code: visualization.code } : {}),
        } } as unknown as AnyObject
      }
      return solved as unknown as AnyObject
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
