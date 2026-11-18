import { EventEmitter } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { PostgresVisualMaterialRepository } from '../src/visual-material-postgres.ts'
import { migrateVisualMaterialSchema } from '../src/visual-material-schema.ts'
import { visualMaterialIndex, visualMaterialSearchPlan } from '../src/visual-material-domain.ts'
import type { VisualMaterialRecord } from '../src/visual-material-contracts.ts'

const actor = { userKey: "owner'; --", schoolId: 'school-one' }
function recordOf(): VisualMaterialRecord {
  const descriptor = { id: `vmat_${'a'.repeat(32)}`, revision: 1, sha256: 'b'.repeat(64), byteLength: 128,
    mediaType: 'image/png' as const, width: 256, height: 256, kind: 'environment' as const, theme: "lab'; --",
    purpose: 'appearance', tags: ['wood', '实验室'], model: 'test', lifecycle: 'pending' as const,
    visibility: 'private' as const, createdAt: 100, updatedAt: 100, metadataTrust: 'untrusted' as const }
  return { ...descriptor, ownerKey: actor.userKey, schoolId: actor.schoolId, operationId: 'operation-one', privatePrompt: 'private prompt',
    generationChannelId: 'channel-private', generationConfigRevision: 'revision-private', generationUsage: { inputTokens: 42, outputTokens: 100 },
    index: visualMaterialIndex(descriptor), blobDurable: false, publicationPending: true, retentionCharged: true }
}
interface QueryCall { sql: string; values: unknown[]; client: number }
class FakeClient extends EventEmitter {
  constructor(readonly pool: FakePool, readonly id: number) { super() }
  releases: boolean[] = []
  async query(sql: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.pool.calls.push({ sql, values, client: this.id })
    if (this.pool.fail?.(sql)) throw new Error('secret PostgreSQL fault diagnostic')
    if (this.pool.failRollback && sql === 'ROLLBACK') throw new Error('rollback failed')
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ held: this.pool.writerAvailable }], rowCount: 1 }
    if (sql.includes('MAX("version")')) return { rows: [{ version: 0 }], rowCount: 1 }
    if (sql.includes('SELECT *') && sql.includes('physicsos_visual_material_quotas')) {
      return { rows: [{ scope: sql.includes("'global'") ? 'global' : 'owner', subject: '', bytes: '0', count: '0', operations: '0', active_count: '0', stage_bytes: '0' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  }
  release(broken = false): void { this.releases.push(broken) }
}
class FakePool extends EventEmitter {
  readonly options = { max: 6 }
  readonly calls: QueryCall[] = []
  readonly clients: FakeClient[] = []
  fail: ((sql: string) => boolean) | undefined
  failRollback = false
  writerAvailable = true
  async connect(): Promise<FakeClient> { const client = new FakeClient(this, this.clients.length); this.clients.push(client); return client }
}
const repositories: PostgresVisualMaterialRepository[] = []
afterEach(async () => { await Promise.all(repositories.splice(0).map(repo => repo.close())) })
function repositoryOf(pool = new FakePool(), assertWriterHeld = () => {}): { repository: PostgresVisualMaterialRepository; pool: FakePool } {
  const repository = new PostgresVisualMaterialRepository({ pool: pool as unknown as Pool, schema: 'private_catalog', assertWriterHeld })
  repositories.push(repository); return { repository, pool }
}

it('runs idempotent migrations in a transaction with normalized metadata/term/ref/operation and quota indexes', async () => {
  const { repository, pool } = repositoryOf()
  await repository.initialize(); const begin = pool.calls.findIndex(call => call.sql === 'BEGIN'), commit = pool.calls.findIndex(call => call.sql === 'COMMIT')
  expect(begin).toBeGreaterThan(-1); expect(commit).toBeGreaterThan(begin)
  const sql = pool.calls.map(call => call.sql).join('\n')
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS "private_catalog"."physicsos_visual_material_terms"')
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS "private_catalog"."physicsos_visual_material_refs"')
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS "private_catalog"."physicsos_visual_material_operations"')
  expect(sql).toContain('USING GIN ("terms")')
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "generation_channel_id"')
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "generation_config_revision"')
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "generation_usage"')
  expect(sql).toContain('octet_length("generation_usage"::text) <= 512')
  expect(sql).toContain("jsonb_typeof(\"generation_usage\" -> 'inputTokens') = 'number'")
  expect(sql).toContain('"owner_key", "lifecycle", "created_at" DESC')
  expect(sql).not.toMatch(/CREATE EXTENSION|jsonb_each|\bOFFSET\b/i)
  const count = pool.calls.length
  await repository.initialize(); expect(pool.calls.length).toBe(count)
  await migrateVisualMaterialSchema(pool.clients[1]! as unknown as import('pg').PoolClient, 'private_catalog')
  expect(pool.calls.slice(count).every(call => !call.sql.includes('CREATE TABLE') || call.sql.includes('IF NOT EXISTS'))).toBe(true)
})

it('reserves quota and inserts metadata/terms/operation atomically using parameters, before a publication exists', async () => {
  const { repository, pool } = repositoryOf(); await repository.initialize(); pool.calls.length = 0
  const row = recordOf(), reservation = await repository.reserveGenerated(actor, row, 'c'.repeat(64))
  expect(reservation).toMatchObject({ created: true, stageBytesReserved: row.byteLength })
  const globalLock = pool.calls.findIndex(call => call.sql.includes("'global'") && call.sql.includes('FOR UPDATE'))
  const metadata = pool.calls.findIndex(call => call.sql.startsWith('INSERT INTO') && call.sql.includes('"physicsos_visual_materials"'))
  expect(globalLock).toBeGreaterThan(-1); expect(metadata).toBeGreaterThan(globalLock)
  expect(pool.calls.at(-1)?.sql).toBe('COMMIT')
  expect(pool.calls.map(call => call.sql).join('\n')).not.toContain(row.theme)
  expect(pool.calls[metadata]?.values).toContain(row.theme)
  expect(pool.calls[metadata]?.values).toContain(row.privatePrompt)
  expect(pool.calls[metadata]?.values).toContain(row.generationChannelId)
  expect(pool.calls[metadata]?.values).toContain(row.generationConfigRevision)
  expect(pool.calls[metadata]?.values.at(-1)).toBe(JSON.stringify(row.generationUsage))
})

it('rolls back quota/metadata/term mutations on SQL failure and destroys a client when rollback fails', async () => {
  const { repository, pool } = repositoryOf(); await repository.initialize(); pool.calls.length = 0
  pool.fail = sql => sql.startsWith('INSERT INTO') && sql.includes('"physicsos_visual_material_terms"')
  await expect(repository.reserveGenerated(actor, recordOf(), 'c'.repeat(64))).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' })
  expect(pool.calls.at(-1)?.sql).toBe('ROLLBACK')
  expect(pool.calls.some(call => call.sql === 'COMMIT')).toBe(false)
  expect(pool.clients.at(-1)?.releases).toEqual([false])
  pool.failRollback = true
  await expect(repository.reserveGenerated(actor, recordOf(), 'c'.repeat(64))).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' })
  expect(pool.clients.at(-1)?.releases).toEqual([true])
})

it('treats ambiguous commit failure as an error with retained operation input, never success or memory fallback', async () => {
  const { repository, pool } = repositoryOf(); await repository.initialize(); pool.calls.length = 0
  pool.fail = sql => sql === 'COMMIT'
  await expect(repository.reserveGenerated(actor, recordOf(), 'c'.repeat(64))).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE', detail: { retryable: true } })
  expect(pool.calls.slice(-2).map(call => call.sql)).toEqual(['COMMIT', 'ROLLBACK'])
  expect(repository.persistence).toBe('postgres')
})

it('startup fails closed after migration failure or conflicting writer, and current reads are bounded transactions', async () => {
  const failing = new FakePool(); failing.fail = sql => sql.includes('CREATE TABLE') && sql.includes('visual_material_terms')
  const failed = repositoryOf(failing).repository
  await expect(failed.initialize()).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' })
  expect(failing.calls.at(-1)?.sql).toBe('ROLLBACK')
  expect(() => failed.assertAvailable()).toThrow()
  const conflicting = new FakePool(); conflicting.writerAvailable = false
  await expect(repositoryOf(conflicting).repository.initialize()).rejects.toMatchObject({ code: 'WRITER_CONFLICT' })
  const { repository, pool } = repositoryOf(); await repository.initialize(); pool.calls.length = 0
  await repository.search(actor, visualMaterialSearchPlan({ query: '实验室', limit: 3 }, 1000))
  expect(pool.calls[0]?.sql).toBe('BEGIN')
  expect(pool.calls.some(call => call.sql.includes('statement_timeout'))).toBe(true)
  const query = pool.calls.find(call => call.sql.startsWith('WITH ranked'))
  expect(query?.values.at(-1)).toBe(4)
  expect(query?.sql).not.toMatch(/\bOFFSET\b/)
  expect(pool.calls.at(-1)?.sql).toBe('COMMIT')
})

it('existing host writer loss and pool lease loss refuse reads/mutations immediately', async () => {
  let hostHeld = true
  const { repository, pool } = repositoryOf(undefined, () => { if (!hostHeld) throw new Error('host lost') })
  await repository.initialize(); hostHeld = false
  await expect(repository.search(actor, visualMaterialSearchPlan())).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' })
  hostHeld = true
  pool.clients[0]!.emit('error', new Error('connection closed'))
  expect(pool.clients[0]!.releases).toEqual([true])
  await expect(repository.search(actor, visualMaterialSearchPlan())).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' })
})

it('never supports a one-connection runtime pool, missing database config or missing host fence', () => {
  expect(() => new PostgresVisualMaterialRepository({ assertWriterHeld: () => {} })).toThrow()
  expect(() => new PostgresVisualMaterialRepository({ poolConfig: { max: 1 }, assertWriterHeld: () => {} })).toThrow()
  expect(() => new PostgresVisualMaterialRepository({ poolConfig: {}, assertWriterHeld: undefined } as never)).toThrow()
})
