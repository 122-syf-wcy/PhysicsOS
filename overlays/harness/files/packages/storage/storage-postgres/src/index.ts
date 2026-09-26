/**
 * PostgreSQL storage backend for the storage hub: one schema hosts every
 * routed unit, with a physical table per unit/table pair and one metadata
 * row per unit version. Registers as backend `postgres`; the disposer
 * unregisters first, then closes the medium.
 * @module @deepseek-ai/dsh-storage-postgres
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Pool } from 'pg'
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

  private readonly pool: Pool
  private readonly schema: string
  private readonly ready: Promise<void>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<PostgresKvUnit>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  constructor(config: Config) {
    const validated = validateConfig(config)
    this.schema = validated.schema
    const ssl: PoolConfig['ssl'] =
      validated.ssl === 'require' ? { rejectUnauthorized: false } : validated.ssl
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
    this.ready = initializeSchema(this.pool, this.schema)
    this.ready.catch(() => {})
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
    })
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
    await this.pool.end()
  }
}

/**
 * Register the PostgreSQL backend as `postgres` on the storage hub. The
 * disposer unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const backend = new PostgresStorageBackend(config)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('postgres', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-postgres.registerBackend')
  ctx.provide(storageBackendServiceKey('postgres'), backend)
}

export { recordTableName } from './schema.ts'
