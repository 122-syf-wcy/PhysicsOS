/**
 * Schema and identifier helpers for the PostgreSQL storage backend.
 *
 * User-supplied unit and table names are never interpolated into SQL. Unit
 * record tables use a digest of the validated pair, while the metadata table
 * names and the configured schema are fixed or validated before quoting.
 * @module @deepseek-ai/dsh-storage-postgres/schema
 */

import { createHash } from 'node:crypto'
import { UNIT_NAME_RE } from '@deepseek-ai/dsh-storage'
import type { Pool } from 'pg'

/** Physical metadata table holding each unit's format version. */
export const POSTGRES_UNITS_TABLE = 'dsh_storage_units'
/** Physical metadata table holding each unit's global singleton. */
export const POSTGRES_GLOBALS_TABLE = 'dsh_storage_globals'

const MAX_IDENTIFIER_BYTES = 63

/** Validate a unit or table name using the storage hub's shared identifier contract. */
export function assertUnitIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UNIT_NAME_RE.test(value)) {
    throw new Error(`${label} '${String(value)}' violates ${UNIT_NAME_RE}`)
  }
}

/** Validate a PostgreSQL schema name before it is quoted as an identifier. */
export function assertSchemaIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !UNIT_NAME_RE.test(value) ||
    Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_BYTES
  ) {
    throw new Error(
      `PostgreSQL schema name '${String(value)}' must match ${UNIT_NAME_RE} and fit in ${MAX_IDENTIFIER_BYTES} bytes`,
    )
  }
}

/** Quote a validated PostgreSQL identifier. */
export function quoteIdentifier(value: string): string {
  assertSchemaIdentifier(value)
  return `"${value}"`
}

/**
 * Derive the physical table name for one unit/table pair.
 *
 * The digest keeps the identifier inside PostgreSQL's 63-byte limit and makes
 * pairs such as (`a_b`, `c`) and (`a`, `b_c`) distinct. Both inputs are
 * validated against the hub identifier contract before hashing.
 */
export function recordTableName(unit: string, table: string): string {
  assertUnitIdentifier(unit, 'kv unit name')
  assertUnitIdentifier(table, `kv table name in unit '${unit}'`)
  const digest = createHash('sha256')
    .update(unit, 'utf8')
    .update('\0', 'utf8')
    .update(table, 'utf8')
    .digest('hex')
    .slice(0, 60)
  return `u_${digest}`
}

/** Fully qualified, safely quoted table name. */
export function qualifiedTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
}

/**
 * Create the configured schema and the backend's metadata tables if needed.
 *
 * The whole initialization runs in one transaction so a failure cannot leave
 * a partially created metadata layout behind.
 */
export async function initializeSchema(pool: Pool, schema: string): Promise<void> {
  const quotedSchema = quoteIdentifier(schema)
  const units = qualifiedTable(schema, POSTGRES_UNITS_TABLE)
  const globals = qualifiedTable(schema, POSTGRES_GLOBALS_TABLE)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${units} (
        name    TEXT PRIMARY KEY,
        version INTEGER NOT NULL CHECK (version >= 0)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${globals} (
        unit  TEXT PRIMARY KEY REFERENCES ${units}(name) ON DELETE CASCADE,
        value TEXT NOT NULL
      )
    `)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
