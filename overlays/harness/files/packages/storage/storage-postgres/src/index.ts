/**
 * PostgreSQL storage backend for the storage hub: one schema hosts every
 * routed unit, with a physical table per unit/table pair and one metadata
 * row per unit version. Registers as backend `postgres`; the disposer
 * unregisters first, then closes the medium.
 * @module @deepseek-ai/dsh-storage-postgres
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Client, Pool } from 'pg'
import type { PoolConfig } from 'pg'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import {
  assertSchemaIdentifier,
  assertUnitIdentifier,
  initializeSchema,
  qualifiedTable,
  recordTableName,
  POSTGRES_UNITS_TABLE,
} from './schema.ts'
import { PostgresKvUnit } from './unit.ts'
import { PostgresWriterLease, WriterLeaseConflictError } from './writer-lease.ts'

/** Cordis plugin name. */
export const name = 'storage-postgres'
/** The backend registers on the storage hub. */
export const inject = ['storage']

/** Plugin configuration. */
export interface Config {
  /** PostgreSQL connection string, e.g. `postgresql://user:pass@host/db`. */
  connectionString: string
  /** Schema containing the backend's metadata and unit tables. Defaults to `public`. */
  schema?: string
  /** Maximum number of pooled connections, from 1 to 100. Defaults to 10. */
  maxConnections?: number
  /**
   * Whether to use TLS. `true` uses the platform's normal certificate
   * verification; `'require'` enables TLS while accepting the server's
   * certificate without an additional CA configuration. Defaults to false.
   */
  ssl?: boolean | 'require'
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  connectionString: z.string().min(1).required(),
  schema: z.string().pattern(UNIT_NAME_RE).max(63).default('public'),
  maxConnections: z.number().step(1).min(1).max(100).default(10),
  ssl: z.union([z.boolean(), z.const('require')]).default(false),
})

function validateConfig(config: Config): Required<Config> {
  if (typeof config.connectionString !== 'string' || config.connectionString.length === 0) {
    throw new TypeError('storage-postgres connectionString must be a non-empty string')
  }
  const schema = config.schema ?? 'public'
  assertSchemaIdentifier(schema)
  const maxConnections = config.maxConnections ?? 10
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 100) {
    throw new RangeError('storage-postgres maxConnections must be an integer from 1 to 100')
  }
  const ssl: unknown = config.ssl ?? false
  if (ssl !== false && ssl !== true && ssl !== 'require') {
    throw new TypeError("storage-postgres ssl must be true, false, or 'require'")
  }
  return { connectionString: config.connectionString, schema, maxConnections, ssl }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Minimal lease shape {@link acquireWriterWithRetry} drives. */
interface WriterLeaseLike {
  acquire(): Promise<void>
  close(): Promise<void>
}

/**
 * Acquire one writer lease, retrying transient connection failures under a
 * bounded schedule. A live conflicting writer is never retried: an accidental
 * second replica must fail immediately instead of waiting for the first to
 * exit. Every failed attempt closes its own connection before the next.
 * @param createWriter - Builds a fresh lease for one attempt.
 * @param options - Attempt count (default 3) and per-attempt delay schedule
 * (default 1s, then 2s).
 * @returns the acquired lease.
 */
export async function acquireWriterWithRetry<T extends WriterLeaseLike>(
  createWriter: () => T,
  options: { attempts?: number; delayMs?: (attempt: number) => number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('acquireWriterWithRetry attempts must be a positive integer')
  }
  const delayMs = options.delayMs ?? ((attempt: number) => attempt * 1_000)
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const writer = createWriter()
    try {
      await writer.acquire()
      return writer
    } catch (error) {
      await writer.close().catch(() => {})
      if (error instanceof WriterLeaseConflictError) throw error
      lastError = error
      if (attempt < attempts) {
        await new Promise<void>((resolve) => { setTimeout(resolve, delayMs(attempt)) })
      }
    }
  }
  throw lastError
}

function validateDescriptor(descriptor: KvUnitDescriptor): void {
  assertUnitIdentifier(descriptor.name, 'kv unit name')
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 0) {
    throw new Error(`kv unit '${descriptor.name}' version must be a non-negative integer`)
  }
  const tables: unknown = descriptor.tables
  if (!Array.isArray(tables)) {
    throw new TypeError(`kv unit '${descriptor.name}' tables must be an array`)
  }
  const seen = new Set<string>()
  for (const table of tables) {
    if (typeof table !== 'string') {
      throw new TypeError(`kv unit '${descriptor.name}' table names must be strings`)
    }
    assertUnitIdentifier(table, `kv table name in unit '${descriptor.name}'`)
    if (seen.has(table)) {
      throw new Error(`kv unit '${descriptor.name}' declares duplicate table '${table}'`)
    }
    seen.add(table)
  }
  if (typeof descriptor.hasGlobal !== 'boolean') {
    throw new TypeError(`kv unit '${descriptor.name}' hasGlobal must be a boolean`)
  }
}

/**
 * PostgreSQL-backed {@link StorageBackend}. It owns one bounded connection
 * pool, the configured schema, and the open-unit name table.
 */
export class PostgresStorageBackend implements StorageBackend {
  /** The key-value facet; the only shape this backend serves. */
  readonly kv: KvFacet = { open: (descriptor: KvUnitDescriptor) => this.openUnit(descriptor) }
  /** Resolves after writer acquisition and schema setup; rejects on startup failure. */
  readonly ready: Promise<void>

  private readonly pool: Pool
  private readonly schema: string
  private readonly connectionString: string
  private readonly ssl: PoolConfig['ssl']
  /** Acquired lease; replaced only while a startup attempt retries. */
  private writer: PostgresWriterLease
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<PostgresKvUnit>>()
  private closing: Promise<void> | undefined
  private poolClosing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  constructor(config: Config) {
    const validated = validateConfig(config)
    this.schema = validated.schema
    const ssl: PoolConfig['ssl'] =
      validated.ssl === 'require' ? { rejectUnauthorized: false } : validated.ssl
    this.connectionString = validated.connectionString
    this.ssl = ssl
    this.pool = new Pool({
      application_name: 'physicsos-storage-postgres',
      connectionString: validated.connectionString,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: validated.maxConnections,
      ssl,
    })
    // pg emits idle-client failures on the pool itself. Consume the event so
    // a transient socket failure cannot terminate the process; the failed
    // operation still rejects through its own query promise.
    this.pool.on('error', () => {
      // No shared state is published here: each query owns its own rejection.
    })
    this.writer = this.createWriter()
    this.ready = this.initialize()
    this.ready.catch(() => {})
  }

  /** Build one dedicated writer connection for a single acquisition attempt. */
  private createWriter(): PostgresWriterLease {
    return new PostgresWriterLease(new Client({
      application_name: 'physicsos-storage-writer',
      connectionString: this.connectionString,
      // A busy startup can stall the event loop past a tight budget, so the
      // connect phase gets ten seconds; the lease's own deadline and grace
      // turn bound every heartbeat probe without a client-side query timeout
      // that could misfire on a stalled loop.
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      ssl: this.ssl,
    }), this.schema, (error) => {
      // Snapshot readers live above the storage API, so rejecting new writes
      // alone is insufficient. A lost lease requires a fresh process/snapshot.
      process.stderr.write(`${error.message}\n`)
      process.exit(1)
    })
  }

  private async initialize(): Promise<void> {
    try {
      this.writer = await acquireWriterWithRetry(() => this.createWriter())
      await initializeSchema(this.pool, this.schema)
    } catch (error) {
      // Startup failures have no guaranteed disposer. Release this session and
      // every pooled socket before making the failed readiness visible.
      await this.writer.close()
      await this.closePool()
      throw error
    }
  }

  private closePool(): Promise<void> {
    this.poolClosing ??= this.pool.end()
    return this.poolClosing
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'postgres storage backend is closed'))
    }
    try {
      validateDescriptor(descriptor)
    } catch (error) {
      return Promise.reject(asError(error))
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(
        new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`),
      )
    }

    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<PostgresKvUnit> {
    await this.ready
    this.writer.assertHeld()
    const unitsTable = qualifiedTable(this.schema, POSTGRES_UNITS_TABLE)
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      // Serialize first materialization of the same schema/unit across
      // processes. The digest is only a lock key; values remain parameters.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${this.schema.length}:${this.schema}${descriptor.name.length}:${descriptor.name}`,
      ])
      const existing = await client.query<{ version: number }>(
        `SELECT version FROM ${unitsTable} WHERE name = $1 FOR UPDATE`,
        [descriptor.name],
      )
      const existingRow = existing.rows.at(0)
      if (existingRow === undefined) {
        await client.query(`INSERT INTO ${unitsTable} (name, version) VALUES ($1, $2)`, [
          descriptor.name,
          descriptor.version,
        ])
      } else {
        const existingVersion = existingRow.version
        if (existingVersion !== descriptor.version) {
          throw new StorageError(
            'version-mismatch',
            `kv unit '${descriptor.name}' is stamped version ${existingVersion} on the medium, incompatible with descriptor version ${descriptor.version}`,
          )
        }
      }

      for (const table of descriptor.tables) {
        const physical = qualifiedTable(this.schema, recordTableName(descriptor.name, table))
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${physical} (
            key_hash TEXT PRIMARY KEY,
            key_json TEXT NOT NULL,
            value TEXT NOT NULL
          )
        `)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }

    return new PostgresKvUnit(this.pool, this.schema, descriptor, () => {
      this.units.delete(descriptor.name)
    }, () => { this.writer.assertHeld() })
  }

  /**
   * Close every open unit and release the pool. Idempotent; concurrent and
   * repeated calls resolve once teardown finishes.
   * @returns resolution after the pool is released.
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    try {
      await this.ready
    } catch {
      // The medium never initialized; the opener already observed the same
      // failure, so there is nothing else to release before ending the pool.
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    await this.closePool()
    await this.writer.close()
  }
}

/**
 * Acquire the writer and initialize its schema before publishing `postgres`.
 * Startup failure closes the backend; disposal removes its registrations
 * before closing it.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 * @returns resolution after initialization and registration succeed.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const backend = new PostgresStorageBackend(config)
  try {
    await backend.ready
  } catch (error) {
    await backend.close()
    throw error
  }
  try {
    ctx.effect(function* () {
      yield () => backend.close()
      yield ctx.storage.backend.register('postgres', backend)
      yield ctx.provide(storageBackendServiceKey('postgres'), backend)
    }, 'storage-postgres.registerBackend')
  } catch (error) {
    // Shutdown or reload can dispose this fiber while the backend is still
    // initializing; registration is then impossible and the backend must be
    // released instead of surfacing an unhandled startup rejection.
    await backend.close()
    if (!isInactiveEffect(error)) throw error
  }
}

/** Whether a Cordis `effect()` call was refused because this fiber is disposed. */
function isInactiveEffect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'INACTIVE_EFFECT'
}

export { recordTableName } from './schema.ts'
export { PostgresWriterLease, WriterLeaseConflictError } from './writer-lease.ts'
