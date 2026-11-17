import type { DrawingDiagram, JsonObject, SourceImage, WhiteboardDocument } from '@physicsos/physics-whiteboard'
import type { WorkbenchLifecycleState } from '@physicsos/physics-workbench/protocol'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { UsageModelReceiptInput } from './usage-types.ts'
import type { ActivitySink } from './activity-contract.ts'
export type WhiteboardJobStatus = 'queued' | 'reading' | 'drawing' | 'validating' | 'ready' | 'error' | 'cancelled'
export interface WhiteboardSummary { readonly id: string; readonly title: string; readonly revision: number; readonly generation: number; readonly updatedAt: string; readonly archivedAt?: string; readonly deletedAt?: string }
export interface WhiteboardRecord { readonly document: WhiteboardDocument; readonly revision: number; readonly generation: number; readonly updatedAt: string; readonly archivedAt?: string; readonly deletedAt?: string; readonly activeGeneration?: { readonly jobId: string; readonly imageId: string }; readonly recoverableGenerations?: readonly { readonly jobId: string; readonly imageId: string; readonly status: WhiteboardJobStatus }[] }
export interface WhiteboardGeneration { readonly id: string; readonly whiteboardId: string; readonly imageId: string; readonly generation?: number; readonly currentHead?: WhiteboardSummary; readonly status: WhiteboardJobStatus; readonly result?: DrawingDiagram; readonly error?: string }
export interface WhiteboardDurableOperation {
  readonly owner: { readonly schoolId: string; readonly userKey: string }
  readonly resourceId: string
  /** Legacy receipts only retain the hash key; it is still a stable durable operation identity. */
  readonly operationId: string
  readonly requestHash: string
  readonly operation: 'create' | 'save' | 'archive' | 'unarchive' | 'delete' | 'restore' | 'copy'
  readonly occurredAt: string
  readonly revision: number
  readonly generation: number
}
export interface WhiteboardModelRequest { readonly provider: string; readonly model: string; readonly system: string; readonly prompt: string; readonly source: SourceImage; readonly attachment: JsonObject; readonly schema: JsonObject; readonly maxTokens: number }
export interface WhiteboardModel {
  readonly provider: string
  readonly model: string
  prepareImage(bytes: Uint8Array, mimeType: SourceImage['mimeType']): Promise<{ readonly width: number; readonly height: number; readonly attachment: JsonObject }>
  /** Await onRequestStart only after preflight and immediately before invoking the provider stream. */
  draw(request: WhiteboardModelRequest, signal: AbortSignal, onRequestStart?: () => Promise<void>): Promise<{ readonly diagram?: unknown; readonly error?: string; readonly usage?: TokenUsage }>
}
export type WhiteboardListState = WorkbenchLifecycleState | 'all'
export interface WhiteboardServiceOptions {
  readonly model: WhiteboardModel
  readonly recordUsage: (input: UsageModelReceiptInput) => Promise<void>
  /** False by default. Never disables lifecycle readers, fences, or task/usage recovery. */
  readonly lifecycleWritesEnabled?: boolean
  /** At-least-once/replayable; delivery failures cannot roll back a durable operation. */
  readonly onDurableOperation?: (operation: WhiteboardDurableOperation) => Promise<void>
  readonly onDurableOperationError?: (error: unknown) => void
  readonly activitySink?: ActivitySink
  readonly now?: () => Date
  readonly maxDocumentBytes?: number
  readonly maxImageBytes?: number
  readonly maxAccountBytes?: number
  readonly maxDocuments?: number
  readonly maxJobs?: number
  readonly maxReceipts?: number
  readonly jobTimeoutMs?: number
}
