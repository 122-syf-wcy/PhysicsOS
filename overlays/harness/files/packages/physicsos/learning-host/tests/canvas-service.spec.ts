import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage, { storageBackendServiceKey, type KvFacet, type KvUnit, type StorageBackend } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { pickEngine, simulateScene } from '@physicsos/physics-runtime'
import { createSnapshotObject, datasetFromSimulationResult } from '@physicsos/physics-workbench/data'
import { parseDatasetsCsv } from '@physicsos/physics-workbench/csv'
import { createSceneObject, parseObject, refsOf } from '@physicsos/physics-workbench/codec'
import { canonicalBytes, canonicalStringify } from '@physicsos/physics-workbench/json'
import type { CanvasGraph, CanvasManifest, CanvasStoredValue, WorkbenchObject } from '@physicsos/physics-workbench/types'
import { CanvasBlobStore, canvasHash, canvasScopeKey } from '../src/canvas-blob-store.ts'
import { resolveCanvasConfig, type CanvasLimits } from '../src/canvas-config.ts'
import { canvasRecordKey, openCanvasDomain, type CanvasHeadRecord } from '../src/canvas-domain.ts'
import type { IdentityActor } from '../src/identity.ts'
import { CanvasService } from '../src/canvas-service.ts'

const actor: IdentityActor = { schoolId: 'TEST', userKey: 'TEST:alice', username: 'alice', role: 'STUDENT' }
const other: IdentityActor = { schoolId: 'TEST', userKey: 'TEST:bob', username: 'bob', role: 'SUPER_ADMIN' }
const otherTenant: IdentityActor = { schoolId: 'OTHER', userKey: 'TEST:alice', username: 'alice', role: 'SUPER_ADMIN' }
const mechanics = () => createSceneObject(createMechanicsScene({ sceneId: 'canvas-scene', model: 'newton_second_law', mass: 1, velocity: { x: 2, y: 0, z: 0 }, appliedForce: { x: 1, y: 0, z: 0 }, endTime: 1 }))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type StoredWrite = { readonly table: string; readonly key: string; readonly value: unknown }

/** This external backend fault/barrier wraps real JSON writes; the actual DomainImpl remains unmodified. */
class WriteFaults {
  before: ((write: StoredWrite) => Promise<void>) | undefined
  unit: KvUnit | undefined

  wrap(backend: storageJson.JsonStorageBackend): StorageBackend {
    const kv: KvFacet = {
      open: async descriptor => {
        const unit = await backend.kv.open(descriptor)
        this.unit = unit
        return {
          loadAll: () => unit.loadAll(),
          putRecord: async (table, key, value) => { await this.before?.({ table, key, value }); await unit.putRecord(table, key, value) },
          deleteRecord: (table, key) => unit.deleteRecord(table, key),
          setGlobal: value => unit.setGlobal(value),
          close: () => unit.close(),
        }
      },
    }
    return { kv, close: () => backend.close() }
  }
}

async function fixture(options: { readonly limits?: Partial<CanvasLimits>; readonly clock?: () => Date } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'physicsos-canvas-service-'))
  let context: Context | undefined
  let service: CanvasService | undefined
  let domain: Awaited<ReturnType<typeof openCanvasDomain>> | undefined
  let backend: storageJson.JsonStorageBackend | undefined
  const barriers = new Set<() => void>()
  const faults = new WriteFaults()
  onTestFinished(async () => {
    for (const release of barriers) release()
    faults.before = undefined
    await service?.dispose()
    await domain?.close()
    await context?.fiber.dispose()
    await backend?.close()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: storage', "  name: '@deepseek-ai/dsh-storage'",
    '- id: json', '  name: canvas-test-json', '  config:', `    root: ${JSON.stringify(join(root, 'storages'))}`,
    '- id: domain', "  name: '@deepseek-ai/dsh-storage-domain'", '  config:', '    backend: json', '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const jsonPlugin = {
    name: 'canvas-test-json', inject: ['storage'],
    async apply(ctx: Context, input: storageJson.Config) {
      const json = new storageJson.JsonStorageBackend(input.root)
      backend = json
      const wrapped = faults.wrap(json)
      return ctx.effect(async function* () {
        yield () => wrapped.close()
        yield ctx.storage.backend.register('json', wrapped)
        yield ctx.provide(storageBackendServiceKey('json'), wrapped)
      })
    },
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage], ['canvas-test-json', jsonPlugin], ['@deepseek-ai/dsh-storage-domain', storageDomain],
  ])
  vi.spyOn(Include.prototype, 'import').mockImplementation((specifier: string) => {
    if (!modules.has(specifier)) throw new Error(`Unexpected Canvas fixture module: ${specifier}`)
    return modules.get(specifier)
  })
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  domain = await openCanvasDomain(context)
  const config = resolveCanvasConfig({ canvasDshHome: root, ...(options.limits === undefined ? {} : { canvasLimits: options.limits }) })
  const blobs = new CanvasBlobStore(config.root)
  service = new CanvasService(domain, blobs, config, options.clock === undefined ? {} : { now: options.clock })
  await service.initialize()
  return { context, root, service, domain, blobs, faults, releaseOnCleanup: (release: () => void) => { barriers.add(release) } }
}

async function upload(service: CanvasService, id: string, value: CanvasStoredValue, owner = actor): Promise<string> {
  const bytes = canonicalBytes(value)
  const digest = canvasHash(bytes)
  await service.uploadObject(owner, id, digest, bytes)
  return digest
}
async function realCapture(service: CanvasService, canvasId: string) {
  const source = mechanics()
  const sceneDigest = await upload(service, canvasId, source)
  const selected = pickEngine(source.scene)
  if (selected.entry === undefined) throw new Error(selected.reasons.join('; '))
  const simulated = simulateScene(source.scene, selected.entry, `${canvasId}-simulation`, `${canvasId}-trace`)
  const state = simulated.simulation.states[0]
  if (state === undefined) throw new Error('Real engine produced no state fixture')
  const capture = createSnapshotObject({
    scene: source.scene, sceneRef: { kind: 'scene', digest: sceneDigest }, instanceId: 'instance', instanceEditRevision: 0,
    capturedAt: '2026-11-08T00:00:00.000Z', source: 'client-engine', request: simulated.request, result: simulated.simulation,
    engineInfo: { id: selected.entry.engine.engineId, version: selected.entry.engine.engineVersion },
    clock: { time: state.time.value, total: 1, running: false, rate: 1 }, cursor: { kind: 'time', time: state.time }, state, datasets: [],
  })
  return { source, selected: selected.entry, sceneDigest, capture, digest: await upload(service, canvasId, capture) }
}
function isHead(value: unknown): value is CanvasHeadRecord {
  return value !== null && typeof value === 'object' && 'version' in value && 'lastCommit' in value && 'manifestDigest' in value
}

async function liveGraph(service: CanvasService, id: string): Promise<CanvasGraph> {
  const opened = await service.open(actor, id)
  const objects: Record<string, WorkbenchObject> = {}
  const pending = [...refsOf(opened.manifest)]
  for (let index = 0; index < pending.length; index += 1) {
    const ref = pending[index]!
    if (objects[ref.digest] !== undefined) continue
    const downloaded = await service.downloadObject(actor, id, ref.digest)
    const raw: unknown = JSON.parse(new TextDecoder().decode(downloaded.bytes))
    const parsed = parseObject(raw)
    if (!parsed.ok) throw new Error(canonicalStringify(parsed.issues))
    objects[ref.digest] = parsed.value
    pending.push(...refsOf(parsed.value))
  }
  return { schemaVersion: 1, manifest: opened.manifest, objects }
}

describe('CanvasService on the actual domain write chain and JSON medium', () => {
  it('serializes CAS overlap into one durable success and one explicit conflict', async () => {
    const { service, faults, domain, releaseOnCleanup } = await fixture()
    const opened = await service.create(actor, { id: 'cas', title: 'CAS', mutationId: 'create-cas' })
    const left = { ...opened.manifest, title: 'Left' }
    const right = { ...opened.manifest, title: 'Right' }
    const leftDigest = await upload(service, 'cas', left)
    const rightDigest = await upload(service, 'cas', right)
    const entered = deferred<void>()
    const release = deferred<void>()
    releaseOnCleanup(() => release.resolve())
    faults.before = async write => {
      if (write.table === 'heads' && isHead(write.value) && write.value.version === 2) { entered.resolve(); await release.promise }
    }
    const first = service.commit(actor, 'cas', { expectedVersion: 1, mutationId: 'left', manifestDigest: leftDigest })
    await entered.promise
    const second = service.commit(actor, 'cas', { expectedVersion: 1, mutationId: 'right', manifestDigest: rightDigest })
    const settled = Promise.allSettled([first, second])
    expect(domain.table('heads').get(canvasRecordKey(actor.schoolId, actor.userKey, 'cas'))?.version).toBe(1)
    release.resolve()
    const results = await settled
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'VERSION_CONFLICT', status: 409 } })
    expect((await service.open(actor, 'cas')).head).toMatchObject({ version: 2, title: 'Left' })
  })

  it('checks CAS inside transform even when a competing actual domain write is already queued', async () => {
    const { service, domain, faults, releaseOnCleanup } = await fixture()
    const opened = await service.create(actor, { id: 'chain', title: 'Chain', mutationId: 'create-chain' })
    const nextDigest = await upload(service, 'chain', { ...opened.manifest, title: 'Stale' })
    const entered = deferred<void>()
    const release = deferred<void>()
    releaseOnCleanup(() => release.resolve())
    const key = canvasRecordKey(actor.schoolId, actor.userKey, 'chain')
    faults.before = async write => { if (write.table === 'heads' && isHead(write.value) && write.value.title === 'External') { entered.resolve(); await release.promise } }
    const outside = domain.table('heads').update(key, current => ({ ...current, title: 'External', version: current.version + 1 }))
    await entered.promise
    const stale = service.commit(actor, 'chain', { expectedVersion: 1, mutationId: 'stale', manifestDigest: nextDigest })
    const settled = Promise.allSettled([outside, stale])
    release.resolve()
    expect(await settled).toMatchObject([{ status: 'fulfilled' }, { status: 'rejected', reason: { code: 'VERSION_CONFLICT' } }])
    expect(domain.table('heads').get(key)?.title).toBe('External')
  })

  it('repairs a lost post-head receipt and never advances the head again on response-loss retry', async () => {
    const { service, faults, domain } = await fixture()
    const opened = await service.create(actor, { id: 'lost', title: 'Lost', mutationId: 'create-lost' })
    const manifestDigest = await upload(service, 'lost', { ...opened.manifest, title: 'Durable' })
    let failed = false
    faults.before = async write => { if (!failed && write.table === 'receipts' && write.value !== null && typeof write.value === 'object' && 'mutationId' in write.value && write.value.mutationId === 'commit-lost') { failed = true; throw new Error('injected receipt publication failure') } }
    const request = { expectedVersion: 1, mutationId: 'commit-lost', manifestDigest }
    await expect(service.commit(actor, 'lost', request)).rejects.toThrow('injected')
    const head = domain.table('heads').get(canvasRecordKey(actor.schoolId, actor.userKey, 'lost'))
    expect(head?.version).toBe(2)
    expect(head?.lastCommit.mutationId).toBe('commit-lost')
    faults.before = undefined
    const retry = await service.commit(actor, 'lost', request)
    expect(retry).toMatchObject({ replayed: true, head: { version: 2 } })
    expect(domain.table('receipts').get(canvasRecordKey(actor.schoolId, actor.userKey, 'lost', 'commit-lost'))?.head.version).toBe(2)
    expect(domain.table('reservations').get(canvasRecordKey(actor.schoolId, actor.userKey, 'lost', 'commit-lost'))).toBeUndefined()
    await expect(service.commit(actor, 'lost', { ...request, manifestDigest: opened.head.manifestDigest })).rejects.toMatchObject({ code: 'MUTATION_CONFLICT' })
  })

  it('repairs a committed lost receipt during collection before releasing its expired reservation', async () => {
    let time = Date.parse('2026-11-08T00:00:00.000Z')
    const { service, domain, faults } = await fixture({ clock: () => new Date(time), limits: { reservationTtlMs: 1000 } })
    const opened = await service.create(actor, { id: 'gc-receipt', title: 'GC receipt', mutationId: 'create-gc-receipt' })
    const manifestDigest = await upload(service, 'gc-receipt', { ...opened.manifest, title: 'Committed' })
    faults.before = async write => {
      if (write.table === 'receipts' && write.value !== null && typeof write.value === 'object' && 'mutationId' in write.value && write.value.mutationId === 'lost-gc') throw new Error('injected lost GC receipt')
    }
    const request = { expectedVersion: 1, mutationId: 'lost-gc', manifestDigest }
    await expect(service.commit(actor, 'gc-receipt', request)).rejects.toThrow('injected')
    const key = canvasRecordKey(actor.schoolId, actor.userKey, 'gc-receipt', 'lost-gc')
    expect(domain.table('receipts').get(key)).toBeUndefined()
    expect(domain.table('reservations').get(key)).toBeDefined()
    time += 1001
    faults.before = undefined
    await service.collect(actor, 'gc-receipt')
    expect(domain.table('receipts').get(key)?.head.version).toBe(2)
    expect(domain.table('reservations').get(key)).toBeUndefined()
    expect((await service.commit(actor, 'gc-receipt', request)).head.version).toBe(2)
  })

  it('leaves memory and emitted heads unchanged when durable head publication fails', async () => {
    const { service, faults, domain, context, root } = await fixture()
    const opened = await service.create(actor, { id: 'failure', title: 'Before', mutationId: 'create-failure' })
    const digest = await upload(service, 'failure', { ...opened.manifest, title: 'Rejected' })
    const events: unknown[] = []
    const dispose = context.on('domain/changed', change => { if (change.domain === 'physicsos_canvas' && change.table === 'heads') events.push(change) })
    onTestFinished(dispose)
    faults.before = async write => { if (write.table === 'heads') throw new Error('injected durable head failure') }
    await expect(service.commit(actor, 'failure', { expectedVersion: 1, mutationId: 'rejected', manifestDigest: digest })).rejects.toThrow('injected')
    expect(domain.table('heads').get(canvasRecordKey(actor.schoolId, actor.userKey, 'failure'))?.version).toBe(1)
    expect(events).toEqual([])
    const persisted = JSON.parse(await readFile(join(root, 'storages', 'physicsos_canvas.json'), 'utf8')) as { tables: { heads: Record<string, CanvasHeadRecord> } }
    expect(persisted.tables.heads[canvasRecordKey(actor.schoolId, actor.userKey, 'failure')]?.version).toBe(1)
    faults.before = undefined
    expect((await service.commit(actor, 'failure', { expectedVersion: 1, mutationId: 'rejected', manifestDigest: digest })).head.version).toBe(2)
  })

  it('keeps account and tenant isolation even for an administrator with a colliding userKey', async () => {
    const { service } = await fixture()
    const opened = await service.create(actor, { id: 'private', title: 'Private', mutationId: 'private-create' })
    await expect(service.open(other, 'private')).rejects.toMatchObject({ status: 404 })
    await expect(service.open(otherTenant, 'private')).rejects.toMatchObject({ status: 404 })
    await expect(service.downloadObject(other, 'private', opened.head.manifestDigest)).rejects.toMatchObject({ status: 404 })
    expect((await service.list(other)).items).toEqual([])
    expect((await service.list(otherTenant)).items).toEqual([])
    await expect(service.create(actor, { id: 'forged', title: 'Forged', mutationId: 'forged-create', schoolId: 'OTHER', userKey: other.userKey })).rejects.toMatchObject({ status: 400 })
  })

  it('retains monotonic delete and restore generations and never revives stale queued requests', async () => {
    const { service } = await fixture()
    const opened = await service.create(actor, { id: 'lifetime', title: 'Lifetime', mutationId: 'life-create' })
    const deleted = await service.delete(actor, 'lifetime', { expectedVersion: 1, mutationId: 'delete' })
    expect(deleted.head).toMatchObject({ version: 2, generation: 2, deletedAt: expect.any(String) })
    await expect(service.commit(actor, 'lifetime', { expectedVersion: 1, mutationId: 'old', manifestDigest: opened.head.manifestDigest })).rejects.toMatchObject({ code: 'DELETED' })
    const restored = await service.restore(actor, 'lifetime', { expectedVersion: 2, expectedGeneration: 2, mutationId: 'restore' })
    expect(restored.head).toMatchObject({ version: 3, generation: 3 })
    expect(restored.head.deletedAt).toBeUndefined()
    const repeatedDelete = await service.delete(actor, 'lifetime', { expectedVersion: 1, mutationId: 'delete' })
    expect(repeatedDelete).toMatchObject({ replayed: true, head: { version: 2, generation: 2 } })
    expect((await service.open(actor, 'lifetime')).head.version).toBe(3)
    await expect(service.restore(actor, 'lifetime', { expectedVersion: 2, mutationId: 'stale-restore' })).rejects.toMatchObject({ code: 'NOT_DELETED' })
    await expect(service.create(actor, { id: 'lifetime', title: 'Reused', mutationId: 'reuse' })).rejects.toMatchObject({ code: 'ID_CONFLICT' })
  })

  it('returns only committed changes while a durable head write is blocked', async () => {
    const { service, faults, releaseOnCleanup } = await fixture()
    const opened = await service.create(actor, { id: 'changes', title: 'Changes', mutationId: 'changes-create' })
    const digest = await upload(service, 'changes', { ...opened.manifest, title: 'Later' })
    const entered = deferred<void>()
    const release = deferred<void>()
    releaseOnCleanup(() => release.resolve())
    faults.before = async write => { if (write.table === 'heads') { entered.resolve(); await release.promise } }
    const commit = service.commit(actor, 'changes', { expectedVersion: 1, mutationId: 'later', manifestDigest: digest })
    await entered.promise
    const changes = service.changes(actor, String(opened.head.changeSeq))
    let completed = false
    void changes.then(() => { completed = true })
    expect(completed).toBe(false)
    release.resolve()
    await commit
    expect(await changes).toMatchObject({ changes: [{ head: { version: 2 } }], cursor: 2, hasMore: false })
    await expect(service.changes(actor, '999999')).rejects.toMatchObject({ code: 'BAD_CURSOR' })
  })

  it('rejects malformed addresses, kind mismatches, and noncanonical bytes', async () => {
    const { service } = await fixture()
    await service.create(actor, { id: 'objects', title: 'Objects', mutationId: 'objects-create' })
    const scene = mechanics()
    const digest = await upload(service, 'objects', scene)
    const canonical = canonicalBytes(scene)
    const spaced = Buffer.from(JSON.stringify(scene, null, 2))
    await expect(service.uploadObject(actor, 'objects', canvasHash(spaced), spaced)).rejects.toMatchObject({ code: 'NON_CANONICAL_OBJECT' })
    await expect(service.uploadObject(actor, 'objects', `${digest}\n`, canonical)).rejects.toMatchObject({ code: 'BAD_DIGEST' })
    await expect(service.uploadObject(actor, 'objects', '0'.repeat(64), canonical)).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' })
    const wrongRef: CanvasManifest = { ...(await service.open(actor, 'objects')).manifest, snapshots: [{ id: 'fake', title: 'Fake', snapshot: { kind: 'snapshot', digest } }] }
    await expect(upload(service, 'objects', wrongRef)).rejects.toMatchObject({ code: 'REFERENCE_KIND_MISMATCH' })
  })

  it('stores real client captures, refuses forged server provenance, verifies independently, and exports every raw row', async () => {
    const { service } = await fixture()
    await service.create(actor, { id: 'capture', title: 'Capture', mutationId: 'capture-create' })
    const source = mechanics()
    const sceneDigest = await upload(service, 'capture', source)
    const selected = pickEngine(source.scene)
    if (selected.entry === undefined) throw new Error(selected.reasons.join('; '))
    const simulated = simulateScene(source.scene, selected.entry, 'capture-simulation', 'capture-trace')
    const datasets = datasetFromSimulationResult(simulated.simulation, { sourceScene: { kind: 'scene', digest: sceneDigest } })
    const refs: { kind: 'dataset'; digest: string }[] = []
    for (const dataset of datasets) refs.push({ kind: 'dataset', digest: await upload(service, 'capture', dataset) })
    const state = simulated.simulation.states[0]
    if (state === undefined) throw new Error('Real engine produced no state fixture')
    const capture = createSnapshotObject({
      scene: source.scene, sceneRef: { kind: 'scene', digest: sceneDigest }, instanceId: 'instance', instanceEditRevision: 0,
      capturedAt: '2026-11-08T00:00:00.000Z', source: 'client-engine', request: simulated.request, result: simulated.simulation,
      engineInfo: { id: selected.entry.engine.engineId, version: selected.entry.engine.engineVersion },
      clock: { time: state.time.value, total: 1, running: false, rate: 1 }, cursor: { kind: 'time', time: state.time }, state, datasets: refs,
    })
    const digest = await upload(service, 'capture', capture)
    const forgedServer = { ...capture, source: 'server-engine' as const }
    await expect(upload(service, 'capture', forgedServer)).rejects.toMatchObject({ code: 'SERVER_AUTHORITY_REQUIRED', status: 403 })
    const original = canonicalStringify(capture)
    const verified = await service.verify(actor, 'capture', { captureDigest: digest, mutationId: 'verify-one' })
    expect(verified.receipt).toMatchObject({ status: 'verified', captureDigest: digest, sceneDigest })
    expect(verified.resultDigest).toMatch(/^[a-f0-9]{64}$/)
    const result = await service.downloadObject(actor, 'capture', verified.resultDigest!)
    expect(result.kind).toBe('snapshot')
    const originalObject = await service.downloadObject(actor, 'capture', digest)
    expect(new TextDecoder().decode(originalObject.bytes)).toBe(original)
    const retry = await service.verify(actor, 'capture', { captureDigest: digest, mutationId: 'verify-one' })
    expect(retry).toMatchObject({ replayed: true, resultDigest: verified.resultDigest, receipt: { id: verified.receipt.id } })
    const csv = await service.snapshotCsv(actor, 'capture', digest)
    const parsed = parseDatasetsCsv(csv)
    if (!parsed.ok) throw new Error(canonicalStringify(parsed.issues))
    expect(parsed.value).toEqual(datasets)
    expect(parsed.value.reduce((count, dataset) => count + dataset.rows.length, 0)).toBeGreaterThan(10)
    await expect(service.verification(other, 'capture', verified.receipt.id)).rejects.toMatchObject({ status: 404 })
  })

  it('reuses the first durable verification outcome after receipt failure without rerunning the engine', async () => {
    let time = Date.parse('2026-11-08T00:00:00.000Z')
    const { service, domain, faults } = await fixture({ clock: () => new Date(time) })
    await service.create(actor, { id: 'verify-lost', title: 'Verify lost', mutationId: 'create-verify-lost' })
    const captured = await realCapture(service, 'verify-lost')
    const simulationSpy = vi.spyOn(captured.selected.engine, 'simulate')
    let failed = false
    faults.before = async write => {
      if (!failed && write.table === 'verifications') { failed = true; throw new Error('injected verification receipt failure') }
    }
    const request = { captureDigest: captured.digest, mutationId: 'verify-first' }
    await expect(service.verify(actor, 'verify-lost', request)).rejects.toThrow('injected')
    expect(simulationSpy).toHaveBeenCalledTimes(1)
    const key = canvasRecordKey(actor.schoolId, actor.userKey, 'verify-lost', request.mutationId)
    const pending = domain.table('reservations').get(key)
    expect(pending?.verificationAttempt).toBeDefined()
    const objectsBefore = [...domain.table('objects').entries()].map(([key, value]) => [key, value.digest]).sort()
    time += 60_000
    faults.before = undefined
    const recovered = await service.verify(actor, 'verify-lost', request)
    expect(simulationSpy).toHaveBeenCalledTimes(1)
    expect(recovered.receipt.checkedAt).toBe(pending?.createdAt)
    expect([...domain.table('objects').entries()].map(([key, value]) => [key, value.digest]).sort()).toEqual(objectsBefore)
    expect(domain.table('reservations').get(key)).toBeUndefined()
    expect(recovered.receipt.status).toBe('verified')
  })

  it('refuses to rerun a ready server attempt whose immutable file was lost', async () => {
    const { service, domain, faults, root } = await fixture()
    await service.create(actor, { id: 'verify-corrupt', title: 'Verify corrupt', mutationId: 'create-verify-corrupt' })
    const captured = await realCapture(service, 'verify-corrupt')
    const spy = vi.spyOn(captured.selected.engine, 'simulate')
    faults.before = async write => { if (write.table === 'verifications') throw new Error('injected verification record failure') }
    const request = { captureDigest: captured.digest, mutationId: 'verify-corrupt-mutation' }
    await expect(service.verify(actor, 'verify-corrupt', request)).rejects.toThrow('injected')
    const key = canvasRecordKey(actor.schoolId, actor.userKey, 'verify-corrupt', request.mutationId)
    const pending = domain.table('reservations').get(key)
    expect(pending?.verificationAttempt?.status).toBe('ready')
    const attempt = pending?.verificationAttempt
    if (attempt === undefined) throw new Error('Expected real persisted first attempt')
    const path = join(root, 'physicsos', 'canvases', 'v1', 'accounts', canvasScopeKey(actor.schoolId, actor.userKey), 'documents', canvasScopeKey('verify-corrupt'), 'verification-attempts', attempt.digest.slice(0, 2), attempt.digest)
    await unlink(path)
    faults.before = undefined
    await expect(service.verify(actor, 'verify-corrupt', request)).rejects.toMatchObject({ code: 'BLOB_MISSING' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(domain.table('reservations').get(key)?.verificationAttempt).toEqual(attempt)
  })

  it('retains the chosen create timestamp and object address after durable head failure', async () => {
    let time = Date.parse('2026-11-08T00:00:00.000Z')
    const { service, domain, faults } = await fixture({ clock: () => new Date(time++) })
    let failed = false
    faults.before = async write => { if (!failed && write.table === 'heads') { failed = true; throw new Error('injected first head failure') } }
    const request = { id: 'create-lost', title: 'Create lost', mutationId: 'create-first' }
    await expect(service.create(actor, request)).rejects.toThrow('injected')
    const pending = domain.table('reservations').get(canvasRecordKey(actor.schoolId, actor.userKey, request.id, request.mutationId))
    const objects = [...domain.table('objects').entries()].map(([, value]) => value.digest)
    expect(objects).toHaveLength(1)
    expect(pending?.createdAt).toBeDefined()
    faults.before = undefined
    const recovered = await service.create(actor, request)
    expect(recovered.head.manifestDigest).toBe(objects[0])
    expect(recovered.manifest.createdAt).toBe(pending?.createdAt)
    expect(domain.table('objects').size).toBe(1)
  })

  it('precharges every cloned object and rejects a partial copy before any destination publication', async () => {
    const { service, domain } = await fixture({ limits: { maxObjectsPerDocument: 4 } })
    const source = await service.create(actor, { id: 'copy-quota-source', title: 'Copy quota', mutationId: 'create-copy-quota' })
    const sceneDigest = await upload(service, source.head.id, mechanics())
    const historyDigest = await upload(service, source.head.id, { schemaVersion: 1, kind: 'history', parents: [], entries: [{ id: 'capture-origin-history', instanceId: 'instance', scene: { kind: 'scene', digest: sceneDigest }, at: source.manifest.createdAt, operation: 'create' }] })
    const manifest: CanvasManifest = { ...source.manifest, history: { kind: 'history', digest: historyDigest }, instances: [{ instanceId: 'instance', currentScene: { kind: 'scene', digest: sceneDigest }, originScene: { kind: 'scene', digest: sceneDigest },
      domain: 'mechanics', source: { kind: 'free-build' }, buildMode: 'construct', clock: { time: 0, total: 0, running: false, rate: 1 }, instanceEditRevision: 0,
    }] }
    const manifestDigest = await upload(service, source.head.id, manifest)
    await service.commit(actor, source.head.id, { expectedVersion: 1, mutationId: 'content', manifestDigest })
    await expect(service.copy(actor, source.head.id, { expectedVersion: 2, mutationId: 'copy-too-many', id: 'copy-quota-destination', title: 'Copy' })).rejects.toMatchObject({ code: 'OBJECT_LIMIT' })
    expect([...domain.table('objects').entries()].filter(([, row]) => row.canvasId === 'copy-quota-destination')).toEqual([])
    expect(domain.table('heads').get(canvasRecordKey(actor.schoolId, actor.userKey, 'copy-quota-destination'))).toBeUndefined()
  })

  it('collects other account documents while an active failed creation has unmaterialized roots', async () => {
    let time = Date.parse('2026-11-08T00:00:00.000Z')
    const { service, domain, faults } = await fixture({ clock: () => new Date(time), limits: { reservationTtlMs: 1000 } })
    await service.create(actor, { id: 'existing-gc', title: 'Existing', mutationId: 'create-existing' })
    const orphan = await upload(service, 'existing-gc', mechanics())
    faults.before = async write => { if (write.table === 'objects') throw new Error('injected missing creation object') }
    await expect(service.create(actor, { id: 'pending-create', title: 'Pending', mutationId: 'create-pending' })).rejects.toThrow('injected')
    faults.before = undefined
    time += 500
    expect(await service.collect(actor)).toMatchObject({ objects: 0 })
    expect(domain.table('objects').get(canvasRecordKey(actor.schoolId, actor.userKey, 'existing-gc', orphan))).toBeDefined()
  })

  it('charges full metadata, retained documents, and multibyte object envelopes without truncating', async () => {
    const { service } = await fixture({ limits: { maxDocumentsPerAccount: 1, maxTitleBytes: 8 } })
    await expect(service.create(actor, { id: 'utf8', title: '物理实验', mutationId: 'utf8-create' })).rejects.toMatchObject({ code: 'TITLE_TOO_LARGE' })
    await service.create(actor, { id: 'first', title: 'First', mutationId: 'first-create' })
    await expect(service.create(actor, { id: 'second', title: 'Second', mutationId: 'second-create' })).rejects.toMatchObject({ code: 'DOCUMENT_LIMIT' })
    await service.delete(actor, 'first', { expectedVersion: 1, mutationId: 'first-delete' })
    await expect(service.create(actor, { id: 'second', title: 'Second', mutationId: 'second-create' })).rejects.toMatchObject({ code: 'DOCUMENT_LIMIT' })
  })

  it('collects unreachable bytes only after actual unlink and preserves committed history', async () => {
    let time = Date.parse('2026-11-08T00:00:00.000Z')
    const { service, blobs } = await fixture({ clock: () => new Date(time), limits: { reservationTtlMs: 1000 } })
    const opened = await service.create(actor, { id: 'gc', title: 'GC', mutationId: 'gc-create' })
    const scene = mechanics()
    const digest = await upload(service, 'gc', scene)
    expect((await service.collect(actor, 'gc')).objects).toBe(0)
    time += 1001
    const collected = await service.collect(actor, 'gc')
    expect(collected).toMatchObject({ objects: 1, bytes: canonicalBytes(scene).byteLength })
    await expect(blobs.read({ ...actor, canvasId: 'gc' }, digest, canonicalBytes(scene).byteLength, 16 * 1024 * 1024)).rejects.toMatchObject({ code: 'BLOB_MISSING' })
    expect((await service.open(actor, 'gc')).head.manifestDigest).toBe(opened.head.manifestDigest)
  })

  it('copies a real graph without writing source rows or rebadging original captures', async () => {
    const { service, domain } = await fixture()
    const opened = await service.create(actor, { id: 'source', title: 'Source', mutationId: 'source-create' })
    const sourceObject = mechanics()
    const sceneDigest = await upload(service, 'source', sourceObject)
    const manifest: CanvasManifest = { ...opened.manifest, instances: [{
      instanceId: 'instance', currentScene: { kind: 'scene', digest: sceneDigest }, originScene: { kind: 'scene', digest: sceneDigest },
      domain: 'mechanics', source: { kind: 'free-build' }, buildMode: 'construct',
      clock: { time: 0, total: 0, running: false, rate: 1 }, instanceEditRevision: 0,
    }], nodes: [{ id: 'node', kind: 'experiment', instanceId: 'instance', layout: { x: 0, y: 0, width: 500, height: 400, zIndex: 1 } }] }
    const manifestDigest = await upload(service, 'source', manifest)
    await service.commit(actor, 'source', { expectedVersion: 1, mutationId: 'source-content', manifestDigest })
    const sourceBefore = canonicalStringify(domain.table('heads').get(canvasRecordKey(actor.schoolId, actor.userKey, 'source')))
    const copied = await service.copy(actor, 'source', { expectedVersion: 2, mutationId: 'copy', id: 'copy', title: 'Copy' })
    expect(copied.head).toMatchObject({ id: 'copy', version: 1 })
    expect(canonicalStringify(domain.table('heads').get(canvasRecordKey(actor.schoolId, actor.userKey, 'source')))).toBe(sourceBefore)
    expect(copied.manifest.instances[0]?.instanceId).not.toBe('instance')
    expect(copied.manifest.instances[0]?.currentScene.digest).not.toBe(sceneDigest)
    const graph = await liveGraph(service, 'copy')
    const scene = graph.objects[copied.manifest.instances[0]!.currentScene.digest]
    expect(scene?.kind).toBe('scene')
    if (scene?.kind === 'scene') expect(scene.scene.id).not.toBe(sourceObject.scene.id)
    const retry = await service.copy(actor, 'source', { expectedVersion: 2, mutationId: 'copy', id: 'copy', title: 'Copy' })
    expect(retry).toMatchObject({ replayed: true, head: { version: 1 } })
  })

  it('waits for accepted account work on dispose and refuses subsequent requests', async () => {
    const { service, faults, releaseOnCleanup } = await fixture()
    await service.create(actor, { id: 'close', title: 'Close', mutationId: 'close-create' })
    const entered = deferred<void>()
    const release = deferred<void>()
    releaseOnCleanup(() => release.resolve())
    faults.before = async write => { if (write.table === 'heads') { entered.resolve(); await release.promise } }
    const accepted = service.delete(actor, 'close', { expectedVersion: 1, mutationId: 'close-delete' })
    await entered.promise
    let disposed = false
    const close = service.dispose().then(() => { disposed = true })
    expect(disposed).toBe(false)
    await expect(service.list(actor)).rejects.toMatchObject({ code: 'CLOSED' })
    release.resolve()
    await accepted
    await close
    expect(disposed).toBe(true)
  })
})
