import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { createSceneObject } from '@physicsos/physics-workbench/codec'
import { canonicalBytes } from '@physicsos/physics-workbench/json'
import type { CanvasOpenResponse, CanvasCommitResponse } from '@physicsos/physics-workbench/protocol'
import { loadCanvasFixture, responseJson, CANVAS_FIXTURE_TIMEOUT } from './canvas-fixture.ts'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../../../storage/storage-postgres/src/schema.ts'

const database = process.env.PHYSICSOS_TEST_POSTGRES_URL
const require = createRequire(new URL('../../../storage/storage-postgres/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')
const prefix = '/physicsos/learning/canvases'

/** This lane requires an explicitly supplied isolated database, never DATABASE_URL or production. */
describe.skipIf(database === undefined)('canvas PostgreSQL persistence and restart', () => {
  it('persists real documents and blobs, fences concurrent writes and restores after a new Loader', async () => {
    const schema = `canvas_test_${randomUUID().replaceAll('-', '')}`
    const pool = new Pool({ connectionString: database, max: 1 })
    let close: (() => Promise<void>) | undefined
    onTestFinished(async () => {
      await close?.()
      try { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`) }
      finally { await pool.end() }
    }, CANVAS_FIXTURE_TIMEOUT)
    if (database === undefined) throw new Error('Isolated PostgreSQL URL required')
    const fixture = await loadCanvasFixture({ postgres: { connectionString: database, schema } })
    close = fixture.close
    const account = await fixture.register(`owner_${randomUUID().slice(0, 8)}`)
    const other = await fixture.register(`other_${randomUUID().slice(0, 8)}`)
    const initial = await responseJson<CanvasOpenResponse>(await fixture.call('POST', prefix, {
      id: 'persisted-board', title: 'PostgreSQL workbench', mutationId: 'create-board',
    }, account), 201)
    const scene = createSceneObject(createMechanicsScene({ sceneId: 'persisted-motion', model: 'uniform_linear_motion', mass: 2,
      velocity: { x: 4, y: 0, z: 0 }, endTime: 2, title: 'Persistent motion' }))
    const sceneBytes = canonicalBytes(scene)
    const sceneDigest = createHash('sha256').update(sceneBytes).digest('hex')
    expect((await fixture.raw('PUT', `${prefix}/persisted-board/objects/${sceneDigest}`, sceneBytes, account)).status).toBe(200)
    const manifest = { ...initial.manifest,
      instances: [{ instanceId: 'experiment-a', currentScene: { kind: 'scene', digest: sceneDigest }, originScene: { kind: 'scene', digest: sceneDigest },
        source: { kind: 'template', id: 'uniform-linear' }, templateId: 'uniform-linear', domain: 'mechanics', buildMode: 'inspect',
        instanceEditRevision: 0, clock: { time: 0, total: 2, running: false, rate: 1 } }],
      nodes: [{ id: 'experiment-node', kind: 'experiment', instanceId: 'experiment-a', layout: { x: 40, y: 60, width: 520, height: 360, zIndex: 0 } },
        { id: 'note-node', kind: 'note', title: 'Conclusion', body: 'Measured x = 8 m after 2 s', format: 'markdown', layout: { x: 600, y: 60, width: 320, height: 220, zIndex: 1 } }],
    }
    const bytes = canonicalBytes(manifest)
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect((await fixture.raw('PUT', `${prefix}/persisted-board/objects/${digest}`, bytes, account)).status).toBe(200)
    const committed = await responseJson<CanvasCommitResponse>(await fixture.call('POST', `${prefix}/persisted-board/commit`, {
      expectedVersion: initial.head.version, mutationId: 'commit-real-scene', manifestDigest: digest,
    }, account))
    expect(committed.head.version).toBe(initial.head.version + 1)
    const table = qualifiedTable(schema, recordTableName('physicsos_canvas', 'heads'))
    const stored = await pool.query<{ value: string }>(`SELECT value FROM ${table}`)
    expect(stored.rows.map(row => JSON.parse(row.value))).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'persisted-board', manifestDigest: digest })]))
    expect((await fixture.call('GET', `${prefix}/persisted-board`, undefined, other)).status).toBe(404)
    const races = await Promise.all(['first', 'second'].map(name => fixture.call('POST', `${prefix}/persisted-board/rename`, {
      expectedVersion: committed.head.version, mutationId: `rename-${name}`, title: name,
    }, account)))
    expect(races.map(response => response.status).sort()).toEqual([200, 409])
    await fixture.restart()
    const signedIn = await fixture.login(account.user.username)
    const opened = await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/persisted-board`, undefined, signedIn))
    expect(opened.manifest.nodes).toEqual(manifest.nodes)
    const readBytes = Buffer.from(await (await fixture.call('GET', `${prefix}/persisted-board/objects/${sceneDigest}`, undefined, signedIn)).arrayBuffer())
    expect(readBytes).toEqual(Buffer.from(sceneBytes))
    const deleted = await responseJson<{ head: CanvasOpenResponse['head'] }>(await fixture.call('DELETE', `${prefix}/persisted-board`, {
      expectedVersion: opened.head.version, mutationId: 'delete-board',
    }, signedIn))
    expect((await fixture.call('GET', `${prefix}/persisted-board`, undefined, signedIn)).status).toBe(410)
    const restored = await responseJson<{ head: CanvasOpenResponse['head'] }>(await fixture.call('POST', `${prefix}/persisted-board/restore`, {
      expectedVersion: deleted.head.version, mutationId: 'restore-board',
    }, signedIn))
    expect(restored.head.generation).toBeGreaterThan(opened.head.generation)
    const final = await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/persisted-board`, undefined, signedIn))
    expect(final.manifest.nodes).toEqual(manifest.nodes)
  }, CANVAS_FIXTURE_TIMEOUT)
})
