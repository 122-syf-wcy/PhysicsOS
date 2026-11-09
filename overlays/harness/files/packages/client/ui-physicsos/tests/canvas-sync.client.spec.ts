import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createMagneticScene } from '@physicsos/physics-scene'
import { createManifest, createSceneObject, parseManifest, parseStoredValue } from '@physicsos/physics-workbench/codec'
import { canonicalByteLength, canonicalStringify, freezeData, record, unwrap } from '@physicsos/physics-workbench/json'
import type { CanvasHead, CanvasOpenResponse } from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, CanvasStoredValue } from '@physicsos/physics-workbench/types'
import { CanvasRequestError, createCanvasApi, type CanvasListQuery } from '../src/client/canvas/api.ts'
import { createCanvasPersistence, type CanvasPersistence, type LocalCanvasRecord } from '../src/client/canvas/persistence.ts'
import { assertCanvasReferences, canvasErrorOf, createCanvasSynchronizer, type CanvasSynchronizer } from '../src/client/canvas/sync.ts'
import { WorkspaceCaptureError } from '../src/client/physics/workspace-capture.ts'
import { createCanvasDigest } from '../src/client/canvas/digest.ts'

const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex')
const now = '2026-11-08T10:00:00.000Z'
const namespace = 'A|school'
const owner = { schoolId: 'school', username: 'A' }
const stores: CanvasPersistence[] = []
const databaseNames = new Set<string>()
const synchronizers: CanvasSynchronizer[] = []
let testIdentity = 0
const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
})
interface ServerDocument {
  head: CanvasHead
  manifest: CanvasManifest
  readonly objects: Map<string, CanvasStoredValue>
}
/** Only the HTTP transport is simulated; every uploaded graph uses the actual shared codec and SHA256. */
const transport = () => {
  const documents = new Map<string, ServerDocument>()
  const replay = new Map<string, CanvasOpenResponse & { readonly replayed: boolean }>()
  const requests: { readonly method: string; readonly url: string; readonly body?: unknown; readonly owner?: string }[] = []
  let actualOwner = owner.username
  let sequence = 0
  let hook: ((method: string, path: string, body: unknown) => Promise<Response | undefined>) | undefined
  const headFor = async (manifest: CanvasManifest, version = 1, generation = 1): Promise<CanvasHead> => ({
    id: manifest.id, title: manifest.title, version, generation, changeSeq: ++sequence,
    manifestDigest: await hash(manifest), createdAt: manifest.createdAt, updatedAt: now,
  })
  const insert = async (manifest: CanvasManifest): Promise<ServerDocument> => {
    const head = await headFor(manifest)
    const item = { head, manifest, objects: new Map<string, CanvasStoredValue>([[head.manifestDigest, manifest]]) }
    documents.set(manifest.id, item)
    return item
  }
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(rawUrl, 'https://canvas.invalid')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const headers = new Headers(init?.headers)
    const expectedOwner = headers.get('x-physicsos-canvas-owner') ?? undefined
    requests.push({ method, url: rawUrl, ...(body === undefined ? {} : { body }), ...(expectedOwner === undefined ? {} : { owner: expectedOwner }) })
    if (expectedOwner !== encodeURIComponent(canonicalStringify({ schoolId: owner.schoolId, username: actualOwner }))) {
      return response({ error: { code: 'CANVAS_OWNER_MISMATCH', message: 'Cookie account changed.', retryable: false } }, 401)
    }
    const intercepted = await hook?.(method, path, body)
    if (intercepted !== undefined) return intercepted
    const base = '/physicsos/learning/canvases'
    if (path === base && method === 'GET') return response({ items: [...documents.values()].map(item => item.head) })
    if (path === `${base}/changes`) return response({ changes: [], cursor: sequence, hasMore: false })
    if (path === base && method === 'POST') {
      const request = record(body, '/create')
      const mutationId = String(request.mutationId)
      const existingReplay = replay.get(mutationId)
      if (existingReplay !== undefined) return response({ ...existingReplay, replayed: true })
      const id = String(request.id)
      if (documents.has(id)) return response({ error: { code: 'CONFLICT', message: 'Identity exists.', currentHead: documents.get(id)!.head } }, 409)
      const manifest = createManifest({ id, title: String(request.title), now })
      const document = await insert(manifest)
      const created = { head: document.head, manifest, replayed: false }
      replay.set(mutationId, created)
      return response(created, 201)
    }
    const parts = path.slice(base.length + 1).split('/').map(decodeURIComponent)
    const id = parts[0]!
    const document = documents.get(id)
    if (document === undefined) return response({ error: { code: 'NOT_FOUND', message: 'Missing canvas.', retryable: false } }, 404)
    if (parts.length === 1 && method === 'GET') {
      if (document.head.deletedAt !== undefined) return response({ error: { code: 'DELETED', message: 'Canvas deleted.', currentHead: document.head, retryable: false } }, 410)
      return response({ head: document.head, manifest: document.manifest })
    }
    if (parts[1] === 'objects' && method === 'PUT') {
      const object = unwrap(parseStoredValue(body))
      const digest = parts[2]!
      if (await hash(object) !== digest) return response({ error: { code: 'DIGEST_INVALID', message: 'Wrong hash.', retryable: false } }, 400)
      const existed = document.objects.has(digest)
      document.objects.set(digest, object)
      return response({ digest, kind: 'kind' in object ? object.kind : 'manifest', bytes: canonicalByteLength(object),
        byteLength: canonicalByteLength(object), existed })
    }
    if (parts[1] === 'objects' && method === 'GET') {
      const object = document.objects.get(parts[2]!)
      return object === undefined ? response({ error: { code: 'OBJECT_MISSING', message: 'Missing object.', retryable: false } }, 404) : response(object)
    }
    const request = record(body, '/mutation')
    const mutationId = String(request.mutationId)
    const oldReplay = replay.get(mutationId)
    if (oldReplay !== undefined) return response({ ...oldReplay, replayed: true })
    if (request.expectedVersion !== document.head.version ||
      (request.expectedGeneration !== undefined && request.expectedGeneration !== document.head.generation)) {
      return response({ error: { code: 'CONFLICT', message: 'CAS conflict.', currentHead: document.head, retryable: false } }, 409)
    }
    if (parts[1] === 'commit') {
      if (document.head.deletedAt !== undefined) return response({ error: { code: 'DELETED', message: 'Canvas deleted.', currentHead: document.head } }, 410)
      const manifest = document.objects.get(String(request.manifestDigest))
      if (manifest === undefined || 'kind' in manifest) return response({ error: { code: 'MANIFEST_MISSING', message: 'Manifest missing.', retryable: false } }, 422)
      document.manifest = unwrap(parseManifest(manifest))
      document.head = await headFor(document.manifest, document.head.version + 1, document.head.generation)
    } else if (method === 'DELETE') {
      document.head = { ...await headFor(document.manifest, document.head.version + 1, document.head.generation + 1), deletedAt: now }
    } else if (parts[1] === 'restore') {
      document.head = await headFor(document.manifest, document.head.version + 1, document.head.generation + 1)
    } else return response({ error: { code: 'NOT_FOUND', message: 'Unsupported route.', retryable: false } }, 404)
    const committed = { head: document.head, manifest: document.manifest, replayed: false }
    replay.set(mutationId, committed)
    return response(committed)
  }
  return {
    api: createCanvasApi(fetcher).forOwner(owner), documents, requests, insert,
    setHook: (intercept: typeof hook) => { hook = intercept },
    switchCookie: (username: string) => { actualOwner = username },
  }
}
const fixture = async (server = transport(), initial?: LocalCanvasRecord) => {
  const identity = ++testIdentity
  let mutation = 0
  let current = true
  const name = `physicsos-canvas-sync-${randomUUID()}`
  databaseNames.add(name)
  const persistence = createCanvasPersistence({ name, hash }); stores.push(persistence)
  const sync = createCanvasSynchronizer({ namespace, api: server.api, persistence, hash,
    id: prefix => `${prefix}-${identity}-${++mutation}`, now: () => now, online: () => true,
    isCurrent: () => current, onRecord: () => undefined })
  synchronizers.push(sync)
  if (initial !== undefined) await persistence.save(initial)
  return { ...server, persistence, sync, switchScope: () => { current = false } }
}
const draft = (title = 'Local draft'): LocalCanvasRecord => ({
  namespace, id: 'document', cacheVersion: 0, editSequence: 1, acknowledgedSequence: 0,
  working: createManifest({ id: 'document', title, now: '2026-11-08T09:00:00.000Z' }), deleted: false, savedAt: now,
})
const settled = async (server: ReturnType<typeof transport>, manifest = createManifest({ id: 'document', title: 'Base', now })): Promise<LocalCanvasRecord> => {
  const remote = await server.insert(manifest)
  return { ...draft(), working: manifest, base: manifest, head: remote.head, editSequence: 0, acknowledgedSequence: 0 }
}
const write = async (persistence: CanvasPersistence, change: (record: LocalCanvasRecord) => LocalCanvasRecord) => {
  const current = (await persistence.read(namespace, 'document'))!
  return persistence.save(change(current), {}, current.cacheVersion)
}

afterEach(async () => {
  await Promise.all(synchronizers.splice(0).map(sync => sync.dispose()))
  await Promise.all(stores.splice(0).map(store => store.close()))
  await Promise.all([...databaseNames].map(name => deleteDB(name)))
  databaseNames.clear()
})

describe('canvas sealed offline queue', () => {
  it('creates the server empty head before uploading the full local graph and committing CAS', async () => {
    const server = transport()
    const { persistence, sync, requests } = await fixture(server, draft())
    const scene = createSceneObject(createMagneticScene())
    const digest = await hash(scene)
    const current = (await persistence.read(namespace, 'document'))!
    const working = unwrap(parseManifest({ ...current.working,
      instances: [{ instanceId: 'instance', currentScene: { kind: 'scene', digest }, originScene: { kind: 'scene', digest },
        source: { kind: 'template' }, domain: 'magnetic', buildMode: 'inspect', clock: { time: 0, total: 0, running: false, rate: 1 }, instanceEditRevision: 0 }],
      nodes: [{ id: 'node', kind: 'experiment', instanceId: 'instance', layout: { x: 0, y: 0, width: 620, height: 440, zIndex: 1 } }],
    }))
    await persistence.save({ ...current, working, editSequence: 2 }, { [digest]: scene })
    await sync.sync('document')
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.body).toMatchObject({ id: 'document', title: 'Local draft' })
    expect(requests[0]!.body).not.toHaveProperty('manifestDigest')
    const objectUpload = requests.findIndex(request => request.method === 'PUT')
    const commit = requests.findIndex(request => request.url.endsWith('/commit'))
    expect(objectUpload).toBeGreaterThan(0)
    expect(commit).toBeGreaterThan(objectUpload)
    const saved = (await persistence.read(namespace, 'document'))!
    expect(saved.pending).toBeUndefined()
    expect(saved.acknowledgedSequence).toBe(saved.editSequence)
    expect(saved.working.instances).toHaveLength(1)
    expect(saved.working.createdAt).toBe(now)
    expect(saved.base).toEqual(saved.working)
    expect(server.documents.get('document')!.manifest.instances).toHaveLength(1)
    expect(requests.every(request => request.owner === encodeURIComponent(canonicalStringify(owner)))).toBe(true)
  })

  it('keeps mutation id, request body and digest unchanged after network failure and retries idempotently', async () => {
    const server = transport()
    const base = await settled(server)
    const { persistence, sync } = await fixture(server, { ...base, working: { ...base.working, title: 'Local edited' }, editSequence: 1 })
    let failed = false
    server.setHook(async (_method, path) => {
      if (path.endsWith('/commit') && !failed) { failed = true; throw new Error('Network disappeared') }
      return undefined
    })
    await sync.sync('document')
    const pending = (await persistence.read(namespace, 'document'))!.pending!
    expect(pending.kind).toBe('commit')
    await write(persistence, current => ({ ...current, working: { ...current.working, title: 'Edited again while offline' }, editSequence: current.editSequence + 1 }))
    await sync.sync('document', true)
    const commits = server.requests.filter(request => request.url.endsWith('/commit'))
    expect(commits.length).toBeGreaterThanOrEqual(3)
    expect(commits[0]!.body).toEqual(commits[1]!.body)
    const firstBody = record(commits[0]!.body, '/request')
    expect(firstBody.mutationId).toBe(pending.request.mutationId)
    expect(canonicalStringify(commits[1]!.body)).toBe(pending.body)
    const final = (await persistence.read(namespace, 'document'))!
    expect(final.pending).toBeUndefined()
    expect(final.working.title).toBe('Edited again while offline')
    expect(final.base).toEqual(final.working)
    expect(server.documents.get('document')!.head.version).toBe(3)
  })

  it('a late acknowledgement covers only the sealed sequence and cannot overwrite a newer working edit', async () => {
    const server = transport()
    const base = await settled(server)
    const { persistence, sync } = await fixture(server, { ...base, working: { ...base.working, title: 'Sealed first' }, editSequence: 1 })
    const waiting = deferred<void>()
    const release = deferred<void>()
    let intercepted = false
    server.setHook(async (_method, path) => {
      if (path.endsWith('/commit') && !intercepted) { intercepted = true; waiting.resolve(); await release.promise }
      return undefined
    })
    const sending = sync.sync('document')
    await waiting.promise
    const sealed = (await persistence.read(namespace, 'document'))!.pending!
    const saved = await write(persistence, current => ({ ...current,
      working: { ...current.working, title: 'New edit during request' }, editSequence: current.editSequence + 1 }))
    expect(saved.pending).toEqual(sealed)
    release.resolve()
    await sending
    const final = (await persistence.read(namespace, 'document'))!
    expect(final.working.title).toBe('New edit during request')
    expect(final.acknowledgedSequence).toBe(2)
    expect(final.base).toEqual(final.working)
    expect(server.documents.get('document')!.manifest.title).toBe('New edit during request')
  })

  it('two synchronizers racing the same cache use IDB CAS and server replay instead of duplicating mutations', async () => {
    const server = transport()
    const first = await fixture(server, draft())
    let identity = 0
    const second = createCanvasSynchronizer({ namespace, api: server.api, persistence: first.persistence, hash,
      id: prefix => `${prefix}-other-tab-${++identity}`, now: () => now, online: () => true, isCurrent: () => true, onRecord: () => undefined })
    synchronizers.push(second)
    await Promise.all([first.sync.sync('document'), second.sync('document')])
    const final = (await first.persistence.read(namespace, 'document'))!
    expect(final.pending).toBeUndefined()
    expect(final.base).toEqual(final.working)
    expect(server.documents.size).toBe(1)
    expect(server.documents.get('document')!.head.version).toBe(1)
    const creates = server.requests.filter(request => request.method === 'POST' && request.url === '/physicsos/learning/canvases')
    expect(new Set(creates.map(request => record(request.body, '/create').mutationId)).size).toBe(1)
  })
})

describe('canvas server conflict and actor fences', () => {
  it('merges nonoverlapping node edits and persists conflicting same-field base/local/remote copies', async () => {
    const server = transport()
    const manifest = unwrap(parseManifest({ ...createManifest({ id: 'document', title: 'Base', now }),
      nodes: [{ id: 'note', kind: 'note', body: 'Base note', format: 'markdown', layout: { x: 0, y: 0, width: 300, height: 200, zIndex: 1 } }] }))
    const base = await settled(server, manifest)
    const local = unwrap(parseManifest({ ...manifest, nodes: manifest.nodes.map(node => ({ ...node, layout: { ...node.layout, x: 80 } })) }))
    const remote = unwrap(parseManifest({ ...manifest, nodes: manifest.nodes.map(node => node.kind === 'note' ? { ...node, body: 'Remote note' } : node) }))
    const remoteDocument = server.documents.get('document')!
    remoteDocument.manifest = remote
    remoteDocument.head = { ...remoteDocument.head, version: 2, changeSeq: 2, manifestDigest: await hash(remote) }
    remoteDocument.objects.set(remoteDocument.head.manifestDigest, remote)
    const { sync, persistence } = await fixture(server, { ...base, working: local, editSequence: 1 })
    await sync.sync('document')
    const merged = (await persistence.read(namespace, 'document'))!
    expect(merged.conflict).toBeUndefined()
    expect(merged.working.nodes[0]).toMatchObject({ body: 'Remote note', layout: { x: 80 } })
    expect(merged.base).toEqual(merged.working)
    const nextLocal = unwrap(parseManifest({ ...merged.working, title: 'Local title' }))
    const nextRemote = unwrap(parseManifest({ ...merged.working, title: 'Remote title' }))
    await persistence.save({ ...merged, working: nextLocal, editSequence: merged.editSequence + 1 })
    remoteDocument.manifest = nextRemote
    remoteDocument.head = { ...remoteDocument.head, title: nextRemote.title, version: remoteDocument.head.version + 1,
      changeSeq: remoteDocument.head.changeSeq + 1, manifestDigest: await hash(nextRemote) }
    remoteDocument.objects.set(remoteDocument.head.manifestDigest, nextRemote)
    await sync.sync('document')
    const conflicted = (await persistence.read(namespace, 'document'))!
    expect(conflicted.working.title).toBe('Local title')
    expect(conflicted.conflict?.base.title).toBe(merged.working.title)
    expect(conflicted.conflict?.local.title).toBe('Local title')
    expect(conflicted.conflict?.remote.manifest.title).toBe('Remote title')
    expect(conflicted.conflict?.conflicts.some(conflict => conflict.path === '/title')).toBe(true)
  })

  it('does not send the A outbox under a changed B cookie and stops on 401 while retaining the draft', async () => {
    const server = transport()
    const { sync, persistence } = await fixture(server, draft('A private draft'))
    server.switchCookie('B')
    await sync.sync('document')
    const saved = (await persistence.read(namespace, 'document'))!
    expect(saved.working.title).toBe('A private draft')
    expect(saved.error?.status).toBe(401)
    expect(saved.pending).toBeDefined()
    expect(server.documents.size).toBe(0)
    const count = server.requests.length
    await sync.sync('document', true)
    expect(server.requests).toHaveLength(count)
    expect(await persistence.list('B|school')).toHaveLength(0)
  })

  it('fences a late response after account switch and does not publish it into either account cache', async () => {
    const server = transport()
    const { sync, persistence, switchScope } = await fixture(server, draft())
    const waiting = deferred<void>()
    const release = deferred<void>()
    server.setHook(async (method, path) => {
      if (method === 'POST' && path === '/physicsos/learning/canvases') { waiting.resolve(); await release.promise }
      return undefined
    })
    const sending = sync.sync('document')
    await waiting.promise
    switchScope()
    release.resolve()
    await sending
    const local = (await persistence.read(namespace, 'document'))!
    expect(local.head).toBeUndefined()
    expect(local.pending?.kind).toBe('create')
    expect(local.error?.status).toBe(401)
    expect(await persistence.list('B|school')).toHaveLength(0)
  })

  it('resumes the same sealed draft only after a new authenticated scope explicitly retries it', async () => {
    const server = transport()
    const { sync, persistence } = await fixture(server, draft('Retained A draft'))
    server.switchCookie('B')
    await sync.sync('document')
    const rejected = (await persistence.read(namespace, 'document'))!
    const sealed = rejected.pending
    expect(rejected.error?.status).toBe(401)
    expect(sealed).toBeDefined()
    server.switchCookie('A')
    const beforeResume = server.requests.length
    await sync.sync('document', true)
    expect(server.requests).toHaveLength(beforeResume)
    await sync.dispose()
    const resumed = createCanvasSynchronizer({ namespace, api: server.api, persistence, hash,
      id: prefix => `${prefix}-resumed-${++testIdentity}`, now: () => now, online: () => true,
      isCurrent: () => true, onRecord: () => undefined })
    synchronizers.push(resumed)
    await resumed.sync('document')
    expect(server.documents.size).toBe(0)
    await resumed.sync('document', true)
    expect(server.documents.get('document')?.manifest.title).toBe('Retained A draft')
    const acknowledged = (await persistence.read(namespace, 'document'))!
    expect(acknowledged.pending).toBeUndefined()
    expect(acknowledged.error).toBeUndefined()
    expect(server.requests.filter(item => item.method === 'POST' && item.url === '/physicsos/learning/canvases')
      .map(item => item.body)).toEqual([sealed!.request, sealed!.request])
  })

  it('does not clear a quota rejection when a newly authenticated scope explicitly retries', async () => {
    const server = transport()
    const base = await settled(server)
    const { sync, persistence } = await fixture(server, { ...base, working: { ...base.working, title: 'Over quota' }, editSequence: 1 })
    server.setHook(async (_method, path) => path.endsWith('/commit')
      ? response({ error: { code: 'DOCUMENT_QUOTA', message: 'Complete document exceeds quota.' } }, 413) : undefined)
    await sync.sync('document')
    const rejected = (await persistence.read(namespace, 'document'))!
    await sync.dispose()
    const resumed = createCanvasSynchronizer({ namespace, api: server.api, persistence, hash,
      id: prefix => `${prefix}-quota-${++testIdentity}`, now: () => now, online: () => true,
      isCurrent: () => true, onRecord: () => undefined })
    synchronizers.push(resumed)
    const requests = server.requests.length
    await resumed.sync('document', true)
    expect(server.requests).toHaveLength(requests)
    expect((await persistence.read(namespace, 'document'))!.pending).toEqual(rejected.pending)
    expect((await persistence.read(namespace, 'document'))!.error?.status).toBe(413)
  })

  it('retains 413 sealed payloads but never blindly retries rejected schemas or quotas', async () => {
    const server = transport()
    const base = await settled(server)
    const { sync, persistence } = await fixture(server, { ...base, working: { ...base.working, title: 'Too large' }, editSequence: 1 })
    server.setHook(async (_method, path) => path.endsWith('/commit')
      ? response({ error: { code: 'QUOTA_EXCEEDED', message: 'Canvas exceeds quota.', retryable: true } }, 413) : undefined)
    await sync.sync('document')
    const local = (await persistence.read(namespace, 'document'))!
    expect(local.error).toMatchObject({ status: 413, retryable: false })
    expect(local.pending).toBeDefined()
    const count = server.requests.length
    await sync.sync('document', true)
    expect(server.requests).toHaveLength(count)
    expect((await persistence.read(namespace, 'document'))!.pending).toEqual(local.pending)
  })

  it('loads the authorized retained manifest for remote tombstones and restores with generation CAS', async () => {
    const server = transport()
    const base = await settled(server)
    const remote = server.documents.get('document')!
    remote.head = { ...remote.head, version: 2, generation: 2, changeSeq: 2, deletedAt: now }
    const { sync, persistence } = await fixture(server, base)
    await sync.refresh('document')
    const deleted = (await persistence.read(namespace, 'document'))!
    expect(deleted.deleted).toBe(true)
    expect(deleted.working).toEqual(base.working)
    await persistence.save({ ...deleted, deleted: false, editSequence: deleted.editSequence + 1 })
    await sync.sync('document')
    const restored = (await persistence.read(namespace, 'document'))!
    expect(restored.deleted).toBe(false)
    expect(restored.head?.generation).toBe(3)
    expect(restored.head?.deletedAt).toBeUndefined()
    expect(server.requests.some(request => request.url.endsWith(`/objects/${remote.head.manifestDigest}`))).toBe(true)
  })
})

describe('canvas immutable hot paths', () => {
  it('memoizes only recursively immutable canonical data and never caches a mutable child', async () => {
    let calls = 0
    const hashing = createCanvasDigest(async value => { calls += 1; return hash(value) })
    const immutable = freezeData({ values: [{ time: 1, value: 2 }] })
    expect(await hashing.digest(immutable)).toBe(await hashing.digest(immutable))
    expect(calls).toBe(1)
    const values = [{ time: 1, value: 2 }]
    const shallowFrozen = Object.freeze({ values })
    const before = await hashing.digest(shallowFrozen)
    values[0]!.value = 3
    expect(await hashing.digest(shallowFrozen)).not.toBe(before)
    expect(calls).toBe(3)
    expect(hashing.stringify(immutable)).toBe(canonicalStringify(immutable))
    await expect(hashing.digest(Object.freeze({ callback: () => undefined }))).rejects.toThrow()
    let reads = 0
    const accessor = Object.freeze(Object.defineProperty({}, 'value', { enumerable: true, get: () => { reads += 1; return 2 } }))
    await expect(hashing.digest(accessor)).rejects.toThrow()
    expect(reads).toBe(0)
  })

  it('checks a hot manifest reference without cloning valid objects and rejects a missing dependency', async () => {
    const scene = createSceneObject(createMagneticScene())
    const digest = await hash(scene)
    const manifest = unwrap(parseManifest({ ...createManifest({ id: 'references', title: 'Refs', now }),
      instances: [{ instanceId: 'first', currentScene: { kind: 'scene', digest }, originScene: { kind: 'scene', digest },
        source: { kind: 'template' }, domain: 'magnetic', buildMode: 'inspect', clock: { time: 0, total: 0, running: false, rate: 1 }, instanceEditRevision: 0 }],
      nodes: [{ id: 'node', kind: 'experiment', instanceId: 'first', layout: { x: 0, y: 0, width: 620, height: 440, zIndex: 1 } }],
    }))
    expect(assertCanvasReferences(manifest, { [digest]: scene }).objects[digest]).toBe(scene)
    expect(() => assertCanvasReferences(manifest, {})).toThrow('missing')
    const second = unwrap(parseManifest({ ...manifest, instances: [...manifest.instances, { ...manifest.instances[0]!, instanceId: 'second' }] }))
    expect(() => assertCanvasReferences(second, { [digest]: scene })).toThrow('share')
  })
})

describe('canvas runtime diagnostics', () => {
  it('preserves actual capture and corrupt-history diagnostics without classifying them as retryable network failures', () => {
    expect(canvasErrorOf(new WorkspaceCaptureError('CAPTURE_UNAVAILABLE', 'Complete the gesture before capturing.'))).toEqual({
      code: 'CAPTURE_UNAVAILABLE', message: 'Complete the gesture before capturing.', retryable: false,
    })
    expect(canvasErrorOf(new WorkspaceCaptureError('CAPTURE_REVISION_MISMATCH', 'The held result belongs to another revision.'))).toEqual({
      code: 'CAPTURE_REVISION_MISMATCH', message: 'The held result belongs to another revision.', retryable: false,
    })
    expect(canvasErrorOf(new TypeError('WORKBENCH_STATE_INVALID: malformed persisted history.'))).toMatchObject({
      code: 'WORKBENCH_STATE_INVALID', retryable: false,
    })
    expect(canvasErrorOf(new Error('Network disappeared'))).toMatchObject({ code: 'CANVAS_NETWORK_FAILED', retryable: true })
  })
})

describe('canvas HTTP boundary', () => {
  it('preserves server status and owner identity even for JSON error responses and URL-encoded IDs', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const api = createCanvasApi(async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
      return response({ error: { code: 'CONFLICT', message: 'Concurrent write.', retryable: false } }, 409)
    }).forOwner({ schoolId: 'school / 范围', username: 'user A' })
    await expect(api.open('document/a')).rejects.toMatchObject({ status: 409, code: 'CONFLICT', retryable: false })
    expect(calls[0]!.url).toBe('/physicsos/learning/canvases/document%2Fa')
    expect(new Headers(calls[0]!.init?.headers).get('x-physicsos-canvas-owner')).toBe(encodeURIComponent(canonicalStringify({ schoolId: 'school / 范围', username: 'user A' })))
    const unowned = createCanvasApi(async () => { throw new Error('Must not send without an owner.') })
    await expect(unowned.list()).rejects.toBeInstanceOf(CanvasRequestError)
  })

  it('rejects malformed protocol values rather than accepting unknown casts or fake verification blobs', async () => {
    const api = createCanvasApi(async () => response({ receipt: { status: 'verified' }, resultDigest: 'fake' })).forOwner(owner)
    await expect(api.verify('document', { captureDigest: await hash({ capture: true }), mutationId: 'verification' })).rejects.toMatchObject({ status: 502, code: 'RESPONSE_INVALID', retryable: false })
    const malformed = createCanvasApi(async () => response({ items: [{ version: '1' }] })).forOwner(owner)
    await expect(malformed.list({ sort: 'updated' } satisfies CanvasListQuery)).rejects.toMatchObject({ status: 502, code: 'RESPONSE_INVALID' })
  })
})
