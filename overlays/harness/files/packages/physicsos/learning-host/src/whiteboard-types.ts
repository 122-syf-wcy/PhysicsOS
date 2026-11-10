import type { DrawingDiagram, JsonObject, SourceImage, WhiteboardDocument } from '@physicsos/physics-whiteboard'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { UsageModelReceiptInput } from './usage-types.ts'
export type WhiteboardJobStatus = 'queued' | 'reading' | 'drawing' | 'validating' | 'ready' | 'error' | 'cancelled'
export interface WhiteboardRecord { readonly document: WhiteboardDocument; readonly revision: number; readonly updatedAt: string; readonly activeGeneration?: { readonly jobId: string; readonly imageId: string }; readonly recoverableGenerations?: readonly { readonly jobId: string; readonly imageId: string; readonly status: WhiteboardJobStatus }[] }
export interface WhiteboardGeneration { readonly id: string; readonly whiteboardId: string; readonly imageId: string; readonly status: WhiteboardJobStatus; readonly result?: DrawingDiagram; readonly error?: string }
export interface WhiteboardModelRequest { readonly provider: string; readonly model: string; readonly system: string; readonly prompt: string; readonly source: SourceImage; readonly attachment: JsonObject; readonly schema: JsonObject; readonly maxTokens: number }
export interface WhiteboardModel {
  readonly provider: string
  readonly model: string
  prepareImage(bytes: Uint8Array, mimeType: SourceImage['mimeType']): Promise<{ readonly width: number; readonly height: number; readonly attachment: JsonObject }>
  /** Await onRequestStart only after preflight and immediately before invoking the provider stream. */
  draw(request: WhiteboardModelRequest, signal: AbortSignal, onRequestStart?: () => Promise<void>): Promise<{ readonly diagram?: unknown; readonly error?: string; readonly usage?: TokenUsage }>
}
export interface WhiteboardServiceOptions { readonly model: WhiteboardModel; readonly recordUsage: (input: UsageModelReceiptInput) => Promise<void>; readonly now?: () => Date; readonly maxDocumentBytes?: number; readonly maxImageBytes?: number; readonly maxAccountBytes?: number; readonly maxDocuments?: number; readonly maxJobs?: number; readonly maxReceipts?: number; readonly jobTimeoutMs?: number }
