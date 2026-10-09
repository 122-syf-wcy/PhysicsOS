#!/usr/bin/env node
/**
 * Import a quiesced JSON storage snapshot into one NEW PostgreSQL schema.
 *
 * node scripts/deploy/migrate-json-postgres.mjs --snapshot-root /snapshot/storages \
 *   --database-url-file /run/secrets/database_url --schema physicsos_new
 *
 * Optional --descriptors-file supplies a JSON object keyed by per-record unit
 * name, each declaring {version, compatibleVersions?, tables, hasGlobal}.
 * --pg-module selects an existing absolute pg module entry when the script is
 * outside the application checkout. No dependencies are installed.
 *
 * Source JSON is never written. The operator must stop all source writers and
 * retain the complete app volume, Redis, old PostgreSQL schema and stable model
 * encryption secret. Session JSONL files and filesystem workspaces are outside
 * this domain import. Ciphertext and ownership values are copied unchanged;
 * application-schema/decryption/browser validation remains a release gate.
 * Once the new schema accepts live writes, the frozen JSON is not a lossless
 * rollback target. A commit transport failure requires inspecting the target;
 * this tool never retries, replaces or deletes an existing schema.
 */
import { Buffer } from 'node:buffer'
import process from 'node:process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NAME = /^[a-z][a-z0-9_]*$/
const RECORD_FILE = /^[a-zA-Z0-9_-]+\.json$/
const DEFAULT_DESCRIPTORS = {
  // packages/session/session-projection-cache/src/spec.ts:101-108.
  session_projcache: { version: 7, compatibleVersions: [3, 4, 5, 6], tables: ['sessions'], hasGlobal: false },
}

class MigrationFailure extends Error {}
const fail = (code) => { throw new MigrationFailure(code) }
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const version = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647
const validName = (value) => typeof value === 'string' && NAME.test(value)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const ordered = (values) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)

function fields(value, required, optional = []) {
  return object(value) && required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes), (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) fail(code)
      return value
    })
  }
  catch { fail(code) }
}

async function regularFile(path, code) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) fail(code)
  return readFile(path)
}

async function directory(path) {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_SNAPSHOT_ENTRY')
  return (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

async function descriptorsFromFile(path) {
  const descriptors = new Map(Object.entries(DEFAULT_DESCRIPTORS))
  if (path === undefined) return descriptors
  let extra
  try { extra = parseJson(await regularFile(path, 'INVALID_DESCRIPTORS'), 'INVALID_DESCRIPTORS') }
  catch { fail('INVALID_DESCRIPTORS') }
  if (!object(extra)) fail('INVALID_DESCRIPTORS')
  for (const [name, descriptor] of Object.entries(extra)) {
    if (!validName(name) || !fields(descriptor, ['version', 'tables', 'hasGlobal'], ['compatibleVersions']) ||
      !version(descriptor.version) || typeof descriptor.hasGlobal !== 'boolean' ||
      !Array.isArray(descriptor.tables) || !descriptor.tables.every(validName) ||
      new Set(descriptor.tables).size !== descriptor.tables.length ||
      !Array.isArray(descriptor.compatibleVersions ?? []) ||
      !(descriptor.compatibleVersions ?? []).every(version) ||
      new Set([descriptor.version, ...descriptor.compatibleVersions ?? []]).size !== 1 + (descriptor.compatibleVersions?.length ?? 0)) fail('INVALID_DESCRIPTORS')
    if (descriptors.has(name)) fail('DUPLICATE_DESCRIPTOR')
    descriptors.set(name, descriptor)
  }
  return descriptors
}

function singleUnit(name, bytes) {
  const document = parseJson(bytes, 'INVALID_SINGLE_UNIT')
  if (!validName(name) || !fields(document, ['unit', 'global', 'tables']) ||
    !fields(document.unit, ['name', 'version']) || document.unit.name !== name ||
    !version(document.unit.version) || !object(document.tables)) fail('INVALID_SINGLE_UNIT')
  for (const [table, records] of Object.entries(document.tables)) {
    if (!validName(table) || !object(records)) fail('INVALID_SINGLE_UNIT')
  }
  return { name, version: document.unit.version, layout: 'single', global: document.global,
    globalPresent: document.global !== null, tables: document.tables }
}

function recordValue(bytes, descriptor) {
  const document = parseJson(bytes, 'INVALID_PER_RECORD_DOCUMENT')
  if (!fields(document, ['version', 'record']) ||
    ![descriptor.version, ...descriptor.compatibleVersions ?? []].includes(document.version)) fail('INVALID_PER_RECORD_DOCUMENT')
  return document.record
}

/**
 * Read every supported source entry, rejecting unknown/ambiguous layouts.
 * @param snapshotRoot - Frozen storage-json root, not the whole app volume.
 * @param options - Optional explicit descriptors file for other per-record units.
 * @returns Values for the importer plus a fingerprint of all source paths/bytes.
 */
export async function readJsonSnapshot(snapshotRoot, options = {}) {
  if (typeof snapshotRoot !== 'string' || snapshotRoot.length === 0) fail('INVALID_SNAPSHOT_ROOT')
  try {
    const root = resolve(snapshotRoot)
    const descriptors = await descriptorsFromFile(options.descriptorsFile)
    const entries = await directory(root)
    const inventory = []
    const units = []
    const names = new Set()
    const sourceFile = async (relative) => {
      const bytes = await regularFile(join(root, relative), 'UNSAFE_SNAPSHOT_ENTRY')
      inventory.push({ path: relative, type: 'file', sha256: hash(bytes) })
      return bytes
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) fail('UNSAFE_SNAPSHOT_ENTRY')
      const name = entry.isFile() && entry.name.endsWith('.json') ? entry.name.slice(0, -5) : entry.name
      if (names.has(name)) fail('AMBIGUOUS_UNIT_LAYOUT')
      names.add(name)
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        if (!entry.name.endsWith('.json')) fail('UNSUPPORTED_SNAPSHOT_ENTRY')
        units.push(singleUnit(entry.name.slice(0, -5), await sourceFile(entry.name)))
        continue
      }
      const name = entry.name
      const descriptor = descriptors.get(name)
      if (!descriptor) fail('UNKNOWN_PER_RECORD_UNIT')
      inventory.push({ path: name, type: 'directory' })
      const tables = Object.fromEntries(ordered(descriptor.tables).map((table) => [table, {}]))
      const unit = { name, version: descriptor.version, layout: 'per-record', global: null, globalPresent: false, tables }
      for (const child of await directory(join(root, name))) {
        if (child.isSymbolicLink() || (!child.isFile() && !child.isDirectory())) fail('UNSAFE_SNAPSHOT_ENTRY')
        if (child.isFile() && child.name === 'global.json' && descriptor.hasGlobal) {
          unit.global = recordValue(await sourceFile(join(name, child.name)), descriptor)
          unit.globalPresent = true
          continue
        }
        if (!child.isDirectory() || !descriptor.tables.includes(child.name)) fail('UNDECLARED_PER_RECORD_ENTRY')
        inventory.push({ path: join(name, child.name), type: 'directory' })
        for (const file of await directory(join(root, name, child.name))) {
          if (file.isSymbolicLink() || !file.isFile()) fail('UNSAFE_SNAPSHOT_ENTRY')
          if (!RECORD_FILE.test(file.name)) fail('UNDECLARED_PER_RECORD_ENTRY')
          const key = file.name.slice(0, -5)
          Object.defineProperty(tables[child.name], key, { enumerable: true, configurable: true, writable: true,
            value: recordValue(await sourceFile(join(name, child.name, file.name)), descriptor) })
        }
      }
      units.push(unit)
    }
    if (units.length === 0) fail('EMPTY_SNAPSHOT')
    return { units, fingerprint: hash(JSON.stringify({ inventory, descriptors: [...descriptors] })) }
  } catch (error) {
    if (error instanceof MigrationFailure) throw error
    fail('SNAPSHOT_READ_FAILED')
  }
}

function schemaIdentifier(schema) {
  if (!validName(schema) || schema.startsWith('pg_') || Buffer.byteLength(schema) > 63) fail('INVALID_SCHEMA')
  return `"${schema}"`
}

function tableIdentifier(unit, table) {
  return `"u_${hash(`${unit}\0${table}`).slice(0, 60)}"`
}

async function databaseUrlFromFile(path) {
  try {
    if (typeof path !== 'string' || path.length === 0) fail('INVALID_DATABASE_URL_FILE')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 8192) fail('INVALID_DATABASE_URL_FILE')
    const value = (await readFile(path, 'utf8')).trim()
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) fail('INVALID_DATABASE_URL_FILE')
    return value
  } catch { fail('INVALID_DATABASE_URL_FILE') }
}

async function createPgClient(config, pgModule) {
  try {
    if (pgModule !== undefined && !isAbsolute(pgModule)) fail('DATABASE_DRIVER_UNAVAILABLE')
    const require = createRequire(new URL('../../vendor/deepseek-harness/packages/storage/storage-postgres/package.json', import.meta.url))
    const pg = pgModule === undefined ? require('pg') : await import(pathToFileURL(pgModule).href)
    const Client = pg.Client ?? pg.default?.Client
    return new Client(config)
  } catch { fail('DATABASE_DRIVER_UNAVAILABLE') }
}

function storedRows(records) {
  return Object.entries(records).map(([key, value]) => {
    const keyJson = JSON.stringify(key)
    return { key_hash: hash(keyJson), key_json: keyJson, value: JSON.stringify(value) }
  })
}

function sameRows(rows, expected, key, columns) {
  const map = new Map(expected.map((row) => [row[key], row]))
  if (rows.length !== expected.length || map.size !== expected.length) fail('VERIFICATION_FAILED')
  for (const row of rows) {
    const wanted = map.get(row[key])
    if (!wanted || !columns.every((column) => row[column] === wanted[column])) fail('VERIFICATION_FAILED')
    map.delete(row[key])
  }
  if (map.size !== 0) fail('VERIFICATION_FAILED')
}

function summary(snapshot, schema) {
  const units = snapshot.units.map((unit) => ({ name: unit.name, version: unit.version, layout: unit.layout,
    globalPresent: unit.globalPresent,
    tables: Object.fromEntries(Object.entries(unit.tables).map(([name, records]) => [name, Object.keys(records).length])) }))
  return { format: 'physicsos-json-postgres-migration/1', schema, sourceFingerprint: snapshot.fingerprint,
    unitCount: units.length, tableCount: units.reduce((total, unit) => total + Object.keys(unit.tables).length, 0),
    recordCount: units.reduce((total, unit) => total + Object.values(unit.tables).reduce((sum, count) => sum + count, 0), 0),
    globalCount: units.filter((unit) => unit.globalPresent).length, units, verified: true }
}

/**
 * Create, fill and verify a new schema in one transaction. Never updates source
 * JSON, queries an old business schema, or replaces an existing destination.
 * @param options - snapshotRoot, databaseUrlFile, schema; optional descriptorsFile/pgModule.
 * @param dependencies - Optional pg Client factory for failure-path verification.
 * @returns Non-secret counts and source fingerprint only after COMMIT succeeds.
 */
export async function migrateJsonPostgres(options, dependencies = {}) {
  const schema = schemaIdentifier(options.schema)
  const snapshot = await readJsonSnapshot(options.snapshotRoot, options)
  const connectionString = await databaseUrlFromFile(options.databaseUrlFile)
  const config = { connectionString, application_name: 'physicsos-json-migration', connectionTimeoutMillis: 10_000, query_timeout: 60_000 }
  const client = dependencies.createClient ? await dependencies.createClient(config) : await createPgClient(config, options.pgModule)
  client.on('error', () => {})
  let phase = 'connecting'
  try {
    await client.connect()
    phase = 'beginning'
    await client.query('BEGIN')
    phase = 'importing'
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '60s'")
    const lease = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [`physicsos:single-writer:${options.schema}`])
    if (lease.rows[0]?.acquired !== true) fail('TARGET_SCHEMA_IN_USE')
    const existing = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [options.schema])
    if (existing.rows.length > 0) fail('TARGET_SCHEMA_EXISTS')
    await client.query(`CREATE SCHEMA ${schema}`)
    const metadata = `${schema}."dsh_storage_units"`
    const globals = `${schema}."dsh_storage_globals"`
    await client.query(`CREATE TABLE ${metadata} (name TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK (version >= 0))`)
    await client.query(`CREATE TABLE ${globals} (unit TEXT PRIMARY KEY REFERENCES ${metadata}(name) ON DELETE CASCADE, value TEXT NOT NULL)`)
    for (const unit of snapshot.units) {
      await client.query(`INSERT INTO ${metadata} (name, version) VALUES ($1, $2)`, [unit.name, unit.version])
      for (const [table, records] of Object.entries(unit.tables)) {
        const target = `${schema}.${tableIdentifier(unit.name, table)}`
        await client.query(`CREATE TABLE ${target} (key_hash TEXT PRIMARY KEY, key_json TEXT NOT NULL, value TEXT NOT NULL)`)
        for (const row of storedRows(records)) {
          await client.query(`INSERT INTO ${target} (key_hash, key_json, value) VALUES ($1, $2, $3)`, [row.key_hash, row.key_json, row.value])
        }
      }
      if (unit.globalPresent) await client.query(`INSERT INTO ${globals} (unit, value) VALUES ($1, $2)`, [unit.name, JSON.stringify(unit.global)])
    }
    sameRows((await client.query(`SELECT name, version FROM ${metadata}`)).rows, snapshot.units, 'name', ['version'])
    const expectedGlobals = snapshot.units.filter((unit) => unit.globalPresent).map((unit) => ({ unit: unit.name, value: JSON.stringify(unit.global) }))
    sameRows((await client.query(`SELECT unit, value FROM ${globals}`)).rows, expectedGlobals, 'unit', ['value'])
    for (const unit of snapshot.units) {
      for (const [table, records] of Object.entries(unit.tables)) {
        const target = `${schema}.${tableIdentifier(unit.name, table)}`
        sameRows((await client.query(`SELECT key_hash, key_json, value FROM ${target}`)).rows, storedRows(records), 'key_hash', ['key_json', 'value'])
      }
    }
    try {
      if ((await readJsonSnapshot(options.snapshotRoot, options)).fingerprint !== snapshot.fingerprint) fail('SNAPSHOT_CHANGED')
    } catch { fail('SNAPSHOT_CHANGED') }
    phase = 'committing'
    await client.query('COMMIT')
    phase = 'committed'
    return summary(snapshot, options.schema)
  } catch (error) {
    const failedPhase = phase
    if (phase !== 'connecting') {
      try { await client.query('ROLLBACK') }
      catch { /* Closing this connection releases an uncommitted transaction. */ }
    }
    if (failedPhase === 'committing') fail('COMMIT_OUTCOME_UNKNOWN')
    if (error instanceof MigrationFailure) throw error
    if (failedPhase === 'connecting') fail('DATABASE_CONNECTION_FAILED')
    if (error?.code === '42P06') fail('TARGET_SCHEMA_EXISTS')
    fail('DATABASE_IMPORT_FAILED')
  } finally {
    await client.end().catch(() => {})
  }
}

const USAGE = 'Usage: migrate-json-postgres.mjs --snapshot-root DIR --database-url-file FILE --schema NEW_SCHEMA [--descriptors-file FILE] [--pg-module ABSOLUTE_PATH]'

function cliOptions(argv) {
  const names = { '--snapshot-root': 'snapshotRoot', '--database-url-file': 'databaseUrlFile', '--schema': 'schema', '--descriptors-file': 'descriptorsFile', '--pg-module': 'pgModule' }
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]]
    const value = argv[index + 1]
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS')
    options[name] = value
  }
  if (!options.snapshotRoot || !options.databaseUrlFile || !options.schema) fail('INVALID_ARGUMENTS')
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--help') console.log(USAGE)
    else console.log(JSON.stringify(await migrateJsonPostgres(cliOptions(process.argv.slice(2)))))
  } catch (error) {
    console.error(`migrate-json-postgres: ${error instanceof MigrationFailure ? error.message : 'MIGRATION_FAILED'}`)
    process.exitCode = 1
  }
}
