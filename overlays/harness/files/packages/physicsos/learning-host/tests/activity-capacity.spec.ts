/** Opt-in SERVER capacity gate, never a local test or production database benchmark. */
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import Storage, { type StorageBackend } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PostgresStorageBackend } from '../../../storage/storage-postgres/src/index.ts'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../../../storage/storage-postgres/src/schema.ts'
import { activityBucketWire, activityReceiptWire, openActivityDomain, type ActivityDomain } from '../src/activity-domain.ts'
import { ACTIVITY_AVATARS, ActivityService } from '../src/activity-service.ts'
import { DEFAULT_ACTIVITY_LIMITS, ACTIVITY_SHARDS, type ActivityRoster } from '../src/activity-types.ts'
import { root } from './activity-fixture.ts'

const enabled = process.env.PHYSICSOS_ACTIVITY_RUN_CAPACITY === '1'
const database = process.env.PHYSICSOS_TEST_POSTGRES_URL
const require = createRequire(new URL('../../../storage/storage-postgres/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const DAY = 86_400_000
const numberInput = (name: string): number => {
  const value = Number(process.env[name])
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error(`Explicit bounded capacity input required: ${name}`)
  return value
}
/** Inputs are expected deployment demand, not invented production counts. This generator never runs in the application. */
describe.skipIf(!enabled || database === undefined)('activity 90-day + ten-times real PostgreSQL capacity release gate', () => {
  for (const scale of [1, 10]) it(`measures full loadAll, grouping, cache and heap at ${scale}x configured demand`, async () => {
    if (database === undefined) throw new Error('Isolated PostgreSQL URL required')
    const baseUsers = numberInput('PHYSICSOS_ACTIVITY_BASE_DAILY_USERS'), eventsPerDay = numberInput('PHYSICSOS_ACTIVITY_EVENTS_PER_USER_DAY'), users = baseUsers * scale
    const gc = (globalThis as { gc?: () => void }).gc
    if (gc === undefined) throw new Error('Capacity gate needs an explicit GC-enabled isolated server process for reproducible heap measurement')
    if (users > DEFAULT_ACTIVITY_LIMITS.maxRosterUsers) throw new Error('10x demand exceeds roster admission; add indexed storage before enabling queries')
    const estimate = users * 90 * (Math.min(ACTIVITY_SHARDS, eventsPerDay) + Math.floor(eventsPerDay / 3))
    if (estimate + 1 > DEFAULT_ACTIVITY_LIMITS.maxRows) throw new Error('90-day demand exceeds the finite unit row envelope; queries must remain gated until indexed storage is added')
    const schema = `activity_capacity_${randomUUID().replaceAll('-', '')}`, pool = new Pool({ connectionString: database, max: 1 })
    let context: Context | undefined, backend: PostgresStorageBackend | undefined, domain: ActivityDomain | undefined, service: ActivityService | undefined, loadCalls = 0, clock = new Date('2026-11-16T00:00:00.000Z')
    const roster: ActivityRoster = { version: `capacity-${scale}`, schools: [{ id: 'capacity', name: '容量验收隔离学校', status: 'active' }], users: Array.from({ length: users }, (_, index) => ({ schoolId: 'capacity', userKey: `capacity:u${index}`, username: `u${index}`, status: 'active' as const, role: 'STUDENT' as const, avatarUrl: ACTIVITY_AVATARS[index % 12]!.path })) }
    const close = async () => { await service?.dispose(); await domain?.close(); await backend?.close(); await context?.fiber.dispose(); service = undefined; domain = undefined; backend = undefined; context = undefined }
    onTestFinished(async () => { await close(); try { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`) } finally { await pool.end() } }, 60_000)
    const open = async () => {
      context = new Context(); await context.plugin(Storage)
      backend = new PostgresStorageBackend({ connectionString: database, schema, maxConnections: 2 })
      const actual = backend, wrapped: StorageBackend = { kv: { open: async descriptor => {
        const unit = await actual.kv.open(descriptor)
        return { loadAll: () => { loadCalls += 1; return unit.loadAll() }, putRecord: (table, key, value) => unit.putRecord(table, key, value), deleteRecord: (table, key) => unit.deleteRecord(table, key), setGlobal: value => unit.setGlobal(value), close: () => unit.close() }
      } }, close: () => actual.close() }
      context.storage.backend.register('postgres', wrapped); context.provide('storageDomain', new DomainFacility(context, { backend: 'postgres' }))
      domain = await openActivityDomain(context)
      service = new ActivityService(domain, { mode: 'enabled', now: () => clock, roster: () => roster, queryCapacityVerified: true })
      await service.initialize()
      return service
    }
    clock = new Date('2026-08-19T00:00:00.000Z'); await open(); await close()
    const bucketTable = qualifiedTable(schema, recordTableName('physicsos_activity_v1', 'buckets')), receiptTable = qualifiedTable(schema, recordTableName('physicsos_activity_v1', 'receipts'))
    let seededRows = 1, seededBytes = 0
    const insert = async (table: string, values: readonly { key: string; value: unknown }[]) => {
      for (let index = 0; index < values.length; index += 200) {
        const chunk = values.slice(index, index + 200), parameters: string[] = []
        const slots = chunk.map((row, rowIndex) => {
          const keyJson = JSON.stringify(row.key), value = JSON.stringify(row.value)
          parameters.push(createHash('sha256').update(keyJson).digest('hex'), keyJson, value)
          seededRows += 1; seededBytes += Buffer.byteLength(row.key) + Buffer.byteLength(value)
          return `($${rowIndex * 3 + 1}, $${rowIndex * 3 + 2}, $${rowIndex * 3 + 3})`
        })
        if (seededRows > DEFAULT_ACTIVITY_LIMITS.maxRows || seededBytes > DEFAULT_ACTIVITY_LIMITS.maxStoredBytes) throw new Error('Generated 90-day demand exceeds bounded storage; leave capacity gate closed')
        await pool.query(`INSERT INTO ${table} (key_hash, key_json, value) VALUES ${slots.join(',')}`, parameters)
      }
    }
    for (let dayIndex = 0; dayIndex < 90; dayIndex += 1) {
      const date = new Date(Date.parse('2026-08-19T00:00:00.000Z') + dayIndex * DAY), day = date.toISOString().slice(0, 10)
      const buckets: { key: string; value: ReturnType<typeof activityBucketWire.parse> }[] = [], receipts: { key: string; value: ReturnType<typeof activityReceiptWire.parse> }[] = []
      for (let user = 0; user < users; user += 1) {
        const owner = { schoolId: 'capacity', userKey: `capacity:u${user}` }, shards = new Map<number, ReturnType<typeof activityBucketWire.parse>>()
        for (let index = 0; index < eventsPerDay; index += 1) {
          const id = hash([owner, day, index]), requestHash = hash(['content', id]), shard = Number.parseInt(id.slice(0, 8), 16) % ACTIVITY_SHARDS
          const old = shards.get(shard) ?? { ...owner, day, shard, visits: 0, opens: 0, uses: 0, modules: [], dedup: {} }
          const kind = index % 3, visits = old.visits + Number(kind === 0), opens = old.opens + Number(kind === 1), uses = old.uses + Number(kind === 2)
          const value = activityBucketWire.parse({ ...old, visits, opens, uses, modules: [{ module: 'app', visits, opens: 0, uses: 0 }, { module: 'canvas', visits: 0, opens, uses, ...(uses === 0 ? {} : { lastUseAt: date.toISOString() }) }], dedup: { ...old.dedup, [id]: requestHash } })
          if (Buffer.byteLength(JSON.stringify(value)) > DEFAULT_ACTIVITY_LIMITS.maxBucketBytes) throw new Error('Expected per-user/day shard is over budget')
          shards.set(shard, value)
          if (kind === 2) receipts.push({ key: id, value: activityReceiptWire.parse({ ...owner, source: 'canvas-edit', operationHash: id, requestHash, occurredAt: date.toISOString(), state: 'applied' }) })
        }
        for (const [shard, value] of shards) buckets.push({ key: hash([owner.schoolId, owner.userKey, day, shard]), value })
      }
      await insert(bucketTable, buckets); await insert(receiptTable, receipts)
    }
    clock = new Date('2026-11-16T00:00:00.000Z'); gc()
    const heapBefore = process.memoryUsage().heapUsed, loadBefore = loadCalls, start = performance.now(), opened = await open(), coldMs = performance.now() - start
    gc(); const coldHeapBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore)
    expect(loadCalls - loadBefore).toBe(1)
    expect(coldMs).toBeLessThanOrEqual(DEFAULT_ACTIVITY_LIMITS.maxColdStartMs)
    expect(coldHeapBytes).toBeLessThanOrEqual(512 * 1024 * 1024)
    const diagnosticBefore = opened.diagnostics(), samples: number[] = []
    const queryHeapBefore = process.memoryUsage().heapUsed
    for (let sample = 0; sample < 20; sample += 1) {
      clock = new Date(clock.getTime() + DEFAULT_ACTIVITY_LIMITS.cacheTtlMs + 1)
      const began = performance.now(); await opened.schoolRanking(root, { days: 90 }); samples.push(performance.now() - began)
    }
    const sorted = [...samples].sort((a, b) => a - b), p95Ms = sorted[Math.ceil(sorted.length * .95) - 1]!
    gc(); const queryHeapBytes = Math.max(0, process.memoryUsage().heapUsed - queryHeapBefore)
    expect(opened.diagnostics().bucketScans - diagnosticBefore.bucketScans).toBe(20)
    expect(opened.diagnostics().receiptScans - diagnosticBefore.receiptScans).toBe(20)
    expect(p95Ms).toBeLessThanOrEqual(DEFAULT_ACTIVITY_LIMITS.maxQueryMs)
    expect(queryHeapBytes).toBeLessThanOrEqual(128 * 1024 * 1024)
    expect(opened.diagnostics().cacheBytes).toBeLessThanOrEqual(DEFAULT_ACTIVITY_LIMITS.maxCacheBytes)
    console.info('activity-capacity', { scale, users, eventsPerDay, rows: seededRows, bytes: seededBytes, coldMs, coldHeapBytes, p95Ms, queryHeapBytes, loadCalls: loadCalls - loadBefore })
  }, 600_000)
})
