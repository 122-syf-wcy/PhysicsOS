import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { runKvBackendContract } from '../../storage/tests/contract.ts'
import { Pool } from 'pg'
import * as StoragePostgres from '../src/index.ts'
import { Config, PostgresStorageBackend, recordTableName } from '../src/index.ts'

const SPECIFIC_DESCRIPTOR: KvUnitDescriptor = {
  name: 'specimen',
  version: 1,
  tables: ['records'],
  hasGlobal: true,
}

type Availability = { ok: true; url: string } | { ok: false; reason: string }

async function probePostgres(): Promise<Availability> {
  const candidates = [
    process.env.PHYSICSOS_TEST_POSTGRES_URL,
    'postgresql:///postgres',
    'postgresql://localhost/postgres',
  ].filter((value): value is string => value !== undefined && value !== '')
  const failures: string[] = []

  for (const url of new Set(candidates)) {
    const pool = new Pool({
      application_name: 'physicsos-storage-postgres-test-probe',
      connectionString: url,
      connectionTimeoutMillis: 2_000,
      max: 1,
    })
    try {
      await pool.query('SELECT 1')
      await pool.end()
      return { ok: true, url }
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
      await pool.end().catch(() => {})
    }
  }

  return {
    ok: false,
    reason: [
      'PostgreSQL unavailable; set PHYSICSOS_TEST_POSTGRES_URL to a reachable PostgreSQL URL.',
      ...failures,
    ].join(' '),
  }
}

const availability = await probePostgres()
const backends: PostgresStorageBackend[] = []
const schemas: string[] = []
const adminPool = availability.ok
  ? new Pool({
    application_name: 'physicsos-storage-postgres-test-admin',
    connectionString: availability.url,
    connectionTimeoutMillis: 2_000,
    max: 2,
  })
  : undefined

afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.close()
  for (const schema of schemas.splice(0)) {
    await adminPool!.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  }
})

afterAll(async () => {
  await adminPool?.end()
})

function quoteIdentifier(value: string): string {
  return `"${value}"`
}

async function freshSchema(): Promise<string> {
  const schema = `physicsos_test_${randomUUID().replaceAll('-', '')}`
  await adminPool!.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`)
  schemas.push(schema)
  return schema
}

function backendAt(
  schema: string,
  connectionString = availability.ok ? availability.url : '',
): PostgresStorageBackend {
  const backend = new PostgresStorageBackend(
    new Config({
      connectionString,
      schema,
      maxConnections: 4,
    }),
  )
  backends.push(backend)
  return backend
}

if (!availability.ok) {
  describe('postgres storage backend', () => {
    it.skip(`requires a reachable PostgreSQL server: ${availability.reason}`, () => {})
  })
} else {
  runKvBackendContract('postgres', async () => {
    const schema = await freshSchema()
    return {
      backend: backendAt(schema),
      reopen: async () => backendAt(schema),
    }
  })

  describe('postgres backend specifics', () => {
    it('resolves config defaults and rejects invalid config loudly', () => {
      const defaults = new Config({ connectionString: availability.url })
      expect(defaults.schema).toBe('public')
      expect(defaults.maxConnections).toBe(10)
      expect(defaults.ssl).toBe(false)

      expect(() => new Config({ connectionString: '' })).toThrow()
      expect(
        () => new Config({ connectionString: availability.url, schema: 'Bad-Schema' }),
      ).toThrow()
      expect(
        () => new Config({ connectionString: availability.url, schema: 'x'.repeat(64) }),
      ).toThrow()
      expect(() => new Config({ connectionString: availability.url, maxConnections: 0 })).toThrow()
      expect(
        () => new Config({ connectionString: availability.url, maxConnections: 101 }),
      ).toThrow()
      expect(
        () => new Config({ connectionString: availability.url, maxConnections: 1.5 }),
      ).toThrow()
      expect(
        () => new Config({ connectionString: availability.url, ssl: 'maybe' as never }),
      ).toThrow()
    })

    it('rejects invalid unit and table names before touching the medium', async () => {
      const backend = backendAt(await freshSchema())
      await expect(backend.kv.open({ ...SPECIFIC_DESCRIPTOR, name: 'Bad-Name' })).rejects.toThrow(
        /violates/,
      )
      await expect(
        backend.kv.open({ ...SPECIFIC_DESCRIPTOR, tables: ['ok', '1bad'] }),
      ).rejects.toThrow(/violates/)
      expect(adminPool).toBeDefined()
    })

    it('rejects duplicate unit tables and invalid unit versions', async () => {
      const backend = backendAt(await freshSchema())
      await expect(
        backend.kv.open({ ...SPECIFIC_DESCRIPTOR, tables: ['records', 'records'] }),
      ).rejects.toThrow(/duplicate/)
      await expect(backend.kv.open({ ...SPECIFIC_DESCRIPTOR, version: -1 })).rejects.toThrow(
        /non-negative/,
      )
      await expect(backend.kv.open({ ...SPECIFIC_DESCRIPTOR, version: 1.5 })).rejects.toThrow(
        /integer/,
      )
    })

    it('rejects a second open of the same unit name', async () => {
      const backend = backendAt(await freshSchema())
      await backend.kv.open(SPECIFIC_DESCRIPTOR)
      await expect(backend.kv.open(SPECIFIC_DESCRIPTOR)).rejects.toThrow(/already open/)
      await backend.close()
    })

    it('allows re-open after unit close, and rejects open on a closed backend', async () => {
      const backend = backendAt(await freshSchema())
      const unit = await backend.kv.open(SPECIFIC_DESCRIPTOR)
      await unit.close()
      const again = await backend.kv.open(SPECIFIC_DESCRIPTOR)
      await again.putRecord('records', 'k', 1)
      await backend.close()
      await expect(backend.kv.open(SPECIFIC_DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
    })

    it('round-trips arbitrary keys without prototype pollution', async () => {
      const backend = backendAt(await freshSchema())
      const unit = await backend.kv.open(SPECIFIC_DESCRIPTOR)
      const largeKey = 'x'.repeat(5_000)
      await unit.putRecord('records', '__proto__', { evil: true })
      await unit.putRecord('records', 'constructor', { n: 1 })
      await unit.putRecord('records', 'nul\0key', { nul: true })
      await unit.putRecord('records', largeKey, { large: true })

      const records = (await unit.loadAll()).tables['records']
      if (records === undefined) throw new Error('records table missing from the snapshot')
      expect(Object.hasOwn(records, '__proto__')).toBe(true)
      expect(records['__proto__']).toEqual({ evil: true })
      expect(records['constructor']).toEqual({ n: 1 })
      expect(records['nul\0key']).toEqual({ nul: true })
      expect(records[largeKey]).toEqual({ large: true })
      expect(Object.getPrototypeOf({})).not.toHaveProperty('evil')
      await backend.close()
    })

    it('maps malformed record and global JSON to malformed-medium', async () => {
      const schema = await freshSchema()
      const backend = backendAt(schema)
      const unit = await backend.kv.open(SPECIFIC_DESCRIPTOR)
      await unit.putRecord('records', 'good', { n: 1 })
      await unit.setGlobal({ g: 1 })

      const recordTable = `${quoteIdentifier(schema)}.${quoteIdentifier(recordTableName('specimen', 'records'))}`
      await adminPool!.query(`UPDATE ${recordTable} SET value = $1 WHERE key_json = $2`, [
        '{not json',
        JSON.stringify('good'),
      ])
      await expect(unit.loadAll()).rejects.toMatchObject({
        name: 'StorageError',
        code: 'malformed-medium',
      })

      await adminPool!.query(`UPDATE ${recordTable} SET value = $1 WHERE key_json = $2`, [
        JSON.stringify({ n: 1 }),
        JSON.stringify('good'),
      ])
      const globalsTable = `${quoteIdentifier(schema)}.${quoteIdentifier('dsh_storage_globals')}`
      await adminPool!.query(`UPDATE ${globalsTable} SET value = $1 WHERE unit = $2`, [
        '][',
        'specimen',
      ])
      await expect(unit.loadAll()).rejects.toMatchObject({
        name: 'StorageError',
        code: 'malformed-medium',
      })
      await backend.close()
    })

    it('rejects setGlobal without a global slot and writes to undeclared tables', async () => {
      const backend = backendAt(await freshSchema())
      const unit = await backend.kv.open({ ...SPECIFIC_DESCRIPTOR, hasGlobal: false })
      await expect(unit.setGlobal({ g: 1 })).rejects.toThrow(/declared no global slot/)
      await expect(unit.putRecord('undeclared', 'k', 1)).rejects.toThrow(/declared no table/)
      expect((await unit.loadAll()).global).toBeNull()
      await backend.close()
    })

    it('wraps a non-Error toJSON throw into an Error rejection', async () => {
      const backend = backendAt(await freshSchema())
      const unit = await backend.kv.open(SPECIFIC_DESCRIPTOR)
      const hostile = {
        toJSON: () => {
          throw 'not an error'
        },
      }
      await expect(unit.putRecord('records', 'k', hostile)).rejects.toThrow('not an error')
      await expect(unit.putRecord('records', 'k', hostile)).rejects.toBeInstanceOf(Error)
      await backend.close()
    })

    it('propagates pool query failures and remains closeable', async () => {
      const schema = await freshSchema()
      const backend = backendAt(schema)
      const unit = await backend.kv.open(SPECIFIC_DESCRIPTOR)
      const recordTable = `${quoteIdentifier(schema)}.${quoteIdentifier(recordTableName('specimen', 'records'))}`
      await adminPool!.query(`DROP TABLE ${recordTable}`)

      await expect(unit.putRecord('records', 'k', 1)).rejects.toMatchObject({ code: '42P01' })
      await expect(backend.close()).resolves.toBeUndefined()
    })

    it('propagates a connection failure from the pool', async () => {
      const backend = new PostgresStorageBackend(
        new Config({
          connectionString: 'postgresql://127.0.0.1:1/physicsos?connect_timeout=1',
          schema: 'public',
          maxConnections: 1,
        }),
      )
      backends.push(backend)
      await expect(backend.kv.open(SPECIFIC_DESCRIPTOR)).rejects.toBeInstanceOf(Error)
      await expect(backend.close()).resolves.toBeUndefined()
    })

    it('drains a still-pending failed open during close', async () => {
      const schema = await freshSchema()
      const first = backendAt(schema)
      await (await first.kv.open(SPECIFIC_DESCRIPTOR)).close()
      await first.close()

      const backend = backendAt(schema)
      const pending = backend.kv.open({ ...SPECIFIC_DESCRIPTOR, version: 99 })
      const closed = backend.close()
      await expect(pending).rejects.toMatchObject({ code: 'version-mismatch' })
      await closed
    })

    it('registers on the storage hub as backend postgres and closes on dispose', async () => {
      const ctx = new Context()
      await ctx.plugin(Storage)
      const fiber = await ctx.plugin(StoragePostgres, {
        connectionString: availability.url,
        schema: await freshSchema(),
        maxConnections: 2,
        ssl: false,
      })
      const backend = ctx.storage.backend.get('postgres')
      expect(ctx.get(storageBackendServiceKey('postgres'))).toBe(backend)
      const unit = await backend.kv!.open(SPECIFIC_DESCRIPTOR)
      await unit.putRecord('records', 'k', { n: 1 })

      await fiber.dispose()
      expect(ctx.storage.backend.names()).toEqual([])
      expect(ctx.get(storageBackendServiceKey('postgres'))).toBeUndefined()
      await expect(backend.kv!.open(SPECIFIC_DESCRIPTOR)).rejects.toMatchObject({ code: 'closed' })
    })
  })
}
