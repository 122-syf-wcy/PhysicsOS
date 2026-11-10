import { describe, expect, it } from 'vitest'
import { loadCanvasFixture, responseJson, CANVAS_FIXTURE_TIMEOUT } from './canvas-fixture.ts'
import type { WhiteboardRecord } from '../src/whiteboard-types.ts'
describe('Loader mounted account whiteboard routes', () => {
  it('persists real authenticated HTTP edits and rejects foreign accounts and cross-origin writes', async () => {
    const f = await loadCanvasFixture()
    const a = await f.register('whiteboard-owner')
    const b = await f.register('whiteboard-other')
    expect((await f.call('GET', '/physicsos/whiteboards')).status).toBe(401)
    const created = await responseJson<WhiteboardRecord>(await f.call('POST', '/physicsos/whiteboards', { title: 'Class board', operationId: 'create-http' }, a))
    const url = `/physicsos/whiteboards/${created.document.id}`
    const scene = { elements: [{ id: 'pen', type: 'freedraw', x: 10, y: 20, points: [[1, 2], [1, 2], [3, 4]], pressures: [0.2, 0.6, 0.9] }], appState: { scrollX: -20 } }
    const payload = { document: { ...created.document, scene }, expectedRevision: 1, operationId: 'save-http' }
    const saved = await responseJson<WhiteboardRecord>(await f.call('PUT', url, payload, a))
    expect(saved.revision).toBe(2)
    expect(await responseJson(await f.call('PUT', url, payload, a))).toEqual(saved)
    expect((await f.call('GET', url, undefined, b)).status).toBe(404)
    expect((await f.call('PUT', url, { ...payload, expectedRevision: 2, operationId: 'cross-site' }, a, { origin: 'https://foreign.invalid' })).status).toBe(403)
    await f.restart()
    const login = await f.login('whiteboard-owner')
    const restored = await responseJson<WhiteboardRecord>(await f.call('GET', url, undefined, login))
    expect(restored.document.scene).toEqual(scene)
    const list = await f.call('GET', '/physicsos/whiteboards', undefined, login)
    expect(list.headers.get('cache-control')).toBe('private, no-store')
    expect(await list.json()).toMatchObject([{ id: created.document.id, title: 'Class board', revision: 2 }])
  }, CANVAS_FIXTURE_TIMEOUT)
})
