/** Explicit disposable PostgreSQL opt-in. Not run by offline source tests and never reads production URLs. */
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateSync } from 'node:zlib'
import { expect, it } from 'vitest'
import type { Pool } from 'pg'
import { PostgresVisualMaterialRepository } from '../src/visual-material-postgres.ts'
import { FileVisualMaterialBlobStore } from '../src/visual-material-blobs.ts'
import { DefaultVisualMaterialService } from '../src/visual-material-service.ts'
import { compileVisualMaterialSearch } from '../src/visual-material-sql.ts'
import { visualMaterialSearchPlan } from '../src/visual-material-domain.ts'
import { visualMaterialTableNames, visualMaterialSqlIdentifier } from '../src/visual-material-schema.ts'

const optedIn = process.env.PHYSICSOS_VISUAL_MATERIAL_PG_TEST === '1' && !!process.env.PHYSICSOS_VISUAL_MATERIAL_PG_TEST_URL
function pngOf(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const size = Buffer.alloc(4), crc = Buffer.alloc(4), tag = Buffer.from(type)
    size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, crc])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(256 * 1025))), chunk('IEND', Buffer.alloc(0))])
}

it.skipIf(!optedIn)('PostgreSQL indexes/relevance/access/idempotence/rollback/restart against a unique disposable schema', async () => {
  const { Pool: RuntimePool } = await import('pg')
  const pool: Pool = new RuntimePool({ connectionString: process.env.PHYSICSOS_VISUAL_MATERIAL_PG_TEST_URL!, max: 6, connectionTimeoutMillis: 5000 })
  const schema = `vm_test_${randomBytes(8).toString('hex')}`, t = visualMaterialTableNames(schema)
  const home = await mkdtemp(path.join(await realpath(tmpdir()), 'physicsos-vmat-pg-')); await chmod(home, 0o700)
  const actor = { userKey: 'owner', schoolId: 'school' }, peer = { userKey: 'peer', schoolId: 'school' }, foreign = { userKey: 'foreign', schoolId: 'foreign', role: 'SUPER_ADMIN' }
  const input = { operationId: 'one', bytes: pngOf(), mediaType: 'image/png' as const, width: 256, height: 256,
    model: 'test', theme: '牛顿实验室', purpose: 'appearance', tags: ['实验室', 'wood'], kind: 'environment' as const, prompt: 'private prompt',
    generationChannelId: 'channel-private', generationConfigRevision: 'config-private', generationUsage: { inputTokens: 42, outputTokens: 100, totalTokens: 142 } }
  let repository = new PostgresVisualMaterialRepository({ pool, schema, assertWriterHeld: () => {} })
  try {
    await repository.initialize()
    const service = new DefaultVisualMaterialService({ repository, blobs: new FileVisualMaterialBlobStore({ dshHome: home }) })
    await service.initialize()
    let first = await service.storeGenerated(actor, input)
    const provenance = await pool.query(`SELECT "generation_channel_id", "generation_config_revision", "generation_usage" FROM ${t.material} WHERE "id" = $1`, [first.id])
    expect(provenance.rows[0]).toMatchObject({ generation_channel_id: input.generationChannelId, generation_config_revision: input.generationConfigRevision, generation_usage: input.generationUsage })
    expect(JSON.stringify(first)).not.toMatch(/channel-private|config-private|generationUsage|totalTokens/)
    expect(await service.storeGenerated(actor, input)).toEqual(first)
    expect((await service.search(peer)).items).toHaveLength(0)
    await expect(service.readBytes(foreign, first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    first = await service.manage(actor, first.id, { operationId: 'share', expectedRevision: first.revision, visibility: 'school' })
    expect((await service.search(peer, { query: '实验室' })).items[0]?.id).toBe(first.id)
    expect((await service.select(peer, first.id)).bytes).toEqual(input.bytes)
    await service.storeGenerated(actor, { ...input, operationId: 'two', theme: 'other', tags: [], purpose: '实验室' })
    const ranked = await service.search(actor, { query: '实验室', limit: 1 })
    expect(ranked.items[0]?.id).toBe(first.id)
    expect((await service.search(actor, { query: '实验室', cursor: ranked.nextCursor!, limit: 5 })).items).toHaveLength(1)
    const indexes = await pool.query<{ indexdef: string }>('SELECT "indexdef" FROM pg_indexes WHERE "schemaname" = $1', [schema])
    expect(indexes.rows.some(row => /USING gin \(terms\)/i.test(row.indexdef))).toBe(true)
    expect(indexes.rows.some(row => /owner_key, lifecycle, created_at DESC/i.test(row.indexdef))).toBe(true)
    const explainClient = await pool.connect()
    try {
      await explainClient.query('BEGIN')
      await explainClient.query('SET LOCAL enable_seqscan = off')
      const plan = compileVisualMaterialSearch(schema, actor, visualMaterialSearchPlan({ query: '实验室' }))
      const explained = await explainClient.query(`EXPLAIN (FORMAT JSON) ${plan.text}`, [...plan.values])
      expect(JSON.stringify(explained.rows)).toMatch(/terms_gin/)
      await explainClient.query('COMMIT')
    } catch (error) { await explainClient.query('ROLLBACK'); throw error }
    finally { explainClient.release() }
    // A real term insert error rolls back the quota and normalized metadata in the same transaction.
    await pool.query(`ALTER TABLE ${t.term} ADD CONSTRAINT "vm_test_fault" CHECK ("term" <> 'faultmarker')`)
    const before = await service.quota(actor)
    await expect(service.storeGenerated(actor, { ...input, operationId: 'fault', tags: ['faultmarker'] })).rejects.toMatchObject({ code: 'REPOSITORY_UNAVAILABLE' })
    expect(await service.quota(actor)).toEqual(before)
    expect((await service.list(actor)).items).toHaveLength(2)
    await pool.query(`ALTER TABLE ${t.term} DROP CONSTRAINT "vm_test_fault"`)
    // Force ready metadata failure AFTER durable blob publication, then recover with a fresh runtime.
    await pool.query(`ALTER TABLE ${t.material} ADD CONSTRAINT "vm_test_publication_fault" CHECK ("operation_id" <> 'restart' OR "lifecycle" <> 'ready')`)
    await expect(service.storeGenerated(actor, { ...input, operationId: 'restart' })).rejects.toMatchObject({ code: 'RETENTION_PENDING' })
    expect((await service.list(actor, { lifecycle: 'pending' })).items).toHaveLength(1)
    await pool.query(`ALTER TABLE ${t.material} DROP CONSTRAINT "vm_test_publication_fault"`)
    await repository.close()
    repository = new PostgresVisualMaterialRepository({ pool, schema, assertWriterHeld: () => {} })
    const restarted = new DefaultVisualMaterialService({ repository, blobs: new FileVisualMaterialBlobStore({ dshHome: home }) })
    await restarted.initialize()
    expect(await restarted.recoverPending()).toMatchObject({ recovered: 1, pending: 0 })
    expect((await restarted.quota(actor)).account).toMatchObject({ count: 3, activeCount: 0, stageBytes: 0 })
    const tombstone = await restarted.manage(actor, first.id, { operationId: 'delete', expectedRevision: first.revision, softdelete: true })
    expect(tombstone.lifecycle).toBe('deleted')
    await expect(restarted.select(peer, first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  } finally {
    await repository.close()
    await pool.query(`DROP SCHEMA IF EXISTS ${visualMaterialSqlIdentifier(schema)} CASCADE`)
    await pool.end(); await rm(home, { recursive: true, force: true })
  }
}, 60_000)
