/** Retain first, reuse/search separately; generation and artifact binding stay in the caller. */
import { randomBytes } from 'node:crypto'
import {
  VisualMaterialError, visualMaterialAborted, visualMaterialDescriptor, visualMaterialLimits,
  type ManageVisualMaterial, type StoreGeneratedVisualMaterial, type VerifiedVisualMaterialBytes,
  type VisualMaterialActor, type VisualMaterialBlobStore, type VisualMaterialDescriptor,
  type VisualMaterialLimits, type VisualMaterialList, type VisualMaterialListPage,
  type VisualMaterialPngValidator, type VisualMaterialQuota, type VisualMaterialRecord,
  type VisualMaterialRecoveryPosition, type VisualMaterialRecoveryResult,
  type VisualMaterialRepository, type VisualMaterialSearch, type VisualMaterialSearchPage,
  type VisualMaterialService,
} from './visual-material-contracts.ts'
import {
  VisualMaterialCursorCodec, visualMaterialActor, visualMaterialDigest, visualMaterialFingerprint,
  visualMaterialGeneratedMetadata, visualMaterialId, visualMaterialIndex, visualMaterialListPlan,
  visualMaterialManageInput, visualMaterialOperationId, visualMaterialSearchPlan, visualMaterialSha,
} from './visual-material-domain.ts'
import { validateVisualMaterialPng } from './visual-material-png.ts'

export interface DefaultVisualMaterialServiceOptions {
  readonly repository: VisualMaterialRepository
  readonly blobs: VisualMaterialBlobStore
  readonly limits?: Partial<VisualMaterialLimits>
  readonly validatePng?: VisualMaterialPngValidator
  /** Only permits explicit test fixtures, and is refused when NODE_ENV=production. */
  readonly testOnly?: true
  readonly now?: () => number
}
const notFound = (): never => { throw new VisualMaterialError(404, 'NOT_FOUND', 'Visual material not found.') }
const errorCode = (error: unknown): string => error instanceof VisualMaterialError ? error.code : 'PUBLICATION_PENDING'

export class DefaultVisualMaterialService implements VisualMaterialService {
  private readonly repository: VisualMaterialRepository
  private readonly blobs: VisualMaterialBlobStore
  private readonly limits: VisualMaterialLimits
  private readonly validator: VisualMaterialPngValidator
  private readonly clock: () => number
  private codec: VisualMaterialCursorCodec | undefined
  private initializing: Promise<void> | undefined
  private readonly work = new Map<string, number>()
  private active = 0
  private publicationActive = 0
  private residentBytes = 0
  private recovering = false
  private readonly publications = new Set<string>()
  constructor(options: DefaultVisualMaterialServiceOptions) {
    if (options.repository.persistence !== 'postgres' && (options.testOnly !== true || process.env.NODE_ENV === 'production')) {
      throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Production visual material services require PostgreSQL; there is no memory fallback.')
    }
    this.repository = options.repository; this.blobs = options.blobs
    this.limits = visualMaterialLimits(options.limits)
    this.validator = options.validatePng ?? validateVisualMaterialPng
    this.clock = options.now ?? Date.now
  }
  private now(): number {
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0) throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual material clock is invalid.')
    return now
  }
  async initialize(signal?: AbortSignal): Promise<void> {
    visualMaterialAborted(signal)
    this.initializing ??= (async () => {
      await this.repository.initialize()
      await this.blobs.initialize()
      this.codec = new VisualMaterialCursorCodec(await this.blobs.cursorKey())
    })()
    await this.initializing
    this.repository.assertAvailable(); visualMaterialAborted(signal)
  }
  private ready(): VisualMaterialCursorCodec {
    if (this.codec === undefined) throw new VisualMaterialError(503, 'LIBRARY_UNAVAILABLE', 'Visual material service has not initialized.')
    this.repository.assertAvailable()
    return this.codec
  }
  private async withWork<T>(actor: VisualMaterialActor, bytes: number, publication: boolean, action: () => Promise<T>): Promise<T> {
    const account = this.work.get(actor.userKey) ?? 0
    if (account >= this.limits.maxAccountConcurrent || this.active >= this.limits.maxGlobalConcurrent) {
      throw new VisualMaterialError(429, 'CONCURRENCY_QUOTA', 'Visual material I/O concurrency is exhausted.')
    }
    if (this.residentBytes + bytes > this.limits.maxStageBytes) throw new VisualMaterialError(429, 'STAGING_QUOTA', 'Visual material memory/staging budget is exhausted.')
    this.work.set(actor.userKey, account + 1); this.active++; this.residentBytes += bytes
    if (publication) this.publicationActive++
    try { return await action() }
    finally {
      const remaining = (this.work.get(actor.userKey) ?? 1) - 1
      if (remaining === 0) this.work.delete(actor.userKey); else this.work.set(actor.userKey, remaining)
      this.active--; this.residentBytes -= bytes
      if (publication) this.publicationActive--
    }
  }

  async storeGenerated(actor0: VisualMaterialActor, input: StoreGeneratedVisualMaterial, signal?: AbortSignal): Promise<VisualMaterialDescriptor> {
    this.ready()
    if (this.recovering) throw new VisualMaterialError(409, 'RECOVERY_BUSY', 'Visual material recovery is running; retry publication after it drains.')
    const actor = visualMaterialActor(actor0), operationId = visualMaterialOperationId(input?.operationId)
    if (signal?.aborted) { await this.repository.cancelGenerated(actor, operationId, this.now()); visualMaterialAborted(signal) }
    const metadata = visualMaterialGeneratedMetadata(input)
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > this.limits.maxImageBytes
      || input.bytes.buffer instanceof SharedArrayBuffer) throw new VisualMaterialError(422, 'IMAGE_INVALID', 'Generated image exceeds the bounded PNG contract.')
    return this.withWork(actor, input.bytes.byteLength, true, async () => {
      const bytes = Buffer.from(input.bytes) // frozen snapshot: caller may reuse/change its source after this call
      const dimensions = this.validator(bytes)
      if (dimensions.width !== metadata.width || dimensions.height !== metadata.height) {
        throw new VisualMaterialError(422, 'IMAGE_DIMENSIONS', 'Declared dimensions do not match decoded image bytes.')
      }
      const sha256 = visualMaterialDigest(bytes), at = this.now()
      const { privatePrompt, sourceJobId, generationChannelId, generationConfigRevision, generationUsage, ...visibleMetadata } = metadata
      let row: VisualMaterialRecord = {
        ...visibleMetadata, id: `vmat_${randomBytes(16).toString('hex')}`, revision: 1, sha256, byteLength: bytes.length,
        lifecycle: 'pending', visibility: 'private', createdAt: at, updatedAt: at, metadataTrust: 'untrusted',
        ownerKey: actor.userKey, schoolId: actor.schoolId,
        ...(privatePrompt === undefined ? {} : { privatePrompt }), ...(sourceJobId === undefined ? {} : { sourceJobId }),
        ...(generationChannelId === undefined ? {} : { generationChannelId }),
        ...(generationConfigRevision === undefined ? {} : { generationConfigRevision }),
        ...(generationUsage === undefined ? {} : { generationUsage }),
        index: visualMaterialIndex(metadata), blobDurable: false, publicationPending: true, retentionCharged: true,
      }
      const fingerprint = visualMaterialFingerprint({ metadata, sha256, byteLength: bytes.length })
      const publicationKey = `${actor.userKey}\0${operationId}`
      if (this.publications.has(publicationKey)) throw new VisualMaterialError(409, 'OPERATION_IN_PROGRESS', 'This visual material operation is already publishing.', { operationId, retryable: true })
      this.publications.add(publicationKey)
      let cancel: Promise<void> | undefined, cancelError: unknown
      const onAbort = (): void => {
        cancel ??= Promise.resolve().then(() => this.repository.cancelGenerated(actor, operationId, this.now())).catch(error => { cancelError = error })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const fence = (): void => { this.repository.assertAvailable(); visualMaterialAborted(signal) }
      let reserved = false, commitAttempted = false
      try {
        fence()
        const reservation = await this.repository.reserveGenerated(actor, row, fingerprint, signal)
        row = reservation.record; reserved = true
        if (row.lifecycle === 'canceled') throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Canceled visual material operation cannot publish a late result.')
        if (!row.publicationPending) {
          // Idempotent retry never resurrects a later tombstone or changes owner school/visibility.
          await this.blobs.read(row, fence)
          fence(); return visualMaterialDescriptor(row)
        }
        await this.blobs.publish(row, bytes, reservation.stageBytesReserved, fence)
        fence()
        commitAttempted = true
        const result = await this.repository.completePublication(actor, row.id, operationId, this.now(), signal)
        return visualMaterialDescriptor(result)
      } catch (error) {
        if (signal?.aborted && reserved && commitAttempted) {
          // resolve an ambiguous COMMIT before attempting cancellation; already-applied retention wins.
          const current = await this.repository.get(actor, row.id, { ownedOnly: true, includeInactive: true })
          if (current !== undefined && !current.publicationPending && current.blobDurable && current.lifecycle !== 'canceled') return visualMaterialDescriptor(current)
        }
        if (signal?.aborted || error instanceof VisualMaterialError && error.code === 'OPERATION_CANCELED') {
          onAbort(); await cancel
          if (cancelError !== undefined) {
            throw new VisualMaterialError(503, 'CANCELLATION_PENDING', 'Visual material cancellation could not be durably recorded; retry cancellation before accepting a late result.',
              { materialId: row.id, operationId, retryable: true }, { cause: cancelError })
          }
          if (reserved) {
            // A commit may linearize just before cancellation. Do not claim committed retention was undone.
            const current = await this.repository.get(actor, row.id, { ownedOnly: true, includeInactive: true })
            if (commitAttempted && current !== undefined && !current.publicationPending && current.blobDurable && current.lifecycle !== 'canceled') {
              return visualMaterialDescriptor(current)
            }
            // A canceled stage may already have renamed. Retain it privately, but never mark it ready.
            if (current?.lifecycle === 'canceled' && current.publicationPending) {
              const quota = await this.repository.quota(actor)
              const durable = await this.blobs.recover(current, quota.global.stageBytes, () => this.repository.assertAvailable())
              await this.repository.reconcileCanceledPublication(actor, row.id, operationId, durable === 'durable', this.now())
            }
          }
          throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Visual material operation was canceled; late publication is fenced.', { operationId })
        }
        if (reserved && row.publicationPending) {
          try { await this.repository.notePublicationFailure(actor, row.id, operationId, errorCode(error)) }
          catch (journalError) {
            throw new VisualMaterialError(503, 'RETENTION_PENDING', 'Visual material retention/journal failed. Keep the original result and retry this operation; do not silently omit it.',
              { materialId: row.id, operationId, retryable: true }, { cause: journalError })
          }
          if (error instanceof VisualMaterialError && ['BLOB_PATH_UNSAFE', 'BLOB_INTEGRITY', 'IMAGE_INVALID'].includes(error.code)) throw error
          throw new VisualMaterialError(error instanceof VisualMaterialError ? error.status : 503, 'RETENTION_PENDING',
            'Visual material metadata is reserved; original publication is unfinished. Keep the result and retry this operation or run recovery.',
            { materialId: row.id, operationId, retryable: true }, { cause: error })
        }
        if (error instanceof VisualMaterialError) throw error
        throw new VisualMaterialError(503, 'RETENTION_FAILED', 'Visual material was not acknowledged as retained. Keep the original result and retry the same operation.',
          { materialId: row.id, operationId, retryable: true }, { cause: error })
      } finally {
        signal?.removeEventListener('abort', onAbort)
        if (cancel !== undefined) await cancel
        this.publications.delete(publicationKey)
      }
    })
  }

  async search(actor0: VisualMaterialActor, input: VisualMaterialSearch = {}, signal?: AbortSignal): Promise<VisualMaterialSearchPage> {
    const codec = this.ready(), actor = visualMaterialActor(actor0)
    const plan = codec.apply(actor, visualMaterialSearchPlan(input, this.now()), input.cursor)
    const hits = await this.repository.search(actor, plan, signal), selected = hits.slice(0, plan.limit), last = selected.at(-1)
    return {
      items: selected.map(hit => ({ ...visualMaterialDescriptor(hit.record), match: { ...hit.match, fields: { ...hit.match.fields }, matchedTerms: [...hit.match.matchedTerms] } })),
      ...(hits.length > plan.limit && last !== undefined ? { nextCursor: codec.encode(actor, plan, { score: last.match.score, createdAt: last.record.createdAt, id: last.record.id }) } : {}),
    }
  }
  async list(actor0: VisualMaterialActor, input: VisualMaterialList = {}, signal?: AbortSignal): Promise<VisualMaterialListPage> {
    const codec = this.ready(), actor = visualMaterialActor(actor0)
    const plan = codec.apply(actor, visualMaterialListPlan(input, this.now()), input.cursor)
    const hits = await this.repository.search(actor, plan, signal), selected = hits.slice(0, plan.limit), last = selected.at(-1)
    return { items: selected.map(hit => visualMaterialDescriptor(hit.record)),
      ...(hits.length > plan.limit && last !== undefined ? { nextCursor: codec.encode(actor, plan, { score: 0, createdAt: last.record.createdAt, id: last.record.id }) } : {}) }
  }
  async describe(actor0: VisualMaterialActor, id: string, signal?: AbortSignal): Promise<VisualMaterialDescriptor> {
    this.ready(); const actor = visualMaterialActor(actor0); visualMaterialId(id)
    const row = await this.repository.get(actor, id, { includeInactive: true }, signal)
    return row === undefined ? notFound() : visualMaterialDescriptor(row)
  }
  async readBytes(actor0: VisualMaterialActor, id: string, sha256?: string, signal?: AbortSignal): Promise<VerifiedVisualMaterialBytes> {
    this.ready(); const actor = visualMaterialActor(actor0); visualMaterialId(id)
    if (sha256 !== undefined) visualMaterialSha(sha256)
    const row = await this.repository.get(actor, id, {}, signal)
    if (row === undefined || sha256 !== undefined && row.sha256 !== sha256) return notFound()
    return this.withWork(actor, row.byteLength, false, async () => {
      const fence = (): void => { this.repository.assertAvailable(); visualMaterialAborted(signal) }
      const bytes = await this.blobs.read(row, fence)
      // Recheck CURRENT SQL after disk I/O: revocation/deletion during read must not leak the bytes.
      const current = await this.repository.get(actor, id, {}, signal)
      if (current === undefined || current.revision !== row.revision || current.sha256 !== row.sha256) return notFound()
      fence()
      return { descriptor: visualMaterialDescriptor(current), bytes, mediaType: 'image/png' }
    })
  }
  async select(actor: VisualMaterialActor, id: string, sha256?: string, signal?: AbortSignal): Promise<VerifiedVisualMaterialBytes> {
    return this.readBytes(actor, id, sha256, signal)
  }
  async manage(actor0: VisualMaterialActor, id: string, input0: ManageVisualMaterial, signal?: AbortSignal): Promise<VisualMaterialDescriptor> {
    this.ready(); const actor = visualMaterialActor(actor0); visualMaterialId(id)
    const input = visualMaterialManageInput(input0), fingerprint = visualMaterialFingerprint({ id, input })
    if (input.restore) {
      const row = await this.repository.get(actor, id, { ownedOnly: true, includeInactive: true }, signal)
      if (row === undefined) return notFound()
      await this.withWork(actor, row.byteLength, false, () => this.blobs.read(row, () => { this.repository.assertAvailable(); visualMaterialAborted(signal) }))
    }
    return this.repository.manage(actor, id, input, fingerprint, this.now(), signal)
  }
  async cancelGeneratedOperation(actor0: VisualMaterialActor, operationId: string): Promise<void> {
    this.ready(); const actor = visualMaterialActor(actor0); visualMaterialOperationId(operationId)
    await this.repository.cancelGenerated(actor, operationId, this.now())
  }
  async quota(actor0: VisualMaterialActor, signal?: AbortSignal): Promise<VisualMaterialQuota> {
    this.ready(); return this.repository.quota(visualMaterialActor(actor0), signal)
  }

  async recoverPending(input: { readonly limit?: number; readonly after?: VisualMaterialRecoveryPosition } = {}, signal?: AbortSignal): Promise<VisualMaterialRecoveryResult> {
    this.ready(); visualMaterialAborted(signal)
    if (this.publicationActive !== 0 || this.recovering) throw new VisualMaterialError(409, 'RECOVERY_BUSY', 'Run visual material recovery before accepting publications or after draining them.')
    this.recovering = true
    try {
      const page = await this.repository.pendingPublications({ limit: input.limit ?? 100, ...(input.after === undefined ? {} : { after: input.after }) }, signal)
      let recovered = 0, pending = 0
      const issues: { id: string; code: string }[] = []
      for (const row of page.items) {
        visualMaterialAborted(signal)
        const actor = { userKey: row.ownerKey, schoolId: row.schoolId }, quota = await this.repository.quota(actor, signal)
        try {
          const status = await this.withWork(actor, row.byteLength, true, () => this.blobs.recover(row, quota.global.stageBytes,
            () => { this.repository.assertAvailable(); visualMaterialAborted(signal) }))
          if (row.lifecycle === 'canceled') {
            await this.repository.reconcileCanceledPublication(actor, row.id, row.operationId, status === 'durable', this.now()); recovered++
          } else if (status === 'durable') {
            await this.repository.completePublication(actor, row.id, row.operationId, this.now(), signal); recovered++
          } else { pending++; issues.push({ id: row.id, code: 'BYTES_PENDING' }); await this.repository.notePublicationFailure(actor, row.id, row.operationId, 'BYTES_PENDING') }
        } catch (error) {
          if (signal?.aborted) throw error
          if (error instanceof VisualMaterialError && error.code === 'REPOSITORY_UNAVAILABLE') throw error
          pending++; issues.push({ id: row.id, code: errorCode(error) })
          await this.repository.notePublicationFailure(actor, row.id, row.operationId, errorCode(error))
        }
      }
      return { recovered, pending, issues, ...(page.next === undefined ? {} : { next: page.next }) }
    } finally { this.recovering = false }
  }
}
