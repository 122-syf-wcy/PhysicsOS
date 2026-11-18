import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { VisualMaterialError, type VisualMaterialDescriptor, type VisualMaterialService } from '../src/visual-material-contracts.ts'
import { visualMaterialRoutes, type VisualMaterialRouteIdentity } from '../src/visual-material-routes.ts'

const owner = { userKey: 'owner', schoolId: 'school', username: 'account', role: 'STUDENT' }
const material: VisualMaterialDescriptor = {
  id: `vmat_${'a'.repeat(32)}`, revision: 2, sha256: 'b'.repeat(64), byteLength: 3, mediaType: 'image/png',
  width: 256, height: 256, kind: 'environment', theme: 'lab', purpose: 'appearance', tags: ['wood'], model: 'test',
  lifecycle: 'ready', visibility: 'private', createdAt: 1, updatedAt: 1, metadataTrust: 'untrusted',
}
function serviceOf(): VisualMaterialService {
  return {
    initialize: vi.fn(async () => {}), storeGenerated: vi.fn(async () => material), search: vi.fn(async () => ({ items: [] })),
    list: vi.fn(async () => ({ items: [] })), describe: vi.fn(async () => material),
    select: vi.fn(async () => ({ descriptor: material, bytes: Buffer.from('png'), mediaType: 'image/png' as const })),
    readBytes: vi.fn(async () => ({ descriptor: material, bytes: Buffer.from('png'), mediaType: 'image/png' as const })),
    manage: vi.fn(async () => material), cancelGeneratedOperation: vi.fn(async () => {}),
    quota: vi.fn(async () => ({ account: { bytes: 3, count: 1, operations: 1, activeCount: 0, stageBytes: 0 }, global: { bytes: 3, count: 1, operations: 1, activeCount: 0, stageBytes: 0 } })),
    recoverPending: vi.fn(async () => ({ recovered: 0, pending: 0, issues: [] })),
  }
}
async function request(handler: ReturnType<typeof visualMaterialRoutes>, url: string, method = 'GET', body?: unknown, headers: IncomingMessage['headers'] = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]) as unknown as IncomingMessage
  req.url = url; req.method = method; req.headers = headers
  const res = new EventEmitter() as ServerResponse
  let status = 0, responseHeaders: Record<string, unknown> = {}
  let response: Buffer = Buffer.alloc(0)
  res.writeHead = ((code: number, passedHeaders: Record<string, unknown>) => { status = code; responseHeaders = passedHeaders; return res }) as ServerResponse['writeHead']
  res.end = ((data?: string | Buffer) => { response = Buffer.isBuffer(data) ? data : Buffer.from(data ?? ''); return res }) as ServerResponse['end']
  await handler(req, res)
  return { status, headers: responseHeaders, bytes: response, json: () => JSON.parse(response.toString()) as Record<string, unknown> }
}
const mutationHeaders = { 'content-type': 'application/json', origin: 'https://physics.dongsiwei.com', 'sec-fetch-site': 'same-origin' }

it('requires per-request authentication even for preview bytes and fails closed when identity is unavailable', async () => {
  const service = serviceOf()
  let identity: VisualMaterialRouteIdentity | undefined
  const handler = visualMaterialRoutes({ service, identity: () => identity, origin: 'https://physics.dongsiwei.com' })
  expect((await request(handler, `/physicsos/visual-materials/${material.id}/preview.png`)).status).toBe(503)
  identity = { actorOf: vi.fn(() => null) }
  expect((await request(handler, `/physicsos/visual-materials/${material.id}/preview.png`)).status).toBe(401)
  identity = { actorOf: vi.fn(() => owner) }
  expect((await request(handler, '/physicsos/visual-materials')).status).toBe(200)
  expect((await request(handler, `/physicsos/visual-materials/${material.id}/preview.png`)).status).toBe(200)
  expect(identity.actorOf).toHaveBeenCalledTimes(2)
  expect(service.readBytes).toHaveBeenCalledWith(owner, material.id, undefined, expect.any(AbortSignal))
})

it('fences cross-origin/fetch-metadata/non-JSON mutations before touching management', async () => {
  const service = serviceOf(), handler = visualMaterialRoutes({ service, identity: () => ({ actorOf: () => owner }), origin: 'https://physics.dongsiwei.com' })
  const body = { operationId: 'manage', expectedRevision: 2, visibility: 'school' }
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'PATCH', body, { ...mutationHeaders, origin: 'https://evil.example' })).status).toBe(403)
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'PATCH', body, { ...mutationHeaders, 'sec-fetch-site': 'same-site' })).status).toBe(403)
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'PATCH', body, { ...mutationHeaders, 'content-type': 'text/plain' })).status).toBe(415)
  expect(service.manage).not.toHaveBeenCalled()
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'PATCH', body, mutationHeaders)).status).toBe(200)
  expect(service.manage).toHaveBeenCalledWith(owner, material.id, body, expect.any(AbortSignal))
})

it('serves authenticated previews without public CORS, caching, URLs, prompt or owner provenance', async () => {
  const service = serviceOf(), handler = visualMaterialRoutes({ service, identity: () => ({ actorOf: () => owner }), origin: 'https://physics.dongsiwei.com' })
  const response = await request(handler, `/physicsos/visual-materials/${material.id}/preview.png?sha256=${material.sha256}`)
  expect(response.status).toBe(200)
  expect(response.bytes).toEqual(Buffer.from('png'))
  expect(response.headers).toMatchObject({ 'cache-control': 'private, no-store', 'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' })
  expect(response.headers['access-control-allow-origin']).toBeUndefined()
  expect((await request(handler, `/physicsos/visual-materials/${material.id}/content?sha256=${material.sha256}`)).bytes).toEqual(Buffer.from('png'))
  const quota = await request(handler, '/physicsos/visual-materials/quota')
  expect(quota.status).toBe(200)
  expect(quota.json()).toMatchObject({ account: { bytes: 3, count: 1 }, global: { bytes: 3, count: 1 } })
  expect((await request(handler, `/physicsos/visual-materials/digest/${material.sha256}`)).status).toBe(404)
  expect((await request(handler, `/physicsos/visual-materials/${material.id}/preview.png?url=https://evil.example/a.png`)).status).toBe(400)
})

it('accepts bounded allowlisted filters and refuses account forgery or executable metadata fields', async () => {
  const service = serviceOf(), handler = visualMaterialRoutes({ service, identity: () => ({ actorOf: () => owner }), origin: 'https://physics.dongsiwei.com' })
  expect((await request(handler, '/physicsos/visual-materials?query=%E5%AE%9E%E9%AA%8C%E5%AE%A4&tag=wood&tag=glass&minWidth=256&kind=environment&limit=5')).status).toBe(200)
  expect(service.search).toHaveBeenCalledWith(owner, { query: '实验室', tags: ['wood', 'glass'], minWidth: 256, kind: 'environment', limit: 5 }, expect.any(AbortSignal))
  expect((await request(handler, '/physicsos/visual-materials?ownerKey=other')).status).toBe(400)
  expect((await request(handler, '/physicsos/visual-materials?limit=1&limit=2')).status).toBe(400)
  const forged = { operationId: 'forged', expectedRevision: 2, visibility: 'public', userKey: 'other', prompt: 'private' }
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'PATCH', forged, mutationHeaders)).status).toBe(400)
  expect(service.manage).not.toHaveBeenCalled()
})

it('DELETE/restore are catalog-only revisioned operations and audit never records raw tags/prompts', async () => {
  const service = serviceOf(), record = vi.fn(async () => {}), handler = visualMaterialRoutes({ service, identity: () => ({ actorOf: () => owner, record }), origin: 'https://physics.dongsiwei.com' })
  const input = { operationId: 'delete', expectedRevision: 2 }
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'DELETE', input, mutationHeaders)).status).toBe(200)
  expect(service.manage).toHaveBeenCalledWith(owner, material.id, { ...input, softdelete: true }, expect.any(AbortSignal))
  expect((await request(handler, `/physicsos/visual-materials/${material.id}/restore`, 'POST', { ...input, operationId: 'restore' }, mutationHeaders)).status).toBe(200)
  expect(service.manage).toHaveBeenCalledWith(owner, material.id, { ...input, operationId: 'restore', restore: true }, expect.any(AbortSignal))
  expect(record).toHaveBeenCalledWith(owner, 'visual-material.manage', material.id, { revision: 2, lifecycle: 'ready', visibility: 'private' })
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'DELETE', { ...input, arbitraryPath: '../../x' }, mutationHeaders)).status).toBe(400)
})

it('keeps internal SQL/path/provider failures out of the error envelope and bounds JSON bodies', async () => {
  const service = serviceOf(), handler = visualMaterialRoutes({ service, identity: () => ({ actorOf: () => owner }), origin: 'https://physics.dongsiwei.com' })
  vi.mocked(service.describe).mockRejectedValueOnce(new Error('postgres://secret private path'))
  const failed = await request(handler, `/physicsos/visual-materials/${material.id}`)
  expect(failed.status).toBe(500)
  expect(failed.bytes.toString()).not.toMatch(/postgres|secret|path/)
  vi.mocked(service.describe).mockRejectedValueOnce(new VisualMaterialError(404, 'NOT_FOUND', 'Visual material not found.'))
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`)).status).toBe(404)
  expect((await request(handler, `/physicsos/visual-materials/${material.id}`, 'PATCH', 'x'.repeat(17 * 1024), mutationHeaders)).status).toBe(413)
})
