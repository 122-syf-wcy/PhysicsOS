// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createManifest, parseManifest, parseStoredValue } from '@physicsos/physics-workbench/codec'
import { GRAPH_LIMITS } from '@physicsos/physics-workbench/graph'
import { canonicalStringify, record, unwrap } from '@physicsos/physics-workbench/json'
import type { CanvasHead } from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, CanvasStoredValue } from '@physicsos/physics-workbench/types'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import type { CanvasController, CanvasEnvironment } from '../src/client/canvas/types.ts'

const now = '2026-11-09T00:00:00.000Z'
const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const controllers: CanvasController[] = []
const databases = new Set<string>()
const databaseName = (): string => { const value = `canvas-account-sync-${randomUUID()}`; databases.add(value); return value }
const json = (value: unknown, status = 200): Response => Response.json(value, { status })

/** The HTTP boundary is controlled; both browser connections use the real IndexedDB and synchronizer. */
function server() {
  const documents = new Map<string, { head: CanvasHead; manifest: CanvasManifest; objects: Map<string, CanvasStoredValue> }>()
  let sequence = 0
  const head = async (manifest: CanvasManifest, version: number): Promise<CanvasHead> => ({ id: manifest.id, title: manifest.title,
    version, generation: 1, changeSeq: ++sequence, manifestDigest: await hash(manifest), createdAt: manifest.createdAt, updatedAt: now })
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, 'https://canvas.invalid')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const base = '/physicsos/learning/canvases'
    if (path === `${base}/policy`) return json({ schemaVersion: 1, limits: GRAPH_LIMITS })
    if (path === base && method === 'GET') return json({ items: [...documents.values()].map(value => value.head) })
    if (path === `${base}/changes`) {
      const cursor = Number(url.searchParams.get('cursor') ?? 0)
      const changes = [...documents.values()].filter(value => value.head.changeSeq > cursor).map(value => ({
        seq: value.head.changeSeq, head: value.head, operation: 'commit', mutationId: `remote-${value.head.changeSeq}` }))
      return json({ changes, cursor: sequence, hasMore: false })
    }
    if (path === base && method === 'POST') {
      const request = record(body, '/create')
      const manifest = createManifest({ id: String(request.id), title: String(request.title), now })
      const value = { manifest, head: await head(manifest, 1), objects: new Map<string, CanvasStoredValue>() }
      value.objects.set(value.head.manifestDigest, manifest)
      documents.set(manifest.id, value)
      return json({ head: value.head, manifest, replayed: false }, 201)
    }
    const parts = path.slice(base.length + 1).split('/').map(decodeURIComponent)
    const value = documents.get(parts[0]!)
    if (value === undefined) return json({ error: { code: 'NOT_FOUND', message: 'No private canvas.' } }, 404)
    if (parts.length === 1 && method === 'GET') return json({ head: value.head, manifest: value.manifest })
    if (parts[1] === 'objects') {
      if (method === 'PUT') {
        const object = unwrap(parseStoredValue(body))
        if (await hash(object) !== parts[2]) throw new Error('A client upload changed its digest.')
        value.objects.set(parts[2]!, object)
        return json({ digest: parts[2], kind: 'kind' in object ? object.kind : 'manifest', bytes: Buffer.byteLength(canonicalStringify(object)), existed: false })
      }
      return json(value.objects.get(parts[2]!) ?? { error: { code: 'NOT_FOUND', message: 'No object.' } }, value.objects.has(parts[2]!) ? 200 : 404)
    }
    if (parts[1] === 'commit') {
      const request = record(body, '/commit')
      if (request.expectedVersion !== value.head.version) return json({ error: { code: 'VERSION_CONFLICT', message: 'Changed canvas.', currentHead: value.head } }, 409)
      const manifest = value.objects.get(String(request.manifestDigest))
      if (manifest === undefined || 'kind' in manifest) throw new Error('The manifest was not durably uploaded before commit.')
      value.manifest = unwrap(parseManifest(manifest))
      value.head = await head(value.manifest, value.head.version + 1)
      return json({ head: value.head, manifest: value.manifest, replayed: false })
    }
    return json({ error: { code: 'NOT_FOUND', message: 'No route.' } }, 404)
  }
  return { api: createCanvasApi(fetcher), documents, changeTitle: async (canvas: string, title: string) => {
    const value = documents.get(canvas)
    if (value === undefined) throw new Error('The browser never published this canvas.')
    value.manifest = unwrap(parseManifest({ ...value.manifest, title }))
    value.head = await head(value.manifest, value.head.version + 1)
    value.objects.set(value.head.manifestDigest, value.manifest)
  } }
}

function browser(remote: ReturnType<typeof server>, name = databaseName(), environment: CanvasEnvironment = {}) {
  let identity = 0
  const controller = createCanvasController({ api: remote.api, persistence: createCanvasPersistence({ name, hash }),
    getAccount: () => ({ id: 'A', username: 'A', schoolId: 'school' }),
    createRuntime: async () => { throw new Error('A title-only synchronization must not create a physics engine.') },
    hash, id: prefix => `${prefix}-${name}-${++identity}`, now: () => now, online: () => true,
    window: null, document: null, channel: null, ...environment })
  controllers.push(controller)
  return controller
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  await Promise.all([...databases].map(name => deleteDB(name)))
  databases.clear()
})

describe('restored outbox and remote account changes', () => {
  it('drains an existing offline outbox on an already-online startup without another edit or reconnect event', async () => {
    const remote = server()
    const name = databaseName()
    const offline = browser(remote, name, { online: () => false })
    const canvas = await offline.create('Draft retained before restart')
    await offline.rename(canvas, 'Final offline title')
    await offline.dispose()
    const online = browser(remote, name)
    await online.refreshAccount()
    await waitFor(() => {
      expect(remote.documents.get(canvas)?.manifest.title).toBe('Final offline title')
      expect(online.documentSource(canvas).getSnapshot().status).toBe('saved')
    })
  })

  it('pulls remote changes when an already-visible browser window regains focus', async () => {
    const remote = server()
    const controller = browser(remote, databaseName(), { window, schedule: () => 0, cancel: () => undefined })
    const canvas = await controller.create('Before another device edits')
    await controller.sync(canvas)
    await remote.changeTitle(canvas, 'Changed in another browser')
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(controller.documentSource(canvas).getSnapshot().manifest?.title).toBe('Changed in another browser'))
  })

  it('notifies a sibling tab after consuming shared remote changes without rebroadcasting cache hints forever', async () => {
    const remote = server()
    const name = databaseName()
    let hints = 0
    class CountingChannel extends BroadcastChannel {
      override postMessage(value: unknown): void { hints += 1; super.postMessage(value) }
    }
    const channel = (name: string) => new CountingChannel(name)
    const first = browser(remote, name, { channel })
    const canvas = await first.create('Shared tab baseline')
    await first.sync(canvas)
    const second = browser(remote, name, { channel })
    await second.open(canvas)
    await remote.changeTitle(canvas, 'Remote change consumed by first tab')
    await first.sync(canvas)
    await second.sync(canvas)
    await waitFor(() => expect(second.documentSource(canvas).getSnapshot().manifest?.title).toBe('Remote change consumed by first tab'))
    const settledHints = hints
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(hints).toBe(settledHints)
    expect(hints).toBeLessThan(12)
  })
})
