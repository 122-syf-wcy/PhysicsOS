import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { CanvasAnnotationScene, JsonObject } from '@physicsos/physics-whiteboard'
import type { UsageModelReceiptInput } from './usage-types.ts'

export type CanvasAssistantMode = 'check' | 'draw'
export type CanvasAssistantStatus = 'queued' | 'reading' | 'thinking' | 'validating' | 'ready' | 'error' | 'cancelled'
export interface CanvasAssistantBinding {
  readonly canvasId: string
  readonly namespace: string
  readonly editSequence: number
  readonly head: { readonly version: number; readonly generation: number; readonly manifestDigest: string }
}
export interface CanvasAssistantResult {
  readonly summary: string
  readonly findings: readonly { readonly severity: 'info' | 'warning'; readonly message: string; readonly nodeIds: readonly string[] }[]
  readonly scene: CanvasAnnotationScene
}
export interface CanvasAssistantJob {
  readonly id: string
  readonly canvasId: string
  readonly mode: CanvasAssistantMode
  readonly status: CanvasAssistantStatus
  readonly binding: CanvasAssistantBinding
  readonly createdAt: string
  readonly updatedAt: string
  readonly result?: CanvasAssistantResult
  readonly error?: string
  readonly usage?: TokenUsage
}
export interface CanvasAssistantModelRequest {
  readonly provider: string
  readonly model: string
  readonly mode: CanvasAssistantMode
  readonly system: string
  readonly prompt: string
  readonly schema: JsonObject
  readonly maxTokens: number
  readonly attachment?: JsonObject
}
export interface CanvasAssistantModel {
  readonly provider: string
  readonly model: string
  prepareImage(bytes: Uint8Array, mimeType: 'image/png' | 'image/jpeg' | 'image/webp'): Promise<{ readonly attachment: JsonObject }>
  /** Durable admission happens after provider preflight, immediately before the real stream. */
  run(request: CanvasAssistantModelRequest, signal: AbortSignal, onRequestStart?: () => Promise<void>): Promise<{ readonly proposal?: unknown; readonly usage?: TokenUsage; readonly error?: string }>
}
export interface CanvasAssistantServiceOptions {
  readonly model: CanvasAssistantModel
  readonly recordUsage: (input: UsageModelReceiptInput) => Promise<void>
  readonly now?: () => Date
  readonly maxJobs?: number
  readonly maxConcurrentJobs?: number
  readonly maxContextBytes?: number
  readonly maxProposalBytes?: number
  readonly jobTimeoutMs?: number
}
