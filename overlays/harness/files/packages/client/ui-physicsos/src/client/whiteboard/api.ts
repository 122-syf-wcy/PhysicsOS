import type { DrawingDiagram, SourceImage, WhiteboardDocument } from '@physicsos/physics-whiteboard'

export interface WhiteboardSummary { readonly id: string; readonly title: string; readonly updatedAt: string; readonly revision: number }
export interface WhiteboardRecord { readonly document: WhiteboardDocument; readonly revision: number; readonly updatedAt: string; readonly activeGeneration?: { readonly jobId: string; readonly imageId: string }; readonly recoverableGenerations?: readonly { readonly jobId: string; readonly imageId: string; readonly status: GenerationStatus }[] }
export type GenerationStatus = 'queued' | 'reading' | 'drawing' | 'validating' | 'ready' | 'error' | 'cancelled'
export interface WhiteboardGeneration {
  readonly id: string
  readonly whiteboardId: string
  readonly imageId: string
  readonly status: GenerationStatus
  readonly result?: DrawingDiagram
  readonly error?: string
}
/** Account authority, bytes and CAS live in the root's actual durable service. */
export interface WhiteboardApi {
  list(input: { readonly signal?: AbortSignal }): Promise<readonly WhiteboardSummary[]>
  create(input: { readonly title: string; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  read(input: { readonly id: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  save(input: { readonly id: string; readonly document: WhiteboardDocument; readonly expectedRevision: number; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardRecord>
  uploadImage(input: { readonly whiteboardId: string; readonly file: Blob; readonly operationId: string; readonly signal?: AbortSignal }): Promise<SourceImage>
  readImage(input: { readonly whiteboardId: string; readonly imageId: string; readonly signal?: AbortSignal }): Promise<{ readonly blob: Blob; readonly source: SourceImage }>
  startGeneration(input: { readonly whiteboardId: string; readonly imageId: string; readonly expectedRevision: number; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardGeneration>
  readGeneration(input: { readonly whiteboardId: string; readonly jobId: string; readonly signal?: AbortSignal }): Promise<WhiteboardGeneration>
  cancelGeneration(input: { readonly whiteboardId: string; readonly jobId: string; readonly operationId: string; readonly signal?: AbortSignal }): Promise<WhiteboardGeneration>
}
