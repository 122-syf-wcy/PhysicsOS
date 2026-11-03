/** Trusted one-shot code child composition; no generic delegation capability is exposed. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProvider, ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'

export const CODE_PROVIDER_NAME = 'physics-question-code'
export const CODE_PRESET_ID = 'physics-code-only'
export const CODE_PERSONA = '你是 PhysicsOS 的专用题目实验代码作者。只输出 renderer/CSS，物理事实由平台引擎持有。不能询问学生、修改题目条件、调用物理工具、文件/终端/网页工具或进一步委派。使用 structured_output 提交最终四个字符串。'

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
  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    await this.ensurePreset()
    if (!request.outputSchema || request.maxDepth !== 1 || request.parent.session.header.parentSession !== undefined) {
      throw new Error('Code generation requires a structured first-level child')
    }
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
      agent.ctx.tools.presentAs('native')
      agent.ctx.tools.restrict({ allow: [] })
      agent.ctx.tools.guard((exec) => {
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
      if (names.length !== 1 || names[0] !== 'structured_output') throw new Error('Code child tool isolation failed')
      agent.session.append('agent-preset/selected', { agentPreset: CODE_PRESET_ID })
      flags.isolated = true
      return undefined
    }, { global: true })
    try {
      const parentLimit = request.parent.session.requestHeader()?.config.maxTokens ?? request.parent.options.maxTokens ?? 24000
      const maxTokens = Math.min(parentLimit, request.agentOptions?.maxTokens ?? 24000)
      const run = await startInProcessRun({ ...request, persona, toolFilter: { allow: [] }, agentOptions: { maxTokens } }, {})
      if (!flags.isolated) { await run.dispose(); throw new Error('Code child creation did not establish its restricted preset') }
      return run
    } finally { remove() }
  }
}
