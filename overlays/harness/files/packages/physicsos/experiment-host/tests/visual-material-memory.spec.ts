/** Test-only reference repository. No runtime module imports it and there is no production memory fallback. */
import { expect, it } from 'vitest'
import {
  VisualMaterialError, visualMaterialAborted, visualMaterialDescriptor, visualMaterialLimits,
  type ManageVisualMaterial, type VisualMaterialActor, type VisualMaterialDescriptor,
  type VisualMaterialLimits, type VisualMaterialQuota, type VisualMaterialRecord,
  type VisualMaterialRecoveryPage, type VisualMaterialRecoveryPosition, type VisualMaterialRepository,
  type VisualMaterialRepositoryHit, type VisualMaterialReservation, type VisualMaterialSearchPlan, type VisualMaterialUsage,
} from '../src/visual-material-contracts.ts'
import {
  visualMaterialAfter, visualMaterialCanRead, visualMaterialManagedRecord,
  visualMaterialMatch, visualMaterialMatchesPlan,
} from '../src/visual-material-domain.ts'
import { addVisualMaterialUsage, assertVisualMaterialQuota, emptyVisualMaterialUsage } from '../src/visual-material-quota.ts'
interface Operation {
  kind: 'generated' | 'manage'
  fingerprint?: string
  state: 'pending' | 'applied' | 'canceled'
  materialId?: string
  result?: VisualMaterialDescriptor
  lastCode?: string
}
const copy = <T>(value: T): T => structuredClone(value)
const conflict = (): never => { throw new VisualMaterialError(409, 'OPERATION_CONFLICT', 'Visual material operation id already describes different input.') }

export class TestVisualMaterialRepository implements VisualMaterialRepository {
  readonly persistence = 'test-memory' as const
  readonly rows = new Map<string, VisualMaterialRecord>()
  private readonly operations = new Map<string, Operation>()
  private readonly accounts = new Map<string, VisualMaterialUsage>()
  private global = emptyVisualMaterialUsage()
  private initialized = false
  private readonly limits: VisualMaterialLimits
  constructor(limits: Partial<VisualMaterialLimits> = {}) { this.limits = visualMaterialLimits(limits) }
  async initialize(): Promise<void> { this.initialized = true }
  assertAvailable(): void { if (!this.initialized) throw new VisualMaterialError(503, 'REPOSITORY_UNAVAILABLE', 'Test repository unavailable.') }
  async close(): Promise<void> { this.initialized = false }
  private key(owner: string, operationId: string): string { return JSON.stringify([owner, operationId]) }
  private quotaOf(owner: string): VisualMaterialQuota { return { account: this.accounts.get(owner) ?? emptyVisualMaterialUsage(), global: this.global } }
  private delta(owner: string, delta: Partial<VisualMaterialUsage>): void {
    this.global = addVisualMaterialUsage(this.global, delta)
    this.accounts.set(owner, addVisualMaterialUsage(this.accounts.get(owner) ?? emptyVisualMaterialUsage(), delta))
  }
  async reserveGenerated(actor: VisualMaterialActor, record: VisualMaterialRecord, fingerprint: string, signal?: AbortSignal): Promise<VisualMaterialReservation> {
    this.assertAvailable(); visualMaterialAborted(signal)
    const key = this.key(actor.userKey, record.operationId), prior = this.operations.get(key), quota = this.quotaOf(actor.userKey)
    if (prior !== undefined) {
      if (prior.kind !== 'generated' || prior.fingerprint !== undefined && prior.fingerprint !== fingerprint) return conflict()
      if (prior.state === 'canceled') throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Canceled visual material operation cannot publish a late result.')
      const row = prior.materialId === undefined ? undefined : this.rows.get(prior.materialId)
      if (row === undefined) throw new Error('test operation integrity')
      return { record: copy(row), created: false, stageBytesReserved: quota.global.stageBytes }
    }
    assertVisualMaterialQuota(quota, this.limits, { bytes: record.byteLength, count: 1, operations: 1, activeCount: 1, stageBytes: record.byteLength })
    this.rows.set(record.id, copy(record)); this.operations.set(key, { kind: 'generated', fingerprint, state: 'pending', materialId: record.id })
    this.delta(actor.userKey, { bytes: record.byteLength, count: 1, operations: 1, activeCount: 1, stageBytes: record.byteLength })
    return { record: copy(record), created: true, stageBytesReserved: this.global.stageBytes }
  }
  async completePublication(actor: VisualMaterialActor, id: string, operationId: string, at: number, signal?: AbortSignal): Promise<VisualMaterialRecord> {
    this.assertAvailable(); visualMaterialAborted(signal)
    const op = this.operations.get(this.key(actor.userKey, operationId)), row = this.rows.get(id)
    if (op?.materialId !== id || row?.ownerKey !== actor.userKey) throw new VisualMaterialError(404, 'NOT_FOUND', 'Visual material reservation not found.')
    if (op.state === 'canceled' || row.lifecycle === 'canceled') throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Canceled visual material operation cannot become ready.')
    if (op.state === 'applied') return copy(row)
    const ready: VisualMaterialRecord = { ...row, lifecycle: 'ready', revision: row.revision + 1, updatedAt: Math.max(at, row.updatedAt), blobDurable: true, publicationPending: false }
    this.rows.set(id, ready); this.operations.set(this.key(actor.userKey, operationId), { ...op, state: 'applied', result: visualMaterialDescriptor(ready) })
    this.delta(actor.userKey, { activeCount: -1, stageBytes: -row.byteLength })
    return copy(ready)
  }
  async reconcileCanceledPublication(actor: VisualMaterialActor, id: string, operationId: string, durable: boolean, at: number): Promise<void> {
    this.assertAvailable()
    const op = this.operations.get(this.key(actor.userKey, operationId)), row = this.rows.get(id)
    if (op?.state !== 'canceled' || op.materialId !== id || row?.ownerKey !== actor.userKey) return conflict()
    if (!row.publicationPending) return
    this.rows.set(id, { ...row, blobDurable: durable, publicationPending: false, retentionCharged: durable, updatedAt: Math.max(at, row.updatedAt) })
    this.delta(actor.userKey, { activeCount: -1, stageBytes: -row.byteLength, ...(durable || !row.retentionCharged ? {} : { bytes: -row.byteLength, count: -1 }) })
  }
  async notePublicationFailure(actor: VisualMaterialActor, id: string, operationId: string, code: string): Promise<void> {
    this.assertAvailable()
    const key = this.key(actor.userKey, operationId), op = this.operations.get(key)
    if (op?.materialId !== id || op.state === 'applied') return
    this.operations.set(key, { ...op, lastCode: code })
    const row = this.rows.get(id)
    if (row?.lifecycle === 'pending' && ['BLOB_INTEGRITY', 'IMAGE_INVALID', 'BLOB_PATH_UNSAFE'].includes(code)) {
      this.rows.set(id, { ...row, lifecycle: 'failed', revision: row.revision + 1 })
    }
  }
  async cancelGenerated(actor: VisualMaterialActor, operationId: string, at: number): Promise<void> {
    this.assertAvailable()
    const key = this.key(actor.userKey, operationId), op = this.operations.get(key)
    if (op?.kind === 'manage') return conflict()
    if (op?.state === 'applied' || op?.state === 'canceled') return
    if (op === undefined) {
      assertVisualMaterialQuota(this.quotaOf(actor.userKey), this.limits, { operations: 1 })
      this.operations.set(key, { kind: 'generated', state: 'canceled' }); this.delta(actor.userKey, { operations: 1 }); return
    }
    this.operations.set(key, { ...op, state: 'canceled' })
    const row = op.materialId === undefined ? undefined : this.rows.get(op.materialId)
    if (row !== undefined) this.rows.set(row.id, { ...row, lifecycle: 'canceled', visibility: 'private', revision: row.revision + 1, updatedAt: Math.max(at, row.updatedAt) })
  }
  async get(actor: VisualMaterialActor, id: string, options: { readonly ownedOnly?: boolean; readonly includeInactive?: boolean } = {}, signal?: AbortSignal): Promise<VisualMaterialRecord | undefined> {
    this.assertAvailable(); visualMaterialAborted(signal)
    const row = this.rows.get(id)
    return row !== undefined && visualMaterialCanRead(actor, row, options) ? copy(row) : undefined
  }
  async search(actor: VisualMaterialActor, plan: VisualMaterialSearchPlan, signal?: AbortSignal): Promise<readonly VisualMaterialRepositoryHit[]> {
    this.assertAvailable(); visualMaterialAborted(signal)
    return [...this.rows.values()].filter(row => visualMaterialMatchesPlan(actor, row, plan))
      .map(record => ({ record: copy(record), match: visualMaterialMatch(record, plan) }))
      .filter(hit => plan.after === undefined || visualMaterialAfter({ score: hit.match.score, createdAt: hit.record.createdAt, id: hit.record.id }, plan.after))
      .sort((a, b) => b.match.score - a.match.score || b.record.createdAt - a.record.createdAt || (a.record.id < b.record.id ? 1 : a.record.id > b.record.id ? -1 : 0))
      .slice(0, plan.limit + 1)
  }
  async manage(actor: VisualMaterialActor, id: string, input: ManageVisualMaterial, fingerprint: string, at: number, signal?: AbortSignal): Promise<VisualMaterialDescriptor> {
    this.assertAvailable(); visualMaterialAborted(signal)
    const row = this.rows.get(id)
    if (row?.ownerKey !== actor.userKey) throw new VisualMaterialError(404, 'NOT_FOUND', 'Visual material not found.')
    const key = this.key(actor.userKey, input.operationId), op = this.operations.get(key)
    if (op !== undefined) {
      if (op.kind !== 'manage' || op.fingerprint !== fingerprint || op.materialId !== id || op.result === undefined) return conflict()
      return copy(op.result)
    }
    assertVisualMaterialQuota(this.quotaOf(actor.userKey), this.limits, { operations: 1 })
    const updated = visualMaterialManagedRecord(actor, row, input, at), descriptor = visualMaterialDescriptor(updated)
    this.rows.set(id, copy(updated)); this.operations.set(key, { kind: 'manage', fingerprint, state: 'applied', materialId: id, result: copy(descriptor) })
    this.delta(actor.userKey, { operations: 1 }); return descriptor
  }
  async quota(actor: VisualMaterialActor, signal?: AbortSignal): Promise<VisualMaterialQuota> { this.assertAvailable(); visualMaterialAborted(signal); return copy(this.quotaOf(actor.userKey)) }
  async pendingPublications(input: { readonly limit: number; readonly after?: VisualMaterialRecoveryPosition }, signal?: AbortSignal): Promise<VisualMaterialRecoveryPage> {
    this.assertAvailable(); visualMaterialAborted(signal)
    const all = [...this.rows.values()].filter(row => row.publicationPending && (input.after === undefined
      || row.createdAt > input.after.createdAt || row.createdAt === input.after.createdAt && row.id > input.after.id))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const items = all.slice(0, input.limit).map(copy), last = items.at(-1)
    return { items, ...(all.length > input.limit && last !== undefined ? { next: { createdAt: last.createdAt, id: last.id } } : {}) }
  }
}

it('keeps the in-memory reference implementation explicitly test-only', async () => {
  const repository = new TestVisualMaterialRepository()
  expect(repository.persistence).toBe('test-memory')
  expect(() => repository.assertAvailable()).toThrow()
  await repository.initialize()
  expect(() => repository.assertAvailable()).not.toThrow()
})
