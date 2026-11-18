/** Private, reusable appearance assets. None of these contracts grants account identity. */
export type VisualMaterialKind = 'environment' | 'material'
export type VisualMaterialVisibility = 'private' | 'school'
export type VisualMaterialLifecycle = 'pending' | 'ready' | 'deleted' | 'canceled' | 'failed'

/** Trusted host seam: resolve this from auth on every request/tool invocation, never model arguments. */
export interface VisualMaterialActor {
  readonly userKey: string
  readonly schoolId: string
  readonly username?: string
  readonly role?: string
}

/** Safe for the authenticated catalog, NOT a public package manifest. Text is always untrusted data. */
export interface VisualMaterialDescriptor {
  readonly id: string
  readonly revision: number
  readonly sha256: string
  readonly byteLength: number
  readonly mediaType: 'image/png'
  readonly width: number
  readonly height: number
  readonly kind: VisualMaterialKind
  readonly theme: string
  readonly purpose: string
  readonly tags: readonly string[]
  readonly style?: string
  readonly model: string
  readonly lifecycle: VisualMaterialLifecycle
  readonly visibility: VisualMaterialVisibility
  readonly createdAt: number
  readonly updatedAt: number
  readonly metadataTrust: 'untrusted'
}

/** Actual generation usage is private provenance, strictly numeric and bounded. */
export interface VisualMaterialGenerationUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly textInputTokens?: number
  readonly imageInputTokens?: number
}

export interface StoreGeneratedVisualMaterial {
  /** Owner-scoped, stable across retries; one operation describes exactly one generated image. */
  readonly operationId: string
  readonly bytes: Uint8Array
  readonly mediaType: 'image/png'
  readonly width: number
  readonly height: number
  readonly model: string
  readonly theme: string
  readonly purpose: string
  readonly kind: VisualMaterialKind
  readonly tags: readonly string[]
  readonly style?: string
  /** Private service-side provenance. Never returned by catalog/REST/package projection. */
  readonly prompt?: string
  readonly sourceJobId?: string
  readonly generationChannelId?: string
  readonly generationConfigRevision?: string
  readonly generationUsage?: VisualMaterialGenerationUsage
}

export interface VisualMaterialSearch {
  readonly query?: string
  /** Dimension filters are exact NFKC/lowercase/whitespace-normalized matches. Query is lexical OR. */
  readonly theme?: string
  readonly purpose?: string
  readonly kind?: VisualMaterialKind
  readonly tags?: readonly string[]
  readonly style?: string
  readonly minWidth?: number
  readonly minHeight?: number
  readonly cursor?: string
  readonly limit?: number
}

export interface VisualMaterialList {
  readonly lifecycle?: VisualMaterialLifecycle | 'all'
  readonly cursor?: string
  readonly limit?: number
}

export interface VisualMaterialMatch {
  /** Sum of the five field contributions; no hidden semantic/embedding score. */
  readonly score: number
  readonly matchedTerms: readonly string[]
  readonly fields: Readonly<Record<'theme' | 'purpose' | 'tags' | 'style' | 'kind', number>>
}

export interface VisualMaterialSearchItem extends VisualMaterialDescriptor {
  readonly match: VisualMaterialMatch
}

export interface VisualMaterialSearchPage {
  readonly items: readonly VisualMaterialSearchItem[]
  readonly nextCursor?: string
}

export interface VisualMaterialListPage {
  readonly items: readonly VisualMaterialDescriptor[]
  readonly nextCursor?: string
}

export interface ManageVisualMaterial {
  readonly expectedRevision: number
  readonly operationId: string
  readonly updateTags?: readonly string[]
  /** Only the owner can opt into school sharing. Public is deliberately not a value. */
  readonly visibility?: VisualMaterialVisibility
  readonly softdelete?: true
  readonly restore?: true
}

export interface VerifiedVisualMaterialBytes {
  readonly descriptor: VisualMaterialDescriptor
  readonly bytes: Buffer
  readonly mediaType: 'image/png'
}

export interface VisualMaterialUsage {
  /** Logical retained bytes/count, including tombstones and pending reservations. No silent eviction. */
  readonly bytes: number
  readonly count: number
  readonly operations: number
  readonly activeCount: number
  readonly stageBytes: number
}

export interface VisualMaterialQuota {
  readonly account: VisualMaterialUsage
  readonly global: VisualMaterialUsage
}

export interface VisualMaterialLimits {
  readonly maxImageBytes: number
  readonly maxAccountBytes: number
  readonly maxGlobalBytes: number
  readonly maxAccountCount: number
  readonly maxGlobalCount: number
  readonly maxAccountOperations: number
  readonly maxGlobalOperations: number
  readonly maxAccountConcurrent: number
  readonly maxGlobalConcurrent: number
  readonly maxStageBytes: number
}

export const VISUAL_MATERIAL_DISK_RESERVE = 256 * 1024 * 1024
export const VISUAL_MATERIAL_HARD_IMAGE_BYTES = 6 * 1024 * 1024
export const VISUAL_MATERIAL_MAX_DIMENSION = 4096
export const VISUAL_MATERIAL_MAX_PIXELS = 8_388_608
export const VISUAL_MATERIAL_DEFAULT_LIMITS: Readonly<VisualMaterialLimits> = Object.freeze({
  maxImageBytes: VISUAL_MATERIAL_HARD_IMAGE_BYTES,
  maxAccountBytes: 256 * 1024 * 1024,
  maxGlobalBytes: 4 * 1024 * 1024 * 1024,
  maxAccountCount: 1000,
  maxGlobalCount: 20_000,
  maxAccountOperations: 20_000,
  maxGlobalOperations: 400_000,
  maxAccountConcurrent: 2,
  maxGlobalConcurrent: 8,
  maxStageBytes: 48 * 1024 * 1024,
})

export function visualMaterialLimits(input: Partial<VisualMaterialLimits> = {}): VisualMaterialLimits {
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(VISUAL_MATERIAL_DEFAULT_LIMITS, key)) throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Invalid visual material limits.')
  }
  const limits = { ...VISUAL_MATERIAL_DEFAULT_LIMITS, ...input }
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual material limits must be positive safe integers.')
  }
  if (limits.maxImageBytes > VISUAL_MATERIAL_HARD_IMAGE_BYTES || limits.maxStageBytes < limits.maxImageBytes) {
    throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Image/staging limits exceed the bounded PNG contract.')
  }
  return Object.freeze(limits)
}

/** Messages/details are intentionally fixed, never SQL, paths, private prompts or provider diagnostics. */
export class VisualMaterialError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: Readonly<{ materialId?: string; operationId?: string; retryable?: boolean }> | undefined
  constructor(status: number, code: string, message: string,
    detail?: Readonly<{ materialId?: string; operationId?: string; retryable?: boolean }>, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VisualMaterialError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export function visualMaterialAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'The visual material operation was canceled.')
}

export type VisualMaterialTermField = 'theme' | 'purpose' | 'tags' | 'style' | 'kind'
export interface VisualMaterialTerm {
  readonly term: string
  readonly field: VisualMaterialTermField
  readonly weight: number
}
export interface VisualMaterialIndex {
  readonly themeKey: string
  readonly purposeKey: string
  readonly styleKey: string
  readonly tagKeys: readonly string[]
  readonly terms: readonly string[]
  readonly entries: readonly VisualMaterialTerm[]
}

/** Repository/service-only row. Never spread this into a tool, HTTP response or artifact provenance. */
export interface VisualMaterialRecord extends VisualMaterialDescriptor {
  readonly ownerKey: string
  readonly schoolId: string
  readonly shareSchoolId?: string
  readonly operationId: string
  readonly privatePrompt?: string
  readonly sourceJobId?: string
  readonly generationChannelId?: string
  readonly generationConfigRevision?: string
  readonly generationUsage?: VisualMaterialGenerationUsage
  readonly index: VisualMaterialIndex
  readonly blobDurable: boolean
  readonly publicationPending: boolean
  /** Reservation charges retained bytes/count until explicit canceled-without-bytes reconciliation. */
  readonly retentionCharged: boolean
}

export interface VisualMaterialPosition {
  readonly score: number
  readonly createdAt: number
  readonly id: string
}
/** Timestamp-cutoff keyset page; subsequently modified rows are omitted, not a historical MVCC snapshot. */
export interface VisualMaterialSearchPlan {
  readonly mode: 'search' | 'owned'
  readonly queryKey: string
  readonly queryTerms: readonly string[]
  readonly themeKey?: string
  readonly purposeKey?: string
  readonly tagKeys: readonly string[]
  readonly styleKey?: string
  readonly kind?: VisualMaterialKind
  readonly minWidth?: number
  readonly minHeight?: number
  readonly lifecycle?: VisualMaterialLifecycle | 'all'
  readonly limit: number
  readonly asOf: number
  readonly after?: VisualMaterialPosition
}
export interface VisualMaterialRepositoryHit {
  readonly record: VisualMaterialRecord
  readonly match: VisualMaterialMatch
}
export interface VisualMaterialReservation {
  readonly record: VisualMaterialRecord
  readonly created: boolean
  readonly stageBytesReserved: number
}
export interface VisualMaterialRecoveryPosition {
  readonly createdAt: number
  readonly id: string
}
export interface VisualMaterialRecoveryPage {
  readonly items: readonly VisualMaterialRecord[]
  readonly next?: VisualMaterialRecoveryPosition
}

/**
 * Structural SQL-backed contract. Implementations own all quota/idempotence/revision transactions.
 * Search returns at most limit+1 rows; it must not snapshot/parse a storage-domain unit.
 * Production composition must use PostgresVisualMaterialRepository, never a memory fallback.
 */
export interface VisualMaterialRepository {
  readonly persistence: 'postgres' | 'test-memory'
  initialize(signal?: AbortSignal): Promise<void>
  assertAvailable(): void
  close(): Promise<void>
  reserveGenerated(actor: VisualMaterialActor, record: VisualMaterialRecord, fingerprint: string, signal?: AbortSignal): Promise<VisualMaterialReservation>
  completePublication(actor: VisualMaterialActor, id: string, operationId: string, at: number, signal?: AbortSignal): Promise<VisualMaterialRecord>
  reconcileCanceledPublication(actor: VisualMaterialActor, id: string, operationId: string, durable: boolean, at: number): Promise<void>
  notePublicationFailure(actor: VisualMaterialActor, id: string, operationId: string, code: string): Promise<void>
  /** Also journals cancellation before a model result arrives. It cannot be undone by a late store. */
  cancelGenerated(actor: VisualMaterialActor, operationId: string, at: number): Promise<void>
  get(actor: VisualMaterialActor, id: string, options?: { readonly ownedOnly?: boolean; readonly includeInactive?: boolean }, signal?: AbortSignal): Promise<VisualMaterialRecord | undefined>
  search(actor: VisualMaterialActor, plan: VisualMaterialSearchPlan, signal?: AbortSignal): Promise<readonly VisualMaterialRepositoryHit[]>
  manage(actor: VisualMaterialActor, id: string, input: ManageVisualMaterial, fingerprint: string, at: number, signal?: AbortSignal): Promise<VisualMaterialDescriptor>
  quota(actor: VisualMaterialActor, signal?: AbortSignal): Promise<VisualMaterialQuota>
  pendingPublications(input: { readonly limit: number; readonly after?: VisualMaterialRecoveryPosition }, signal?: AbortSignal): Promise<VisualMaterialRecoveryPage>
}

export type VisualMaterialPngValidator = (bytes: Buffer) => { readonly width: number; readonly height: number }

/** Privileged private filesystem seam; only call after repository authorization. No URL/digest endpoint. */
export interface VisualMaterialBlobStore {
  initialize(): Promise<void>
  cursorKey(): Promise<Buffer>
  /** Reservation includes this image's actual byte length plus other unfinished stages. */
  publish(record: VisualMaterialRecord, bytes: Buffer, stageBytesReserved: number, fence: () => void): Promise<void>
  recover(record: VisualMaterialRecord, stageBytesReserved: number, fence: () => void): Promise<'durable' | 'missing'>
  read(record: VisualMaterialRecord, fence: () => void): Promise<Buffer>
}

export interface VisualMaterialRecoveryResult {
  readonly recovered: number
  readonly pending: number
  readonly issues: readonly { readonly id: string; readonly code: string }[]
  readonly next?: VisualMaterialRecoveryPosition
}

export interface VisualMaterialService {
  initialize(signal?: AbortSignal): Promise<void>
  storeGenerated(actor: VisualMaterialActor, input: StoreGeneratedVisualMaterial, signal?: AbortSignal): Promise<VisualMaterialDescriptor>
  search(actor: VisualMaterialActor, input?: VisualMaterialSearch, signal?: AbortSignal): Promise<VisualMaterialSearchPage>
  list(actor: VisualMaterialActor, input?: VisualMaterialList, signal?: AbortSignal): Promise<VisualMaterialListPage>
  describe(actor: VisualMaterialActor, id: string, signal?: AbortSignal): Promise<VisualMaterialDescriptor>
  /** Both return verified owned/school-authorized bytes for COPYING into the current artifact/job. */
  select(actor: VisualMaterialActor, id: string, sha256?: string, signal?: AbortSignal): Promise<VerifiedVisualMaterialBytes>
  readBytes(actor: VisualMaterialActor, id: string, sha256?: string, signal?: AbortSignal): Promise<VerifiedVisualMaterialBytes>
  manage(actor: VisualMaterialActor, id: string, input: ManageVisualMaterial, signal?: AbortSignal): Promise<VisualMaterialDescriptor>
  cancelGeneratedOperation(actor: VisualMaterialActor, operationId: string): Promise<void>
  quota(actor: VisualMaterialActor, signal?: AbortSignal): Promise<VisualMaterialQuota>
  /** Host startup/operator recovery, not a model/REST method. Bounded keyset batches, no silent deletion. */
  recoverPending(input?: { readonly limit?: number; readonly after?: VisualMaterialRecoveryPosition }, signal?: AbortSignal): Promise<VisualMaterialRecoveryResult>
}

/** Deliberate allowlist: even theme/tags/model can contain user data, so no catalog text goes public. */
export function visualMaterialPackageProvenance(item: VisualMaterialDescriptor): Readonly<{
  source: 'PhysicsOS generated appearance material'
  sha256: string
  mediaType: 'image/png'
  width: number
  height: number
  kind: VisualMaterialKind
  usage: 'Appearance only; physics remains engine-owned'
}> {
  return {
    source: 'PhysicsOS generated appearance material', sha256: item.sha256, mediaType: 'image/png',
    width: item.width, height: item.height, kind: item.kind,
    usage: 'Appearance only; physics remains engine-owned',
  }
}

/** Explicit projection, including for owner reads: private provenance and storage keys stay server-side. */
export function visualMaterialDescriptor(row: VisualMaterialDescriptor): VisualMaterialDescriptor {
  return {
    id: row.id, revision: row.revision, sha256: row.sha256, byteLength: row.byteLength,
    mediaType: 'image/png', width: row.width, height: row.height, kind: row.kind,
    theme: row.theme, purpose: row.purpose, tags: [...row.tags], model: row.model,
    ...(row.style === undefined ? {} : { style: row.style }), lifecycle: row.lifecycle,
    visibility: row.visibility, createdAt: row.createdAt, updatedAt: row.updatedAt, metadataTrust: 'untrusted',
  }
}
