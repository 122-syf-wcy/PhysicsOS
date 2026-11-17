/** Explicit isolated server PostgreSQL lane. Authored, NOT run; never reads DATABASE_URL or production. */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PostgresStorageBackend } from '../../../storage/storage-postgres/src/index.ts'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../../../storage/storage-postgres/src/schema.ts'
import { openExperimentRunDomain, type ExperimentRunDomain } from '../src/experiment-run-domain.ts'
import { ExperimentRunService } from '../src/experiment-run-service.ts'
import { runAlice, runBody } from './experiment-run-fixture.ts'
const database = process.env.PHYSICSOS_TEST_POSTGRES_URL
const require = createRequire(new URL('../../../storage/storage-postgres/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')
describe.skipIf(database === undefined)('experiment run PostgreSQL atomic receipt/cold reopen', () => {
  it('persists fact plus capsule together and replays original time after a fresh service and storage facility', async () => {
    if (database === undefined) throw new Error('Explicitly isolated PHYSICSOS_TEST_POSTGRES_URL required')
    const schema = `experiment_run_test_${randomUUID().replaceAll('-', '')}`, pool = new Pool({ connectionString: database, max: 1 })
    let ctx: Context | undefined, backend: PostgresStorageBackend | undefined, domain: ExperimentRunDomain | undefined, service: ExperimentRunService | undefined
    let at = new Date('2026-11-17T02:00:00.000Z')
    const close = async (): Promise<void> => { await service?.dispose(); await domain?.close(); await backend?.close(); await ctx?.fiber.dispose(); service = undefined; domain = undefined; backend = undefined; ctx = undefined }
    const open = async (): Promise<ExperimentRunService> => {
      ctx = new Context(); await ctx.plugin(Storage)
      backend = new PostgresStorageBackend({ connectionString: database, schema, maxConnections: 2 })
      ctx.storage.backend.register('postgres', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'postgres' }))
      domain = await openExperimentRunDomain(ctx)
      service = new ExperimentRunService(domain, { mode: 'enabled', resolveExperiment: id => id === 'incline', now: () => at, activitySink: { success: async () => ({ status: 'pending' }) } })
      await service.initialize(); return service
    }
    onTestFinished(async () => { await close(); try { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`) } finally { await pool.end() } }, 60_000)
    const first = await open(), body = runBody(first), permit = await first.prepare(runAlice, body)
    const table = qualifiedTable(schema, recordTableName('physicsos_experiment_run_v1', 'runs'))
    const prepared = await pool.query<{ value: string }>(`SELECT value FROM ${table}`)
    expect(JSON.parse(prepared.rows[0]!.value)).toMatchObject({ state: 'prepared' })
    expect(prepared.rows[0]!.value).not.toContain(permit.permit)
    at = new Date('2026-11-17T02:00:01.000Z')
    const ack = await first.record(runAlice, { ...body, permit: permit.permit })
    const stored = await pool.query<{ value: string }>(`SELECT value FROM ${table}`)
    expect(stored.rows).toHaveLength(1)
    expect(JSON.parse(stored.rows[0]!.value)).toMatchObject({ state: 'recorded', recordedAt: ack.recordedAt, stableHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      provenance: 'client-observed', activitySuccess: { source: 'experiment-run', operationId: body.runId, occurredAt: ack.recordedAt } })
    expect(stored.rows[0]!.value).not.toContain(permit.permit)
    await close(); at = new Date('2026-11-18T02:00:00.000Z')
    const reopened = await open()
    await expect(reopened.record(runAlice, { ...body, permit: permit.permit })).rejects.toMatchObject({ code: 'RUN_CAPABILITY_CHANGED' })
    const replay = await reopened.activityReplaySource.read({ from: '2026-11-17T00:00:00.000Z', to: at.toISOString(), limit: 10, signal: new AbortController().signal })
    expect(replay.capsules).toEqual([{ version: 1, source: 'experiment-run', operationId: body.runId, occurredAt: ack.recordedAt, owner: { schoolId: runAlice.schoolId, userKey: runAlice.userKey } }])
  }, 120_000)
})
