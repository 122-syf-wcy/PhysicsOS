import { describe, expect, it } from 'vitest'
import type { CanvasCommitResponse, CanvasOpenResponse, WorkbenchLifecycleCapabilities } from '@physicsos/physics-workbench/protocol'
import type { WhiteboardRecord } from '../src/whiteboard-types.ts'
import { loadCanvasFixture, responseJson, CANVAS_FIXTURE_TIMEOUT } from './canvas-fixture.ts'

const canvases = '/physicsos/learning/canvases'
const boards = '/physicsos/whiteboards'

describe('real authenticated lifecycle routes and capabilities', () => {
  it('mounts the bridge by default, keeps existing Canvas delete/restore and refuses new lifecycle state writes', async test => {
    const f = await loadCanvasFixture({ test })
    const a = await f.register('bridge-lifecycle-owner')
    const canvasCapabilities = await responseJson<WorkbenchLifecycleCapabilities>(await f.call('GET', `${canvases}/capabilities`, undefined, a))
    const boardCapabilities = await responseJson<WorkbenchLifecycleCapabilities>(await f.call('GET', `${boards}/capabilities`, undefined, a))
    expect(canvasCapabilities).toMatchObject({ lifecycleBridge: true, lifecycleWritesEnabled: false, archive: false, delete: true, restore: true })
    expect(boardCapabilities).toMatchObject({ lifecycleBridge: true, lifecycleWritesEnabled: false, archive: false, delete: false, restore: false })
    const canvas = await responseJson<CanvasOpenResponse>(await f.call('POST', canvases, { id: 'bridge-board', title: 'Bridge board', mutationId: 'create' }, a), 201)
    const fence = { expectedVersion: canvas.head.version, expectedGeneration: canvas.head.generation, mutationId: 'archive' }
    expect((await f.call('POST', `${canvases}/bridge-board/archive`, fence, a)).status).toBe(409)
    const deleted = await responseJson<CanvasCommitResponse>(await f.call('DELETE', `${canvases}/bridge-board`, { ...fence, mutationId: 'delete' }, a))
    const restored = await responseJson<CanvasCommitResponse>(await f.call('POST', `${canvases}/bridge-board/restore`, { expectedVersion: deleted.head.version, expectedGeneration: deleted.head.generation, mutationId: 'restore' }, a))
    expect(restored.head).not.toHaveProperty('archivedAt'); expect(restored.head).not.toHaveProperty('deletedAt')
    const board = await responseJson<WhiteboardRecord>(await f.call('POST', boards, { title: 'Teaching board', operationId: 'create-board' }, a))
    const denied = await f.call('DELETE', `${boards}/${board.document.id}`, { expectedRevision: board.revision, expectedGeneration: board.generation, operationId: 'delete-board' }, a)
    expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: 'LIFECYCLE_WRITES_DISABLED' })
    const oldSave = await f.call('PUT', `${boards}/${board.document.id}`, { document: board.document, expectedRevision: board.revision, operationId: 'old-client' }, a)
    expect(oldSave.status).toBe(409); expect(await oldSave.json()).toMatchObject({ code: 'CLIENT_UPGRADE_REQUIRED' })
  }, CANVAS_FIXTURE_TIMEOUT)

  it('exposes account-private archive/delete/restore, retained export reads, and immutable-operation response-loss replay after Loader restart', async test => {
    const f = await loadCanvasFixture({ test, teachingToolsMode: 'enabled' })
    const a = await f.register('enabled-lifecycle-owner'); const b = await f.register('enabled-lifecycle-other')
    const created = await responseJson<WhiteboardRecord>(await f.call('POST', boards, { title: 'Pressure board', operationId: 'create' }, a))
    const url = `${boards}/${created.document.id}`
    const scene = { elements: [{ id: 'pen', type: 'freedraw', points: [[0, 1], [0, 1], [8, 13]], pressures: [.13, .57, .99], customData: { originalSamples: [0, 1, 2] } }], appState: { scrollX: 12 } }
    const saved = await responseJson<WhiteboardRecord>(await f.call('PUT', url, { expectedRevision: created.revision, expectedGeneration: created.generation,
      operationId: 'save', editingSessionId: 'one-editor-session', document: { ...created.document, scene } }, a))
    const archiveRequest = { expectedRevision: saved.revision, expectedGeneration: saved.generation, operationId: 'archive' }
    const archived = await responseJson<WhiteboardRecord>(await f.call('POST', `${url}/archive`, archiveRequest, a))
    expect(archived.archivedAt).toBeTypeOf('string')
    expect((await f.call('POST', `${url}/archive`, archiveRequest, b)).status).toBe(404)
    expect((await f.call('PUT', url, { document: saved.document, expectedRevision: archived.revision, expectedGeneration: archived.generation, operationId: 'must-not-save' }, a)).status).toBe(409)
    const deleted = await responseJson<WhiteboardRecord>(await f.call('DELETE', url, { expectedRevision: archived.revision, expectedGeneration: archived.generation, operationId: 'delete' }, a))
    expect((await f.call('GET', url, undefined, a)).status).toBe(410)
    expect((await f.call('GET', `${url}/retained`, undefined, b)).status).toBe(404)
    const retained = await responseJson<WhiteboardRecord>(await f.call('GET', `${url}/retained`, undefined, a))
    expect(retained.document.scene).toEqual(scene)
    const restoreRequest = { expectedRevision: deleted.revision, expectedGeneration: deleted.generation, operationId: 'restore' }
    const restored = await responseJson<WhiteboardRecord>(await f.call('POST', `${url}/restore`, restoreRequest, a))
    expect(restored.archivedAt).toBe(archived.archivedAt); expect(restored.deletedAt).toBeUndefined()
    await f.restart(); const login = await f.login('enabled-lifecycle-owner')
    expect(await responseJson<WhiteboardRecord>(await f.call('POST', `${url}/restore`, restoreRequest, login))).toEqual(restored)
    expect(await responseJson<WhiteboardRecord>(await f.call('POST', `${url}/archive`, archiveRequest, login))).toEqual(archived)
    const latest = await responseJson<WhiteboardRecord>(await f.call('GET', url, undefined, login))
    expect(latest).toEqual(restored)
    const listed = await responseJson<readonly { readonly id: string; readonly archivedAt?: string }[]>(await f.call('GET', `${boards}?state=archived`, undefined, login))
    expect(listed).toHaveLength(1); expect(listed[0]?.id).toBe(created.document.id)
    expect((await f.call('POST', `${url}/purge`, {}, login)).status).toBe(404)
  }, CANVAS_FIXTURE_TIMEOUT)
})
