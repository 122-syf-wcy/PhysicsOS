/** Trusted one-shot code child composition; no generic delegation capability is exposed. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProvider, ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PhysicsSceneSnapshot } from './types.ts'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

export const CODE_PROVIDER_NAME = 'physics-question-code'
export const CODE_PRESET_ID = 'physics-code-only'
export const CODE_PERSONA = '你是 PhysicsOS 的专用题目实验代码作者和实验美术设计师。按已发布实验提示词制作 Warm Lab 拟真实验场景。先调用 physics_generate_experiment_asset 生成本题环境或材质，再用独立原生 Canvas2D/SVG 与生成素材完成装置、空间与动态画面；物理事实由平台引擎持有。不能导入旧渲染器，不能询问学生、修改题目条件、调用物理/文件/终端/网页工具或进一步委派。最后用 structured_output 提交四个源码字符串。'

export class PhysicsCodeProvider implements SubagentProvider {
  readonly name = CODE_PROVIDER_NAME
  readonly inheritsParentContext = false
  readonly capabilities = { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  private presetReady?: Promise<void>
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
  private async lightEffort(request: ResolvedSubagentStartRequest): Promise<ReasoningEffortId | undefined> {
    const signal = request.signal
    const isAborted = (): boolean => signal.aborted
    const abortError = (): Error => {
      const reason = signal.reason as unknown
      const timedOut = typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'GENERATION_TIMEOUT'
      return Object.assign(new Error('Code metadata lookup aborted'), {
        code: timedOut ? 'GENERATION_TIMEOUT' : 'GENERATION_ABORTED',
      })
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
      // Only advisory metadata is raced. Actual child startup keeps its holder-owned lifecycle.
      const info = await Promise.race([llm.resolveModelInfo(route.provider, route.model, signal), aborted])
      for (const level of ['off', 'none', 'minimal', 'low']) {
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
  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    await this.ensurePreset()
    if (!request.outputSchema || request.maxDepth !== 1 || request.parent.session.header.parentSession !== undefined) {
      throw new Error('Code generation requires a structured first-level child')
    }
    const reasoningEffort = await this.lightEffort(request)
    const parentState = request.parent.ctx.get('sessionProjections')?.stateOf(request.parent.session, 'physicsScenes')
    const assetScene: PhysicsSceneSnapshot | undefined = parentState?.latest ? parentState.scenes[parentState.latest] : undefined
    const pending = assetScene?.visualization
    const assetOwner = String(request.parent.id)
    const generationId = pending?.status === 'generating' && pending.ownerSessionId === assetOwner ? pending.jobId : undefined
    type AssetService = { generateAsset(input: { ownerSessionId: string; generationId: string; scene: unknown; prompt: string; kind: 'environment' | 'material'; signal: AbortSignal }): Promise<{ path: string; cssPath: string; sha256: string; width: number; height: number; kind: string; model: string }> }
    const artifacts = (this.ctx.get as (name: string) => unknown)('questionCodeArtifacts') as AssetService | undefined
    const canGenerateAsset = assetScene !== undefined && generationId !== undefined && typeof artifacts?.generateAsset === 'function'
    const allowedTools = canGenerateAsset ? ['physics_generate_experiment_asset'] : []
    const marker = `PhysicsOS internal code run ${randomUUID()}`
    const persona = `${CODE_PERSONA}\n${marker}`
    const flags = { isolated: false }
    // Creation is serial and awaited before inbox release. A unique scoped persona
    // marker identifies this exact start, even when the same parent starts concurrently.
    const remove = this.ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.parentSession !== request.parent.id) return undefined
      const assembly = await agent.ctx.systemPrompt.assemble({ scope: agent, agent })
      if (!assembly.sections.some(section => section.name === 'deployment:persona-prefix' && section.text.includes(marker))) return undefined
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) throw new Error('Code child requires the agent preset registry')
      await presets.mount(agent.ctx, CODE_PRESET_ID)
      if (canGenerateAsset) agent.ctx.tools.register(defineTool({
        name: 'physics_generate_experiment_asset',
        timeoutMs: 185_000,
        description: '调用平台已配置的gpt-image-2.5-sunburst为本题制作Warm Lab环境/材质图片。每题最多2次，通常1张环境已足够。不要生成文字、公式、轨迹或测量结果。返回本包图片path和CSS路径；随后必须实际使用图片绘制实验。',
        parameters: {
          prompt: { type: 'string', required: true, description: '具体美术构图、材质、灯光、留白位置；不超过5000字。图片不可含物理读数或运动结果。' },
          kind: { type: 'string', required: true, enum: ['environment', 'material'], description: 'environment为实验环境/场景背景，material为器材表面材质。' },
        },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (args, exec) => {
          if (request.signal.aborted || exec.signal.aborted) throw new HarnessError('素材生成已取消。', 'IMAGE_ABORTED')
          const current = request.parent.ctx.get('sessionProjections')?.stateOf(request.parent.session, 'physicsScenes')?.scenes[assetScene.sceneId]
          if (current?.visualization?.status !== 'generating' || current.visualization.jobId !== generationId) throw new HarnessError('题目生成任务已更新。', 'STALE_GENERATION')
          try {
            return await artifacts.generateAsset({ ownerSessionId: assetOwner, generationId, scene: assetScene.scene,
              prompt: args.prompt, kind: args.kind, signal: AbortSignal.any([request.signal, exec.signal]) })
          } catch (error) {
            const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^IMAGE_[A-Z_]+$/.test(error.code) ? error.code : 'IMAGE_GENERATION_FAILED'
            throw new HarnessError('素材生成未完成（' + code + '）。请在剩余额度内处理；不能伪造图片路径。', code)
          }
        },
        presentCall: () => ({ card: 'generic', title: '制作本题实验素材', kind: 'other' }),
      }))
      agent.ctx.tools.presentAs('native')
      agent.ctx.tools.restrict({ allow: [] })
      agent.ctx.tools.guard((exec) => {
        if (canGenerateAsset && exec.name === 'physics_generate_experiment_asset') return undefined
        if (exec.name !== 'structured_output') return 'Code child accepts only structured_output'
        const source = exec.arguments as Record<string, unknown>
        const limits = { title: 120, summary: 1000, rendererJs: 96000, stylesheet: 24000 }
        for (const [key, maximum] of Object.entries(limits)) {
          if (typeof source[key] !== 'string' || source[key].length > maximum) return `Code source ${key} must be a string of at most ${maximum} characters`
        }
        if (!(source.title as string).trim() || !(source.rendererJs as string).trim()) return 'Code source title and rendererJs must not be empty'
        return undefined
      })
      const names = agent.ctx.tools.schemas(agent).map(tool => tool.name)
      if (names.length !== allowedTools.length + 1 || names.some(name => name !== 'structured_output' && !allowedTools.includes(name))) throw new Error('Code child tool isolation failed')
      agent.session.append('agent-preset/selected', { agentPreset: CODE_PRESET_ID })
      flags.isolated = true
      return undefined
    }, { global: true })
    try {
      const parentLimit = request.parent.session.requestHeader()?.config.maxTokens ?? request.parent.options.maxTokens ?? 8192
      const maxTokens = Math.min(8192, parentLimit, request.agentOptions?.maxTokens ?? 8192)
      const run = await startInProcessRun({
        ...request, persona, toolFilter: { allow: [] },
        agentOptions: { maxTokens, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) },
      }, {})
      if (!flags.isolated) { await run.dispose(); throw new Error('Code child creation did not establish its restricted preset') }
      return run
    } finally { remove() }
  }
}
