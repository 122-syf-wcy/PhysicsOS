import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it, onTestFinished } from 'vitest'
import { loadCanvasFixture, responseJson, CANVAS_FIXTURE_TIMEOUT } from './canvas-fixture.ts'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../../../storage/storage-postgres/src/schema.ts'
import type { RecentSceneLifecycle } from '../src/personal-product-state-service.ts'
import { sceneEntry } from './personal-product-state-fixture.ts'
const database = process.env.PHYSICSOS_TEST_POSTGRES_URL
const require = createRequire(new URL('../../../storage/storage-postgres/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')

/** Explicit isolated database only; never uses DATABASE_URL or production by fallback. */
describe.skipIf(database === undefined)('personal product PostgreSQL cold restart', () => {
  it('keeps snapshots/tombstones independently durable and blocks old PUT after restore', async () => {
    if (database === undefined) throw new Error('An isolated PostgreSQL URL is required')
    const schema = `personal_test_${randomUUID().replaceAll('-', '')}`
    const pool = new Pool({ connectionString: database, max: 1 })
    let close: (() => Promise<void>) | undefined
    onTestFinished(async () => { await close?.(); try { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`) } finally { await pool.end() } }, CANVAS_FIXTURE_TIMEOUT)
    const f = await loadCanvasFixture({ teachingToolsMode: 'enabled', postgres: { connectionString: database, schema } })
    close = f.close
    const account = await f.register(`recent_${randomUUID().slice(0, 8)}`)
    const owner = { 'x-physicsos-learning-owner': encodeURIComponent(JSON.stringify({ schoolId: account.user.schoolId, username: account.user.username })) }
    expect((await f.call('PUT', '/physicsos/learning/scenes/motion', sceneEntry(), account, owner)).status).toBe(200)
    const deletion = { action: 'delete', expectedGeneration: 0, expectedVersion: 0, operationId: 'persist-delete' }
    const deleted = await responseJson<{ state: RecentSceneLifecycle }>(await f.call('POST', '/physicsos/learning/product-state/recent-scenes/motion', deletion, account, owner))
    expect(deleted.state.recentState).toBe('deleted')
    const snapshots = qualifiedTable(schema, recordTableName('physicsos_learning', 'saved_scenes'))
    const heads = qualifiedTable(schema, recordTableName('physicsos_personal_product_state_v1', 'recent_scenes'))
    expect((await pool.query(`SELECT value FROM ${snapshots}`)).rows).toHaveLength(1)
    const stored = await pool.query<{ value: string }>(`SELECT value FROM ${heads}`)
    expect(stored.rows.map(row => JSON.parse(row.value))).toEqual([expect.objectContaining({ state: 'deleted', generation: 1 })])
    await f.restart()
    const signedIn = await f.login(account.user.username)
    const replay = await responseJson<{ state: RecentSceneLifecycle }>(await f.call('POST', '/physicsos/learning/product-state/recent-scenes/motion', deletion, signedIn, owner))
    expect(replay.state).toEqual(deleted.state)
    expect((await f.call('PUT', '/physicsos/learning/scenes/motion', sceneEntry('motion', 10), signedIn, owner)).status).toBe(410)
    const restored = await responseJson<{ state: RecentSceneLifecycle }>(await f.call('POST', '/physicsos/learning/product-state/recent-scenes/motion', {
      action: 'restore', expectedGeneration: 1, expectedVersion: 1, operationId: 'persist-restore',
    }, signedIn, owner))
    expect(restored.state.recentGeneration).toBe(2)
    expect((await f.call('PUT', '/physicsos/learning/scenes/motion', sceneEntry('motion', 11), signedIn, owner)).status).toBe(409)
    expect((await f.call('PUT', '/physicsos/learning/scenes/motion', { ...sceneEntry('motion', 12), recentGeneration: 2 }, signedIn, owner)).status).toBe(200)
  }, CANVAS_FIXTURE_TIMEOUT)
})
