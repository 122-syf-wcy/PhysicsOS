/**
 * One opened PostgreSQL KV unit: one physical table per declared unit table
 * plus the unit's row in the shared global-singleton table. Each primitive is
 * one parameterized SQL statement, so PostgreSQL supplies atomic durability
 * without a caller-visible transaction.
 * @module @deepseek-ai/dsh-storage-postgres/unit
 */

import { createHash } from 'node:crypto'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import type { Pool } from 'pg'
import { POSTGRES_GLOBALS_TABLE, qualifiedTable, recordTableName } from './schema.ts'

interface StoredRecord {
  key_json: string
  value: string
}

interface StoredGlobal {
  value: string
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function serializeValue(value: unknown, slot: string): string {
  let text: unknown
  try {
    text = JSON.stringify(value)
  } catch (error) {
    throw asError(error)
  }
  if (typeof text !== 'string') {
    throw new TypeError(`${slot} is not JSON-serializable`)
  }
  return text
}

function keyHash(keyJson: string): string {
  return createHash('sha256').update(keyJson, 'utf8').digest('hex')
}

/** One opened unit over a PostgreSQL connection pool. */
export class PostgresKvUnit implements KvUnit {
  private readonly tables = new Map<string, string>()
  private readonly globalTable: string | undefined
  private readonly pending = new Set<Promise<unknown>>()
  private closing: Promise<void> | undefined
  private closed = false

  /**
   * @param pool - The backend-owned connection pool.
   * @param schema - Validated schema containing the unit's tables.
   * @param descriptor - Validated descriptor whose tables already exist.
   * @param onClose - Backend callback releasing this unit's open-name slot.
   */
  constructor(
    private readonly pool: Pool,
    schema: string,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {
    for (const table of descriptor.tables) {
      this.tables.set(table, qualifiedTable(schema, recordTableName(descriptor.name, table)))
    }
    this.globalTable = descriptor.hasGlobal
      ? qualifiedTable(schema, POSTGRES_GLOBALS_TABLE)
      : undefined
  }

  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    return this.settle(async () => {
      const tables: Record<string, Record<string, unknown>> = Object.create(null) as Record<
        string,
        Record<string, unknown>
      >
      for (const [name, physical] of this.tables) {
        const result = await this.pool.query<StoredRecord>(
          `SELECT key_json, value FROM ${physical}`,
        )
        // Null prototype: record keys are arbitrary strings, so '__proto__'
        // must land as an own property instead of mutating the prototype.
        const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>
        for (const row of result.rows) {
          const key = this.parseKey(row.key_json, `table '${name}'`)
          records[key] = this.parseJson(row.value, `table '${name}' key '${key}'`)
        }
        tables[name] = records
      }

      let global: unknown = null
      if (this.globalTable !== undefined) {
        const result = await this.pool.query<StoredGlobal>(
          `SELECT value FROM ${this.globalTable} WHERE unit = $1`,
          [this.descriptor.name],
        )
        const row = result.rows.at(0)
        if (row !== undefined) {
          global = this.parseJson(row.value, 'global slot')
        }
      }
      return { tables, global }
    })
  }

  putRecord(table: string, key: string, value: unknown): Promise<void> {
    return this.settle(async () => {
      const physical = this.tableFor(table)
      const keyJson = JSON.stringify(key)
      await this.pool.query(
        `INSERT INTO ${physical} (key_hash, key_json, value) VALUES ($1, $2, $3)
         ON CONFLICT (key_hash) DO UPDATE SET key_json = EXCLUDED.key_json, value = EXCLUDED.value`,
        [
          keyHash(keyJson),
          keyJson,
          serializeValue(value, `kv unit '${this.descriptor.name}' record '${key}'`),
        ],
      )
    })
  }

  deleteRecord(table: string, key: string): Promise<void> {
    return this.settle(async () => {
      const physical = this.tableFor(table)
      const keyJson = JSON.stringify(key)
      await this.pool.query(`DELETE FROM ${physical} WHERE key_hash = $1 AND key_json = $2`, [
        keyHash(keyJson),
        keyJson,
      ])
    })
  }

  setGlobal(value: unknown): Promise<void> {
    return this.settle(async () => {
      if (this.globalTable === undefined) {
        throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
      }
      await this.pool.query(
        `INSERT INTO ${this.globalTable} (unit, value) VALUES ($1, $2)
         ON CONFLICT (unit) DO UPDATE SET value = EXCLUDED.value`,
        [
          this.descriptor.name,
          serializeValue(value, `kv unit '${this.descriptor.name}' global slot`),
        ],
      )
    })
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    this.onClose()
    this.closing = Promise.allSettled([...this.pending]).then(() => {})
    return this.closing
  }

  private settle<T>(operation: () => Promise<T> | T): Promise<T> {
    try {
      this.ensureOpen()
      const result = operation()
      const tracked = Promise.resolve(result).catch((error: unknown): never => {
        throw asError(error)
      })
      const pending = tracked.finally(() => {
        this.pending.delete(pending)
      })
      this.pending.add(pending)
      return pending
    } catch (error) {
      return Promise.reject(asError(error))
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `kv unit '${this.descriptor.name}' is closed`)
    }
  }

  private tableFor(table: string): string {
    const physical = this.tables.get(table)
    if (physical === undefined) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
    }
    return physical
  }

  private parseKey(keyJson: string, slot: string): string {
    const key = this.parseJson(keyJson, slot)
    if (typeof key !== 'string') {
      throw new StorageError(
        'malformed-medium',
        `kv unit '${this.descriptor.name}' holds a non-string key at ${slot}`,
      )
    }
    return key
  }

  private parseJson(text: string, slot: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new StorageError(
        'malformed-medium',
        `kv unit '${this.descriptor.name}' holds unparsable JSON at ${slot}`,
        { cause: asError(error) },
      )
    }
  }
}
