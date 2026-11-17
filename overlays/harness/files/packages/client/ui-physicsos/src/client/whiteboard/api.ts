import type { DrawingDiagram, SourceImage, WhiteboardDocument } from '@physicsos/physics-whiteboard'
import type { WorkbenchLifecycleCapabilities, WorkbenchLifecycleState } from '@physicsos/physics-workbench/protocol'

/** generation is optional only at legacy cache/custom-adapter boundaries; the HTTP adapter normalizes it. */
export interface WhiteboardSummary { readonly id: string; readonly title: string; readonly updatedAt: string; readonly revision: number; readonly generation?: number; readonly archivedAt?: string; readonly deletedAt?: string }
export interface WhiteboardRecord { readonly document: WhiteboardDocument; readonly revision: number; readonly generation?: number; readonly updatedAt: string; readonly archivedAt?: string; readonly deletedAt?: string; readonly activeGeneration?: { readonly jobId: string; readonly imageId: string }; readonly recoverableGenerations?: readonly { readonly jobId: string; readonly imageId: string; readonly status: GenerationStatus }[] }
export type GenerationStatus = 'queued' | 'reading' | 'drawing' | 'validating' | 'ready' | 'error' | 'cancelled'
export interface WhiteboardGeneration {
  readonly id: string
  readonly whiteboardId: string
  readonly imageId: string
  readonly generation?: number
  readonly currentHead?: WhiteboardSummary
  readonly status: GenerationStatus
  readonly result?: DrawingDiagram
  readonly error?: string
}
export interface WhiteboardFence { readonly expectedRevision: number; readonly expectedGeneration: number; readonly operationId: string }
export type WhiteboardLifecycleOperation = 'archive' | 'unarchive' | 'delete' | 'restore'
export interface PendingWhiteboardLifecycle extends WhiteboardFence { readonly id: string; readonly operation: WhiteboardLifecycleOperation }
export class WhiteboardRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly currentHead?: WhiteboardSummary,
    readonly retryable = status === 408 || status === 429 || status >= 500) { super(message); this.name = 'WhiteboardRequestError' }
}
export const whiteboardGenerationOf = (value: { readonly generation?: number }): number => value.generation ?? 1
export const whiteboardSummaryOf = (value: WhiteboardRecord): WhiteboardSummary => ({ id: value.document.id, title: value.document.title,
  revision: value.revision, generation: whiteboardGenerationOf(value), updatedAt: value.updatedAt,
  ...(value.archivedAt === undefined ? {} : { archivedAt: value.archivedAt }), ...(value.deletedAt === undefined ? {} : { deletedAt: value.deletedAt }) })

/** Account authority, bytes and CAS live in the root's actual durable service. */
export interface WhiteboardApi {
  capabilities?(input: { readonly signal?: AbortSignal }): Promise<WorkbenchLifecycleCapabilities>
  list(input: { readonly signal?: AbortSignal; readonly state?: WorkbenchLifecycleState | 'all' }): Promise<readonly WhiteboardSummary[]>
  create(input: { readonly title: string; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  read(input: { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  readRetained?(input: { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  save(input: { readonly id: string; readonly document: WhiteboardDocument; readonly expectedRevision: number; readonly expectedGeneration?: number; readonly editingSessionId?: string; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  archive?(input: WhiteboardFence & { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  unarchive?(input: WhiteboardFence & { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  remove?(input: WhiteboardFence & { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  restore?(input: WhiteboardFence & { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  copy?(input: WhiteboardFence & { readonly id: string; readonly title: string; readonly document?: WhiteboardDocument; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  uploadImage(input: { readonly whiteboardId: string; readonly file: Blob; readonly expectedRevision?: number; readonly expectedGeneration?: number; readonly operationId: string; readonly signal?: AbortSignal }): Promise<SourceImage>
  readImage(input: { readonly whiteboardId: string; readonly imageId: string; readonly signal?: AbortSignal }): Promise<{ readonly blob: Blob; readonly source: SourceImage }>
  startGeneration(input: { readonly whiteboardId: string; readonly imageId: string; readonly expectedRevision: number; readonly expectedGeneration?: number; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardGeneration>
  readGeneration(input: { readonly whiteboardId: string; readonly jobId: string; readonly signal?: AbortSignal }): Promise<WhiteboardGeneration>
  cancelGeneration(input: { readonly whiteboardId: string; readonly jobId: string; readonly expectedRevision?: number; readonly expectedGeneration?: number; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardGeneration>
}
