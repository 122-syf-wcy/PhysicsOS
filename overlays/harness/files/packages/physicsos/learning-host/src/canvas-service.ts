/** Durable account-private Canvas operations; all admission and cross-document work owns one account queue. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import {
  createManifest,
  parseObject,
  parseStoredValue,
  refsOf,
} from '@physicsos/physics-workbench/codec'
import { cloneGraph, validateGraph, type GraphLimits } from '@physicsos/physics-workbench/graph'
import { datasetsToCsv } from '@physicsos/physics-workbench/csv'
import { datasetFromSimulationResult } from '@physicsos/physics-workbench/data'
import {
  canonicalByteLength,
  canonicalBytes,
  canonicalStringify,
  jsonObject,
  WorkbenchDataError,
} from '@physicsos/physics-workbench/json'
import type {
  CanvasChange,
  CanvasChangesResponse,
  CanvasCommitResponse,
  CanvasHead,
  CanvasListResponse,
  CanvasObjectUploadResponse,
  CanvasOpenResponse,
  CanvasVerificationReceipt,
  CanvasVerificationListResponse,
  CanvasResourcePolicy,
} from '@physicsos/physics-workbench/protocol'
import type {
  CanvasGraph,
  CanvasManifest,
  CanvasStoredValue,
  DatasetObject,
  ObjectRef,
  WorkbenchObject,
} from '@physicsos/physics-workbench/types'
import { verifyCanvasCapture, type CanvasVerificationOutcome } from './canvas-verification.ts'
import type { IdentityActor } from './identity.ts'
import {
  canvasDomain,
  canvasHeadOf,
  canvasVerificationOf,
  canvasVerificationReceiptSchema,
  canvasRecordKey,
  canvasReferenceMetadata,
  type CanvasCommitCapsule,
  type CanvasDomain,
  type CanvasHeadRecord,
  type CanvasMutationReceipt,
  type CanvasObjectRecord,
  type CanvasReservation,
  type CanvasVerificationRecord,
} from './canvas-domain.ts'
import {
  CanvasBlobStore,
  canvasDigest,
  canvasHash,
  canvasScopeKey,
  type CanvasBlobScope,
} from './canvas-blob-store.ts'
import type { CanvasConfig } from './canvas-config.ts'
import { CanvasError } from './canvas-error.ts'

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+(?![\s\S])/)
const digestSchema = z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/)
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const createWire = z.strictObject({ id: identifier, title: z.string().min(1), mutationId: identifier, manifestDigest: digestSchema.optional() })
const commitWire = z.strictObject({ expectedVersion: version, expectedGeneration: version.optional(), mutationId: identifier, manifestDigest: digestSchema })
const renameWire = z.strictObject({ expectedVersion: version, mutationId: identifier, title: z.string().min(1), manifestDigest: digestSchema.optional() })
const lifecycleWire = z.strictObject({ expectedVersion: version, expectedGeneration: version.optional(), mutationId: identifier })
const copyWire = z.strictObject({ expectedVersion: version, mutationId: identifier, id: identifier, title: z.string().min(1).optional(), manifestDigest: digestSchema.optional() })
const verifyWire = z.strictObject({ captureDigest: digestSchema, mutationId: identifier })

/** Account-private list filters; cursors are bound to these filters and cannot grant access. */
export interface CanvasListQuery {
  readonly limit?: string
  readonly cursor?: string
  readonly search?: string
  readonly state?: string
  readonly sort?: string
  readonly order?: string
}

/** Instance-local clock input; production uses real time and server-derived receipt identities. */
export interface CanvasServiceOptions {
  readonly now?: () => Date
}

interface RequestContext { readonly signal: AbortSignal }
type Operation = CanvasCommitCapsule['operation']
type AccountingTable = 'heads' | 'objects' | 'reservations' | 'receipts' | 'verifications'
type PersistentRow = CanvasHeadRecord | CanvasObjectRecord | CanvasReservation | CanvasMutationReceipt | CanvasVerificationRecord
interface AccountingRow {
  readonly table: AccountingTable
  readonly key: string
  readonly canvasId: string
  readonly value: PersistentRow
  readonly bytes: number
}
interface AccountingReplacement {
  readonly table: AccountingTable
  readonly key: string
  readonly canvasId: string
  readonly value: PersistentRow
}
interface PreparedObject {
  readonly value: CanvasStoredValue
  readonly bytes: Uint8Array
  readonly digest: string
  readonly kind: CanvasObjectRecord['kind']
  readonly refs: readonly ObjectRef[]
}
interface MutationInput {
  readonly mutationId: string
  readonly requestHash: string
  readonly operation: Operation
  readonly expectedVersion: number
  readonly expectedGeneration?: number | undefined
  readonly manifest: CanvasManifest
  readonly manifestDigest: string
  readonly deleted: boolean
}
interface ListCursor {
  readonly version: 1
  readonly filters: string
  readonly primary: string
  readonly id: string
}

class ReplayCommit extends Error {
  constructor(readonly capsule: CanvasCommitCapsule) { super('Canvas mutation already committed.') }
}

const parseWire = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new CanvasError(400, 'BAD_REQUEST', 'Canvas request fields are invalid.')
  return parsed.data
}
const nextInteger = (value: number, subject: string): number => {
  const next = value + 1
  if (!Number.isSafeInteger(next)) throw new CanvasError(409, 'REVISION_EXHAUSTED', `${subject} has exhausted its revision range.`)
  return next
}
const own = (actor: IdentityActor, value: { readonly schoolId: string; readonly userKey: string }): boolean =>
  value.schoolId === actor.schoolId && value.userKey === actor.userKey
const notFound = (): CanvasError => new CanvasError(404, 'NOT_FOUND', 'Canvas does not exist in this account.')
const bytesOf = (bytes: Uint8Array): Iterable<Uint8Array> => [bytes]

/**
 * One service owns each account's admission queue. KvTable.update still performs
 * every CAS, deletion, and mutation-receipt check on the actual domain write chain.
 * PostgreSQL's existing single-writer lease is required; this is not multi-writer CAS.
 */
export class CanvasService {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly requests = new Set<Promise<unknown>>()
  private readonly requestContext = new AsyncLocalStorage<RequestContext>()
  private readonly now: () => Date
  private closing = false
  private disposal: Promise<void> | undefined

  constructor(
    private readonly domain: CanvasDomain,
    private readonly blobs: CanvasBlobStore,
    readonly config: CanvasConfig,
    options: CanvasServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Initialize the real filesystem before the REST registration becomes visible.
   * @returns Completion after private directories and ancestor entries are durable.
   */
  initialize(): Promise<void> { return this.blobs.initialize() }

  /**
   * Admit the complete HTTP operation, including body reading, into disposal quiescence.
   * @param signal - Optional transport cancellation.
   * @param operation - All work belonging to this admitted request.
   * @returns The actual operation result; disposal waits for it, not merely its queue slot.
   */
  request<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const inherited = this.requestContext.getStore()
    if (inherited !== undefined) return operation(inherited.signal)
    if (this.closing) return Promise.reject(new CanvasError(503, 'CLOSED', 'Canvas service is closing.'))
    if (this.requests.size >= this.config.limits.maxInFlightRequests) {
      return Promise.reject(new CanvasError(429, 'REQUEST_LIMIT', 'Canvas service has reached its configured in-flight request limit.'))
    }
    const deadline = AbortSignal.timeout(this.config.limits.requestTimeoutMs)
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    const result = this.requestContext.run({ signal: combined }, async () => operation(combined))
    this.requests.add(result)
    void result.then(() => this.requests.delete(result), () => this.requests.delete(result))
    return result
  }

  /**
   * Create an empty durable manifest and head without accepting client authorization fields.
   * @param actor - Server-resolved account and tenant.
   * @param body - Shared create request; mutationId identifies its retry.
   * @returns The committed head and empty manifest, including idempotent response-loss replay.
   */
  create(actor: IdentityActor, body: unknown): Promise<CanvasOpenResponse & { readonly replayed: boolean }> {
    return this.account(actor, async () => {
      this.checkRequestBytes(body)
      const input = parseWire(createWire, body)
      this.checkTitle(input.title)
      const hash = this.requestHash('create', input.id, input)
      const replay = await this.replayIfPresent(actor, input.id, input.mutationId, hash)
      if (replay !== undefined) return this.openReplay(actor, replay)
      const current = this.heads.get(this.key(actor, input.id))
      if (current !== undefined) throw new CanvasError(409, 'ID_CONFLICT', 'Canvas id is already retained by this account.')
      const reservation = this.reservations.get(this.mutationKey(actor, input.id, input.mutationId))
      if (reservation !== undefined && (!own(actor, reservation) || reservation.canvasId !== input.id || reservation.requestHash !== hash)) {
        throw new CanvasError(409, 'MUTATION_CONFLICT', 'Create mutationId has different retained request content.')
      }
      const manifest = createManifest({ id: input.id, title: input.title, now: reservation?.createdAt ?? this.timestamp() })
      const prepared = this.prepare(manifest, input.id, false)
      if (input.manifestDigest !== undefined && input.manifestDigest !== prepared.digest) {
        throw new CanvasError(400, 'BAD_MANIFEST', 'Create establishes a server-authored empty manifest; upload content after creation.')
      }
      return this.publishNewHead(actor, input.id, manifest, prepared, input.mutationId, hash, 'create')
    })
  }

  /**
   * List live or deleted summaries with filter-bound keyset pagination.
   * @param actor - Server-resolved account and tenant.
   * @param query - Search, sort, state, and pagination fields.
   * @returns Only the caller's committed head summaries; object payloads are not loaded.
   */
  list(actor: IdentityActor, query: CanvasListQuery = {}): Promise<CanvasListResponse> {
    return this.account(actor, async () => {
      const state = query.state ?? 'live'
      const sort = query.sort ?? 'updated'
      const order = query.order ?? (sort === 'title' ? 'asc' : 'desc')
      if (!['live', 'deleted', 'all'].includes(state) || !['updated', 'created', 'title'].includes(sort) || !['asc', 'desc'].includes(order)) {
        throw new CanvasError(400, 'BAD_REQUEST', 'Canvas list state, sort, or order is invalid.')
      }
      const search = query.search ?? ''
      if (Buffer.byteLength(search, 'utf8') > this.config.limits.maxSearchBytes) throw new CanvasError(413, 'SEARCH_TOO_LARGE', 'Canvas search text is too large.')
      const limit = this.pageSize(query.limit)
      const filters = canvasHash(canonicalBytes({ state, sort, order, search }))
      const cursor = query.cursor === undefined ? undefined : this.decodeListCursor(query.cursor, filters)
      const primary = (head: CanvasHead): string => sort === 'title' ? head.title : sort === 'created' ? head.createdAt : head.updatedAt
      const compare = (left: { readonly primary: string; readonly id: string }, right: { readonly primary: string; readonly id: string }): number => {
        const value = left.primary < right.primary ? -1 : left.primary > right.primary ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
        return order === 'asc' ? value : -value
      }
      const normalized = search.toLocaleLowerCase('und')
      const ordered = [...this.heads.entries()].map(([, row]) => row)
        .filter(row => own(actor, row) && (state === 'all' || (row.deletedAt === undefined) === (state === 'live')))
        .map(canvasHeadOf)
        .filter(head => head.title.toLocaleLowerCase('und').includes(normalized))
        .sort((left, right) => compare({ primary: primary(left), id: left.id }, { primary: primary(right), id: right.id }))
      const remaining = cursor === undefined ? ordered : ordered.filter(head => compare({ primary: primary(head), id: head.id }, cursor) > 0)
      const items = remaining.slice(0, limit)
      const last = items.at(-1)
      return last !== undefined && remaining.length > limit
        ? { items, nextCursor: Buffer.from(canonicalStringify({ version: 1, filters, primary: primary(last), id: last.id } satisfies ListCursor)).toString('base64url') }
        : { items }
    })
  }
  /**
   * Read the configured aggregate policy for an authenticated account, without changing Canvas metadata.
   * @param actor - Server-resolved account and tenant.
   * @returns The same graph limits used for admission, read, cloning and portable validation.
   */
  resourcePolicy(actor: IdentityActor): Promise<CanvasResourcePolicy> {
    return this.account(actor, async () => ({ schemaVersion: 1, limits: this.graphLimits() }))
  }

  /**
   * Read a committed live Canvas and validate its complete durable graph.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Document identifier in this account.
   * @returns Head and manifest; corrupt or incomplete objects are actual errors, not empty canvases.
   */
  open(actor: IdentityActor, canvasId: string): Promise<CanvasOpenResponse> {
    return this.account(actor, async () => {
      const row = this.requireHead(actor, canvasId, false)
      const graph = await this.readGraph(actor, row.id, row.manifestDigest)
      return { head: canvasHeadOf(row), manifest: graph.manifest }
    })
  }

  /**
   * Upload one immutable canonical object after validating its exact bytes, kind, and dependencies.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Existing live document.
   * @param digest - Expected lowercase SHA-256 from the path.
   * @param bytes - Complete raw canonical UTF-8 JSON body.
   * @returns Actual immutable facts only after file and metadata publication are durable.
   */
  uploadObject(actor: IdentityActor, canvasId: string, digest: string, bytes: Uint8Array): Promise<CanvasObjectUploadResponse> {
    return this.account(actor, async () => {
      this.requireHead(actor, canvasId, false)
      const prepared = this.prepareBytes(bytes, canvasDigest(digest), canvasId, true)
      const existed = await this.storeObject(actor, canvasId, prepared)
      return { digest: prepared.digest, kind: prepared.kind, byteLength: prepared.bytes.byteLength, bytes: prepared.bytes.byteLength, existed }
    })
  }

  /**
   * Download an authorized immutable object without granting access by guessed hash.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Existing document; retained deleted documents remain readable only to their owner.
   * @param digest - Object address in that document's metadata, never a global lookup.
   * @returns Verified canonical bytes and measured kind/length.
   */
  downloadObject(actor: IdentityActor, canvasId: string, digest: string): Promise<{ readonly bytes: Uint8Array; readonly kind: CanvasObjectRecord['kind'] }> {
    return this.account(actor, async () => {
      this.requireHead(actor, canvasId, true)
      const row = this.requireObject(actor, canvasId, canvasDigest(digest))
      return { bytes: await this.blobs.read(this.scope(actor, canvasId), digest, row.bytes, this.config.limits.maxObjectBytes, this.signal()), kind: row.kind }
    })
  }

  /**
   * Publish only a complete, already-written dependency closure with CAS on the actual write chain.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Existing live document.
   * @param body - Shared commit request with expectedVersion and mutationId.
   * @returns Durable head and manifest; retries return their original successful head.
   */
  commit(actor: IdentityActor, canvasId: string, body: unknown): Promise<CanvasCommitResponse> {
    return this.account(actor, async () => {
      this.checkRequestBytes(body)
      const input = parseWire(commitWire, body)
      const hash = this.requestHash('commit', canvasId, input)
      const replay = await this.replayIfPresent(actor, canvasId, input.mutationId, hash)
      if (replay !== undefined) return this.openReplay(actor, replay)
      const current = this.requireHead(actor, canvasId, false)
      const graph = await this.readGraph(actor, canvasId, input.manifestDigest)
      this.checkManifestAgainstHead(graph.manifest, current)
      return this.publishMutation(actor, current, {
        ...input, requestHash: hash, operation: 'commit', manifest: graph.manifest,
        manifestDigest: input.manifestDigest, deleted: false,
      })
    })
  }

  /**
   * Rename the current manifest or publish an already-uploaded renamed manifest with CAS.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Existing live document.
   * @param body - Shared rename request.
   * @returns Durable renamed head and manifest, without modifying any captured object.
   */
  rename(actor: IdentityActor, canvasId: string, body: unknown): Promise<CanvasCommitResponse> {
    return this.account(actor, async () => {
      this.checkRequestBytes(body)
      const input = parseWire(renameWire, body)
      this.checkTitle(input.title)
      const hash = this.requestHash('rename', canvasId, input)
      const replay = await this.replayIfPresent(actor, canvasId, input.mutationId, hash)
      if (replay !== undefined) return this.openReplay(actor, replay)
      const current = this.requireHead(actor, canvasId, false)
      const original = await this.readGraph(actor, canvasId, current.manifestDigest)
      const reservation = this.reservations.get(this.mutationKey(actor, canvasId, input.mutationId))
      if (reservation !== undefined && (!own(actor, reservation) || reservation.operation !== 'rename' || reservation.requestHash !== hash)) {
        throw new CanvasError(409, 'MUTATION_CONFLICT', 'Rename mutationId has a different reserved request.')
      }
      const manifest = input.manifestDigest === undefined
        ? { ...original.manifest, title: input.title, updatedAt: reservation?.createdAt ?? this.timestamp() }
        : (await this.readGraph(actor, canvasId, input.manifestDigest)).manifest
      if (manifest.title !== input.title) throw new CanvasError(400, 'BAD_MANIFEST', 'Renamed manifest title differs from the request.')
      this.checkManifestAgainstHead(manifest, current)
      const prepared = this.prepare(manifest, canvasId, false)
      const objectKey = this.objectKey(actor, canvasId, prepared.digest)
      const objectRow: CanvasObjectRecord = {
        schoolId: actor.schoolId, userKey: actor.userKey, canvasId, digest: prepared.digest, kind: prepared.kind,
        bytes: prepared.bytes.byteLength, refs: canvasReferenceMetadata(prepared.refs), status: 'reserved', createdAt: manifest.updatedAt,
        reservedUntil: new Date(this.now().getTime() + this.config.limits.reservationTtlMs).toISOString(),
      }
      await this.reserve(actor, canvasId, input.mutationId, hash, 'rename', [prepared.digest, current.manifestDigest],
        [{ table: 'objects', key: objectKey, bytes: this.recordBytes('objects', objectKey, objectRow) }], manifest.updatedAt,
      )
      await this.storeObject(actor, canvasId, prepared)
      return this.publishMutation(actor, current, {
        mutationId: input.mutationId, requestHash: hash, operation: 'rename',
        expectedVersion: input.expectedVersion, manifest, manifestDigest: prepared.digest, deleted: false,
      })
    })
  }

  /**
   * Retain a monotonic tombstone; deletion never frees an identifier or resurrects on stale writes.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Existing live document.
   * @param body - CAS and mutation identifiers.
   * @returns Durable tombstone with an incremented version and generation.
   */
  delete(actor: IdentityActor, canvasId: string, body: unknown): Promise<CanvasCommitResponse> {
    return this.account(actor, () => this.lifecycle(actor, canvasId, body, true))
  }

  /**
   * Restore only the expected retained tombstone generation.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Retained deleted document.
   * @param body - CAS token, optional generation fence, and mutation identifier.
   * @returns Durable restored head with another monotonic version and generation.
   */
  restore(actor: IdentityActor, canvasId: string, body: unknown): Promise<CanvasCommitResponse> {
    return this.account(actor, () => this.lifecycle(actor, canvasId, body, false))
  }

  /**
   * Copy a complete authorized workbench with new owned scene identities and unchanged historical captures.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Existing source Canvas; its head and objects are never modified.
   * @param body - Source CAS token, destination identity/title, and mutation identifier.
   * @returns A newly committed full dependency closure, or its original idempotent replay.
   */
  copy(actor: IdentityActor, canvasId: string, body: unknown): Promise<CanvasOpenResponse & { readonly replayed: boolean }> {
    return this.account(actor, async () => {
      this.checkRequestBytes(body)
      const input = parseWire(copyWire, body)
      if (input.id === canvasId) throw new CanvasError(400, 'BAD_REQUEST', 'Copy destination must have a different Canvas id.')
      const hash = this.requestHash('copy', canvasId, input)
      const replay = await this.replayIfPresent(actor, input.id, input.mutationId, hash)
      if (replay !== undefined) return this.openReplay(actor, replay)
      if (this.heads.get(this.key(actor, input.id)) !== undefined) throw new CanvasError(409, 'ID_CONFLICT', 'Copy destination id is already retained by this account.')
      const source = this.requireHead(actor, canvasId, false)
      try {
        await this.heads.update(this.key(actor, canvasId), current => {
          if (!own(actor, current) || current.id !== canvasId) throw notFound()
          if (current.version !== input.expectedVersion || current.deletedAt !== undefined) throw new CanvasError(409, 'VERSION_CONFLICT', 'Source Canvas changed before copying.', { currentHead: canvasHeadOf(current) })
          throw new ReplayCommit(current.lastCommit)
        })
      } catch (error) { if (!(error instanceof ReplayCommit)) throw error }
      const graph = await this.readGraph(actor, canvasId, source.manifestDigest)
      const title = input.title ?? `${source.title} copy`
      this.checkTitle(title)
      const existingReservation = this.reservations.get(this.mutationKey(actor, input.id, input.mutationId))
      if (existingReservation !== undefined && (!own(actor, existingReservation) || existingReservation.operation !== 'copy' || existingReservation.requestHash !== hash)) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Copy mutationId has different retained request content.')
      const at = existingReservation?.createdAt ?? this.timestamp()
      const occurrences = new Map<string, number>()
      const cloned = await cloneGraph(graph, {
        id: (kind, oldId) => {
          if (kind === 'canvas') return input.id
          const key = canonicalStringify([kind, oldId])
          const ordinal = occurrences.get(key) ?? 0
          occurrences.set(key, ordinal + 1)
          return `copy-${canvasScopeKey(input.id, input.mutationId, kind, oldId, String(ordinal)).slice(0, 48)}`
        },
        hash: canonical => canvasHash(Buffer.from(canonical, 'utf8')),
        title, now: at, limits: this.graphLimits(),
      })
      const destination = cloned.graph
      const manifest = this.prepare(destination.manifest, input.id, false)
      if (input.manifestDigest !== undefined && input.manifestDigest !== manifest.digest) throw new CanvasError(400, 'BAD_MANIFEST', 'Copy manifest digest differs from the actual server-owned clone.')
      const prepared = new Map<string, PreparedObject>()
      for (const [digest, object] of Object.entries(destination.objects)) {
        const value = this.prepare(object, input.id, false)
        if (value.digest !== digest) throw new CanvasError(400, 'DIGEST_MISMATCH', 'Cloned object address differs from its canonical bytes.')
        prepared.set(digest, value)
      }
      const roots = [manifest.digest, ...prepared.keys()]
      const allocations: CanvasReservation['allocations'] = []
      for (const [digest, object] of prepared) {
        const key = this.objectKey(actor, input.id, digest)
        const row: CanvasObjectRecord = {
          schoolId: actor.schoolId, userKey: actor.userKey, canvasId: input.id, digest, kind: object.kind,
          bytes: object.bytes.byteLength, refs: canvasReferenceMetadata(object.refs), status: 'reserved', createdAt: at,
          reservedUntil: new Date(this.now().getTime() + this.config.limits.reservationTtlMs).toISOString(),
        }
        allocations.push({ table: 'objects', key, bytes: this.recordBytes('objects', key, row) })
      }
      const manifestKey = this.objectKey(actor, input.id, manifest.digest)
      const manifestRow: CanvasObjectRecord = {
        schoolId: actor.schoolId, userKey: actor.userKey, canvasId: input.id, digest: manifest.digest, kind: 'manifest',
        bytes: manifest.bytes.byteLength, refs: canvasReferenceMetadata(manifest.refs), status: 'reserved', createdAt: at,
        reservedUntil: new Date(this.now().getTime() + this.config.limits.reservationTtlMs).toISOString(),
      }
      allocations.push({ table: 'objects', key: manifestKey, bytes: this.recordBytes('objects', manifestKey, manifestRow) })
      const copiedHead: CanvasHead = {
        id: input.id, title: destination.manifest.title, version: 1, generation: 1, changeSeq: this.nextSequence(actor),
        manifestDigest: manifest.digest, createdAt: destination.manifest.createdAt, updatedAt: destination.manifest.updatedAt,
      }
      const copiedCapsule: CanvasCommitCapsule = { mutationId: input.mutationId, requestHash: hash, operation: 'copy', head: copiedHead }
      const copiedRow: CanvasHeadRecord = { ...copiedHead, schoolId: actor.schoolId, userKey: actor.userKey, lastCommit: copiedCapsule, history: [] }
      const copiedReceipt = this.receipt(actor, input.id, copiedCapsule)
      allocations.push(
        { table: 'heads', key: this.key(actor, input.id), bytes: this.recordBytes('heads', this.key(actor, input.id), copiedRow) },
        { table: 'receipts', key: this.mutationKey(actor, input.id, input.mutationId), bytes: this.recordBytes('receipts', this.mutationKey(actor, input.id, input.mutationId), copiedReceipt) },
      )
      await this.reserve(actor, input.id, input.mutationId, hash, 'copy', roots, allocations, at)
      const required = new Map<string, number>()
      const dependents = new Map<string, string[]>()
      const pending: string[] = []
      for (const [digest, object] of prepared) {
        const dependencies = [...new Set(object.refs.map(ref => ref.digest))]
        required.set(digest, dependencies.length)
        if (dependencies.length === 0) pending.push(digest)
        for (const dependency of dependencies) {
          if (!prepared.has(dependency)) throw new CanvasError(400, 'REFERENCE_MISSING', 'Copied dependency closure is incomplete.')
          const users = dependents.get(dependency) ?? []
          users.push(digest)
          dependents.set(dependency, users)
        }
      }
      for (let index = 0; index < pending.length; index += 1) {
        const digest = pending[index]!
        await this.storeObject(actor, input.id, prepared.get(digest)!)
        for (const user of dependents.get(digest) ?? []) {
          const count = required.get(user)! - 1
          required.set(user, count)
          if (count === 0) pending.push(user)
        }
      }
      if (pending.length !== prepared.size) throw new CanvasError(400, 'DEPENDENCY_CYCLE', 'Copied dependency closure is cyclic.')
      return this.publishNewHead(actor, input.id, destination.manifest, manifest, input.mutationId, hash, 'copy')
    })
  }

  /**
   * Re-run an authorized immutable capture with its actual accepted request and keep independent evidence.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Owned live Canvas containing the capture and its dependencies.
   * @param body - Shared capture digest and mutation identifier.
   * @returns Durable server receipt and, when the real engine ran, a new immutable server snapshot digest.
   */
  verify(actor: IdentityActor, canvasId: string, body: unknown): Promise<{ readonly receipt: CanvasVerificationReceipt; readonly resultDigest?: string; readonly replayed: boolean }> {
    return this.account(actor, async () => {
      this.checkRequestBytes(body)
      const input = parseWire(verifyWire, body)
      const hash = this.requestHash('verify', canvasId, input)
      const verificationReservation = this.reservations.get(this.mutationKey(actor, canvasId, input.mutationId))
      if (verificationReservation !== undefined && (!own(actor, verificationReservation) || verificationReservation.operation !== 'verify' || verificationReservation.requestHash !== hash)) {
        throw new CanvasError(409, 'MUTATION_CONFLICT', 'Verification mutationId has a different reserved request.')
      }
      const verificationKey = this.mutationKey(actor, canvasId, input.mutationId)
      const existing = this.verifications.get(verificationKey)
      if (existing !== undefined) {
        if (!own(actor, existing) || existing.canvasId !== canvasId) throw notFound()
        if (existing.requestHash !== hash) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Verification mutationId has different request content.')
        const current = this.requireHead(actor, canvasId, true)
        await this.heads.update(this.key(actor, canvasId), queued => {
          if (!own(actor, queued) || queued.id !== canvasId) throw notFound()
          const receipt = this.verifications.get(verificationKey)
          if (receipt === undefined || !own(actor, receipt) || receipt.requestHash !== hash) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Verification receipt changed before replay.')
          throw new ReplayCommit(queued.lastCommit)
        }).catch(error => { if (!(error instanceof ReplayCommit)) throw error })
        if (current.id !== existing.canvasId) throw notFound()
        await this.releaseReservation(actor, canvasId, input.mutationId, hash)
        return { receipt: canvasVerificationOf(existing), ...(existing.resultDigest === undefined ? {} : { resultDigest: existing.resultDigest }), replayed: true }
      }
      this.requireHead(actor, canvasId, false)
      const mutationHead = this.heads.get(this.key(actor, canvasId))!
      if (this.validateReplay(actor, canvasId, input.mutationId, hash, mutationHead) !== undefined) {
        throw new CanvasError(409, 'MUTATION_CONFLICT', 'mutationId belongs to a different Canvas mutation.')
      }
      const verificationCount = [...this.verifications.entries()].filter(([, row]) => own(actor, row) && row.canvasId === canvasId).length
      if (verificationCount >= this.config.limits.maxVerificationEntries) throw new CanvasError(413, 'VERIFICATION_LIMIT', 'Canvas retains too many server verification receipts.')
      const capture = await this.readStored(actor, canvasId, input.captureDigest)
      if (!('kind' in capture) || capture.kind !== 'snapshot') throw new CanvasError(400, 'BAD_CAPTURE', 'Verification requires a saved snapshot object.')
      const source = await this.readStored(actor, canvasId, capture.scene.digest)
      if (!('kind' in source) || source.kind !== 'scene') throw new CanvasError(400, 'BAD_CAPTURE', 'Snapshot source is not an immutable PhysicsScene object.')
      const checkedAt = verificationReservation?.createdAt ?? this.timestamp()
      await this.reserve(actor, canvasId, input.mutationId, hash, 'verify', [input.captureDigest, capture.scene.digest], [], checkedAt)
      let outcome = await this.readVerificationOutcome(actor, canvasId, verificationReservation, input.captureDigest)
      let needsAttemptPublication = false
      if (outcome === undefined) {
        outcome = verifyCanvasCapture(source, capture, {
          id: `verify-${canvasScopeKey(actor.schoolId, actor.userKey, canvasId, input.mutationId).slice(0, 48)}`,
          canvasId, captureDigest: input.captureDigest, sceneDigest: capture.scene.digest, checkedAt,
        }, this.config.limits, this.signal())
        needsAttemptPublication = true
      }
      let resultDigest: string | undefined
      const evidence: PreparedObject[] = []
      if (outcome.snapshot !== undefined) {
        const references: ObjectRef<'dataset'>[] = []
        for (const dataset of outcome.datasets) {
          const prepared = this.prepare(dataset, canvasId, false)
          evidence.push(prepared)
          references.push({ kind: 'dataset', digest: prepared.digest })
        }
        const prepared = this.prepare({ ...outcome.snapshot, datasets: references }, canvasId, false)
        evidence.push(prepared)
        resultDigest = prepared.digest
      }
      const record: CanvasVerificationRecord = {
        schoolId: actor.schoolId, userKey: actor.userKey, canvasId,
        mutationId: input.mutationId, requestHash: hash, receipt: outcome.receipt,
        ...(resultDigest === undefined ? {} : { resultDigest }),
      }
      const allocations: CanvasReservation['allocations'] = [{ table: 'verifications', key: verificationKey, bytes: this.recordBytes('verifications', verificationKey, record) }]
      for (const prepared of evidence) {
        const key = this.objectKey(actor, canvasId, prepared.digest)
        const row: CanvasObjectRecord = {
          schoolId: actor.schoolId, userKey: actor.userKey, canvasId, digest: prepared.digest, kind: prepared.kind,
          bytes: prepared.bytes.byteLength, refs: canvasReferenceMetadata(prepared.refs), status: 'reserved', createdAt: checkedAt,
          reservedUntil: new Date(this.now().getTime() + this.config.limits.reservationTtlMs).toISOString(),
        }
        allocations.push({ table: 'objects', key, bytes: this.recordBytes('objects', key, row) })
      }
      await this.reserve(actor, canvasId, input.mutationId, hash, 'verify',
        [input.captureDigest, capture.scene.digest, ...evidence.map(object => object.digest)], allocations, checkedAt,
      )
      if (needsAttemptPublication) await this.publishVerificationOutcome(actor, canvasId, input.mutationId, hash, outcome)
      for (const prepared of evidence) await this.storeObject(actor, canvasId, prepared)
      this.checkCapacity(actor, { table: 'verifications', key: verificationKey, canvasId, value: record })
      await this.verifications.put(verificationKey, record)
      await this.releaseReservation(actor, canvasId, input.mutationId, hash)
      return { receipt: outcome.receipt, ...(resultDigest === undefined ? {} : { resultDigest }), replayed: false }
    })
  }

  /**
   * Read a durable server receipt without accepting client verification claims.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Owned retained Canvas.
   * @param receiptId - Server-created receipt identifier.
   * @returns Only the independent persisted server result and its immutable evidence address.
   */
  verification(actor: IdentityActor, canvasId: string, receiptId: string): Promise<{ readonly receipt: CanvasVerificationReceipt; readonly resultDigest?: string }> {
    return this.account(actor, async () => {
      this.requireHead(actor, canvasId, true)
      this.assertId(receiptId)
      const record = [...this.verifications.entries()].map(([, row]) => row)
        .find(row => own(actor, row) && row.canvasId === canvasId && row.receipt.id === receiptId)
      if (record === undefined) throw notFound()
      return { receipt: canvasVerificationOf(record), ...(record.resultDigest === undefined ? {} : { resultDigest: record.resultDigest }) }
    })
  }

  /**
   * Discover durable replay receipts without reading physical payloads or rerunning an engine.
   * @param actor - Server-resolved account and tenant; document authorization is checked first.
   * @param canvasId - Owned retained Canvas.
   * @param captureValue - Exact immutable captured snapshot digest.
   * @param query - Bounded page size and a cursor bound to this actor, document and capture.
   * @returns Every matching metadata receipt over keyset pages, including previously lost responses.
   */
  listVerifications(actor: IdentityActor, canvasId: string, captureValue: string,
    query: Pick<CanvasListQuery, 'cursor' | 'limit'> = {}): Promise<CanvasVerificationListResponse> {
    return this.account(actor, async () => {
      this.requireHead(actor, canvasId, true)
      const captureDigest = parseWire(digestSchema, captureValue)
      const limit = this.pageSize(query.limit)
      const filters = canvasHash(canonicalBytes({ resource: 'canvas-verifications', schoolId: actor.schoolId,
        userKey: actor.userKey, canvasId, captureDigest }))
      const cursor = query.cursor === undefined ? undefined : this.decodeListCursor(query.cursor, filters)
      const compare = (left: { readonly primary: string; readonly id: string }, right: { readonly primary: string; readonly id: string }): number =>
        left.primary < right.primary ? -1 : left.primary > right.primary ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      const ordered = [...this.verifications.entries()].map(([, row]) => row)
        .filter(row => own(actor, row) && row.canvasId === canvasId && row.receipt.captureDigest === captureDigest)
        .sort((left, right) => compare({ primary: left.receipt.checkedAt, id: left.receipt.id },
          { primary: right.receipt.checkedAt, id: right.receipt.id }))
      const remaining = cursor === undefined ? ordered : ordered.filter(row => compare({ primary: row.receipt.checkedAt, id: row.receipt.id }, cursor) > 0)
      const page = remaining.slice(0, limit)
      const items = page.map(row => ({ receipt: canvasVerificationOf(row), ...(row.resultDigest === undefined ? {} : { resultDigest: row.resultDigest }) }))
      const last = page.at(-1)
      return last !== undefined && remaining.length > limit ? { items,
        nextCursor: Buffer.from(canonicalStringify({ version: 1, filters, primary: last.receipt.checkedAt, id: last.receipt.id } satisfies ListCursor)).toString('base64url'),
      } : { items }
    })
  }

  /**
   * Export all original raw dataset rows, never a renderer's cropped or rounded table.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Owned retained Canvas containing the capture.
   * @param captureDigest - Original immutable snapshot address.
   * @returns Full-raw reversible CSV; a corrupt dataset or complete-byte overflow rejects.
   */
  snapshotCsv(actor: IdentityActor, canvasId: string, captureDigest: string): Promise<string> {
    return this.account(actor, async () => {
      this.requireHead(actor, canvasId, true)
      const capture = await this.readStored(actor, canvasId, canvasDigest(captureDigest))
      if (!('kind' in capture) || capture.kind !== 'snapshot') throw new CanvasError(400, 'BAD_CAPTURE', 'CSV export requires an immutable snapshot object.')
      const datasets: DatasetObject[] = []
      for (const ref of capture.datasets) {
        const object = await this.readStored(actor, canvasId, ref.digest)
        if (!('kind' in object) || object.kind !== 'dataset') throw new CanvasError(400, 'REFERENCE_KIND_MISMATCH', 'Snapshot dataset reference has a different stored kind.')
        datasets.push(object)
      }
      if (datasets.length === 0 && capture.result !== undefined) {
        datasets.push(...datasetFromSimulationResult(capture.result, { sourceScene: capture.scene }))
      }
      if (datasets.length === 0) throw new CanvasError(409, 'RAW_DATA_UNAVAILABLE', 'Snapshot contains no raw exportable datasets or retained simulation result.')
      let csv: string
      try { csv = datasetsToCsv(datasets, { bom: true, maxBytes: this.config.limits.maxCsvBytes }) } catch (error) {
        if (error instanceof WorkbenchDataError && error.issues.some(issue => issue.code === 'CSV_TOO_LARGE')) throw new CanvasError(413, 'CSV_TOO_LARGE', 'Complete raw CSV exceeds its configured byte limit.')
        throw error
      }
      if (Buffer.byteLength(csv, 'utf8') > this.config.limits.maxCsvBytes) throw new CanvasError(413, 'CSV_TOO_LARGE', 'Complete raw CSV exceeds its configured byte limit.')
      return csv
    })
  }

  /**
   * Read changes only from committed heads; a reserved sequence never advances this cursor.
   * @param actor - Server-resolved account and tenant.
   * @param cursor - Last observed account sequence, initially zero.
   * @param limitValue - Optional bounded page size.
   * @returns Latest committed heads including tombstones and a safe durable cursor.
   */
  changes(actor: IdentityActor, cursor = '0', limitValue?: string): Promise<CanvasChangesResponse> {
    return this.account(actor, async () => {
      if (!/^(0|[1-9]\d*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new CanvasError(400, 'BAD_CURSOR', 'Canvas change cursor is invalid.')
      const since = Number(cursor)
      const limit = this.pageSize(limitValue)
      const committed = [...this.heads.entries()].map(([, row]) => row).filter(row => own(actor, row))
      const highest = committed.reduce((value, row) => Math.max(value, row.changeSeq), 0)
      if (since > highest) throw new CanvasError(400, 'BAD_CURSOR', 'Canvas change cursor is ahead of this account\'s committed heads.')
      const heads = committed.filter(row => row.changeSeq > since)
        .sort((left, right) => left.changeSeq - right.changeSeq || left.id.localeCompare(right.id))
      const page = heads.slice(0, limit)
      const changes: CanvasChange[] = page.map(row => ({
        seq: row.changeSeq, operation: row.lastCommit.operation, mutationId: row.lastCommit.mutationId, head: canvasHeadOf(row),
      }))
      return { changes, cursor: page.at(-1)?.changeSeq ?? since, hasMore: heads.length > limit }
    })
  }

  /**
   * Collect unreachable objects under the same account queue; files disappear before accounting falls.
   * @param actor - Server-resolved account and tenant.
   * @param canvasId - Optional owned document; omission scans all retained account documents.
   * @returns Actual removed object and byte counts, including expired failed reservations.
   */
  collect(actor: IdentityActor, canvasId?: string): Promise<{ readonly objects: number; readonly bytes: number }> {
    return this.account(actor, async () => {
      if (canvasId !== undefined) this.requireHead(actor, canvasId, true)
      const documents = new Set<string>()
      for (const [, row] of this.heads.entries()) if (own(actor, row) && (canvasId === undefined || row.id === canvasId)) documents.add(row.id)
      for (const [, row] of this.objects.entries()) if (own(actor, row) && (canvasId === undefined || row.canvasId === canvasId)) documents.add(row.canvasId)
      for (const [, row] of this.reservations.entries()) if (own(actor, row) && (canvasId === undefined || row.canvasId === canvasId)) documents.add(row.canvasId)
      const now = this.now().getTime()
      let objects = 0
      let bytes = 0
      for (const document of documents) {
        const committed = this.heads.get(this.key(actor, document))
        if (committed !== undefined && own(actor, committed)) {
          await this.ensureReceipt(actor, document, committed.lastCommit)
          await this.releaseReservation(actor, document, committed.lastCommit.mutationId, committed.lastCommit.requestHash)
        }
        for (const [, verification] of this.verifications.entries()) {
          if (own(actor, verification) && verification.canvasId === document) {
            await this.releaseReservation(actor, document, verification.mutationId, verification.requestHash)
          }
        }
        const metadataDigests = new Set([...this.objects.entries()].filter(([, row]) => own(actor, row) && row.canvasId === document).map(([, row]) => row.digest))
        for (const [, reservation] of this.reservations.entries()) {
          if (!own(actor, reservation) || reservation.canvasId !== document || Date.parse(reservation.expiresAt) > now) continue
          for (const digest of reservation.roots) if (!metadataDigests.has(digest)) await this.blobs.remove(this.scope(actor, document), digest)
        }
        const marked = this.reachableMetadata(actor, document, now)
        for (const [key, row] of this.objects.entries()) {
          if (!own(actor, row) || row.canvasId !== document || marked.has(row.digest)) continue
          if (Date.parse(row.reservedUntil) > now) continue
          await this.blobs.remove(this.scope(actor, document), row.digest)
          await this.objects.delete(key)
          objects += 1
          bytes += row.bytes
        }
        const active = [...this.reservations.entries()].some(([, row]) => own(actor, row) && row.canvasId === document && Date.parse(row.expiresAt) > now)
        if (!active) await this.blobs.collectStaging(this.scope(actor, document), now - this.config.limits.reservationTtlMs)
        for (const [key, row] of this.reservations.entries()) {
          if (!own(actor, row) || row.canvasId !== document || Date.parse(row.expiresAt) > now) continue
          const remaining = row.roots.some(digest => this.objects.get(this.objectKey(actor, document, digest)) !== undefined && !marked.has(digest))
          if (!remaining) {
            if (row.verificationAttempt !== undefined) await this.blobs.removeVerificationAttempt(this.scope(actor, document), row.verificationAttempt.digest)
            await this.reservations.delete(key)
          }
        }
      }
      return { objects, bytes }
    })
  }

  /** Export account-owned metadata, including retained deleted documents, without loading all blobs at once. */
  exportMetadata(actor: IdentityActor): Promise<{ id: string; table: string; value: unknown }[]> {
    return this.account(actor, async () => {
      const rows: { id: string; table: string; value: unknown }[] = []
      for (const table of ['heads', 'objects', 'reservations', 'receipts', 'verifications'] as const) {
        for (const [key, value] of this.domain.table(table).entries()) {
          if (own(actor, value)) rows.push({ id: `${table}:${key}`, table, value })
        }
      }
      return rows
    })
  }

  /** Enumerate private object files for bounded account export; authorization is checked again on read. */
  exportObjectIndex(actor: IdentityActor): Promise<{ id: string; canvasId: string; digest: string; bytes: number }[]> {
    return this.account(actor, async () => [...this.objects.entries()]
      .filter(([, row]) => own(actor, row) && row.status === 'ready')
      .map(([id, row]) => ({ id, canvasId: row.canvasId, digest: row.digest, bytes: row.bytes })))
  }

  /** Read an exported object through its owned metadata, including orphaned-but-retained durable objects. */
  exportObject(actor: IdentityActor, id: string): Promise<{ id: string; canvasId: string; digest: string; object: unknown }> {
    return this.account(actor, async () => {
      const row = this.objects.get(id)
      if (row === undefined || !own(actor, row) || row.status !== 'ready') throw notFound()
      const bytes = await this.blobs.read(this.scope(actor, row.canvasId), row.digest, row.bytes, this.config.limits.maxObjectBytes, this.signal())
      return { id, canvasId: row.canvasId, digest: row.digest, object: JSON.parse(Buffer.from(bytes).toString('utf8')) }
    })
  }

  /**
   * Stop admitting new requests, await complete handlers and account queues, then close file work.
   * @returns One shared quiescence promise; the owning effect closes domains afterwards.
   */
  dispose(): Promise<void> {
    this.closing = true
    this.disposal ??= (async () => {
      await Promise.allSettled([...this.requests])
      await Promise.all([...this.queues.values()])
      await this.blobs.close()
    })()
    return this.disposal
  }

  private get heads() { return this.domain.table('heads') }
  private get objects() { return this.domain.table('objects') }
  private get reservations() { return this.domain.table('reservations') }
  private get receipts() { return this.domain.table('receipts') }
  private get verifications() { return this.domain.table('verifications') }

  private account<T>(actor: IdentityActor, operation: () => Promise<T>): Promise<T> {
    return this.request(undefined, async () => {
      const key = canvasScopeKey(actor.schoolId, actor.userKey)
      const previous = this.queues.get(key) ?? Promise.resolve()
      const result = previous.then(() => {
        this.signal().throwIfAborted()
        return operation()
      })
      const settled = result.then(() => {}, () => {})
      this.queues.set(key, settled)
      void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key) })
      return result
    })
  }
  private signal(): AbortSignal {
    const request = this.requestContext.getStore()
    if (request === undefined) throw new Error('Canvas operation has no admitted request')
    return request.signal
  }
  private timestamp(): string { return this.now().toISOString() }
  private key(actor: IdentityActor, id: string): string { return canvasRecordKey(actor.schoolId, actor.userKey, id) }
  private objectKey(actor: IdentityActor, id: string, digest: string): string { return canvasRecordKey(actor.schoolId, actor.userKey, id, digest) }
  private mutationKey(actor: IdentityActor, id: string, mutationId: string): string { return canvasRecordKey(actor.schoolId, actor.userKey, id, mutationId) }
  private scope(actor: IdentityActor, canvasId: string): CanvasBlobScope { return { schoolId: actor.schoolId, userKey: actor.userKey, canvasId } }
  private assertId(id: string): string { return parseWire(identifier, id) }
  private checkTitle(title: string): void {
    if (title.trim() === '' || Buffer.byteLength(title, 'utf8') > this.config.limits.maxTitleBytes) {
      throw new CanvasError(413, 'TITLE_TOO_LARGE', 'Canvas title is blank or exceeds its UTF-8 byte limit.')
    }
  }
  private checkRequestBytes(body: unknown): void {
    let bytes: number
    try { bytes = canonicalByteLength(body) } catch (error) {
      throw new CanvasError(400, 'BAD_REQUEST', 'Canvas request is not safe JSON.', { cause: error })
    }
    if (bytes > this.config.limits.maxRequestBytes) throw new CanvasError(413, 'PAYLOAD_TOO_LARGE', 'Complete Canvas request exceeds its byte limit.')
  }
  private requestHash(operation: string, canvasId: string, body: unknown): string { return canvasHash(canonicalBytes({ operation, canvasId, body })) }
  private requireHead(actor: IdentityActor, canvasId: string, allowDeleted: boolean): CanvasHeadRecord {
    this.assertId(canvasId)
    const row = this.heads.get(this.key(actor, canvasId))
    if (row === undefined || !own(actor, row)) throw notFound()
    if (!allowDeleted && row.deletedAt !== undefined) throw new CanvasError(410, 'DELETED', 'Canvas is deleted.', { currentHead: canvasHeadOf(row) })
    return row
  }
  private requireObject(actor: IdentityActor, canvasId: string, digest: string): CanvasObjectRecord {
    const row = this.objects.get(this.objectKey(actor, canvasId, digest))
    if (row === undefined || !own(actor, row) || row.canvasId !== canvasId) throw new CanvasError(404, 'OBJECT_NOT_FOUND', 'Object is not stored in this account and Canvas.')
    if (row.status !== 'ready') throw new CanvasError(409, 'OBJECT_INCOMPLETE', 'Object publication has not durably completed.')
    return row
  }
  private graphLimits(): GraphLimits {
    return {
      maxBytes: this.config.limits.maxDocumentBytes,
      maxJsonNodes: this.config.limits.maxGraphJsonNodes,
      maxDepth: this.config.limits.maxGraphDepth,
      maxObjects: this.config.limits.maxClosureObjects,
      maxReferences: this.config.limits.maxGraphReferences,
      maxReferencesPerObject: this.config.limits.maxReferencesPerObject,
      maxIssues: this.config.limits.maxGraphIssues,
    }
  }
  private pageSize(value?: string): number {
    if (value === undefined) return this.config.limits.defaultPageSize
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > this.config.limits.maxPageSize) {
      throw new CanvasError(400, 'BAD_REQUEST', `limit must be from 1 to ${this.config.limits.maxPageSize}.`)
    }
    return Number(value)
  }
  private decodeListCursor(value: string, filters: string): ListCursor {
    if (value.length > this.config.limits.maxSearchBytes * 4 + 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new CanvasError(400, 'BAD_CURSOR', 'Canvas list cursor is invalid.')
    try {
      const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
      const schema = z.strictObject({ version: z.literal(1), filters: digestSchema, primary: z.string(), id: identifier })
      const cursor = schema.parse(parsed)
      if (cursor.filters !== filters) throw new Error('cursor filters differ')
      return cursor
    } catch (error) { throw new CanvasError(400, 'BAD_CURSOR', 'Canvas cursor does not match these filters.', { cause: error }) }
  }
  private prepare(value: CanvasStoredValue, canvasId: string, clientUpload: boolean): PreparedObject {
    const bytes = canonicalBytes(value)
    return this.prepareBytes(bytes, canvasHash(bytes), canvasId, clientUpload)
  }
  private prepareBytes(bytes: Uint8Array, digest: string, canvasId: string, clientUpload: boolean): PreparedObject {
    if (bytes.byteLength < 1 || bytes.byteLength > this.config.limits.maxRequestBytes || bytes.byteLength > this.config.limits.maxObjectBytes) {
      throw new CanvasError(413, 'OBJECT_TOO_LARGE', 'Complete Canvas object exceeds its UTF-8 byte limit.')
    }
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch (error) {
      throw new CanvasError(400, 'BAD_OBJECT', 'Canvas object is not valid UTF-8 JSON.', { cause: error })
    }
    const parsed = parseStoredValue(raw)
    if (!parsed.ok) throw new CanvasError(400, 'BAD_OBJECT', 'Canvas object fields are invalid.', { details: jsonObject({ issues: parsed.issues }) })
    const value = parsed.value
    const canonical = canonicalBytes(value)
    if (canonical.byteLength !== bytes.byteLength || Buffer.compare(Buffer.from(canonical), Buffer.from(bytes)) !== 0) {
      throw new CanvasError(400, 'NON_CANONICAL_OBJECT', 'Object bytes must be the complete canonical JSON encoding.')
    }
    if (canvasHash(bytes) !== digest) throw new CanvasError(400, 'DIGEST_MISMATCH', 'Object bytes do not match the requested SHA-256.')
    const kind = 'kind' in value ? value.kind : 'manifest'
    if (!('kind' in value)) {
      if (value.id !== canvasId) throw new CanvasError(400, 'BAD_MANIFEST', 'Manifest id differs from its Canvas.')
      this.checkTitle(value.title)
    }
    if (clientUpload && 'kind' in value && value.kind === 'snapshot' && value.source === 'server-engine') {
      throw new CanvasError(403, 'SERVER_AUTHORITY_REQUIRED', 'Clients cannot upload server-engine captures.')
    }
    const refs = refsOf(value)
    if (refs.length > this.config.limits.maxReferencesPerObject) throw new CanvasError(413, 'REFERENCE_LIMIT', 'Canvas object has too many explicit dependencies.')
    if ('kind' in value && value.kind === 'history' && value.entries.length > this.config.limits.maxHistoryEntries) {
      throw new CanvasError(413, 'HISTORY_LIMIT', 'Canvas history has too many retained entries.')
    }
    return { value, bytes: canonical, digest, kind, refs }
  }
  private async storeObject(actor: IdentityActor, canvasId: string, object: PreparedObject): Promise<boolean> {
    for (const ref of object.refs) {
      const dependency = this.requireObject(actor, canvasId, canvasDigest(ref.digest))
      if (dependency.kind !== ref.kind) throw new CanvasError(400, 'REFERENCE_KIND_MISMATCH', 'An object dependency has a different stored kind.')
    }
    const key = this.objectKey(actor, canvasId, object.digest)
    const existing = this.objects.get(key)
    if (existing !== undefined) {
      this.checkObjectMetadata(actor, canvasId, existing, object)
      if (existing.status === 'ready') {
        await this.blobs.read(this.scope(actor, canvasId), object.digest, existing.bytes, this.config.limits.maxObjectBytes, this.signal())
        return true
      }
      await this.blobs.collectStaging(this.scope(actor, canvasId), Number.POSITIVE_INFINITY)
    }
    const now = this.timestamp()
    const row: CanvasObjectRecord = {
      userKey: actor.userKey, schoolId: actor.schoolId, canvasId, digest: object.digest, kind: object.kind,
      bytes: object.bytes.byteLength, refs: canvasReferenceMetadata(object.refs), status: 'reserved',
      createdAt: existing?.createdAt ?? now, reservedUntil: new Date(this.now().getTime() + this.config.limits.reservationTtlMs).toISOString(),
    }
    this.checkCapacity(actor, { table: 'objects', key, canvasId, value: row })
    if (existing === undefined) await this.objects.put(key, row)
    else await this.objects.update(key, current => {
      this.checkObjectMetadata(actor, canvasId, current, object)
      return current.status === 'ready' ? current : row
    })
    await this.blobs.publish(this.scope(actor, canvasId), object.digest, bytesOf(object.bytes), {
      expectedBytes: object.bytes.byteLength, maxBytes: this.config.limits.maxObjectBytes, signal: this.signal(),
    })
    await this.objects.update(key, current => {
      this.checkObjectMetadata(actor, canvasId, current, object)
      return { ...current, status: 'ready' }
    })
    return existing !== undefined
  }
  private checkObjectMetadata(actor: IdentityActor, canvasId: string, row: CanvasObjectRecord, object: PreparedObject): void {
    if (!own(actor, row) || row.canvasId !== canvasId) throw notFound()
    if (row.digest !== object.digest || row.kind !== object.kind || row.bytes !== object.bytes.byteLength || canonicalStringify(row.refs) !== canonicalStringify(object.refs)) {
      throw new CanvasError(409, 'OBJECT_CONFLICT', 'Immutable object metadata differs from the same address.')
    }
  }
  private async readStored(actor: IdentityActor, canvasId: string, digest: string): Promise<CanvasStoredValue> {
    const row = this.requireObject(actor, canvasId, canvasDigest(digest))
    const bytes = await this.blobs.read(this.scope(actor, canvasId), digest, row.bytes, this.config.limits.maxObjectBytes, this.signal())
    const prepared = this.prepareBytes(bytes, digest, canvasId, false)
    this.checkObjectMetadata(actor, canvasId, row, prepared)
    return prepared.value
  }
  private async readGraph(actor: IdentityActor, canvasId: string, manifestDigest: string): Promise<CanvasGraph> {
    const root = await this.readStored(actor, canvasId, manifestDigest)
    if ('kind' in root) throw new CanvasError(400, 'BAD_MANIFEST', 'Published head must reference a Canvas manifest.')
    const objects: Record<string, WorkbenchObject> = {}
    const pending = [...refsOf(root)]
    if (pending.length > this.config.limits.maxGraphReferences) throw new CanvasError(413, 'REFERENCE_LIMIT', 'Canvas manifest exceeds its configured reference count.')
    const expected = new Map<string, ObjectRef['kind']>()
    let objectCount = 0
    let retained = this.requireObject(actor, canvasId, manifestDigest).bytes
    for (let index = 0; index < pending.length; index += 1) {
      this.signal().throwIfAborted()
      const ref = pending[index]!
      const previousKind = expected.get(ref.digest)
      if (previousKind !== undefined && previousKind !== ref.kind) throw new CanvasError(400, 'REFERENCE_KIND_MISMATCH', 'Dependency address is referenced with multiple kinds.')
      expected.set(ref.digest, ref.kind)
      if (objects[ref.digest] !== undefined) continue
      objectCount += 1
      if (objectCount > this.config.limits.maxClosureObjects) throw new CanvasError(413, 'CLOSURE_LIMIT', 'Canvas dependency closure contains too many objects.')
      const value = await this.readStored(actor, canvasId, ref.digest)
      if (!('kind' in value) || value.kind !== ref.kind) throw new CanvasError(400, 'REFERENCE_KIND_MISMATCH', 'Dependency content differs from its declared kind.')
      objects[ref.digest] = value
      retained += this.requireObject(actor, canvasId, ref.digest).bytes
      if (!Number.isSafeInteger(retained) || retained > this.config.limits.maxDocumentBytes) throw new CanvasError(413, 'DOCUMENT_QUOTA', 'Complete Canvas dependency closure exceeds document byte quota.')
      pending.push(...refsOf(value))
      if (pending.length > this.config.limits.maxGraphReferences) throw new CanvasError(413, 'REFERENCE_LIMIT', 'Complete Canvas dependency closure exceeds its configured reference count.')
    }
    const parsed = validateGraph(root, objects, this.graphLimits())
    if (!parsed.ok) throw new CanvasError(400, 'BAD_GRAPH', 'Canvas dependency graph is invalid.', { details: jsonObject({ issues: parsed.issues }) })
    return parsed.value
  }
  private async publishVerificationOutcome(
    actor: IdentityActor, canvasId: string, mutationId: string, requestHash: string, outcome: CanvasVerificationOutcome,
  ): Promise<void> {
    const bytes = canonicalBytes({ schemaVersion: 1, receipt: outcome.receipt, datasets: outcome.datasets,
      ...(outcome.snapshot === undefined ? {} : { snapshot: outcome.snapshot }) })
    if (bytes.byteLength > this.config.limits.maxVerificationAttemptBytes) throw new CanvasError(413, 'VERIFICATION_ATTEMPT_LIMIT', 'Complete server verification attempt exceeds its configured byte limit.')
    const digest = canvasHash(bytes)
    const key = this.mutationKey(actor, canvasId, mutationId)
    const reservation = this.reservations.get(key)
    if (reservation === undefined || !own(actor, reservation) || reservation.operation !== 'verify' || reservation.requestHash !== requestHash) {
      throw new CanvasError(409, 'MUTATION_CONFLICT', 'Server verification reservation is missing or has changed.')
    }
    if (reservation.verificationAttempt !== undefined && reservation.verificationAttempt.digest !== digest) {
      await this.blobs.removeVerificationAttempt(this.scope(actor, canvasId), reservation.verificationAttempt.digest)
    }
    const row: CanvasReservation = {
      ...reservation,
      verificationAttempt: { digest, bytes: bytes.byteLength, status: 'reserved', refs: canvasReferenceMetadata([
        { kind: 'scene', digest: outcome.receipt.sceneDigest }, { kind: 'snapshot', digest: outcome.receipt.captureDigest },
      ]) },
    }
    this.checkCapacity(actor, { table: 'reservations', key, canvasId, value: row })
    await this.reservations.update(key, current => {
      if (!own(actor, current) || current.canvasId !== canvasId || current.operation !== 'verify' || current.requestHash !== requestHash) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Server verification reservation changed before publication.')
      return row
    })
    await this.blobs.publishVerificationAttempt(this.scope(actor, canvasId), digest, bytes, {
      expectedBytes: bytes.byteLength, maxBytes: this.config.limits.maxVerificationAttemptBytes, signal: this.signal(),
    })
    await this.reservations.update(key, current => {
      if (!own(actor, current) || current.canvasId !== canvasId || current.requestHash !== requestHash || current.verificationAttempt?.digest !== digest) {
        throw new CanvasError(409, 'MUTATION_CONFLICT', 'Server verification attempt reservation changed before durable acknowledgement.')
      }
      return { ...current, verificationAttempt: { ...current.verificationAttempt, status: 'ready' } }
    })
  }
  private async readVerificationOutcome(
    actor: IdentityActor, canvasId: string, reservation: CanvasReservation | undefined, captureDigest: string,
  ): Promise<CanvasVerificationOutcome | undefined> {
    if (reservation === undefined) return undefined
    const attempt = reservation.verificationAttempt
    if (attempt === undefined) return undefined
    let bytes: Uint8Array
    try { bytes = await this.blobs.readVerificationAttempt(this.scope(actor, canvasId), attempt.digest, attempt.bytes, this.config.limits.maxVerificationAttemptBytes) } catch (error) {
      if (!(error instanceof CanvasError) || error.code !== 'BLOB_MISSING' || attempt.status === 'ready') throw error
      return undefined
    }
    if (attempt.status === 'reserved') {
      await this.blobs.publishVerificationAttempt(this.scope(actor, canvasId), attempt.digest, bytes, {
        expectedBytes: attempt.bytes, maxBytes: this.config.limits.maxVerificationAttemptBytes, signal: this.signal(),
      })
      await this.reservations.update(reservation.id, current => {
        if (!own(actor, current) || current.canvasId !== canvasId || current.requestHash !== reservation.requestHash || current.verificationAttempt?.digest !== attempt.digest) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Server verification attempt changed during recovery.')
        return { ...current, verificationAttempt: { ...current.verificationAttempt, status: 'ready' } }
      })
    }
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch (error) {
      throw new CanvasError(503, 'BLOB_CORRUPT', 'Server verification attempt contains invalid JSON.', { cause: error })
    }
    const parsed = z.strictObject({ schemaVersion: z.literal(1), receipt: canvasVerificationReceiptSchema, datasets: z.array(z.unknown()), snapshot: z.unknown().optional() }).safeParse(raw)
    if (!parsed.success) throw new CanvasError(503, 'BLOB_CORRUPT', 'Server verification attempt fields failed integrity verification.')
    const receipt = parsed.data.receipt
    if (receipt.canvasId !== canvasId || receipt.captureDigest !== captureDigest) throw new CanvasError(503, 'BLOB_CORRUPT', 'Server verification attempt belongs to a different capture.')
    const datasets: DatasetObject[] = []
    for (const value of parsed.data.datasets) {
      const object = parseObject(value)
      if (!object.ok || object.value.kind !== 'dataset') throw new CanvasError(503, 'BLOB_CORRUPT', 'Server verification attempt contains an invalid dataset.')
      datasets.push(object.value)
    }
    let snapshot: CanvasVerificationOutcome['snapshot']
    if (parsed.data.snapshot !== undefined) {
      const object = parseObject(parsed.data.snapshot)
      if (!object.ok || object.value.kind !== 'snapshot' || object.value.source !== 'server-engine') throw new CanvasError(503, 'BLOB_CORRUPT', 'Server verification attempt contains an invalid server snapshot.')
      snapshot = object.value
    }
    const outcome: CanvasVerificationOutcome = { receipt, datasets, ...(snapshot === undefined ? {} : { snapshot }) }
    if (canvasHash(canonicalBytes({ schemaVersion: 1, receipt: outcome.receipt, datasets: outcome.datasets, ...(outcome.snapshot === undefined ? {} : { snapshot: outcome.snapshot }) })) !== attempt.digest) {
      throw new CanvasError(503, 'BLOB_CORRUPT', 'Server verification attempt changed during JSON validation.')
    }
    return outcome
  }
  private checkManifestAgainstHead(manifest: CanvasManifest, row: CanvasHeadRecord): void {
    if (manifest.id !== row.id || manifest.createdAt !== row.createdAt) throw new CanvasError(400, 'BAD_MANIFEST', 'Manifest identity or creation time differs from its durable head.')
    this.checkTitle(manifest.title)
  }
  private nextSequence(actor: IdentityActor): number {
    let highest = 0
    for (const [, row] of this.heads.entries()) if (own(actor, row)) highest = Math.max(highest, row.changeSeq)
    return nextInteger(highest, 'Canvas account change sequence')
  }
  private receipt(actor: IdentityActor, canvasId: string, capsule: CanvasCommitCapsule): CanvasMutationReceipt {
    return { ...capsule, userKey: actor.userKey, schoolId: actor.schoolId, canvasId, createdAt: capsule.head.updatedAt }
  }
  private validateReplay(actor: IdentityActor, canvasId: string, mutationId: string, requestHash: string, current: CanvasHeadRecord): CanvasCommitCapsule | undefined {
    if (!own(actor, current) || current.id !== canvasId) throw notFound()
    const verification = this.verifications.get(this.mutationKey(actor, canvasId, mutationId))
    if (verification !== undefined) throw new CanvasError(409, 'MUTATION_CONFLICT', 'mutationId belongs to a server verification request.')
    const receipt = this.receipts.get(this.mutationKey(actor, canvasId, mutationId))
    if (receipt !== undefined && (!own(actor, receipt) || receipt.canvasId !== canvasId)) throw notFound()
    const capsule = receipt ?? (current.lastCommit.mutationId === mutationId ? current.lastCommit : undefined)
    if (capsule === undefined) return undefined
    if (capsule.requestHash !== requestHash) throw new CanvasError(409, 'MUTATION_CONFLICT', 'mutationId was already used for different request content.')
    return { mutationId: capsule.mutationId, requestHash: capsule.requestHash, operation: capsule.operation, head: capsule.head }
  }
  private async replayIfPresent(actor: IdentityActor, canvasId: string, mutationId: string, requestHash: string): Promise<CanvasCommitCapsule | undefined> {
    this.assertId(canvasId)
    const current = this.heads.get(this.key(actor, canvasId))
    if (current === undefined) return undefined
    const candidate = this.validateReplay(actor, canvasId, mutationId, requestHash, current)
    if (candidate === undefined) return undefined
    try {
      await this.heads.update(this.key(actor, canvasId), queued => {
        const replay = this.validateReplay(actor, canvasId, mutationId, requestHash, queued)
        if (replay === undefined) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Committed mutation receipt is missing.')
        throw new ReplayCommit(replay)
      })
    } catch (error) {
      if (!(error instanceof ReplayCommit)) throw error
      await this.ensureReceipt(actor, canvasId, error.capsule)
      await this.releaseReservation(actor, canvasId, mutationId, requestHash)
      return error.capsule
    }
    throw new Error('Canvas replay check unexpectedly performed a write')
  }
  private async openReplay(actor: IdentityActor, capsule: CanvasCommitCapsule): Promise<CanvasOpenResponse & { readonly replayed: boolean }> {
    const graph = await this.readGraph(actor, capsule.head.id, capsule.head.manifestDigest)
    return { head: canvasHeadOf(capsule.head), manifest: graph.manifest, replayed: true }
  }
  private async ensureReceipt(actor: IdentityActor, canvasId: string, capsule: CanvasCommitCapsule): Promise<void> {
    const key = this.mutationKey(actor, canvasId, capsule.mutationId)
    const existing = this.receipts.get(key)
    if (existing !== undefined) {
      if (!own(actor, existing) || existing.canvasId !== canvasId) throw notFound()
      if (existing.requestHash !== capsule.requestHash || canonicalStringify(existing.head) !== canonicalStringify(capsule.head)) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Durable mutation receipt disagrees with its committed head.')
      return
    }
    const receipt = this.receipt(actor, canvasId, capsule)
    this.checkCapacity(actor, { table: 'receipts', key, canvasId, value: receipt })
    await this.receipts.put(key, receipt)
  }
  private async publishNewHead(
    actor: IdentityActor, canvasId: string, manifest: CanvasManifest, object: PreparedObject,
    mutationId: string, requestHash: string, operation: 'create' | 'copy',
  ): Promise<CanvasOpenResponse & { readonly replayed: boolean }> {
    const head: CanvasHead = {
      id: canvasId, title: manifest.title, version: 1, generation: 1, changeSeq: this.nextSequence(actor),
      manifestDigest: object.digest, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt,
    }
    const capsule: CanvasCommitCapsule = { mutationId, requestHash, operation, head }
    const row: CanvasHeadRecord = { ...head, userKey: actor.userKey, schoolId: actor.schoolId, lastCommit: capsule, history: [] }
    const receipt = this.receipt(actor, canvasId, capsule)
    await this.reserve(actor, canvasId, mutationId, requestHash, operation, [object.digest], [
      { table: 'heads', key: this.key(actor, canvasId), bytes: this.recordBytes('heads', this.key(actor, canvasId), row) },
      { table: 'receipts', key: this.mutationKey(actor, canvasId, mutationId), bytes: this.recordBytes('receipts', this.mutationKey(actor, canvasId, mutationId), receipt) },
    ], manifest.createdAt)
    await this.storeObject(actor, canvasId, object)
    await this.readGraph(actor, canvasId, object.digest)
    if (this.heads.get(this.key(actor, canvasId)) !== undefined) throw new CanvasError(409, 'ID_CONFLICT', 'Canvas id was concurrently retained.')
    this.checkCapacity(actor, { table: 'heads', key: this.key(actor, canvasId), canvasId, value: row })
    this.signal().throwIfAborted()
    await this.heads.put(this.key(actor, canvasId), row)
    await this.ensureReceipt(actor, canvasId, capsule)
    await this.releaseReservation(actor, canvasId, mutationId, requestHash)
    return { head, manifest, replayed: false }
  }
  private async lifecycle(actor: IdentityActor, canvasId: string, body: unknown, deleted: boolean): Promise<CanvasCommitResponse> {
    this.checkRequestBytes(body)
    const input = parseWire(lifecycleWire, body)
    const operation = deleted ? 'delete' : 'restore'
    const hash = this.requestHash(operation, canvasId, input)
    const replay = await this.replayIfPresent(actor, canvasId, input.mutationId, hash)
    if (replay !== undefined) return this.openReplay(actor, replay)
    const row = this.requireHead(actor, canvasId, true)
    if ((row.deletedAt !== undefined) === deleted) throw new CanvasError(409, deleted ? 'ALREADY_DELETED' : 'NOT_DELETED', 'Canvas lifecycle state differs from this operation.', { currentHead: canvasHeadOf(row) })
    const graph = await this.readGraph(actor, canvasId, row.manifestDigest)
    return this.publishMutation(actor, row, { ...input, operation, requestHash: hash, manifest: graph.manifest, manifestDigest: row.manifestDigest, deleted })
  }
  private async publishMutation(actor: IdentityActor, observed: CanvasHeadRecord, input: MutationInput): Promise<CanvasCommitResponse> {
    await this.ensureReceipt(actor, observed.id, observed.lastCommit)
    const activeReservation = this.reservations.get(this.mutationKey(actor, observed.id, input.mutationId))
    const at = activeReservation?.createdAt ?? this.timestamp()
    const historical = observed.history.some(entry => entry.manifestDigest === observed.manifestDigest)
      ? observed.history
      : [...observed.history, { manifestDigest: observed.manifestDigest, version: observed.version, generation: observed.generation, at: observed.updatedAt }]
    if (historical.length > this.config.limits.maxHistoryEntries) throw new CanvasError(413, 'HISTORY_LIMIT', 'Canvas retained head history exceeds its configured entry limit.')
    const head: CanvasHead = {
      id: observed.id, title: input.manifest.title, version: nextInteger(observed.version, 'Canvas version'),
      generation: (input.operation === 'delete' || input.operation === 'restore') ? nextInteger(observed.generation, 'Canvas generation') : observed.generation,
      changeSeq: this.nextSequence(actor), manifestDigest: input.manifestDigest, createdAt: observed.createdAt, updatedAt: at,
      ...(input.deleted ? { deletedAt: at } : {}),
    }
    const capsule: CanvasCommitCapsule = { mutationId: input.mutationId, requestHash: input.requestHash, operation: input.operation, head }
    const row: CanvasHeadRecord = { ...head, userKey: actor.userKey, schoolId: actor.schoolId, lastCommit: capsule, history: [...historical] }
    const receipt = this.receipt(actor, observed.id, capsule)
    await this.reserve(actor, observed.id, input.mutationId, input.requestHash, input.operation, [input.manifestDigest, observed.manifestDigest], [
      { table: 'heads', key: this.key(actor, observed.id), bytes: this.recordBytes('heads', this.key(actor, observed.id), row) },
      { table: 'receipts', key: this.mutationKey(actor, observed.id, input.mutationId), bytes: this.recordBytes('receipts', this.mutationKey(actor, observed.id, input.mutationId), receipt) },
    ], at)
    this.checkCapacity(actor, { table: 'heads', key: this.key(actor, observed.id), canvasId: observed.id, value: row })
    this.signal().throwIfAborted()
    let committed: CanvasCommitCapsule
    let replayed = false
    try {
      const durable = await this.heads.update(this.key(actor, observed.id), current => {
        const replay = this.validateReplay(actor, observed.id, input.mutationId, input.requestHash, current)
        if (replay !== undefined) throw new ReplayCommit(replay)
        if (current.version !== input.expectedVersion || current.version !== observed.version || (input.expectedGeneration !== undefined && current.generation !== input.expectedGeneration)) {
          throw new CanvasError(409, 'VERSION_CONFLICT', 'Canvas was changed by another device.', { currentHead: canvasHeadOf(current) })
        }
        const requiresDeleted = input.operation === 'restore'
        if ((current.deletedAt !== undefined) !== requiresDeleted) {
          throw new CanvasError(current.deletedAt === undefined ? 409 : 410, 'LIFECYCLE_CONFLICT', 'Canvas deletion state changed before this commit.', { currentHead: canvasHeadOf(current) })
        }
        return row
      })
      committed = durable.lastCommit
    } catch (error) {
      if (!(error instanceof ReplayCommit)) throw error
      committed = error.capsule
      replayed = true
    }
    await this.ensureReceipt(actor, observed.id, committed)
    await this.releaseReservation(actor, observed.id, input.mutationId, input.requestHash)
    return { head: canvasHeadOf(committed.head), manifest: replayed ? (await this.readGraph(actor, observed.id, committed.head.manifestDigest)).manifest : input.manifest, replayed }
  }
  private recordBytes(table: AccountingTable, key: string, value: PersistentRow): number {
    const metadata = canonicalByteLength({ domain: canvasDomain.name, version: canvasDomain.version, table, key, value })
    if (metadata > this.config.limits.maxMetadataBytes || (table === 'heads' && metadata > this.config.limits.maxHeadBytes)) {
      throw new CanvasError(413, 'METADATA_LIMIT', 'Complete Canvas metadata record exceeds its byte limit.')
    }
    return metadata + (table === 'objects' && 'bytes' in value ? value.bytes : 0)
      + (table === 'reservations' && 'verificationAttempt' in value ? value.verificationAttempt?.bytes ?? 0 : 0)
  }
  private accounting(actor: IdentityActor, replacement?: AccountingReplacement): AccountingRow[] {
    const rows: AccountingRow[] = []
    const add = (table: AccountingTable, key: string, canvasId: string, value: PersistentRow): void => {
      if (!own(actor, value) || (replacement?.table === table && replacement.key === key)) return
      rows.push({ table, key, canvasId, value, bytes: this.recordBytes(table, key, value) })
    }
    for (const [key, row] of this.heads.entries()) add('heads', key, row.id, row)
    for (const [key, row] of this.objects.entries()) add('objects', key, row.canvasId, row)
    for (const [key, row] of this.reservations.entries()) add('reservations', key, row.canvasId, row)
    for (const [key, row] of this.receipts.entries()) add('receipts', key, row.canvasId, row)
    for (const [key, row] of this.verifications.entries()) add('verifications', key, row.canvasId, row)
    if (replacement !== undefined) rows.push({ ...replacement, bytes: this.recordBytes(replacement.table, replacement.key, replacement.value) })
    return rows
  }
  private checkCapacity(actor: IdentityActor, replacement: AccountingReplacement): void {
    const rows = this.accounting(actor, replacement)
    const charges = new Map<string, number>()
    const documents = new Set<string>()
    const objectCounts = new Map<string, number>()
    const allocations = new Map<string, { readonly canvasId: string; readonly bytes: number }>()
    const materialized = new Map<string, number>()
    for (const row of rows) {
      documents.add(row.canvasId)
      charges.set(row.canvasId, (charges.get(row.canvasId) ?? 0) + row.bytes)
      materialized.set(`${row.table}/${row.key}`, row.bytes)
      if (row.table === 'objects') objectCounts.set(row.canvasId, (objectCounts.get(row.canvasId) ?? 0) + 1)
      if (row.table === 'reservations' && 'allocations' in row.value) {
        for (const allocation of row.value.allocations) {
          const key = `${allocation.table}/${allocation.key}`
          const previous = allocations.get(key)
          if (previous === undefined || previous.bytes < allocation.bytes) allocations.set(key, { canvasId: row.canvasId, bytes: allocation.bytes })
        }
      }
    }
    for (const [key, allocation] of allocations) {
      const remaining = Math.max(0, allocation.bytes - (materialized.get(key) ?? 0))
      charges.set(allocation.canvasId, (charges.get(allocation.canvasId) ?? 0) + remaining)
      if (key.startsWith('objects/') && !materialized.has(key)) {
        objectCounts.set(allocation.canvasId, (objectCounts.get(allocation.canvasId) ?? 0) + 1)
      }
    }
    if (documents.size > this.config.limits.maxDocumentsPerAccount) throw new CanvasError(413, 'DOCUMENT_LIMIT', 'Account has too many retained or reserved Canvases.')
    let total = 0
    for (const [canvasId, bytes] of charges) {
      if (!Number.isSafeInteger(bytes) || bytes > this.config.limits.maxDocumentBytes) throw new CanvasError(413, 'DOCUMENT_QUOTA', 'Canvas retained bytes and reservations exceed its quota.')
      if ((objectCounts.get(canvasId) ?? 0) > this.config.limits.maxObjectsPerDocument) throw new CanvasError(413, 'OBJECT_LIMIT', 'Canvas has too many retained or reserved objects.')
      total += bytes
    }
    if (!Number.isSafeInteger(total) || total > this.config.limits.maxAccountBytes) throw new CanvasError(413, 'ACCOUNT_QUOTA', 'Account retained bytes and reservations exceed its quota.')
  }
  private async reserve(
    actor: IdentityActor, canvasId: string, mutationId: string, requestHash: string,
    operation: CanvasReservation['operation'], roots: readonly string[], allocations: readonly CanvasReservation['allocations'][number][],
    createdAt?: string,
  ): Promise<void> {
    const key = this.mutationKey(actor, canvasId, mutationId)
    const existing = this.reservations.get(key)
    const receipt = this.receipts.get(key)
    const verification = this.verifications.get(key)
    if ((receipt !== undefined && receipt.requestHash !== requestHash) || (verification !== undefined && verification.requestHash !== requestHash)) {
      throw new CanvasError(409, 'MUTATION_CONFLICT', 'mutationId has different durable request content.')
    }
    if (existing !== undefined && (!own(actor, existing) || existing.canvasId !== canvasId)) throw notFound()
    if (existing !== undefined && (existing.requestHash !== requestHash || existing.operation !== operation)) throw new CanvasError(409, 'MUTATION_CONFLICT', 'mutationId has a different reserved request.')
    const merged = new Map<string, CanvasReservation['allocations'][number]>()
    for (const allocation of [...(existing?.allocations ?? []), ...allocations]) {
      const key = `${allocation.table}/${allocation.key}`
      const previous = merged.get(key)
      if (previous === undefined || allocation.bytes > previous.bytes) merged.set(key, allocation)
    }
    const row: CanvasReservation = {
      userKey: actor.userKey, schoolId: actor.schoolId, canvasId, id: key, mutationId, requestHash, operation,
      roots: [...new Set([...(existing?.roots ?? []), ...roots])], allocations: [...merged.values()],
      createdAt: existing?.createdAt ?? createdAt ?? this.timestamp(), expiresAt: new Date(this.now().getTime() + this.config.limits.reservationTtlMs).toISOString(),
      ...(existing?.verificationAttempt === undefined ? {} : { verificationAttempt: existing.verificationAttempt }),
    }
    if (row.roots.length > this.config.limits.maxGraphReferences) throw new CanvasError(413, 'CLOSURE_LIMIT', 'Mutation reservation retains too many dependency roots.')
    this.checkCapacity(actor, { table: 'reservations', key, canvasId, value: row })
    if (existing === undefined) await this.reservations.put(key, row)
    else await this.reservations.update(key, current => {
      if (!own(actor, current) || current.canvasId !== canvasId) throw notFound()
      if (current.requestHash !== requestHash || current.operation !== operation) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Mutation reservation changed.')
      return row
    })
  }
  private async releaseReservation(actor: IdentityActor, canvasId: string, mutationId: string, requestHash: string): Promise<void> {
    const key = this.mutationKey(actor, canvasId, mutationId)
    const row = this.reservations.get(key)
    if (row === undefined) return
    if (!own(actor, row) || row.canvasId !== canvasId) throw notFound()
    if (row.requestHash !== requestHash) throw new CanvasError(409, 'MUTATION_CONFLICT', 'Mutation reservation has different request content.')
    if (row.verificationAttempt !== undefined) await this.blobs.removeVerificationAttempt(this.scope(actor, canvasId), row.verificationAttempt.digest)
    await this.reservations.delete(key)
  }
  private reachableMetadata(actor: IdentityActor, canvasId: string, now: number): Set<string> {
    const roots: string[] = []
    const pendingRoots: string[] = []
    const row = this.heads.get(this.key(actor, canvasId))
    if (row !== undefined && own(actor, row)) {
      roots.push(row.manifestDigest, row.lastCommit.head.manifestDigest, ...row.history.map(entry => entry.manifestDigest))
    }
    for (const [, receipt] of this.receipts.entries()) if (own(actor, receipt) && receipt.canvasId === canvasId) roots.push(receipt.head.manifestDigest)
    for (const [, reservation] of this.reservations.entries()) if (own(actor, reservation) && reservation.canvasId === canvasId && Date.parse(reservation.expiresAt) > now) pendingRoots.push(...reservation.roots)
    for (const [, verification] of this.verifications.entries()) if (own(actor, verification) && verification.canvasId === canvasId) {
      roots.push(verification.receipt.captureDigest, verification.receipt.sceneDigest)
      if (verification.resultDigest !== undefined) roots.push(verification.resultDigest)
    }
    for (const [, object] of this.objects.entries()) if (own(actor, object) && object.canvasId === canvasId && Date.parse(object.reservedUntil) > now) pendingRoots.push(object.digest)
    const marked = new Set<string>()
    for (let index = 0; index < roots.length; index += 1) {
      const digest = roots[index]!
      if (marked.has(digest)) continue
      marked.add(digest)
      const object = this.objects.get(this.objectKey(actor, canvasId, digest))
      if (object === undefined || !own(actor, object) || object.canvasId !== canvasId) {
        throw new CanvasError(503, 'REFERENCE_MISSING', 'A retained Canvas root is missing object metadata; collection is stopped.')
      }
      roots.push(...object.refs.map(ref => ref.digest))
    }
    for (let index = 0; index < pendingRoots.length; index += 1) {
      const digest = pendingRoots[index]!
      if (marked.has(digest)) continue
      marked.add(digest)
      const object = this.objects.get(this.objectKey(actor, canvasId, digest))
      if (object === undefined) continue
      if (!own(actor, object) || object.canvasId !== canvasId) throw notFound()
      pendingRoots.push(...object.refs.map(ref => ref.digest))
    }
    return marked
  }
}
