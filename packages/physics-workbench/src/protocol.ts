import type {
  CanvasGraph,
  CanvasManifest,
  CanvasStoredValue,
  Digest,
  JsonObject,
  MergeConflict,
  WorkbenchObject,
} from './types.ts'

export const CANVAS_PROTOCOL_VERSION = 1 as const

/** Metadata head. version is the CAS token; generation fences delete/restore lifetimes. */
export interface CanvasHead {
  readonly id: string
  readonly title: string
  readonly version: number
  readonly generation: number
  /** Account-wide monotonic sequence assigned only after durable head publication. */
  readonly changeSeq: number
  readonly manifestDigest: Digest
  readonly createdAt: string
  readonly updatedAt: string
  readonly deletedAt?: string
}
export interface CanvasCreateRequest {
  readonly id: string
  readonly title: string
  /** Omitted until the server establishes the document and its empty manifest. */
  readonly manifestDigest?: Digest
  readonly mutationId: string
}
export interface CanvasCommitRequest {
  readonly expectedVersion: number
  readonly expectedGeneration?: number
  readonly mutationId: string
  readonly manifestDigest: Digest
}
export interface CanvasRenameRequest {
  readonly expectedVersion: number
  readonly mutationId: string
  readonly title: string
  /** When omitted, the server creates the renamed manifest from the current head. */
  readonly manifestDigest?: Digest
}
export interface CanvasDeleteRequest {
  readonly expectedVersion: number
  readonly mutationId: string
}
export interface CanvasRestoreRequest {
  readonly expectedVersion: number
  readonly expectedGeneration?: number
  readonly mutationId: string
}
export interface CanvasCopyRequest {
  readonly expectedVersion: number
  readonly mutationId: string
  readonly id: string
  readonly title: string
  /** When omitted, the server clones the authorized dependency graph. */
  readonly manifestDigest?: Digest
}
export interface CanvasObjectUpload {
  readonly digest: Digest
  readonly object: CanvasStoredValue
}
export interface CanvasObjectDownload {
  readonly digest: Digest
  readonly object: CanvasStoredValue
  readonly byteLength: number
}
export interface CanvasOpenResponse {
  readonly head: CanvasHead
  readonly manifest: CanvasManifest
}
export interface CanvasCommitResponse {
  readonly head: CanvasHead
  readonly manifest?: CanvasManifest
  /** Idempotent retries return the original successful head, without another mutation. */
  readonly replayed: boolean
}
export interface CanvasListResponse {
  readonly items: readonly CanvasHead[]
  readonly nextCursor?: string
}
export interface CanvasChange {
  readonly seq: number
  readonly operation: 'create' | 'commit' | 'rename' | 'delete' | 'restore' | 'copy'
  readonly head: CanvasHead
  readonly mutationId: string
}
export interface CanvasChangesResponse {
  readonly changes: readonly CanvasChange[]
  readonly cursor: number
  readonly hasMore: boolean
}
export interface CanvasObjectUploadResponse {
  readonly digest: Digest
  readonly kind: 'manifest' | WorkbenchObject['kind']
  readonly byteLength: number
  readonly bytes: number
  readonly existed: boolean
}

/** Server-owned response, never an uploadable WorkbenchObject or client-authored certificate. */
export interface CanvasVerificationReceipt {
  readonly id: string
  readonly canvasId: string
  readonly captureDigest: Digest
  readonly checkedAt: string
  readonly status: 'verified' | 'rejected' | 'unsupported' | 'error'
  readonly engineId: string
  readonly engineVersion: string
  readonly sceneDigest: Digest
  readonly details: JsonObject
}
/** Authenticated metadata discovery; each receipt still has its own immutable read endpoint. */
export interface CanvasVerificationListResponse {
  readonly items: readonly { readonly receipt: CanvasVerificationReceipt; readonly resultDigest?: Digest }[]
  readonly nextCursor?: string
}
/** Deployment-owned resource bounds; this response version does not migrate document/storage schemas. */
export interface CanvasResourcePolicy {
  readonly schemaVersion: 1
  readonly limits: import('./graph.ts').GraphLimits
}
export interface CanvasVerifyRequest {
  readonly captureDigest: Digest
  readonly mutationId: string
}
export interface CanvasApiError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly currentHead?: CanvasHead
  readonly conflicts?: readonly MergeConflict[]
  readonly details?: JsonObject
}

/** Serializable offline commit queue; the caller owns IndexedDB, networking, and retry scheduling. */
export interface CanvasOutboxEntry {
  readonly id: string
  readonly canvasId: string
  readonly createdAt: string
  readonly baseHead: CanvasHead
  readonly request: CanvasCommitRequest
  readonly graph: CanvasGraph
  readonly status: 'pending' | 'sending' | 'conflict' | 'failed'
  readonly attempts: number
  readonly lastError?: CanvasApiError
}
export interface CanvasWorkingCopy {
  readonly schemaVersion: 1
  readonly canvasId: string
  readonly baseHead?: CanvasHead
  readonly base: CanvasManifest
  readonly working: CanvasManifest
  readonly objects: Readonly<Record<Digest, WorkbenchObject>>
  readonly outbox: readonly CanvasOutboxEntry[]
}
