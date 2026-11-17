/** Server-only isolated PostgreSQL lane. Never falls back to DATABASE_URL or production. */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PostgresStorageBackend } from '../../../storage/storage-postgres/src/index.ts'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../../../storage/storage-postgres/src/schema.ts'
import { openActivityDomain, type ActivityDomain } from '../src/activity-domain.ts'
import { ActivityService } from '../src/activity-service.ts'
import { alice, admin, capsule, clientEvent, rosterFixture, root } from './activity-fixture.ts'

const database = process.env.PHYSICSOS_TEST_POSTGRES_URL
const require = createRequire(new URL('../../../storage/storage-postgres/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')
describe.skipIf(database === undefined)('activity real PostgreSQL durability and cold reopen', () => {
  it('durably couples count/hash, retains receipts across a fresh DomainFacility, and stays separate from legacy units', async () => {
    if (database === undefined) throw new Error('An explicitly isolated PostgreSQL URL is required')
    const schema = `activity_test_${randomUUID().replaceAll('-', '')}`, pool = new Pool({ connectionString: database, max: 1 })
    let context: Context | undefined, backend: PostgresStorageBackend | undefined, domain: ActivityDomain | undefined, service: ActivityService | undefined
    const close = async () => { await service?.dispose(); await domain?.close(); await backend?.close(); await context?.fiber.dispose(); service = undefined; domain = undefined; backend = undefined; context = undefined }
    onTestFinished(async () => { await close(); try { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`) } finally { await pool.end() } }, 60_000)
    let now = new Date('2026-11-16T00:00:00.000Z')
    const open = async () => {
      context = new Context(); await context.plugin(Storage)
      backend = new PostgresStorageBackend({ connectionString: database, schema, maxConnections: 2 })
      context.storage.backend.register('postgres', backend); context.provide('storageDomain', new DomainFacility(context, { backend: 'postgres' }))
      domain = await openActivityDomain(context)
      service = new ActivityService(domain, { mode: 'enabled', now: () => now, roster: rosterFixture, queryCapacityVerified: true })
      await service.initialize()
      return service
    }
    const first = await open(), visit = clientEvent('visit', now.toISOString()), success = capsule('durable-canvas-session', now.toISOString())
    await Promise.all([first.recordClientEvent(alice, visit), first.recordClientEvent(alice, visit)])
    expect(await first.success(success)).toMatchObject({ status: 'recorded' })
    const bucketTable = qualifiedTable(schema, recordTableName('physicsos_activity_v1', 'buckets'))
    const stored = await pool.query<{ value: string }>(`SELECT value FROM ${bucketTable}`)
    const rows = stored.rows.map(row => JSON.parse(row.value) as { visits: number; uses: number; dedup: Record<string, string> })
    expect(rows.reduce((n, row) => n + row.visits, 0)).toBe(1); expect(rows.reduce((n, row) => n + row.uses, 0)).toBe(1)
    expect(rows.reduce((n, row) => n + Object.keys(row.dedup).length, 0)).toBe(2)
    await close()
    const reopened = await open()
    expect(await reopened.success(success)).toMatchObject({ status: 'duplicate' })
    expect(await reopened.userDetail(admin, { schoolId: alice.schoolId, username: alice.username })).toMatchObject({ visits: 1, uses: 1 })
    expect(await reopened.schoolRanking(root)).toMatchObject({ overview: { visits: 1, uses: 1, activeUsers: 1 } })
    now = new Date('2026-11-24T00:00:00.000Z'); await reopened.recover()
    const sealedStored = await pool.query<{ value: string }>(`SELECT value FROM ${bucketTable}`)
    const sealed = sealedStored.rows.map(row => JSON.parse(row.value) as { visits: number; uses: number; sealedAt?: string; dedup: Record<string, string> })
    expect(sealed.every(row => row.sealedAt !== undefined && Object.keys(row.dedup).length === 0)).toBe(true)
    expect(sealed.reduce((n, row) => n + row.visits, 0)).toBe(1); expect(sealed.reduce((n, row) => n + row.uses, 0)).toBe(1)
    const receiptTable = qualifiedTable(schema, recordTableName('physicsos_activity_v1', 'receipts'))
    expect((await pool.query(`SELECT value FROM ${receiptTable}`)).rows).toHaveLength(0)
    await close(); now = new Date('2026-11-22T00:00:00.000Z') // even a clock rollback cannot reopen discarded proof
    const sealedReopen = await open()
    expect(await sealedReopen.success(success)).toMatchObject({ status: 'rejected', code: 'ACTIVITY_REPLAY_EXPIRED' })
    await expect(sealedReopen.recordClientEvent(alice, visit)).rejects.toMatchObject({ code: 'ACTIVITY_REPLAY_EXPIRED' })
    expect(await sealedReopen.schoolRanking(root, { days: 30 })).toMatchObject({ overview: { visits: 1, uses: 1, activeUsers: 1 } })
  }, 120_000)
})
