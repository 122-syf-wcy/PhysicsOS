/**
 * The two tools the restricted code child may call, and the guard that keeps
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
import { MAX_CODE_PART_CHARACTERS, QuestionCodeParts } from './question-code-parts.ts'

/** The asset service the host provides when image generation is configured. */
export interface AssetService {
  generateAsset(input: {
    ownerSessionId: string
    generationId: string
    scene: unknown
    prompt: string
    kind: 'environment' | 'material'
    signal: AbortSignal
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
    description: `提交实验JS或CSS，优先完整JS一次replace、CSS一次replace；同一任务最多10次（中断续写共用额度）。JS每次及合计最多${MAX_CODE_PART_CHARACTERS}、CSS合计最多6000字符；需要时可append。完成后structured_output只提交title/summary。`,
    parameters: {
      file: { type: 'string', required: true, enum: ['rendererJs', 'stylesheet'] },
      mode: { type: 'string', required: true, enum: ['replace', 'append'] },
      content: { type: 'string', required: true, description: `源码原文，无Markdown；rendererJs每次及合计最多${MAX_CODE_PART_CHARACTERS}字符，stylesheet合计最多6000字符。优先整文件一次replace。` },
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
    description: '调用平台已配置的gpt-image-2.5-sunburst为本题制作Warm Lab环境/材质图片。每题最多2次，通常1张环境已足够。不要生成文字、公式、轨迹或测量结果。成功返回本包图片path和CSS路径并须实际使用；仅平台确认瞬态故障时返回mode:native，立即用原生Canvas/SVG绘图，不重试生图或伪造图片路径。',
    parameters: {
      prompt: { type: 'string', required: true, description: '具体美术构图、材质、灯光、留白位置；不超过5000字。图片不可含物理读数或运动结果。' },
      kind: { type: 'string', required: true, enum: ['environment', 'material'], description: 'environment为实验环境/场景背景，material为器材表面材质。' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (job.signal.aborted || exec.signal.aborted) throw new HarnessError('素材生成已取消。', 'IMAGE_ABORTED')
      if (!jobIsCurrent(job)) throw new HarnessError('题目生成任务已更新。', 'STALE_GENERATION')
      try {
        return await assets.generateAsset({
          ownerSessionId: owner, generationId: job.generationId, scene: job.scene.scene,
          prompt: args.prompt, kind: args.kind, signal: AbortSignal.any([job.signal, exec.signal]),
        })
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
