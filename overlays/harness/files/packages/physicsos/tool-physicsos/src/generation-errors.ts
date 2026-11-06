/**
 * The generation pipeline's failure vocabulary in one place: how a stopped
 * child run is classified, which failures earn the single bounded retry,
 * which ones are a transient upstream fault that may be resumed, what the
 * student reads for each, and the trusted repair hints the host's source
 * validation can hand back to the code author.
 * @module @deepseek-ai/dsh-tool-physicsos/generation-errors
 */

import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { CodeVisualizationSource } from '@physicsos/agent-tools'

/** Stable code carried on every generation failure. */
export type GenerationCode =
  | 'GENERATION_FAILED'
  | 'GENERATION_TIMEOUT'
  | 'GENERATION_ABORTED'
  | 'STALE_GENERATION'
  | 'CHILD_INCOMPLETE'
  | 'MAX_TOKENS'
  | 'UPSTREAM_STREAM_ERROR'
  | 'EMPTY_RESPONSE'
  | 'MISSING_STRUCTURED_OUTPUT'
  | 'INVALID_SOURCE'
  | 'INVALID_CODE_SOURCE'
  | 'INVALID_PACKAGE'
  | 'INVALID_METADATA'
  | 'UNSAFE_RESOURCES'
  | 'IMAGE_REQUIRED'
  | 'IMAGE_UNUSED'
  | 'ARTIFACTS_UNAVAILABLE'
  | 'CHILD_UNAVAILABLE'
  | (string & {})

/** An error carrying a stable generation code and optional recovery material. */
export interface GenerationError extends Error {
  readonly code: GenerationCode
  /** Source the child had committed before it stopped (token limit / upstream fault). */
  readonly partialSource?: PartialSource
  /** Host-trusted reason when a validation refused the source. */
  readonly sourceValidationReason?: string
}

/** The two files a child writes through the chunked tool. */
export type PartialSource = Pick<CodeVisualizationSource, 'rendererJs' | 'stylesheet'>

/**
 * Build a coded error. Every failure in the pipeline goes through here so
 * the code is a real property, never a message substring.
 * @param code - stable failure code.
 * @param message - diagnostic text (never shown to students; see {@link failureMessageFor}).
 * @param extra - recovery material to attach.
 * @returns the error.
 */
export const generationError = (
  code: GenerationCode,
  message: string,
  extra: { partialSource?: PartialSource | undefined; sourceValidationReason?: string } = {},
): GenerationError => Object.assign(new Error(message), {
  code,
  ...(extra.partialSource === undefined ? {} : { partialSource: extra.partialSource }),
  ...(extra.sourceValidationReason === undefined ? {} : { sourceValidationReason: extra.sourceValidationReason }),
})

/** The code of any thrown value; unknown shapes are a plain generation failure. */
export const codeOf = (error: unknown): GenerationCode =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'GENERATION_FAILED'

/** Host validation outcomes that earn the single repair attempt. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'INVALID_SOURCE', 'INVALID_CODE_SOURCE', 'INVALID_PACKAGE', 'INVALID_METADATA', 'UNSAFE_RESOURCES',
  'IMAGE_REQUIRED', 'IMAGE_UNUSED', 'MISSING_STRUCTURED_OUTPUT', 'UPSTREAM_STREAM_ERROR', 'EMPTY_RESPONSE',
])

/** Child diagnostics that mean the upstream channel broke, not the author. */
const TRANSIENT_DIAGNOSTICS: ReadonlySet<string> = new Set([
  'PI_AI_ERROR', 'UPSTREAM_STREAM_ERROR', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'SERVER',
])

/** Whether `code` is one of the failures the pipeline repairs once. */
export const isRetryable = (code: string): boolean => RETRYABLE_CODES.has(code)

/** Whether a child's terminal diagnostic names a transient upstream fault. */
export const isTransientDiagnostic = (diagnostic: string | undefined): boolean =>
  diagnostic !== undefined && TRANSIENT_DIAGNOSTICS.has(diagnostic)

/** Codes that resume the same job (keep assets and committed source) instead of repairing it. */
export const isResumeCode = (code: string): boolean =>
  code === 'MAX_TOKENS' || code === 'UPSTREAM_STREAM_ERROR' || code === 'EMPTY_RESPONSE'

/**
 * Hints the host's drawing validation may attach to a refusal. Only these
 * keys are trusted: anything else in `sourceValidationReason` is ignored so
 * the prompt never relays arbitrary host text to the model.
 */
export const SOURCE_VALIDATION_HINTS = {
  invalid_visibility_key: 'view.visible的键是observable（如forces、trajectory），不是vectors/trajectories/motionMarks/angles/dimensions等数组字段名。向量用view.visible[vector.observable]；波动只在键为false时隐藏。角度/尺寸按已给几何绘制。',
  missing_export: '必须使用字面声明 export function renderFrame(snapshot) { ... }，不能只定义未导出的 const renderFrame。',
  module_dependency: '删除所有 import、动态 import 和 reexport；仅使用本模块普通命名函数和原生浏览器 API。',
  missing_native_entry: '导出的 renderFrame 必须绑定本模块实际绘图的普通函数，不能使用对象/类方法或动态分派。',
  legacy_renderer: '删除旧平台绘图调用，直接在 #canvas 中绘制 snapshot.view 提供的几何。',
  missing_engine_geometry: '实际绘图坐标必须来自当前 snapshot.view 的物体、轨迹或装置几何；常量背景与未调用绘图函数不算画面。',
  missing_native_drawing: '在 #canvas 中挂载自己的 Canvas 2D 或原生 SVG，完成当前帧绘图后再返回。',
} as const

export type TrustedSourceValidationReason = keyof typeof SOURCE_VALIDATION_HINTS

/** The trusted validation reason an error carries, if any. */
export const trustedSourceValidationReason = (error: unknown): TrustedSourceValidationReason | undefined => {
  if (typeof error !== 'object' || error === null || !('sourceValidationReason' in error)) return undefined
  const reason = error.sourceValidationReason
  return typeof reason === 'string' && Object.hasOwn(SOURCE_VALIDATION_HINTS, reason)
    ? reason as TrustedSourceValidationReason
    : undefined
}

/** What the student reads on the card for a terminal failure code. */
export const failureMessageFor = (code: GenerationCode): string => {
  switch (code) {
    case 'GENERATION_TIMEOUT': return '题目实验生成超时，可重新生成。'
    case 'GENERATION_ABORTED': return '题目实验生成已停止，可重新生成。'
    case 'STALE_GENERATION': return '题目场景已更新，本次生成已丢弃。'
    case 'MAX_TOKENS': return '模型输出达到上限，题目实验代码仍未完成，可重新生成。'
    case 'UPSTREAM_STREAM_ERROR':
    case 'EMPTY_RESPONSE': return '模型通道在生成中途断开，已自动续写一次但仍未完成。请稍后重试。'
    default: return '题目实验代码生成未完成，可重新生成。'
  }
}

/** Partial source a stopped child left behind, if it is well-formed and within the write budget. */
export const checkedPartial = (value: unknown): PartialSource | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (Object.keys(value).sort().join(',') !== 'rendererJs,stylesheet') return undefined
  const { rendererJs, stylesheet } = value as PartialSource
  return typeof rendererJs === 'string' && rendererJs.length <= 24000
    && typeof stylesheet === 'string' && stylesheet.length <= 6000
    ? { rendererJs, stylesheet }
    : undefined
}

/** How a child run that did not complete is classified for the retry decision. */
export interface IncompleteRun {
  readonly code: GenerationCode
  readonly partialSource: PartialSource | undefined
  /** A token-limit stop may be resumed once if the job already owns assets or committed source. */
  readonly canContinueTokenLimit: boolean
}

/**
 * Classify a child that stopped without a structured result.
 * @param result - the child's terminal result (plus the provider's partial source).
 * @param assets - the job's asset manifest, if any.
 * @returns the failure code and what may be carried into a resume.
 */
export const classifyIncompleteRun = (
  result: SubagentResult & { partialSource?: unknown; diagnostic?: string },
  assets: unknown,
): IncompleteRun => {
  const partialSource = checkedPartial(result.partialSource)
  const hasAssets = Array.isArray(assets) && assets.length > 0
  const hasSource = partialSource !== undefined && Boolean(partialSource.rendererJs.trim() || partialSource.stylesheet.trim())
  const producedText = result.output.some(block => block.type === 'text' && block.text.trim())
  const code: GenerationCode = result.stopReason === 'max-tokens' ? 'MAX_TOKENS'
    : isTransientDiagnostic(result.diagnostic) ? 'UPSTREAM_STREAM_ERROR'
      : result.diagnostic === 'EMPTY_RESPONSE' ? 'EMPTY_RESPONSE'
        : result.diagnostic === undefined && hasAssets && producedText ? 'MISSING_STRUCTURED_OUTPUT'
          : 'CHILD_INCOMPLETE'
  return { code, partialSource, canContinueTokenLimit: result.stopReason === 'max-tokens' && (hasAssets || hasSource) }
}
