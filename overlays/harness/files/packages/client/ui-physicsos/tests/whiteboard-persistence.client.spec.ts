// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIndexedDbWhiteboardCache, createWhiteboardHttpApi } from '../src/client/whiteboard/persistence.ts'
import type { WhiteboardDraft } from '../src/client/whiteboard/controller.ts'
afterEach(() => vi.unstubAllGlobals())
describe('durable whiteboard browser transport', () => {
  it('persists complete account-scoped offline outbox across cache instances', async () => {
    const cache = createIndexedDbWhiteboardCache()
    const document = { schemaVersion: 1 as const, id: 'offline-board', title: 'Lesson', scene: { elements: [{ id: 'pen', type: 'freedraw', points: [[0, 1], [2, 3]], pressures: [0.17, 0.99] }], appState: {} }, sourceImages: [], appliedGenerationIds: [] }
    const draft: WhiteboardDraft = { record: { document, revision: 5, updatedAt: 'now' }, dirty: true, pendingSave: { document, expectedRevision: 5, operationId: 'same-receipt' } }
    await cache.write('teacher-a', 'offline-board', draft)
    const restarted = createIndexedDbWhiteboardCache()
    expect(await restarted.read('teacher-b', 'offline-board')).toBeUndefined()
    expect(await restarted.read('teacher-a', 'offline-board')).toEqual(draft)
  })
  it('sends revision and exact idempotency receipt with authenticated save and preserves HTTP conflicts', async () => {
    let captured: { url: string; options: RequestInit } | undefined
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => { captured = { url, options }; return new Response(JSON.stringify({ error: 'Remote version changed' }), { status: 409 }) })
    const api = createWhiteboardHttpApi({ owner: () => ({ schoolId: 'school-a', username: 'teacher-a' }) })
    const document = { schemaVersion: 1 as const, id: 'board 1', title: 'Lesson', scene: { elements: [], appState: {} }, sourceImages: [], appliedGenerationIds: [] }
    await expect(api.save({ id: 'board 1', document, expectedRevision: 5, operationId: 'receipt-1' })).rejects.toMatchObject({ status: 409, message: 'Remote version changed' })
    expect(captured?.url).toBe('/physicsos/whiteboards/board%201')
    expect(captured?.options.credentials).toBe('same-origin')
    expect((captured?.options.headers as Record<string, string>)['x-physicsos-canvas-owner']).toBe(encodeURIComponent(JSON.stringify({ schoolId: 'school-a', username: 'teacher-a' })))
    expect(JSON.parse(String(captured?.options.body))).toEqual({ document, expectedRevision: 5, operationId: 'receipt-1' })
  })
  it('captures the expected upload account before awaiting original image bytes', async () => {
    let owner = { schoolId: 'school-a', username: 'first-teacher' }
    let release!: (bytes: ArrayBuffer) => void
    const bytes = new Promise<ArrayBuffer>(resolve => { release = resolve })
    let header: string | undefined
    vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => { header = (options.headers as Record<string, string>)['x-physicsos-canvas-owner']; return new Response(JSON.stringify({ id: 'original', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 1, height: 1, byteLength: 1, viewBox: { x: 0, y: 0, width: 1, height: 1 } })) })
    const api = createWhiteboardHttpApi({ owner: () => owner })
    const uploading = api.uploadImage({ whiteboardId: 'board', operationId: 'upload', file: { type: 'image/png', arrayBuffer: () => bytes } as Blob })
    owner = { schoolId: 'school-a', username: 'second-teacher' }
    release(new Uint8Array([1]).buffer)
    await uploading
    expect(header).toBe(encodeURIComponent(JSON.stringify({ schoolId: 'school-a', username: 'first-teacher' })))
  })

})
