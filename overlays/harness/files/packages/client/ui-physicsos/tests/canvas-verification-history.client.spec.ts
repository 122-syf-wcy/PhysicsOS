import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { createManifest, parseManifest, parseStoredValue } from '@physicsos/physics-workbench/codec'
import { GRAPH_LIMITS } from '@physicsos/physics-workbench/graph'
import { canonicalStringify, record, unwrap } from '@physicsos/physics-workbench/json'
import type { CanvasHead } from '@physicsos/physics-workbench/protocol'
import type { CanvasManifest, CanvasStoredValue } from '@physicsos/physics-workbench/types'
import { createCanvasApi, type CanvasVerificationResponse } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence, type CanvasPersistence } from '../src/client/canvas/persistence.ts'
import type { CanvasController } from '../src/client/canvas/types.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

const now = '2026-11-09T00:00:00.000Z'
const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const controllers: CanvasController[] = []
const browserStores = new WeakMap<CanvasController, CanvasPersistence>()
const databases = new Set<string>()
const json = (value: unknown, status = 200): Response => Response.json(value, { status })

/** Only the HTTP server is replaced; persistence, object validation and independent physics owners are real. */
function server() {
  const documents = new Map<string, { manifest: CanvasManifest; head: CanvasHead; objects: Map<string, CanvasStoredValue> }>()
  const receipts = new Map<string, CanvasVerificationResponse>()
  const mutations = new Map<string, CanvasVerificationResponse>()
  let sequence = 0
  let nextStatus: CanvasVerificationResponse['receipt']['status'] = 'rejected'
  let loseVerificationResponse = false
  const head = async (manifest: CanvasManifest, version: number): Promise<CanvasHead> => ({ id: manifest.id,
    title: manifest.title, version, generation: 1, changeSeq: ++sequence, manifestDigest: await hash(manifest),
    createdAt: manifest.createdAt, updatedAt: now })
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(raw, 'https://canvas.invalid').pathname
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const base = '/physicsos/learning/canvases'
    if (path === `${base}/policy`) return json({ schemaVersion: 1, limits: GRAPH_LIMITS })
    if (path === base && method === 'GET') return json({ items: [...documents.values()].map(item => item.head) })
    if (path === `${base}/changes`) return json({ changes: [], cursor: sequence, hasMore: false })
    if (path === base && method === 'POST') {
      const request = record(body, '/create')
      const manifest = createManifest({ id: String(request.id), title: String(request.title), now })
      const value = { manifest, head: await head(manifest, 1), objects: new Map<string, CanvasStoredValue>() }
      value.objects.set(value.head.manifestDigest, manifest)
      documents.set(manifest.id, value)
      return json({ head: value.head, manifest, replayed: false }, 201)
    }
    const parts = path.slice(base.length + 1).split('/').map(decodeURIComponent)
    const canvas = parts[0]!
    const value = documents.get(canvas)
    if (value === undefined) return json({ error: { code: 'NOT_FOUND', message: 'No private canvas.' } }, 404)
    if (parts.length === 1 && method === 'GET') return json({ head: value.head, manifest: value.manifest })
    if (parts[1] === 'objects') {
      if (method === 'PUT') {
        const object = unwrap(parseStoredValue(body))
        if (await hash(object) !== parts[2]) return json({ error: { code: 'BAD_DIGEST', message: 'Digest mismatch.' } }, 400)
        value.objects.set(parts[2]!, object)
        return json({ digest: parts[2], kind: 'kind' in object ? object.kind : 'manifest', bytes: Buffer.byteLength(canonicalStringify(object)), existed: false })
      }
      return json(value.objects.get(parts[2]!) ?? { error: { code: 'NOT_FOUND', message: 'No immutable object.' } }, value.objects.has(parts[2]!) ? 200 : 404)
    }
    if (parts[1] === 'commit') {
      const request = record(body, '/commit')
      const manifest = value.objects.get(String(request.manifestDigest))
      if (request.expectedVersion !== value.head.version) return json({ error: { code: 'VERSION_CONFLICT', message: 'Changed canvas.', currentHead: value.head } }, 409)
      if (manifest === undefined || 'kind' in manifest) throw new Error('The real client did not publish its manifest closure.')
      value.manifest = unwrap(parseManifest(manifest))
      value.head = await head(value.manifest, value.head.version + 1)
      return json({ head: value.head, manifest: value.manifest, replayed: false })
    }
    if (parts.length === 2 && parts[1] === 'verifications' && method === 'GET') {
      const url = new URL(raw, 'https://canvas.invalid')
      const captureDigest = url.searchParams.get('captureDigest')
      const items = [...receipts.values()].filter(item => item.receipt.canvasId === canvas && item.receipt.captureDigest === captureDigest)
      const start = Number(url.searchParams.get('cursor') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 2)
      return json({ items: items.slice(start, start + limit), ...(start + limit < items.length ? { nextCursor: String(start + limit) } : {}) })
    }
    if (parts[1] === 'verifications' && method === 'GET') {
      const receipt = receipts.get(parts[2]!)
      return json(receipt ?? { error: { code: 'NOT_FOUND', message: 'No authorized receipt.' } }, receipt === undefined ? 404 : 200)
    }
    if (parts[1] === 'verify') {
      const request = record(body, '/verify')
      const mutation = String(request.mutationId)
      let response = mutations.get(mutation)
      if (response === undefined) {
        const snapshot = value.objects.get(String(request.captureDigest))
        if (snapshot === undefined || !('kind' in snapshot) || snapshot.kind !== 'snapshot') throw new Error('The captured result was not really published.')
        response = { receipt: { id: `receipt-${receipts.size + 1}`, canvasId: canvas, captureDigest: String(request.captureDigest),
          sceneDigest: snapshot.scene.digest, checkedAt: now, status: nextStatus,
          engineId: snapshot.engine.id, engineVersion: snapshot.engine.version, details: { reason: 'Server replay outcome retained by the HTTP boundary.' } } }
        mutations.set(mutation, response)
        receipts.set(response.receipt.id, response)
      }
      if (loseVerificationResponse) { loseVerificationResponse = false; throw new TypeError('Network response lost after durable receipt commit.') }
      return json(response)
    }
    return json({ error: { code: 'NOT_FOUND', message: 'No route.' } }, 404)
  }
  return { api: createCanvasApi(fetcher), receipts, documents,
    status: (value: typeof nextStatus) => { nextStatus = value }, loseResponse: () => { loseVerificationResponse = true } }
}

function browser(remote: ReturnType<typeof server>, name = `canvas-history-${randomUUID()}`) {
  let identity = 0
  databases.add(name)
  const persistence = createCanvasPersistence({ name, hash })
  const controller = createCanvasController({ api: remote.api, persistence,
    getAccount: () => ({ id: 'A', username: 'A', schoolId: 'school' }),
    createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
    hash, id: prefix => `${prefix}-${name}-${++identity}`, now: () => now, online: () => true,
    schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null })
  controllers.push(controller)
  browserStores.set(controller, persistence)
  return controller
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.dispose()))
  await Promise.all([...databases].map(name => deleteDB(name)))
  databases.clear()
})

// Each journey transfers and verifies complete graphs in multiple browser stores.
const ACCOUNT_JOURNEY_TIMEOUT_MS = 60_000

describe('persisted authoritative server replay history', () => {
  it('restores every rejected and unsupported receipt in a different browser without changing the frozen capture', async () => {
    const remote = server()
    const first = browser(remote)
    const canvas = await first.create('Persisted server replay history')
    const instance = await first.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 2, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
    const captured = await first.capture(canvas, instance)
    const frozen = canonicalStringify(first.documentSource(canvas).getSnapshot().objects[captured.alias.snapshot.digest])
    const rejected = await first.verifySnapshot(canvas, captured.alias.id)
    remote.status('unsupported')
    const unsupported = await first.verifySnapshot(canvas, captured.alias.id)
    await first.sync(canvas)
    const second = browser(remote)
    await second.open(canvas)
    const history = await second.verificationHistory?.(canvas, captured.alias.id) ?? []
    expect(history.map(item => item.receipt.id)).toEqual([rejected.receipt.id, unsupported.receipt.id])
    expect(history.map(item => item.receipt.status)).toEqual(['rejected', 'unsupported'])
    expect(canonicalStringify(second.documentSource(canvas).getSnapshot().objects[captured.alias.snapshot.digest])).toBe(frozen)
  }, ACCOUNT_JOURNEY_TIMEOUT_MS)

  it('replays the pending verification mutation after a lost response instead of orphaning a duplicate receipt', async () => {
    const remote = server()
    const controller = browser(remote)
    const canvas = await controller.create('Lost verification response')
    const instance = await controller.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 1, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
    const captured = await controller.capture(canvas, instance)
    remote.loseResponse()
    await expect(controller.verifySnapshot(canvas, captured.alias.id)).rejects.toThrow(/Network response lost/)
    const replay = await controller.verifySnapshot(canvas, captured.alias.id)
    expect(remote.receipts.size).toBe(1)
    const history = await controller.verificationHistory?.(canvas, captured.alias.id) ?? []
    expect(history.map(item => item.receipt.id)).toEqual([replay.receipt.id])
  }, ACCOUNT_JOURNEY_TIMEOUT_MS)

  it('discovers a server-accepted lost response in a completely fresh browser without retrying the old mutation', async () => {
    const remote = server()
    const first = browser(remote)
    const canvas = await first.create('Browser never receives the accepted receipt')
    const instance = await first.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 1, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
    const captured = await first.capture(canvas, instance)
    remote.loseResponse()
    await expect(first.verifySnapshot(canvas, captured.alias.id)).rejects.toThrow(/Network response lost/)
    await first.dispose()
    const fresh = browser(remote)
    await fresh.open(canvas)
    const history = await fresh.verificationHistory(canvas, captured.alias.id)
    expect(history.map(item => item.receipt.id)).toEqual(['receipt-1'])
    expect(history[0]?.receipt.status).toBe('rejected')
    expect(remote.receipts.size).toBe(1)
  }, ACCOUNT_JOURNEY_TIMEOUT_MS)

  it('discovers all unreferenced server receipts across every backend page', async () => {
    const remote = server()
    const first = browser(remote)
    const canvas = await first.create('Complete paginated receipt archive')
    const instance = await first.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 2, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
    const captured = await first.capture(canvas, instance)
    await first.sync(canvas)
    const accepted = remote.api.forOwner({ schoolId: 'school', username: 'A' })
    for (let index = 0; index < 5; index += 1) await accepted.verify(canvas, {
      captureDigest: captured.alias.snapshot.digest, mutationId: `unreceived-attempt-${index}` })
    await first.dispose()
    const fresh = browser(remote)
    await fresh.open(canvas)
    const history = await fresh.verificationHistory(canvas, captured.alias.id)
    expect(history.map(item => item.receipt.id)).toEqual(['receipt-1', 'receipt-2', 'receipt-3', 'receipt-4', 'receipt-5'])
    expect(remote.receipts.size).toBe(5)
  }, ACCOUNT_JOURNEY_TIMEOUT_MS)

  it('merges independent replay receipts from two browsers instead of requiring one history to be discarded', async () => {
    const remote = server()
    const first = browser(remote)
    const canvas = await first.create('Concurrent replay history')
    const instance = await first.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 2, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
    const captured = await first.capture(canvas, instance)
    await first.sync(canvas)
    const second = browser(remote)
    await second.open(canvas)
    const receipts = await Promise.all([first.verifySnapshot(canvas, captured.alias.id), second.verifySnapshot(canvas, captured.alias.id)])
    await first.sync(canvas)
    await second.sync(canvas)
    expect(second.documentSource(canvas).getSnapshot().conflicts).toHaveLength(0)
    const third = browser(remote)
    await third.open(canvas)
    const history = await third.verificationHistory(canvas, captured.alias.id)
    expect(history.map(item => item.receipt.id).sort()).toEqual(receipts.map(item => item.receipt.id).sort())
    expect(remote.receipts.size).toBe(2)
  }, ACCOUNT_JOURNEY_TIMEOUT_MS)

  it('keeps a legacy cached receipt discoverable after the next replay and sync to another browser', async () => {
    const remote = server()
    const name = `canvas-history-legacy-${randomUUID()}`
    const first = browser(remote, name)
    const canvas = await first.create('Legacy rejection history')
    const instance = await first.addExperiment(canvas, { scene: createMechanicsScene({ model: 'uniform_linear_motion', mass: 1,
      velocity: { x: 2, y: 0, z: 0 }, endTime: 2 }), source: { kind: 'template', id: 'uniform-linear' } })
    const captured = await first.capture(canvas, instance)
    const legacy = await first.verifySnapshot(canvas, captured.alias.id)
    const persistence = browserStores.get(first)!
    const local = (await persistence.read('A|school', canvas))!
    if (local.base === undefined) throw new Error('The real captured graph was never acknowledged.')
    // Recreate the old client format: the server/base manifest has no receipt refs,
    // while its genuine response remains only in the account-scoped preference.
    await persistence.save({ ...local, working: local.base, editSequence: local.acknowledgedSequence,
      documentHistory: { schemaVersion: 1, past: [], future: [] } }, {}, local.cacheVersion)
    await first.dispose()
    const upgraded = browser(remote, name)
    await upgraded.open(canvas)
    expect((await upgraded.verificationHistory(canvas, captured.alias.id)).map(item => item.receipt.id)).toEqual([legacy.receipt.id])
    remote.status('unsupported')
    const current = await upgraded.verifySnapshot(canvas, captured.alias.id)
    await upgraded.sync(canvas)
    const otherBrowser = browser(remote)
    await otherBrowser.open(canvas)
    const history = await otherBrowser.verificationHistory(canvas, captured.alias.id)
    expect(history.map(item => item.receipt.id)).toEqual([legacy.receipt.id, current.receipt.id])
  }, ACCOUNT_JOURNEY_TIMEOUT_MS)
})
