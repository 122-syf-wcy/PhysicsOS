import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it, onTestFinished } from 'vitest'
import { qualifiedTable, quoteIdentifier, recordTableName } from '../../../storage/storage-postgres/src/schema.ts'
import { coursewareFixture, cwTeacher, importBody } from './courseware-fixture.ts'
const database = process.env.PHYSICSOS_TEST_POSTGRES_URL
const require = createRequire(new URL('../../../storage/storage-postgres/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')
/** Explicit isolated database only. No DATABASE_URL fallback, mock adapter, or production connection. */
describe.skipIf(database === undefined)('courseware real PostgreSQL cold start and bridge round trip', () => {
  it('durably stores the independent strict unit and restores exact originals, CAS, capsules and ink', async () => {
    if (!database) throw new Error('PHYSICSOS_TEST_POSTGRES_URL must identify an isolated test database')
    const schema = `courseware_test_${randomUUID().replaceAll('-', '')}`; const pool = new Pool({ connectionString: database, max: 1 })
    let close: (() => Promise<void>) | undefined
    onTestFinished(async () => { await close?.(); try { await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`) } finally { await pool.end() } }, 120000)
    const f = await coursewareFixture({}, undefined, { connectionString: database, schema }); close = f.close
    const imported = await f.service.import(cwTeacher, importBody())
    const session = await f.service.startLesson(cwTeacher, imported.deck.id, { versionId: imported.deck.activeVersionId, operationId: 'persistent_lesson' })
    const scene = { schemaVersion: 1, primitives: [{ id: 'pressure', type: 'polyline', points: [[5, 8], [10, 20]], samples: [{ x: 5, y: 8, pressure: .11, time: 1 }, { x: 10, y: 20, pressure: .92, time: 2 }] }] }
    const save = { expectedRevision: 0, operationId: 'persistent_ink', scene }
    const outcomes = await Promise.allSettled([f.service.saveAnnotation(cwTeacher, imported.deck.id, session.id, 'document', save), f.service.saveAnnotation(cwTeacher, imported.deck.id, session.id, 'document', { ...save, operationId: 'racing_ink' })])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1)
    const table = qualifiedTable(schema, recordTableName('physicsos_courseware_v1', 'catalog'))
    const rows = await pool.query<{ value: string }>(`SELECT value FROM ${table}`)
    expect(rows.rows).toHaveLength(1)
    const stored = JSON.parse(rows.rows[0]!.value)
    expect(stored.lessons[session.id].activity).toMatchObject({ source: 'courseware-session', operationId: session.id, occurredAt: session.createdAt })
    expect(JSON.stringify(stored)).not.toContain('htmlBase64'); expect(JSON.stringify(stored)).not.toContain('pressure":0.11')
    const original = await f.service.source(cwTeacher, imported.deck.id, imported.deck.activeVersionId)
    await f.restart({ teachingToolsMode: 'bridge' })
    expect(await f.service.source(cwTeacher, imported.deck.id, imported.deck.activeVersionId)).toEqual(original)
    expect((await f.service.readAnnotation(cwTeacher, imported.deck.id, session.id, 'document')).scene).toEqual(scene)
    await expect(f.service.saveAnnotation(cwTeacher, imported.deck.id, session.id, 'document', { ...save, operationId: 'bridge_write', expectedRevision: 1 })).rejects.toMatchObject({ code: 'WRITES_DISABLED' })
    await f.restart({ teachingToolsMode: 'enabled' })
    expect((await f.service.read(cwTeacher, imported.deck.id)).deck.activeVersionId).toBe(imported.deck.activeVersionId)
    expect((await f.service.readLesson(cwTeacher, imported.deck.id, session.id)).id).toBe(session.id)
  }, 120000)
})
