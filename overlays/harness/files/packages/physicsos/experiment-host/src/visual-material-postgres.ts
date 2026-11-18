/** Runtime catalog: current SQL rows, independent normalized indexes and transactional quota ledgers. */
import type { Pool, PoolClient, PoolConfig, QueryResultRow } from 'pg'
import {
  VisualMaterialError, visualMaterialAborted, visualMaterialDescriptor, visualMaterialLimits,
  type ManageVisualMaterial, type VisualMaterialActor, type VisualMaterialDescriptor,
  type VisualMaterialLimits, type VisualMaterialMatch, type VisualMaterialQuota,
  type VisualMaterialRecord, type VisualMaterialRecoveryPage, type VisualMaterialRecoveryPosition,
  type VisualMaterialRepository, type VisualMaterialRepositoryHit, type VisualMaterialReservation,
  type VisualMaterialSearchPlan, type VisualMaterialUsage,
} from './visual-material-contracts.ts'
import {
  visualMaterialActor, visualMaterialGenerationUsage, visualMaterialId, visualMaterialIndex, visualMaterialManagedRecord,
  visualMaterialOperationId, visualMaterialSha,
} from './visual-material-domain.ts'
import { assertVisualMaterialQuota, emptyVisualMaterialUsage } from './visual-material-quota.ts'
import { migrateVisualMaterialSchema, visualMaterialTableNames, type VisualMaterialTableNames } from './visual-material-schema.ts'
import { compileVisualMaterialSearch, visualMaterialSelectColumns, VISUAL_MATERIAL_SELECT_COLUMNS } from './visual-material-sql.ts'

export interface PostgresVisualMaterialRepositoryOptions {
  /** Pass the existing runtime Pool, or explicit existing secret-backed PoolConfig; never a memory fallback. */
  readonly pool?: Pool
  readonly poolConfig?: PoolConfig
  readonly schema?: string
  readonly limits?: Partial<VisualMaterialLimits>
  /** Mandatory existing host single-writer fence. This repository additionally holds its own pool-session lock. */
  readonly assertWriterHeld: () => void
  readonly onWriterLost?: () => void
}
interface OperationRow extends QueryResultRow {
  owner_key: string
  operation_id: string
  kind: 'generated' | 'manage'
  fingerprint: string | null
  state: 'pending' | 'applied' | 'canceled'
  material_id: string | null
  result: unknown
}
const unavailable = (error?: unknown): VisualMaterialError => new VisualMaterialError(503, 'REPOSITORY_UNAVAILABLE',
  'Visual material PostgreSQL repository is unavailable.', { retryable: true }, error === undefined ? undefined : { cause: error })
const numeric = (value: unknown): number => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(number) || number < 0) throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material database contains invalid numeric metadata.')
  return number
}
function rowRecord(row: QueryResultRow): VisualMaterialRecord {
  const requiredText = (key: string): string => {
    if (typeof row[key] !== 'string') throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material database contains invalid metadata.')
    return row[key] as string
  }
  const strings = (key: string): string[] => {
    const value: unknown = row[key]
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material database contains invalid terms.')
    return [...value] as string[]
  }
  const metadata = {
    id: visualMaterialId(row.id), revision: numeric(row.revision), sha256: visualMaterialSha(row.sha256),
    byteLength: numeric(row.byte_length), mediaType: 'image/png' as const, width: numeric(row.width), height: numeric(row.height),
    kind: requiredText('kind') as VisualMaterialRecord['kind'], theme: requiredText('theme'), purpose: requiredText('purpose'),
    tags: strings('tags'), model: requiredText('model'), ...(row.style === null || row.style === undefined ? {} : { style: requiredText('style') }),
    lifecycle: requiredText('lifecycle') as VisualMaterialRecord['lifecycle'], visibility: requiredText('visibility') as VisualMaterialRecord['visibility'],
    createdAt: numeric(row.created_at), updatedAt: numeric(row.updated_at), metadataTrust: 'untrusted' as const,
  }
  return {
    ...metadata, ownerKey: requiredText('owner_key'), schoolId: requiredText('school_id'), operationId: requiredText('operation_id'),
    ...(row.private_prompt === null || row.private_prompt === undefined ? {} : { privatePrompt: requiredText('private_prompt') }),
    ...(row.source_job_id === null || row.source_job_id === undefined ? {} : { sourceJobId: requiredText('source_job_id') }),
    ...(row.generation_channel_id === null || row.generation_channel_id === undefined ? {} : { generationChannelId: requiredText('generation_channel_id') }),
    ...(row.generation_config_revision === null || row.generation_config_revision === undefined ? {} : { generationConfigRevision: requiredText('generation_config_revision') }),
    ...(row.generation_usage === null || row.generation_usage === undefined ? {} : { generationUsage: visualMaterialGenerationUsage(row.generation_usage) }),
    ...(row.share_school_id === null || row.share_school_id === undefined ? {} : { shareSchoolId: requiredText('share_school_id') }),
    index: { ...visualMaterialIndex(metadata), themeKey: requiredText('theme_key'), purposeKey: requiredText('purpose_key'),
      styleKey: requiredText('style_key'), tagKeys: strings('tag_keys'), terms: strings('terms') },
    blobDurable: row.blob_durable === true, publicationPending: row.publication_pending === true, retentionCharged: row.retention_charged === true,
  }
}
function rowUsage(row: QueryResultRow | undefined): VisualMaterialUsage {
  return row === undefined ? emptyVisualMaterialUsage() : {
    bytes: numeric(row.bytes), count: numeric(row.count), operations: numeric(row.operations),
    activeCount: numeric(row.active_count), stageBytes: numeric(row.stage_bytes),
  }
}
function operationResult(value: unknown): VisualMaterialDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material operation receipt is invalid.')
  const item = value as VisualMaterialDescriptor
  visualMaterialId(item.id); visualMaterialSha(item.sha256)
  if (!Array.isArray(item.tags) || !Number.isSafeInteger(item.revision)) throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material operation receipt is invalid.')
  return visualMaterialDescriptor(item)
}

export class PostgresVisualMaterialRepository implements VisualMaterialRepository {
  readonly persistence = 'postgres' as const
  private readonly schema: string
  private readonly t: VisualMaterialTableNames
  private readonly limits: VisualMaterialLimits
  private readonly options: PostgresVisualMaterialRepositoryOptions
  private pool: Pool | undefined
  private readonly ownsPool: boolean
  private lease: PoolClient | undefined
  private leaseHeld = false
  private state: 'new' | 'ready' | 'lost' | 'closed' = 'new'
  private initializing: Promise<void> | undefined
  private heartbeat: ReturnType<typeof setTimeout> | undefined
  private heartbeatDeadline: ReturnType<typeof setTimeout> | undefined
  constructor(options: PostgresVisualMaterialRepositoryOptions) {
    if (typeof options?.assertWriterHeld !== 'function' || (options.pool === undefined && options.poolConfig === undefined)
      || (options.pool !== undefined && options.poolConfig !== undefined)
      || (options.poolConfig?.max !== undefined && options.poolConfig.max < 2)
      || (options.pool?.options?.max !== undefined && options.pool.options.max < 2)) {
      throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual materials require an explicit PostgreSQL Pool/config and host writer fence; Pool needs at least two connections.')
    }
    this.options = options
    this.schema = options.schema ?? 'public'
    this.t = visualMaterialTableNames(this.schema)
    this.limits = visualMaterialLimits(options.limits)
    this.pool = options.pool
    this.ownsPool = options.pool === undefined
  }
  private poolOf(): Pool { if (this.pool === undefined) throw unavailable(); return this.pool }
  assertAvailable(): void {
    if (this.state !== 'ready' || !this.leaseHeld) throw unavailable()
    try { this.options.assertWriterHeld() } catch { throw unavailable() }
  }
  private loseWriter = (): void => {
    if (!this.leaseHeld) return
    this.leaseHeld = false; this.state = 'lost'
    if (this.heartbeat !== undefined) clearTimeout(this.heartbeat)
    if (this.heartbeatDeadline !== undefined) clearTimeout(this.heartbeatDeadline)
    const lease = this.lease; this.lease = undefined
    lease?.release(true)
    this.options.onWriterLost?.()
  }
  private scheduleHeartbeat(): void {
    if (!this.leaseHeld) return
    this.heartbeat = setTimeout(() => { void this.probeWriter() }, 1000)
    this.heartbeat.unref()
  }
  private async probeWriter(): Promise<void> {
    if (!this.leaseHeld || this.lease === undefined) return
    let settled = false
    this.heartbeatDeadline = setTimeout(() => {
      // An event-loop stall alone is not lease loss; give queued SQL replies one turn to settle.
      const timer = setTimeout(() => { if (!settled) this.loseWriter() }, 0); timer.unref()
    }, 5000)
    this.heartbeatDeadline.unref()
    try {
      await this.lease.query('SELECT 1 AS "alive"')
      settled = true; clearTimeout(this.heartbeatDeadline)
      this.scheduleHeartbeat()
    } catch { settled = true; this.loseWriter() }
  }
  async initialize(signal?: AbortSignal): Promise<void> {
    visualMaterialAborted(signal)
    if (this.state === 'ready') { this.assertAvailable(); return }
    if (this.state !== 'new') throw unavailable()
    this.initializing ??= this.initializeOnce()
    await this.initializing; visualMaterialAborted(signal)
  }
  private async initializeOnce(): Promise<void> {
    try {
      this.options.assertWriterHeld()
      if (this.pool === undefined) {
        const { Pool: RuntimePool } = await import('pg')
        this.pool = new RuntimePool({ connectionTimeoutMillis: 5000, max: 6, ...this.options.poolConfig })
      }
      this.poolOf().on('error', this.loseWriter)
      this.lease = await this.poolOf().connect()
      this.lease.on('error', this.loseWriter); this.lease.on('end', this.loseWriter)
      const held = await this.lease.query<{ held: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS "held"', [`physicsos:visual-material-writer:${this.schema}`])
      if (held.rows[0]?.held !== true) throw new VisualMaterialError(503, 'WRITER_CONFLICT', 'Another visual material writer owns this database schema.')
      this.leaseHeld = true
      const client = await this.poolOf().connect()
      let broken = false
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`physicsos:visual-material-migration:${this.schema}`])
        await migrateVisualMaterialSchema(client, this.schema)
        this.options.assertWriterHeld()
        if (!this.leaseHeld) throw unavailable()
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch { broken = true }
        throw error
      } finally { client.release(broken) }
      this.state = 'ready'; this.scheduleHeartbeat()
    } catch (error) {
      this.state = 'lost'; this.leaseHeld = false
      if (this.lease !== undefined) { this.lease.release(true); this.lease = undefined }
      this.pool?.off('error', this.loseWriter)
      if (this.ownsPool && this.pool !== undefined) await this.pool.end().catch(() => {})
      if (error instanceof VisualMaterialError) throw error
      throw unavailable(error)
    }
  }
  async close(): Promise<void> {
    if (this.state === 'closed') return
    if (this.initializing !== undefined) await this.initializing.catch(() => {})
    this.state = 'closed'
    if (this.heartbeat !== undefined) clearTimeout(this.heartbeat)
    if (this.heartbeatDeadline !== undefined) clearTimeout(this.heartbeatDeadline)
    const lease = this.lease; this.lease = undefined
    const held = this.leaseHeld; this.leaseHeld = false
    if (lease !== undefined) {
      let broken = !held
      if (held) {
        try { await lease.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`physicsos:visual-material-writer:${this.schema}`]) }
        catch { broken = true }
      }
      lease.release(broken)
    }
    this.pool?.off('error', this.loseWriter)
    if (this.ownsPool && this.pool !== undefined) await this.pool.end()
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertAvailable(); visualMaterialAborted(signal)
    let client: PoolClient
    try { client = await this.poolOf().connect() } catch (error) { throw unavailable(error) }
    let broken = false
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL lock_timeout = '5s'")
      await client.query("SET LOCAL statement_timeout = '30s'")
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'")
      this.assertAvailable(); visualMaterialAborted(signal)
      const result = await action(client)
      this.assertAvailable(); visualMaterialAborted(signal)
      await client.query('COMMIT')
      // Cancellation after COMMIT cannot undo retained bytes/metadata; callers may retry the receipt.
      this.assertAvailable()
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { broken = true }
      if (error instanceof VisualMaterialError) throw error
      throw unavailable(error)
    } finally { client.release(broken) }
  }
  private async read<T extends QueryResultRow>(text: string, values: readonly unknown[], signal?: AbortSignal): Promise<T[]> {
    return this.transaction(async client => (await client.query<T>(text, [...values])).rows, signal)
  }
  private async lockQuota(client: PoolClient, owner: string): Promise<VisualMaterialQuota> {
    // Global then owner ordering serializes quota reservations and avoids read/modify/write lost updates.
    const global = await client.query(`SELECT * FROM ${this.t.quota} WHERE "scope" = 'global' AND "subject" = '' FOR UPDATE`)
    if (global.rows[0] === undefined) throw new VisualMaterialError(503, 'QUOTA_INTEGRITY', 'Visual material global quota ledger is missing.')
    await client.query(`INSERT INTO ${this.t.quota} ("scope", "subject") VALUES ('owner', $1) ON CONFLICT DO NOTHING`, [owner])
    const account = await client.query(`SELECT * FROM ${this.t.quota} WHERE "scope" = 'owner' AND "subject" = $1 FOR UPDATE`, [owner])
    return { global: rowUsage(global.rows[0]), account: rowUsage(account.rows[0]) }
  }
  private async updateQuota(client: PoolClient, owner: string, delta: Partial<VisualMaterialUsage>): Promise<void> {
    await client.query(`UPDATE ${this.t.quota} SET "bytes" = "bytes" + $2::bigint, "count" = "count" + $3::bigint,
      "operations" = "operations" + $4::bigint, "active_count" = "active_count" + $5::bigint, "stage_bytes" = "stage_bytes" + $6::bigint
      WHERE ("scope" = 'global' AND "subject" = '') OR ("scope" = 'owner' AND "subject" = $1)`,
    [owner, delta.bytes ?? 0, delta.count ?? 0, delta.operations ?? 0, delta.activeCount ?? 0, delta.stageBytes ?? 0])
  }
  private async operation(client: PoolClient, owner: string, operationId: string): Promise<OperationRow | undefined> {
    const result = await client.query<OperationRow>(`SELECT * FROM ${this.t.operation} WHERE "owner_key" = $1 AND "operation_id" = $2 FOR UPDATE`, [owner, operationId])
    return result.rows[0]
  }
  private async current(client: PoolClient, id: string): Promise<VisualMaterialRecord | undefined> {
    const result = await client.query(`SELECT ${visualMaterialSelectColumns()},
      (SELECT sr."school_id" FROM ${this.t.ref} AS sr WHERE sr."material_id" = m."id") AS "share_school_id"
      FROM ${this.t.material} AS m WHERE m."id" = $1 FOR UPDATE OF m`, [id])
    return result.rows[0] === undefined ? undefined : rowRecord(result.rows[0])
  }
  private async insertTerms(client: PoolClient, record: VisualMaterialRecord): Promise<void> {
    const entries = record.index.entries
    if (!entries.length) return
    await client.query(`INSERT INTO ${this.t.term} ("material_id", "term", "field", "weight")
      SELECT $1, input."term", input."field", input."weight" FROM unnest($2::text[], $3::text[], $4::integer[])
        AS input("term", "field", "weight")`,
    [record.id, entries.map(entry => entry.term), entries.map(entry => entry.field), entries.map(entry => entry.weight)])
  }

  async reserveGenerated(actor0: VisualMaterialActor, record: VisualMaterialRecord, fingerprint: string, signal?: AbortSignal): Promise<VisualMaterialReservation> {
    const actor = visualMaterialActor(actor0); visualMaterialId(record.id); visualMaterialSha(fingerprint); visualMaterialSha(record.sha256)
    if (record.ownerKey !== actor.userKey || record.schoolId !== actor.schoolId || record.visibility !== 'private'
      || record.lifecycle !== 'pending' || !record.publicationPending || record.blobDurable || !record.retentionCharged
      || record.byteLength < 1 || record.byteLength > this.limits.maxImageBytes) {
      throw new VisualMaterialError(400, 'INPUT_INVALID', 'Invalid visual material publication reservation.')
    }
    return this.transaction(async client => {
      const quota = await this.lockQuota(client, actor.userKey)
      const prior = await this.operation(client, actor.userKey, record.operationId)
      if (prior !== undefined) {
        if (prior.kind !== 'generated' || prior.fingerprint !== null && prior.fingerprint !== fingerprint) {
          throw new VisualMaterialError(409, 'OPERATION_CONFLICT', 'Visual material operation id already describes different input.')
        }
        if (prior.state === 'canceled') throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Canceled visual material operation cannot publish a late result.')
        const existing = prior.material_id === null ? undefined : await this.current(client, prior.material_id)
        if (existing === undefined) throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material operation has no reservation metadata.')
        return { record: existing, created: false, stageBytesReserved: quota.global.stageBytes }
      }
      assertVisualMaterialQuota(quota, this.limits, { bytes: record.byteLength, count: 1, operations: 1, activeCount: 1, stageBytes: record.byteLength })
      const values = [
        record.id, record.ownerKey, record.schoolId, record.operationId, record.revision, record.sha256, record.byteLength,
        record.mediaType, record.width, record.height, record.kind, record.theme, record.purpose, record.style ?? null,
        [...record.tags], record.model, record.index.themeKey, record.index.purposeKey, record.index.styleKey,
        [...record.index.tagKeys], [...record.index.terms], record.privatePrompt ?? null, record.sourceJobId ?? null,
        record.lifecycle, record.visibility, record.createdAt, record.updatedAt, false, true, true,
        record.generationChannelId ?? null, record.generationConfigRevision ?? null,
        record.generationUsage === undefined ? null : JSON.stringify(visualMaterialGenerationUsage(record.generationUsage)),
      ]
      await client.query(`INSERT INTO ${this.t.material} (${VISUAL_MATERIAL_SELECT_COLUMNS.map(name => `"${name}"`).join(', ')})
        VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})`, values)
      await this.insertTerms(client, record)
      await client.query(`INSERT INTO ${this.t.operation} ("owner_key", "operation_id", "kind", "fingerprint", "state", "material_id", "created_at", "updated_at")
        VALUES ($1, $2, 'generated', $3, 'pending', $4, $5, $5)`, [actor.userKey, record.operationId, fingerprint, record.id, record.createdAt])
      await this.updateQuota(client, actor.userKey, { bytes: record.byteLength, count: 1, operations: 1, activeCount: 1, stageBytes: record.byteLength })
      return { record, created: true, stageBytesReserved: quota.global.stageBytes + record.byteLength }
    }, signal)
  }
  async completePublication(actor0: VisualMaterialActor, id: string, operationId: string, at: number, signal?: AbortSignal): Promise<VisualMaterialRecord> {
    const actor = visualMaterialActor(actor0); visualMaterialId(id); visualMaterialOperationId(operationId)
    return this.transaction(async client => {
      await this.lockQuota(client, actor.userKey)
      const op = await this.operation(client, actor.userKey, operationId), current = await this.current(client, id)
      if (op?.material_id !== id || current?.ownerKey !== actor.userKey || op.kind !== 'generated') throw new VisualMaterialError(404, 'NOT_FOUND', 'Visual material reservation not found.')
      if (op.state === 'canceled' || current.lifecycle === 'canceled') throw new VisualMaterialError(409, 'OPERATION_CANCELED', 'Canceled visual material operation cannot become ready.')
      if (op.state === 'applied') return current
      if (!current.publicationPending || !current.retentionCharged) throw new VisualMaterialError(503, 'REPOSITORY_INTEGRITY', 'Visual material publication ledger is inconsistent.')
      const ready: VisualMaterialRecord = {
        ...current, lifecycle: 'ready', revision: current.revision + 1, updatedAt: Math.max(at, current.updatedAt),
        blobDurable: true, publicationPending: false,
      }
      await client.query(`UPDATE ${this.t.material} SET "lifecycle" = 'ready', "revision" = $2, "updated_at" = $3,
        "blob_durable" = TRUE, "publication_pending" = FALSE WHERE "id" = $1`, [id, ready.revision, ready.updatedAt])
      await client.query(`UPDATE ${this.t.operation} SET "state" = 'applied', "result" = $3::jsonb, "last_error_code" = NULL, "updated_at" = $4
        WHERE "owner_key" = $1 AND "operation_id" = $2`, [actor.userKey, operationId, JSON.stringify(visualMaterialDescriptor(ready)), ready.updatedAt])
      await this.updateQuota(client, actor.userKey, { activeCount: -1, stageBytes: -current.byteLength })
      return ready
    }, signal)
  }
  async reconcileCanceledPublication(actor0: VisualMaterialActor, id: string, operationId: string, durable: boolean, at: number): Promise<void> {
    const actor = visualMaterialActor(actor0); visualMaterialId(id); visualMaterialOperationId(operationId)
    await this.transaction(async client => {
      await this.lockQuota(client, actor.userKey)
      const op = await this.operation(client, actor.userKey, operationId), row = await this.current(client, id)
      if (op?.material_id !== id || op.state !== 'canceled' || row?.ownerKey !== actor.userKey) throw new VisualMaterialError(409, 'OPERATION_CONFLICT', 'Visual material cancellation receipt does not match.')
      if (!row.publicationPending) return
      await client.query(`UPDATE ${this.t.material} SET "blob_durable" = $2, "publication_pending" = FALSE,
        "retention_charged" = $2, "updated_at" = GREATEST("updated_at", $3::bigint) WHERE "id" = $1`, [id, durable, at])
      await this.updateQuota(client, actor.userKey, { activeCount: -1, stageBytes: -row.byteLength,
        ...(durable || !row.retentionCharged ? {} : { bytes: -row.byteLength, count: -1 }) })
    })
  }
  async notePublicationFailure(actor0: VisualMaterialActor, id: string, operationId: string, code: string): Promise<void> {
    const actor = visualMaterialActor(actor0); visualMaterialId(id); visualMaterialOperationId(operationId)
    const safeCode = /^[A-Z_]{1,80}$/.test(code) ? code : 'PUBLICATION_PENDING'
    await this.transaction(async client => {
      await this.lockQuota(client, actor.userKey)
      await client.query(`UPDATE ${this.t.operation} SET "last_error_code" = $3 WHERE "owner_key" = $1 AND "operation_id" = $2
        AND "material_id" = $4 AND "state" IN ('pending', 'canceled')`, [actor.userKey, operationId, safeCode, id])
      if (['BLOB_INTEGRITY', 'IMAGE_INVALID', 'BLOB_PATH_UNSAFE'].includes(safeCode)) {
        await client.query(`UPDATE ${this.t.material} SET "lifecycle" = 'failed', "revision" = "revision" + 1
          WHERE "id" = $1 AND "owner_key" = $2 AND "lifecycle" = 'pending' AND "publication_pending"`, [id, actor.userKey])
      }
    })
  }
  async cancelGenerated(actor0: VisualMaterialActor, operationId: string, at: number): Promise<void> {
    const actor = visualMaterialActor(actor0); visualMaterialOperationId(operationId)
    await this.transaction(async client => {
      const quota = await this.lockQuota(client, actor.userKey), op = await this.operation(client, actor.userKey, operationId)
      if (op?.kind === 'manage') throw new VisualMaterialError(409, 'OPERATION_CONFLICT', 'Operation id belongs to catalog management.')
      if (op?.state === 'applied' || op?.state === 'canceled') return
      if (op === undefined) {
        assertVisualMaterialQuota(quota, this.limits, { operations: 1 })
        await client.query(`INSERT INTO ${this.t.operation} ("owner_key", "operation_id", "kind", "state", "created_at", "updated_at")
          VALUES ($1, $2, 'generated', 'canceled', $3, $3)`, [actor.userKey, operationId, at])
        await this.updateQuota(client, actor.userKey, { operations: 1 }); return
      }
      await client.query(`UPDATE ${this.t.operation} SET "state" = 'canceled', "updated_at" = GREATEST("updated_at", $3::bigint)
        WHERE "owner_key" = $1 AND "operation_id" = $2`, [actor.userKey, operationId, at])
      if (op.material_id !== null) {
        await client.query(`UPDATE ${this.t.material} SET "lifecycle" = 'canceled', "visibility" = 'private',
          "revision" = "revision" + 1, "updated_at" = GREATEST("updated_at", $2::bigint) WHERE "id" = $1 AND "publication_pending"`, [op.material_id, at])
      }
    })
  }

  async get(actor0: VisualMaterialActor, id: string, options: { readonly ownedOnly?: boolean; readonly includeInactive?: boolean } = {}, signal?: AbortSignal): Promise<VisualMaterialRecord | undefined> {
    const actor = visualMaterialActor(actor0); visualMaterialId(id)
    const authorization = options.ownedOnly === true ? 'm."owner_key" = $2' : `(m."owner_key" = $2 OR (m."lifecycle" = 'ready' AND m."visibility" = 'school'
      AND $3::text <> '' AND EXISTS (SELECT 1 FROM ${this.t.ref} AS sr WHERE sr."material_id" = m."id" AND sr."owner_key" = m."owner_key" AND sr."school_id" = $3)))`
    const active = options.includeInactive === true ? '' : ` AND m."lifecycle" = 'ready'`
    const rows = await this.read(`SELECT ${visualMaterialSelectColumns('m', false)},
      (SELECT sr."school_id" FROM ${this.t.ref} AS sr WHERE sr."material_id" = m."id") AS "share_school_id"
      FROM ${this.t.material} AS m WHERE m."id" = $1 AND ${authorization}${active}`,
    // Use $3 even for owner-only queries, keeping the SQL parameter arity explicit.
    options.ownedOnly === true ? [id, actor.userKey] : [id, actor.userKey, actor.schoolId], signal)
    return rows[0] === undefined ? undefined : rowRecord(rows[0])
  }
  async search(actor0: VisualMaterialActor, plan: VisualMaterialSearchPlan, signal?: AbortSignal): Promise<readonly VisualMaterialRepositoryHit[]> {
    const actor = visualMaterialActor(actor0), query = compileVisualMaterialSearch(this.schema, actor, plan)
    const rows = await this.read(query.text, query.values, signal)
    return rows.map(row => {
      const match: VisualMaterialMatch = {
        score: numeric(row.score), matchedTerms: Array.isArray(row.matched_terms) ? (row.matched_terms as string[]).slice().sort() : [],
        fields: { theme: numeric(row.theme_score), purpose: numeric(row.purpose_score), tags: numeric(row.tags_score), style: numeric(row.style_score), kind: numeric(row.kind_score) },
      }
      return { record: rowRecord(row), match }
    })
  }
  async manage(actor0: VisualMaterialActor, id: string, input: ManageVisualMaterial, fingerprint: string, at: number, signal?: AbortSignal): Promise<VisualMaterialDescriptor> {
    const actor = visualMaterialActor(actor0); visualMaterialId(id); visualMaterialSha(fingerprint)
    return this.transaction(async client => {
      const quota = await this.lockQuota(client, actor.userKey), row = await this.current(client, id)
      if (row?.ownerKey !== actor.userKey) throw new VisualMaterialError(404, 'NOT_FOUND', 'Visual material not found.')
      const op = await this.operation(client, actor.userKey, input.operationId)
      if (op !== undefined) {
        if (op.kind !== 'manage' || op.fingerprint !== fingerprint || op.material_id !== id || op.state !== 'applied') {
          throw new VisualMaterialError(409, 'OPERATION_CONFLICT', 'Visual material operation id already describes different input.')
        }
        return operationResult(op.result)
      }
      assertVisualMaterialQuota(quota, this.limits, { operations: 1 })
      const updated = visualMaterialManagedRecord(actor, row, input, at)
      await client.query(`UPDATE ${this.t.material} SET "revision" = $2, "lifecycle" = $3, "visibility" = $4,
        "tags" = $5::text[], "tag_keys" = $6::text[], "terms" = $7::text[], "updated_at" = $8 WHERE "id" = $1`,
      [id, updated.revision, updated.lifecycle, updated.visibility, [...updated.tags], [...updated.index.tagKeys], [...updated.index.terms], updated.updatedAt])
      if (input.updateTags !== undefined) {
        await client.query(`DELETE FROM ${this.t.term} WHERE "material_id" = $1`, [id])
        await this.insertTerms(client, updated)
      }
      if (input.visibility !== undefined) {
        await client.query(`DELETE FROM ${this.t.ref} WHERE "material_id" = $1 AND "owner_key" = $2`, [id, actor.userKey])
        if (updated.visibility === 'school') {
          await client.query(`INSERT INTO ${this.t.ref} ("material_id", "owner_key", "kind", "school_id", "created_at")
            VALUES ($1, $2, 'school', $3, $4)`, [id, actor.userKey, actor.schoolId, at])
        }
      }
      const descriptor = visualMaterialDescriptor(updated)
      await client.query(`INSERT INTO ${this.t.operation} ("owner_key", "operation_id", "kind", "fingerprint", "state", "material_id", "result", "created_at", "updated_at")
        VALUES ($1, $2, 'manage', $3, 'applied', $4, $5::jsonb, $6, $6)`, [actor.userKey, input.operationId, fingerprint, id, JSON.stringify(descriptor), at])
      await this.updateQuota(client, actor.userKey, { operations: 1 })
      return descriptor
    }, signal)
  }
  async quota(actor0: VisualMaterialActor, signal?: AbortSignal): Promise<VisualMaterialQuota> {
    const actor = visualMaterialActor(actor0)
    const rows = await this.read(`SELECT * FROM ${this.t.quota} WHERE ("scope" = 'global' AND "subject" = '') OR ("scope" = 'owner' AND "subject" = $1)`, [actor.userKey], signal)
    const global = rows.find(row => row.scope === 'global'), account = rows.find(row => row.scope === 'owner')
    if (global === undefined) throw new VisualMaterialError(503, 'QUOTA_INTEGRITY', 'Visual material global quota ledger is missing.')
    return { global: rowUsage(global), account: rowUsage(account) }
  }
  async pendingPublications(input: { readonly limit: number; readonly after?: VisualMaterialRecoveryPosition }, signal?: AbortSignal): Promise<VisualMaterialRecoveryPage> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new VisualMaterialError(400, 'INPUT_INVALID', 'Invalid recovery page size.')
    const after = input.after
    if (after !== undefined) { visualMaterialId(after.id); numeric(after.createdAt) }
    const rows = await this.read(`SELECT ${visualMaterialSelectColumns()}, NULL::text AS "share_school_id" FROM ${this.t.material} AS m
      WHERE m."publication_pending"${after === undefined ? '' : ' AND (m."created_at", m."id") > ($2::bigint, $3::text)'}
      ORDER BY m."created_at", m."id" LIMIT $1::integer`, after === undefined ? [input.limit + 1] : [input.limit + 1, after.createdAt, after.id], signal)
    const items = rows.slice(0, input.limit).map(rowRecord), last = items.at(-1)
    return { items, ...(rows.length > input.limit && last !== undefined ? { next: { createdAt: last.createdAt, id: last.id } } : {}) }
  }
}
