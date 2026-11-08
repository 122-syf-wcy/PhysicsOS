/**
 * Trusted one-shot code child composition; no generic delegation capability
 * is exposed. The provider mounts a private preset on the child, registers
 * exactly the tools the job allows (see `code-child-tools.ts`), keeps the
 * job's write budget across resumes (see `code-checkpoints.ts`) and reports
 * how the child stopped so the parent can decide on its single retry.
 * @module @deepseek-ai/dsh-tool-physicsos/code-provider
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProvider, ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { PhysicsSceneSnapshot } from './types.ts'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { MAX_CODE_PART_CHARACTERS, QuestionCodeParts } from './question-code-parts.ts'
import { CodeCheckpoints } from './code-checkpoints.ts'
import { codeChildGuard, registerAssetTool, registerWriteCodeTool, type AssetService, type CodeChildJob } from './code-child-tools.ts'
import { generationError, isTransientDiagnostic } from './generation-errors.ts'

export const CODE_PROVIDER_NAME = 'physics-question-code'
export const CODE_PRESET_ID = 'physics-code-only'
export const CODE_PERSONA = `你是PhysicsOS专用实验绘图作者，只绘制只读snapshot引擎事实，不解题或改条件。没有素材且提供素材工具时先生成一张环境/材质；已有素材直接复用。仅平台工具返回mode:native或可信任务提示时，删除Image/decode/图片路径，直接用原生Canvas/SVG完成画面，不重试生图。立即用physics_write_experiment_code优先完整JS一次提交（最多${MAX_CODE_PART_CHARACTERS}字符）、CSS一次提交（最多6000字符）；最后structured_output只提交title/summary。`

/** Output cap per child request; never above the parent's own. */
const CHILD_MAX_TOKENS = 8192
/** Reasoning levels tried, lightest first, when the route advertises them. */
const LIGHT_EFFORTS = ['off', 'none', 'minimal', 'low'] as const
/** With chunked writes the structured output carries only the metadata. */
const METADATA_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string' }, summary: { type: 'string' } },
  required: ['title', 'summary'],
}

/** Everything a start resolved about its job before the child exists. */
interface JobPlan {
  readonly scene: PhysicsSceneSnapshot
  readonly generationId: string
  readonly owner: string
  readonly assets: AssetService | undefined
  /** The child may write source through the chunked tool. */
  readonly chunked: boolean
  /** The child may generate one image (service present, none yet). */
  readonly canGenerateAsset: boolean
  readonly nativeFallback: boolean
}

export class PhysicsCodeProvider implements SubagentProvider {
  readonly name = CODE_PROVIDER_NAME
  readonly inheritsParentContext = false
  readonly capabilities = { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  private presetReady?: Promise<void>
  private readonly checkpoints = new CodeCheckpoints()
  constructor(private readonly ctx: Context) {}

  private ensurePreset(): Promise<void> {
    return this.presetReady ??= (async () => {
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) throw new Error('Code child requires the agent preset registry')
      try { await presets.resolve(CODE_PRESET_ID) }
      catch { await presets.register({ id: CODE_PRESET_ID, name: '题目实验代码生成', description: '内部受限实验代码子代理', order: 10000, plugins: [] }) }
    })()
  }

  /** Register the durable internal composition during host startup, before cold child reads. */
  initialize(): Promise<void> { return this.ensurePreset() }

  /**
   * The lightest reasoning effort the parent's route advertises. Advisory
   * only: a missing catalog never blocks the child, and the lookup is raced
   * against the request's own cancellation.
   */
  private async lightEffort(request: ResolvedSubagentStartRequest): Promise<ReasoningEffortId | undefined> {
    const signal = request.signal
    /* Read through a function: the signal flips asynchronously, so a plain
       property read would be narrowed to `false` after the first check. */
    const isAborted = (): boolean => signal.aborted
    const abortError = (): Error => {
      const reason = signal.reason as unknown
      const timedOut = typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'GENERATION_TIMEOUT'
      return Object.assign(new Error('Code metadata lookup aborted'), { code: timedOut ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED' })
    }
    if (isAborted()) throw abortError()
    const route = parentAgentOptionsForDelegation(request.parent)
    const llm = this.ctx.get('llm')
    if (llm === undefined || route.provider === undefined || route.model === undefined) return undefined
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => { reject(abortError()) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (isAborted()) onAbort()
    })
    try {
      const info = await Promise.race([llm.resolveModelInfo(route.provider, route.model, signal), aborted])
      for (const level of LIGHT_EFFORTS) {
        const effort = info.reasoning?.efforts.find(item => item.id.toLowerCase() === level)
        if (effort !== undefined) return effort.id
      }
      return undefined
    } catch (error) {
      if (isAborted()) throw abortError()
      if (error instanceof Error && error.name === 'AbortError') throw error
      // Catalog/metadata availability does not gate the exact route's ordinary call path.
      return undefined
    } finally {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }

  /** What this start may do, read from the parent's live generation marker. */
  private plan(request: ResolvedSubagentStartRequest): JobPlan | undefined {
    const parentState = request.parent.ctx.get('sessionProjections')?.stateOf(request.parent.session, 'physicsScenes')
    const scene: PhysicsSceneSnapshot | undefined = parentState?.latest ? parentState.scenes[parentState.latest] : undefined
    const pending = scene?.visualization
    const owner = String(request.parent.id)
    const generationId = pending?.status === 'generating' && pending.ownerSessionId === owner ? pending.jobId : undefined
    if (scene === undefined || generationId === undefined) return undefined
    const assets = (this.ctx.get as (name: string) => unknown)('questionCodeArtifacts') as AssetService | undefined
    const chunked = typeof assets?.generateAsset === 'function'
    const existing = chunked ? assets.assetManifest?.({ ownerSessionId: owner, generationId, scene: scene.scene }) ?? [] : []
    const nativeFallback = chunked && existing.length === 0 && assets.assetFallback?.({ ownerSessionId: owner, generationId, scene: scene.scene }) !== undefined
    return { scene, generationId, owner, assets, chunked, nativeFallback, canGenerateAsset: chunked && existing.length === 0 && !nativeFallback }
  }

  /** A suspended start may only resume the scene and job it originally captured. */
  private assertCurrent(request: ResolvedSubagentStartRequest, plan: JobPlan | undefined): void {
    if (request.signal.aborted) {
      const reason = request.signal.reason as unknown
      const timedOut = typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'GENERATION_TIMEOUT'
      throw generationError(timedOut ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED', 'Code child start aborted')
    }
    // Standalone provider callers without a generation marker retain their
    // structured-output-only path. Never adopt a job that appeared later.
    if (plan === undefined) return
    const state = request.parent.ctx.get('sessionProjections')?.stateOf(request.parent.session, 'physicsScenes')
    const current = state?.scenes[plan.scene.sceneId]
    const pending = current?.visualization
    if (state?.latest !== plan.scene.sceneId || current?.revision !== plan.scene.revision
      || pending?.status !== 'generating' || pending.jobId !== plan.generationId
      || pending.ownerSessionId !== plan.owner || pending.sceneId !== plan.scene.sceneId
      || pending.sceneRevision !== plan.scene.revision) {
      throw generationError('STALE_GENERATION', 'Code child generation changed before startup completed')
    }
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const plan = this.plan(request)
    await this.ensurePreset()
    if (!request.outputSchema || request.maxDepth !== 1 || request.parent.session.header.parentSession !== undefined) {
      throw new Error('Code generation requires a structured first-level child')
    }
    this.assertCurrent(request, plan)
    const reasoningEffort = await this.lightEffort(request)
    this.assertCurrent(request, plan)
    const chunked = plan?.chunked === true
    /* The write budget survives a resume of the same job; a fresh job starts clean. */
    const checkpoint = plan !== undefined && chunked
      ? this.checkpoints.acquire(request.parent, { jobId: plan.generationId, sceneId: plan.scene.sceneId, revision: plan.scene.revision })
      : undefined
    const parts = checkpoint?.parts ?? new QuestionCodeParts()
    const release = (): void => { checkpoint?.release() }
    if (checkpoint !== undefined) request.signal.addEventListener('abort', release, { once: true })
    if (request.signal.aborted) release()

    const allowedTools = [
      ...(plan?.canGenerateAsset ? ['physics_generate_experiment_asset'] : []),
      ...(chunked ? ['physics_write_experiment_code'] : []),
    ]
    const staged = new WeakMap<object, { commit(): void; discard(): void }>()
    const marker = `PhysicsOS internal code run ${randomUUID()}`
    const persona = `${CODE_PERSONA}${plan?.nativeFallback ? '\n平台已确认本任务图片通道瞬态故障：本轮只写原生Canvas/SVG，不生成或引用图片；完整物理、资源和独立绘制校验仍执行。' : ''}\n${marker}`
    const flags = { isolated: false }
    // Creation is serial and awaited before inbox release. A unique scoped persona
    // marker identifies this exact start, even when the same parent starts concurrently.
    const remove = this.ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.parentSession !== request.parent.id) return undefined
      const assembly = await agent.ctx.systemPrompt.assemble({ scope: agent, agent })
      if (!assembly.sections.some(section => section.name === 'deployment:persona-prefix' && section.text.includes(marker))) return undefined
      this.assertCurrent(request, plan)
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) throw new Error('Code child requires the agent preset registry')
      await presets.mount(agent.ctx, CODE_PRESET_ID)
      this.assertCurrent(request, plan)
      agent.ctx.on('tools/result', (exec, result) => {
        const write = staged.get(exec)
        staged.delete(exec)
        if (result.isError || request.signal.aborted || exec.signal.aborted) write?.discard()
        else write?.commit()
      })
      if (plan !== undefined && chunked) {
        const job: CodeChildJob = {
          parent: request.parent, scene: plan.scene, generationId: plan.generationId, parts, signal: request.signal,
        }
        registerWriteCodeTool(agent.ctx, job, staged)
        if (plan.canGenerateAsset && plan.assets !== undefined) registerAssetTool(agent.ctx, job, plan.assets, plan.owner)
      }
      agent.ctx.tools.presentAs('native')
      agent.ctx.tools.restrict({ allow: [] })
      agent.ctx.tools.guard(codeChildGuard(allowedTools, chunked, parts))
      const names = agent.ctx.tools.schemas(agent).map(tool => tool.name)
      if (names.length !== allowedTools.length + 1 || names.some(name => name !== 'structured_output' && !allowedTools.includes(name))) {
        throw new Error('Code child tool isolation failed')
      }
      agent.session.append('agent-preset/selected', { agentPreset: CODE_PRESET_ID })
      flags.isolated = true
      return undefined
    }, { global: true })
    try {
      const parentLimit = request.parent.session.requestHeader()?.config.maxTokens ?? request.parent.options.maxTokens ?? CHILD_MAX_TOKENS
      const maxTokens = Math.min(CHILD_MAX_TOKENS, parentLimit, request.agentOptions?.maxTokens ?? CHILD_MAX_TOKENS)
      const run = await startInProcessRun({
        ...request, persona, toolFilter: { allow: [] },
        ...(chunked ? { outputSchema: METADATA_SCHEMA } : {}),
        agentOptions: { maxTokens, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) },
      }, {})
      if (!flags.isolated) { await run.dispose(); throw new Error('Code child creation did not establish its restricted preset') }
      if (!chunked) return run
      return { ...run, result: run.result.then((result) => {
        const partialSource = parts.source()
        const hasPartial = partialSource.rendererJs.length > 0 || partialSource.stylesheet.length > 0
        if (result.stopReason !== 'completed') {
          // The injected provider owns this child handle; its context does not
          // request the global agents service and cannot read that registry.
          const child = run.localAgent
          // oxlint-disable-next-line typescript/no-deprecated -- Safe classification of this owned child's terminal failure only.
          const end = child?.session.snapshotEvents().findLast(event => event.type === 'turn/end')
          const reason = end?.type === 'turn/end' ? end.data.reason : undefined
          const code = reason?.kind === 'error' ? reason.error.code : undefined
          const diagnostic = code === 'EMPTY_RESPONSE' || isTransientDiagnostic(code) ? code : undefined
          if (result.stopReason === 'aborted' || request.signal.aborted) release()
          return { ...result, ...(hasPartial ? { partialSource } : {}), ...(diagnostic === undefined ? {} : { diagnostic }) }
        }
        // A completed child can still require host validation repair. Retain the
        // same parts and write budget until the parent settles its shared signal.
        if (result.structured === null || typeof result.structured !== 'object') return result
        return { ...result, structured: { ...result.structured, ...parts.source() } }
      }, (error: unknown) => { release(); throw error }) }
    } catch (error) {
      release()
      throw error
    } finally { remove() }
  }
}
