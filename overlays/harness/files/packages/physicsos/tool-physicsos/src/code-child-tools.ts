/**
 * The bounded tools the restricted code child may call, and the guard that keeps
 * everything else out. Both tools re-check, on every call, that the parent's
 * scene still carries this exact job in `generating` — a superseded job
 * cannot write code or spend image budget.
 * @module @deepseek-ai/dsh-tool-physicsos/code-child-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { canonicalJson } from '@physicsos/agent-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { PhysicsSceneSnapshot } from './types.ts'
import { CODE_FILE_LIMITS, CODE_PART_TARGET_CHARACTERS, MAX_CODE_PART_CHARACTERS, QuestionCodeParts } from './question-code-parts.ts'

/** The asset service the host provides when image generation is configured. */
export interface AssetService {
  generateAsset(input: {
    ownerSessionId: string
    generationId: string
    scene: unknown
    prompt: string
    kind: 'environment' | 'material'
    theme?: string
    purpose?: string
    tags?: string[]
    style?: string
    signal: AbortSignal
  }): Promise<{ path: string; cssPath: string; sha256: string; width: number; height: number; kind: string; model: string }>
  searchMaterials?(input: {
    ownerSessionId: string; generationId: string; scene: unknown; query: string;
    kind?: 'environment' | 'material'; purpose?: string; tags?: string[]; style?: string; signal: AbortSignal;
  }): Promise<{ items: readonly { materialId: string; sha256: string; theme: string; purpose: string; kind: string; width: number; height: number; tags: readonly string[]; style?: string }[] }>
  useMaterial?(input: {
    ownerSessionId: string; generationId: string; scene: unknown; materialId: string; sha256: string; signal: AbortSignal;
  }): Promise<{ path: string; cssPath: string; sha256: string; width: number; height: number; kind: string; model: string }>
  assetManifest?(input: { ownerSessionId: string; generationId: string; scene: unknown }): unknown[]
  assetFallback?(input: { ownerSessionId: string; generationId: string; scene: unknown }): {
    status: 'unavailable'; mode: 'native'; code: 'IMAGE_TIMEOUT' | 'IMAGE_RATE_LIMIT' | 'IMAGE_SERVICE_UNAVAILABLE'
  } | undefined
}

/** The job one child run serves: parent, scene, job id and the shared write budget. */
export interface CodeChildJob {
  readonly parent: Agent
  readonly scene: PhysicsSceneSnapshot
  readonly generationId: string
  readonly parts: QuestionCodeParts
  readonly signal: AbortSignal
}

/** Caps the structured_output guard enforces on the assembled source. */
const SOURCE_LIMITS = { title: 120, summary: 1000, rendererJs: 96000, stylesheet: 24000 } as const

/** Whether the parent's projection still names this job as the live generation for the scene. */
const jobIsCurrent = (job: CodeChildJob): boolean => {
  const state = job.parent.ctx.get('sessionProjections')?.stateOf(job.parent.session, 'physicsScenes')
  const current = state?.scenes[job.scene.sceneId], marker = current?.visualization
  return state?.latest === job.scene.sceneId && current?.revision === job.scene.revision
    && canonicalJson(current.scene) === canonicalJson(job.scene.scene)
    && marker?.status === 'generating' && marker.jobId === job.generationId
    && marker.ownerSessionId === String(job.parent.id) && marker.sceneId === job.scene.sceneId
    && marker.sceneRevision === job.scene.revision
}

/**
 * Register `physics_write_experiment_code` on the child. Writes are staged
 * per call and committed only when the registry reports the call succeeded,
 * so a cancelled or errored write never lands in the shared source.
 * @param child - the child agent's context.
 * @param job - the job this child serves.
 * @param staged - per-execution staging slots the result hook commits or discards.
 */
export function registerWriteCodeTool(
  child: Context,
  job: CodeChildJob,
  staged: WeakMap<object, { commit(): void; discard(): void }>,
): void {
  child.tools.register(defineTool({
    name: 'physics_write_experiment_code',
    description: `分段提交实验JS或CSS，通常每段不超过${CODE_PART_TARGET_CHARACTERS}字符，首段replace，收到characters/remainingCharacters回执后再append后续原文，避免整文件截断。同一任务最多10次（中断续写共用额度）；每次硬限${MAX_CODE_PART_CHARACTERS}，JS合计${CODE_FILE_LIMITS.rendererJs}、CSS合计${CODE_FILE_LIMITS.stylesheet}字符。完成后structured_output只提交title/summary。`,
    parameters: {
      file: { type: 'string', required: true, enum: ['rendererJs', 'stylesheet'] },
      mode: { type: 'string', required: true, enum: ['replace', 'append'] },
      content: { type: 'string', required: true, description: `源码原文，无Markdown，建议按函数边界分成最多${CODE_PART_TARGET_CHARACTERS}字符的小段。rendererJs合计最多${CODE_FILE_LIMITS.rendererJs}、stylesheet合计最多${CODE_FILE_LIMITS.stylesheet}字符；单次仍允许最多${MAX_CODE_PART_CHARACTERS}字符。append不得重复已写片段。` },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      if (job.signal.aborted || exec.signal.aborted) throw new HarnessError('代码生成已取消。', 'GENERATION_ABORTED')
      if (!jobIsCurrent(job)) throw new HarnessError('题目生成任务已更新。', 'STALE_GENERATION')
      try {
        const write = job.parts.stage(args.file, args.mode, args.content)
        staged.set(exec, write)
        return Promise.resolve(write.result)
      } catch (error) {
        throw new HarnessError(error instanceof Error ? error.message : 'CODE_WRITE_FAILED', 'CODE_WRITE_FAILED')
      }
    },
    presentCall: () => ({ card: 'generic', title: '编写本题实验画面', kind: 'other' }),
  }))
}

/**
 * Register `physics_generate_experiment_asset` on the child: one Warm Lab
 * environment/material image through the host's configured image channel.
 * @param child - the child agent's context.
 * @param job - the job this child serves.
 * @param assets - the host asset service.
 * @param owner - the parent session id the asset is filed under.
 */
export function registerAssetTool(child: Context, job: CodeChildJob, assets: AssetService, owner: string): void {
  child.tools.register(defineTool({
    name: 'physics_generate_experiment_asset',
    timeoutMs: 185_000,
    description: '通过独立图片渠道制作可视化环境/材质，并自动保存到素材库。先检索适配素材，确实缺失时调用；返回本任务可用的path/cssPath。图片只表现外观，物理数据与科学标注由引擎/代码绘制。',
    parameters: {
      prompt: { type: 'string', required: true, maxLength: 5000, description: '美术构图、材质、灯光和留白；不得含文字、公式、箭头、轨迹或测量结果。每任务最多2次（失败也计数）。' },
      kind: { type: 'string', required: true, enum: ['environment', 'material'], description: 'environment为场景背景，material为器材外观素材。' },
      theme: { type: 'string', maxLength: 120, description: '可复用主题，例如“单摆实验器材”，不要包含题目全文或账号信息。' },
      purpose: { type: 'string', maxLength: 120, description: '素材用途，例如“教学场景背景”或“实验器材外观”。' },
      tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 }, description: '简洁的检索标签。' },
      style: { type: 'string', maxLength: 80, description: '外观风格，不用于声明物理模型或正确性。' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (job.signal.aborted || exec.signal.aborted) throw new HarnessError('素材生成已取消。', 'IMAGE_ABORTED')
      if (!jobIsCurrent(job)) throw new HarnessError('题目生成任务已更新。', 'STALE_GENERATION')
      try {
        const generated = await assets.generateAsset({
          ownerSessionId: owner, generationId: job.generationId, scene: job.scene.scene,
          prompt: args.prompt, kind: args.kind,
          ...(args.theme === undefined ? {} : { theme: args.theme }),
          ...(args.purpose === undefined ? {} : { purpose: args.purpose }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          ...(args.style === undefined ? {} : { style: args.style }),
          signal: AbortSignal.any([job.signal, exec.signal]),
        })
        if (job.signal.aborted || exec.signal.aborted) throw new HarnessError('素材生成已取消。', 'IMAGE_ABORTED')
        if (!jobIsCurrent(job)) throw new HarnessError('题目生成任务已更新。', 'STALE_GENERATION')
        return generated
      } catch (error) {
        if (job.signal.aborted || exec.signal.aborted) throw new HarnessError('素材生成已取消。', 'IMAGE_ABORTED')
        if (!jobIsCurrent(job)) throw new HarnessError('题目生成任务已更新。', 'STALE_GENERATION')
        let fallback: ReturnType<NonNullable<AssetService['assetFallback']>>
        try { fallback = assets.assetFallback?.({ ownerSessionId: owner, generationId: job.generationId, scene: job.scene.scene }) }
        catch { fallback = undefined }
        if (fallback !== undefined) return { ...fallback, instructions: '平台已记录本任务图片通道瞬态故障。不要再次生图；删除Image/decode/图片路径，立即用原生Canvas/SVG完成只读snapshot.view的完整画面，再提交代码与title/summary。' }
        const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^IMAGE_[A-Z_]+$/.test(error.code)
          ? error.code
          : 'IMAGE_GENERATION_FAILED'
        throw new HarnessError('素材生成未完成（' + code + '）。请在剩余额度内处理；不能伪造图片路径。', code)
      }
    },
    presentCall: () => ({ card: 'generic', title: '制作本题实验素材', kind: 'other' }),
  }))
}

const assertMaterialJob = (job: CodeChildJob, exec: ToolExecution): AbortSignal => {
  if (job.signal.aborted || exec.signal.aborted) throw new HarnessError('素材请求已取消。', 'IMAGE_ABORTED')
  if (!jobIsCurrent(job)) throw new HarnessError('可视化任务已更新。', 'STALE_GENERATION')
  return AbortSignal.any([job.signal, exec.signal])
}
const materialFailure = (error: unknown): HarnessError => {
  const code = error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^(?:MATERIAL|IMAGE)_[A-Z_]+$/.test(error.code)
    ? error.code : 'MATERIAL_REQUEST_FAILED'
  return new HarnessError('素材请求未完成（' + code + '）。', code)
}

/** Search/select returns current-job paths; library addresses never enter the renderer. */
export function registerMaterialTools(child: Context, job: CodeChildJob, assets: AssetService, owner: string): void {
  if (typeof assets.searchMaterials !== 'function' || typeof assets.useMaterial !== 'function') return
  child.tools.register(defineTool({
    name: 'physics_search_visual_materials',
    description: '检索当前账号或已授权学校的可复用图片，返回候选ID、摘要、主题、用途和尺寸。选择合适候选后调用physics_use_visual_material获得本任务路径。',
    parameters: {
      query: { type: 'string', required: true, minLength: 1, maxLength: 240, description: '物理主题和画面需求，不是题目全文。' },
      kind: { type: 'string', enum: ['environment', 'material'], description: '按场景背景或器材外观筛选。' },
      purpose: { type: 'string', maxLength: 120, description: '需要素材发挥的教学用途。' },
      tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 } },
      style: { type: 'string', maxLength: 80, description: '需要匹配的视觉风格。' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const signal = assertMaterialJob(job, exec)
      try {
        const found = await assets.searchMaterials!({ ownerSessionId: owner, generationId: job.generationId, scene: job.scene.scene,
          query: args.query, ...(args.kind === undefined ? {} : { kind: args.kind }), ...(args.purpose === undefined ? {} : { purpose: args.purpose }),
          ...(args.tags === undefined ? {} : { tags: args.tags }), ...(args.style === undefined ? {} : { style: args.style }), signal })
        assertMaterialJob(job, exec)
        return found
      } catch (error) { assertMaterialJob(job, exec); throw materialFailure(error) }
    },
    presentCall: () => ({ card: 'generic', title: '检索可复用素材', kind: 'other' }),
  }))
  child.tools.register(defineTool({
    name: 'physics_use_visual_material',
    description: '把选中的授权素材绑定到当前可视化，返回可在renderer/CSS中使用的path/cssPath。保留原始素材，复用不调用生图模型。',
    parameters: {
      materialId: { type: 'string', required: true, minLength: 1, maxLength: 128, description: '检索返回的素材ID。' },
      sha256: { type: 'string', required: true, pattern: '^[a-f0-9]{64}$', description: '同一候选返回的不可变图片摘要。' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const signal = assertMaterialJob(job, exec)
      try {
        const used = await assets.useMaterial!({ ownerSessionId: owner, generationId: job.generationId, scene: job.scene.scene,
          materialId: args.materialId, sha256: args.sha256, signal })
        assertMaterialJob(job, exec)
        return used
      } catch (error) { assertMaterialJob(job, exec); throw materialFailure(error) }
    },
    presentCall: () => ({ card: 'generic', title: '复用可视化素材', kind: 'other' }),
  }))
}

/**
 * The tool guard for a code child: only the allowed tools and a well-formed
 * `structured_output` pass. With chunked writes the committed source is
 * merged into the structured fields before the caps are checked.
 * @param allowed - tool names registered for this child.
 * @param chunked - whether source arrives through the write tool.
 * @param parts - the shared source assembly (read when `chunked`).
 * @returns the guard message, or `undefined` to allow the call.
 */
export const codeChildGuard = (
  allowed: readonly string[],
  chunked: boolean,
  parts: QuestionCodeParts,
) => (exec: ToolExecution): string | undefined => {
  if (allowed.includes(exec.name)) return undefined
  if (exec.name !== 'structured_output') return 'Code child accepts only structured_output'
  const source: Record<string, unknown> = { ...(exec.arguments as Record<string, unknown>), ...(chunked ? parts.source() : {}) }
  for (const [key, maximum] of Object.entries(SOURCE_LIMITS)) {
    if (typeof source[key] !== 'string' || source[key].length > maximum) return `Code source ${key} must be a string of at most ${maximum} characters`
  }
  if (!(source.title as string).trim() || !(source.rendererJs as string).trim()) return 'Code source title and rendererJs must not be empty'
  if (/\bfunction\s+renderFrame\s*\(/.test(source.rendererJs as string)
    && !/\bexport\s+(?:async\s+)?function\s+renderFrame\s*\(/.test(source.rendererJs as string)) {
    return chunked
      ? 'rendererJs缺少export：用physics_write_experiment_code replace修正入口，再append其余函数；最后只提交title/summary。'
      : 'rendererJs is missing export: begin the entry with export async function renderFrame(snapshot). Resubmit complete four fields now.'
  }
  return undefined
}
