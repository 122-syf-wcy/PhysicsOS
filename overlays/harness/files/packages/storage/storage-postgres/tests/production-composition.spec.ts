import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { Pool } from 'pg'
import * as yaml from 'js-yaml'
import { z } from 'zod'
import * as storagePostgres from '../src/index.ts'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../src/schema.ts'

const copiedRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const harnessRoot = existsSync(join(copiedRoot, 'packages/bundle/base/cordis.patch.yml'))
  ? copiedRoot
  : resolve(copiedRoot, '../../../vendor/deepseek-harness')
const testPostgresUrl = process.env.PHYSICSOS_TEST_POSTGRES_URL
const storageIds = new Set(['storage', 'storage-json', 'storage-domain', 'storage-postgres'])
const fixture = { label: 'production-composition', count: 7 }
const spec = storageDomain.defineDomain({
  name: 'production_composition',
  version: 1,
  tables: { records: storageDomain.domainTable(z.object({ label: z.string(), count: z.number().int() })) },
})

let context: Context | undefined
let root: string | undefined
let pool: Pool | undefined
let schema: string | undefined

afterEach(async () => {
  try {
    // Disposing the complete tree closes the domain before either backend,
    // including its PostgreSQL writer lease and all connection pools.
    await context?.fiber.dispose()
  } finally {
    context = undefined
    try {
      if (pool !== undefined && schema !== undefined) {
        await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`)
      }
    } finally {
      schema = undefined
      try {
        await pool?.end()
      } finally {
        pool = undefined
        try {
          if (root !== undefined) await rm(root, { recursive: true, force: true })
        } finally {
          root = undefined
          vi.restoreAllMocks()
          vi.unstubAllEnvs()
        }
      }
    }
  }
})

async function loadShippedStorage(mode: 'postgres' | 'development'): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'physicsos-production-composition-'))
  vi.stubEnv('PHYSICSOS_STORAGE_BACKEND', mode === 'postgres' ? 'postgres' : undefined)
  vi.stubEnv('DATABASE_URL', mode === 'postgres' ? testPostgresUrl : undefined)
  vi.stubEnv('PHYSICSOS_STORAGE_SCHEMA', schema)
  vi.stubEnv('PHYSICSOS_DATABASE_SSL', 'false')

  // Parse and compose the actual shipped layers before selecting the four
  // storage entries. No test-authored backend route can conceal a missing
  // web override; !!js stays intact until the real Loader activates each row.
  const layers = await Promise.all(['base', 'web-app'].map(async (bundle) => {
    const source = await readFile(join(harnessRoot, 'packages/bundle', bundle, 'cordis.patch.yml'), 'utf8')
    return yaml.load(source, { schema: entryListSchema }) as PatchOptions[]
  }))
  const entries = applyEntryPatches([], layers.flat(), () => {})
    .filter(entry => storageIds.has(entry.id))
  expect(entries.map(entry => entry.id).sort()).toEqual([...storageIds].sort())
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, yaml.dump(entries, { schema: entryListSchema }))

  const jsonRoot = root
  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  context.provide('dshHomePath', (...parts: string[]) => join(jsonRoot, ...parts))
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', storageJson],
    ['@deepseek-ai/dsh-storage-domain', storageDomain],
    ['@deepseek-ai/dsh-storage-postgres', storagePostgres],
  ])
  // Keep the native entry/config lifecycle while resolving each plugin to the
  // same source instance imported by this test's module loader.
  vi.spyOn(Include.prototype, 'import').mockImplementation((specifier: string) => {
    if (!modules.has(specifier)) throw new Error(`unexpected storage Loader import: ${specifier}`)
    return modules.get(specifier)
  })
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  expect(context.get('storageDomain')).toBeDefined()
  return context
}

describe('shipped production storage composition', () => {
  it.skipIf(!testPostgresUrl)('writes domain records physically to PostgreSQL without a JSON shadow', async () => {
    // Only the explicitly supplied test database is eligible. Never fall back
    // to DATABASE_URL or the production schema, even on a developer machine.
    pool = new Pool({
      application_name: 'physicsos-production-composition-test',
      connectionString: testPostgresUrl,
      connectionTimeoutMillis: 2_000,
      max: 1,
    })
    schema = `physicsos_test_${randomUUID().replaceAll('-', '')}`
    await pool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`)
    const loaded = await loadShippedStorage('postgres')
    const domain = await loaded.storage.domain.open(spec)
    await domain.table('records').put('fixture', fixture)

    const jsonExists = await access(join(root!, 'storages', `${spec.name}.json`)).then(
      () => true,
      (error: unknown) => {
        if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
        throw error
      },
    )
    expect.soft(jsonExists, 'PostgreSQL mode must not write the domain JSON file').toBe(false)
    const table = qualifiedTable(schema, recordTableName(spec.name, 'records'))
    const located = await pool.query<{ relation: string | null }>('SELECT to_regclass($1) AS relation', [table])
    expect(located.rows).toHaveLength(1)
    expect(typeof located.rows[0]?.relation, 'The domain write must materialize a PostgreSQL record table')
      .toBe('string')
    const persisted = await pool.query<{ value: string }>(`SELECT value FROM ${table} WHERE key_json = $1`, [JSON.stringify('fixture')])
    expect(persisted.rows.map((row): unknown => JSON.parse(row.value))).toEqual([fixture])
  }, 30_000)

  it('keeps development domain records in JSON when the backend environment is unset', async () => {
    const loaded = await loadShippedStorage('development')
    const domain = await loaded.storage.domain.open(spec)
    await domain.table('records').put('fixture', fixture)
    const persisted = JSON.parse(await readFile(join(root!, 'storages', `${spec.name}.json`), 'utf8')) as {
      tables: { records: Record<string, unknown> }
    }
    expect(persisted.tables.records).toEqual({ fixture })
  }, 30_000)
})
