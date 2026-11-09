import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DomainSpec, TableValueOf } from '@deepseek-ai/dsh-storage-domain'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { createSceneObject, parseManifest } from '@physicsos/physics-workbench/codec'
import { createExperimentInstance } from '@physicsos/physics-workbench/data'
import { canonicalByteLength, canonicalBytes, canonicalStringify } from '@physicsos/physics-workbench/json'
import type {
  CanvasApiError,
  CanvasChangesResponse,
  CanvasCommitRequest,
  CanvasCommitResponse,
  CanvasCreateRequest,
  CanvasDeleteRequest,
  CanvasListResponse,
  CanvasObjectUploadResponse,
  CanvasOpenResponse,
  CanvasRenameRequest,
  CanvasRestoreRequest,
} from '@physicsos/physics-workbench/protocol'
import type { CanvasStoredValue, HistoryObject } from '@physicsos/physics-workbench/types'
import * as learningHost from '../src/index.ts'
import { canvasDomain, canvasRecordKey } from '../src/canvas-domain.ts'
import { learningDomain, attemptKey, savedSceneKey, type PersonalAttemptRecord, type SavedSceneRecord } from '../src/domain.ts'
import {
  CANVAS_FIXTURE_TIMEOUT,
  CANVAS_TEST_ADMIN,
  CANVAS_TEST_SCHOOL,
  canvasOwnerHeader,
  loadCanvasFixture,
  responseJson,
  type CanvasAccount,
  type CanvasFixture,
} from './canvas-fixture.ts'

const prefix = '/physicsos/learning/canvases'
const time = '2026-11-08T10:00:00.000Z'
type MutationResponse = CanvasOpenResponse & CanvasCommitResponse
type StoredUnit<S extends DomainSpec> = {
  readonly unit: { readonly name: string; readonly version: number }
  readonly global: unknown
  readonly tables: { readonly [N in keyof S['tables']]: Readonly<Record<string, TableValueOf<S, N>>> }
}

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const encoded = (value: CanvasStoredValue) => {
  const bytes = canonicalBytes(value)
  return { value, bytes, digest: hash(bytes) }
}
const canvasKey = (account: CanvasAccount, id: string): string => canvasRecordKey(account.actor.schoolId, account.actor.userKey, id)
const privateHeaders = (response: Response): void => {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}
const failure = async (response: Response, status: number, code: string): Promise<CanvasApiError> => {
  const body = await responseJson<{ error: CanvasApiError & { status: number } }>(response, status)
  privateHeaders(response)
  expect(body.error).toMatchObject({ code, status, retryable: status >= 500 || status === 408 || status === 429 })
  return body.error
}
const create = async (fixture: CanvasFixture, account: CanvasAccount, id: string, title = id): Promise<MutationResponse> => {
  const request: CanvasCreateRequest = { id, title, mutationId: `create-${id}` }
  const response = await fixture.call('POST', prefix, request, account)
  privateHeaders(response)
  const result = await responseJson<MutationResponse>(response, 201)
  expect(result.replayed).toBe(false)
  return result
}
const upload = async (fixture: CanvasFixture, account: CanvasAccount, id: string, object: ReturnType<typeof encoded>, existed = false): Promise<void> => {
  const response = await fixture.raw('PUT', `${prefix}/${id}/objects/${object.digest}`, object.bytes, account)
  privateHeaders(response)
  expect(await responseJson<CanvasObjectUploadResponse>(response)).toEqual({
    digest: object.digest,
    kind: 'kind' in object.value ? object.value.kind : 'manifest',
    byteLength: object.bytes.byteLength,
    bytes: object.bytes.byteLength,
    existed,
  })
}
const download = async (fixture: CanvasFixture, account: CanvasAccount, id: string, object: ReturnType<typeof encoded>): Promise<void> => {
  const response = await fixture.call('GET', `${prefix}/${id}/objects/${object.digest}`, undefined, account)
  expect(response.status).toBe(200)
  privateHeaders(response)
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
  expect(response.headers.get('content-length')).toBe(String(object.bytes.byteLength))
  expect(response.headers.get('x-physicsos-object-digest')).toBe(object.digest)
  expect(response.headers.get('x-physicsos-object-kind')).toBe('kind' in object.value ? object.value.kind : 'manifest')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(object.bytes))
}
const privateGraph = (base: CanvasOpenResponse) => {
  const physical = createMechanicsScene({
    sceneId: 'private-mechanics', revision: 3, model: 'uniform_linear_motion', mass: 2,
    velocity: { x: 4, y: 0, z: 0 }, endTime: 2, now: time, title: 'Private motion facts',
  })
  const scene = encoded(createSceneObject({
    ...physical,
    metadata: { ...physical.metadata, privateNotebook: { ownerNote: '完整私有事实', readings: [0, 4, 8], untouched: true } },
  }))
  const sceneRef = { kind: 'scene' as const, digest: scene.digest }
  const historyValue: HistoryObject = {
    schemaVersion: 1,
    kind: 'history',
    parents: [],
    entries: [{ id: 'history-create', instanceId: 'instance-1', scene: sceneRef, at: time, operation: 'create', details: { note: 'Private origin evidence' } }],
  }
  const history = encoded(historyValue)
  const parsed = parseManifest({
    ...base.manifest,
    instances: [createExperimentInstance({
      instanceId: 'instance-1', currentScene: sceneRef, originScene: sceneRef,
      domain: 'mechanics', source: { kind: 'free-build' }, buildMode: 'construct',
      clock: { time: 0, total: 2, running: false, rate: 1 }, instanceEditRevision: 3,
    })],
    nodes: [
      { id: 'experiment-node', kind: 'experiment', instanceId: 'instance-1', layout: { x: 10, y: 20, width: 480, height: 320, zIndex: 1 } },
      { id: 'private-note', kind: 'note', body: 'This account owns the complete raw experiment.', format: 'plain', layout: { x: 510, y: 20, width: 240, height: 160, zIndex: 2 } },
    ],
    edges: [{ id: 'note-relation', kind: 'relation', from: 'experiment-node', to: 'private-note' }],
    history: { kind: 'history', digest: history.digest },
    metadata: { privateMarker: 'canonical-whole-envelope' },
  })
  if (!parsed.ok) throw new Error(`Invalid test manifest: ${JSON.stringify(parsed.issues)}`)
  const manifest = encoded(parsed.value)
  return { scene, history, manifest, uploads: [scene, history, manifest] }
}
const changes = async (fixture: CanvasFixture, account: CanvasAccount, cursor = 0, limit?: number): Promise<CanvasChangesResponse> =>
  responseJson<CanvasChangesResponse>(await fixture.call('GET', `${prefix}/changes?cursor=${cursor}${limit === undefined ? '' : `&limit=${limit}`}`, undefined, account))

// Include's resolver spy is restored before boot returns; each case owns its listener and files.
describe('real Loader composition - account-private Canvas HTTP', { timeout: CANVAS_FIXTURE_TIMEOUT }, () => {
  it('loads the named plugin, resolves real cookies, and leaves the existing learning unit unchanged', async (test) => {
    const fixture = await loadCanvasFixture({ test })
    expect('default' in learningHost).toBe(false)
    expect(fixture.context.loader.unwrapExports(learningHost)).toBe(learningHost)
    expect(learningHost.Config).toBeDefined()
    expect(learningHost.inject).toEqual(['webServer', 'storageDomain'])
    expect(fixture.config.root).toBe(join(fixture.root, 'physicsos', 'canvases', 'v1'))

    await failure(await fixture.call('GET', prefix), 401, 'UNAUTHENTICATED')
    await failure(await fixture.call('POST', prefix, { id: 'anonymous', title: 'Anonymous', mutationId: 'anonymous-create' }), 401, 'UNAUTHENTICATED')
    await failure(await fixture.call('GET', `${prefix}/changes`), 401, 'UNAUTHENTICATED')
    const a = await fixture.register('CANVAS_A')
    const b = await fixture.register('canvas_b')
    const admin = await fixture.login(CANVAS_TEST_ADMIN)
    expect(a.user.username).toBe('canvas_a')
    expect(a.actor.userKey).toBe(`${CANVAS_TEST_SCHOOL}:canvas_a`)
    expect(a.ownerHeader).toBe(encodeURIComponent(canonicalStringify({ schoolId: CANVAS_TEST_SCHOOL, username: 'canvas_a' })))
    expect(admin.user.role).toBe('SCHOOL_ADMIN')
    expect(admin.user.schoolId).toBe(a.user.schoolId)

    const attempt = {
      id: 'legacy-attempt', questionId: 'question-1', questionTitle: 'Speed', selfCheckId: 'self-check-1',
      prompt: 'How is speed measured?', answerId: 'answer-1', answerLabel: 'distance / time',
      correct: true, knowledge: ['kinematics'], at: time,
    }
    const legacyAttempt = await responseJson<{ item: PersonalAttemptRecord }>(await fixture.call('PUT', '/physicsos/learning/attempts/legacy-attempt', attempt, a))
    const legacyScene = {
      sceneId: 'legacy-scene', title: 'Saved legacy scene', domain: 'mechanics', kind: 'experiment', updatedAt: time,
      scene: createMechanicsScene({ sceneId: 'legacy-scene', model: 'uniform_linear_motion', now: time }),
      originScene: createMechanicsScene({ sceneId: 'legacy-origin', model: 'uniform_linear_motion', now: time }),
      buildMode: true,
    }
    const saved = await responseJson<{ item: SavedSceneRecord }>(await fixture.call('PUT', '/physicsos/learning/scenes/legacy-scene', legacyScene, a))
    const legacyPath = join(fixture.root, 'storages', 'physicsos_learning.json')
    const learningBytes = await readFile(legacyPath, 'utf8')
    const oldUnit = await fixture.readUnit(learningDomain.name) as StoredUnit<typeof learningDomain>
    expect(oldUnit.unit).toEqual({ name: 'physicsos_learning', version: 0 })
    expect(Object.keys(oldUnit.tables).sort()).toEqual(['attempts', 'saved_scenes'])
    expect(oldUnit.tables.attempts[attemptKey(a.actor.userKey, attempt.id)]).toEqual(legacyAttempt.item)
    expect(oldUnit.tables.saved_scenes[savedSceneKey(a.actor.userKey, legacyScene.sceneId)]).toEqual(saved.item)

    const created = await create(fixture, a, 'shared-id', 'A private Canvas')
    expect(created.head).toMatchObject({ id: 'shared-id', title: 'A private Canvas', version: 1, generation: 1, changeSeq: 1 })
    expect(created.manifest).toMatchObject({ schemaVersion: 1, id: 'shared-id', nodes: [], instances: [], edges: [], snapshots: [], comparisons: [] })
    expect(created.head.manifestDigest).toBe(hash(canonicalBytes(created.manifest)))
    expect(created.head).not.toHaveProperty('userKey')
    expect(created.head).not.toHaveProperty('schoolId')

    const secondDevice = await fixture.login('canvas_a')
    const reopened = await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/shared-id`, undefined, secondDevice))
    expect(reopened).toEqual({ head: created.head, manifest: created.manifest })
    expect(await responseJson(await fixture.call('GET', '/physicsos/learning/attempts', undefined, secondDevice))).toEqual({ items: [legacyAttempt.item] })
    expect(await responseJson(await fixture.call('GET', '/physicsos/learning/scenes', undefined, secondDevice))).toEqual({ items: [saved.item] })

    for (const account of [b, admin]) {
      await failure(await fixture.call('GET', `${prefix}/shared-id`, undefined, account), 404, 'NOT_FOUND')
      await failure(await fixture.call('GET', `${prefix}/shared-id/objects/${created.head.manifestDigest}`, undefined, account), 404, 'NOT_FOUND')
      expect(await responseJson<CanvasListResponse>(await fixture.call('GET', prefix, undefined, account))).toEqual({ items: [] })
      expect(await changes(fixture, account)).toEqual({ changes: [], cursor: 0, hasMore: false })
    }
    await failure(await fixture.call('GET', `${prefix}/shared-id/objects/${'f'.repeat(64)}`, undefined, a), 404, 'OBJECT_NOT_FOUND')
    const ownB = await create(fixture, b, 'shared-id', 'B separate Canvas')
    await failure(await fixture.call('GET', `${prefix}/shared-id/objects/${created.head.manifestDigest}`, undefined, b), 404, 'OBJECT_NOT_FOUND')
    expect(ownB.head.changeSeq).toBe(1)
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/shared-id`, undefined, a))).toEqual({ head: created.head, manifest: created.manifest })

    for (const rawHeader of ['%zz', encodeURIComponent('{'), encodeURIComponent(canonicalStringify({ schoolId: a.user.schoolId, username: a.user.username, userKey: a.actor.userKey }))]) {
      await failure(await fixture.call('GET', `${prefix}/shared-id`, undefined, a, { 'x-physicsos-canvas-owner': rawHeader }), 400, 'BAD_ACCOUNT_HEADER')
    }
    await failure(await fixture.call('GET', `${prefix}/shared-id`, undefined, a, { 'x-physicsos-canvas-owner': canvasOwnerHeader(b.user) }), 401, 'ACCOUNT_CHANGED')
    await failure(await fixture.call('GET', `${prefix}/shared-id`, undefined, b, { 'x-physicsos-canvas-owner': a.ownerHeader }), 401, 'ACCOUNT_CHANGED')

    const stored = await fixture.readUnit(canvasDomain.name) as StoredUnit<typeof canvasDomain>
    expect(stored.unit).toEqual({ name: 'physicsos_canvas', version: 1 })
    expect(stored.global).toBeNull()
    expect(Object.keys(stored.tables).sort()).toEqual(['heads', 'objects', 'receipts', 'reservations', 'verifications'])
    expect(stored.tables.heads[canvasKey(a, 'shared-id')]).toMatchObject({ ...created.head, schoolId: a.user.schoolId, userKey: a.actor.userKey })
    expect(stored.tables.heads[canvasKey(b, 'shared-id')]).toMatchObject({ ...ownB.head, schoolId: b.user.schoolId, userKey: b.actor.userKey })
    expect(Object.values(stored.tables.objects).every(row => !('scene' in row) && !('manifest' in row))).toBe(true)
    expect(await readFile(legacyPath, 'utf8')).toBe(learningBytes)
    expect(learningDomain.version).toBe(0)
  })

  it('uploads canonical scene dependencies before their manifest and commits only a complete durable graph', async (test) => {
    const fixture = await loadCanvasFixture({ test })
    const account = await fixture.register('graph-owner')
    const created = await create(fixture, account, 'graph-canvas', 'Canonical graph')
    const graph = privateGraph(created)

    await failure(await fixture.raw('PUT', `${prefix}/graph-canvas/objects/${graph.manifest.digest}`, graph.manifest.bytes, account), 404, 'OBJECT_NOT_FOUND')
    await failure(await fixture.raw('PUT', `${prefix}/graph-canvas/objects/${graph.history.digest}`, graph.history.bytes, account), 404, 'OBJECT_NOT_FOUND')
    await failure(await fixture.call('POST', `${prefix}/graph-canvas/commit`, {
      expectedVersion: 1, mutationId: 'commit-before-upload', manifestDigest: graph.manifest.digest,
    } satisfies CanvasCommitRequest, account), 404, 'OBJECT_NOT_FOUND')
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/graph-canvas`, undefined, account))).toEqual({ head: created.head, manifest: created.manifest })

    for (const object of graph.uploads) {
      await upload(fixture, account, 'graph-canvas', object)
      expect(await readFile(fixture.blobPath(account, 'graph-canvas', object.digest))).toEqual(Buffer.from(object.bytes))
    }
    await upload(fixture, account, 'graph-canvas', graph.scene, true)
    const beforeCommit = await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/graph-canvas`, undefined, account))
    expect(beforeCommit.head).toEqual(created.head)
    const request: CanvasCommitRequest = { expectedVersion: created.head.version, expectedGeneration: created.head.generation, mutationId: 'commit-graph', manifestDigest: graph.manifest.digest }
    const committed = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/graph-canvas/commit`, request, account))
    expect(committed.replayed).toBe(false)
    expect(committed.head).toMatchObject({ version: 2, generation: 1, changeSeq: 2, manifestDigest: graph.manifest.digest })
    expect(committed.head.createdAt).toBe(created.head.createdAt)
    expect(committed.manifest).toEqual(graph.manifest.value)

    const device = await fixture.login('graph-owner')
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/graph-canvas`, undefined, device))).toEqual({ head: committed.head, manifest: graph.manifest.value })
    for (const object of graph.uploads) await download(fixture, device, 'graph-canvas', object)
    const stale = await failure(await fixture.call('POST', `${prefix}/graph-canvas/commit`, { ...request, mutationId: 'stale-device' }, device), 409, 'VERSION_CONFLICT')
    expect(stale.currentHead).toEqual(committed.head)
    const replay = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/graph-canvas/commit`, request, device))
    expect(replay).toEqual({ ...committed, replayed: true })
    await failure(await fixture.call('POST', `${prefix}/graph-canvas/commit`, { ...request, manifestDigest: created.head.manifestDigest }, account), 409, 'MUTATION_CONFLICT')
    expect(await changes(fixture, account)).toEqual({ changes: [{ seq: 2, operation: 'commit', mutationId: 'commit-graph', head: committed.head }], cursor: 2, hasMore: false })

    const stored = await fixture.readUnit(canvasDomain.name) as StoredUnit<typeof canvasDomain>
    expect(stored.tables.heads[canvasKey(account, 'graph-canvas')]).toMatchObject({ ...committed.head, userKey: account.actor.userKey, schoolId: account.actor.schoolId })
    expect(Object.values(stored.tables.objects)).toHaveLength(4)
    for (const object of graph.uploads) {
      expect(stored.tables.objects[canvasRecordKey(account.actor.schoolId, account.actor.userKey, 'graph-canvas', object.digest)]).toMatchObject({
        digest: object.digest, bytes: object.bytes.byteLength, status: 'ready', schoolId: account.actor.schoolId, userKey: account.actor.userKey,
      })
    }
    expect(Object.values(stored.tables.receipts).map(row => row.mutationId).sort()).toEqual(['commit-graph', 'create-graph-canvas'])
  })

  it('filters and keyset-sorts private lists while changes paginate committed heads and deleted tombstones', async (test) => {
    const fixture = await loadCanvasFixture({ test })
    const account = await fixture.register('list-owner')
    const zulu = await create(fixture, account, 'zulu', 'Zulu Electric')
    const beta = await create(fixture, account, 'beta', 'beta MAGNET')
    const alpha = await create(fixture, account, 'alpha', 'Alpha magnet')
    const alphaTwin = await create(fixture, account, 'alpha-twin', 'Alpha magnet')
    const page = await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?search=MAGNET&sort=title&order=asc&limit=2`, undefined, account))
    expect(page.items.map(head => head.id)).toEqual(['alpha', 'alpha-twin'])
    expect(page.nextCursor).toBeTypeOf('string')
    if (page.nextCursor === undefined) throw new Error('Canvas keyset page did not return its continuation')
    const next = await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?search=MAGNET&sort=title&order=asc&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`, undefined, account))
    expect(next.items.map(head => head.id)).toEqual(['beta'])
    expect(next.nextCursor).toBeUndefined()
    await failure(await fixture.call('GET', `${prefix}?search=Electric&sort=title&order=asc&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`, undefined, account), 400, 'BAD_CURSOR')
    const descending = await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?sort=title&order=desc`, undefined, account))
    expect(descending.items.map(head => head.id)).toEqual(['beta', 'zulu', 'alpha-twin', 'alpha'])

    const deleted = await responseJson<MutationResponse>(await fixture.call('DELETE', `${prefix}/beta`, { expectedVersion: beta.head.version, mutationId: 'delete-beta' } satisfies CanvasDeleteRequest, account))
    const live = await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?sort=title`, undefined, account))
    expect(live.items.map(head => head.id)).toEqual(['alpha', 'alpha-twin', 'zulu'])
    expect(await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?state=deleted&search=magnet`, undefined, account))).toEqual({ items: [deleted.head] })
    const all = await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?state=all&sort=title`, undefined, account))
    expect(all.items.map(head => head.id)).toEqual(['alpha', 'alpha-twin', 'zulu', 'beta'])
    const firstChanges = await changes(fixture, account, 0, 2)
    expect(firstChanges).toEqual({
      changes: [
        { seq: zulu.head.changeSeq, operation: 'create', mutationId: 'create-zulu', head: zulu.head },
        { seq: alpha.head.changeSeq, operation: 'create', mutationId: 'create-alpha', head: alpha.head },
      ], cursor: alpha.head.changeSeq, hasMore: true,
    })
    expect(await changes(fixture, account, firstChanges.cursor, 2)).toEqual({
      changes: [
        { seq: alphaTwin.head.changeSeq, operation: 'create', mutationId: 'create-alpha-twin', head: alphaTwin.head },
        { seq: deleted.head.changeSeq, operation: 'delete', mutationId: 'delete-beta', head: deleted.head },
      ], cursor: deleted.head.changeSeq, hasMore: false,
    })
    expect(deleted.head.deletedAt).toBeTypeOf('string')
    for (const query of ['limit=0', 'sort=bogus', 'state=bogus', 'order=bogus', 'limit=1&limit=2']) {
      await failure(await fixture.call('GET', `${prefix}?${query}`, undefined, account), 400, 'BAD_REQUEST')
    }
    await failure(await fixture.call('GET', `${prefix}/changes?cursor=-1`, undefined, account), 400, 'BAD_CURSOR')
  })

  it('renames with CAS and retains monotonic delete/restore generations and idempotent tombstone receipts', async (test) => {
    const fixture = await loadCanvasFixture({ test })
    const account = await fixture.register('lifecycle-owner')
    const created = await create(fixture, account, 'lifecycle', 'Original title')
    const renameRequest: CanvasRenameRequest = { expectedVersion: 1, mutationId: 'rename-title', title: 'Renamed title' }
    const renamed = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/lifecycle/rename`, renameRequest, account))
    expect(renamed.head).toMatchObject({ title: renameRequest.title, version: 2, generation: 1, changeSeq: 2 })
    expect(renamed.manifest.title).toBe(renameRequest.title)
    expect(renamed.manifest.createdAt).toBe(created.manifest.createdAt)
    expect(renamed.head.manifestDigest).toBe(hash(canonicalBytes(renamed.manifest)))
    await download(fixture, account, 'lifecycle', encoded(created.manifest))
    expect((await failure(await fixture.call('POST', `${prefix}/lifecycle/rename`, { ...renameRequest, mutationId: 'stale-rename' }, account), 409, 'VERSION_CONFLICT')).currentHead).toEqual(renamed.head)
    await failure(await fixture.call('POST', `${prefix}/lifecycle/rename`, { ...renameRequest, title: 'Different retry content' }, account), 409, 'MUTATION_CONFLICT')
    expect((await failure(await fixture.call('DELETE', `${prefix}/lifecycle`, { expectedVersion: 1, mutationId: 'stale-delete' }, account), 409, 'VERSION_CONFLICT')).currentHead).toEqual(renamed.head)

    const deleteRequest: CanvasDeleteRequest = { expectedVersion: renamed.head.version, mutationId: 'delete-lifecycle' }
    const deleted = await responseJson<MutationResponse>(await fixture.call('DELETE', `${prefix}/lifecycle`, deleteRequest, account))
    expect(deleted.head).toMatchObject({ version: 3, generation: 2, changeSeq: 3, manifestDigest: renamed.head.manifestDigest })
    expect(deleted.head.deletedAt).toBeTypeOf('string')
    expect(deleted.manifest).toEqual(renamed.manifest)
    expect(await changes(fixture, account, renamed.head.changeSeq)).toEqual({ changes: [{ seq: 3, operation: 'delete', mutationId: deleteRequest.mutationId, head: deleted.head }], cursor: 3, hasMore: false })
    expect((await failure(await fixture.call('GET', `${prefix}/lifecycle`, undefined, account), 410, 'DELETED')).currentHead).toEqual(deleted.head)
    await failure(await fixture.call('POST', `${prefix}/lifecycle/commit`, { expectedVersion: 2, mutationId: 'stale-save', manifestDigest: renamed.head.manifestDigest } satisfies CanvasCommitRequest, account), 410, 'DELETED')
    await failure(await fixture.call('POST', prefix, { id: 'lifecycle', title: 'Reused id', mutationId: 'recreate-deleted' } satisfies CanvasCreateRequest, account), 409, 'ID_CONFLICT')
    await download(fixture, account, 'lifecycle', encoded(renamed.manifest))

    const restoreRequest: CanvasRestoreRequest = { expectedVersion: deleted.head.version, expectedGeneration: deleted.head.generation, mutationId: 'restore-lifecycle' }
    expect((await failure(await fixture.call('POST', `${prefix}/lifecycle/restore`, { ...restoreRequest, expectedVersion: 2, mutationId: 'stale-restore-version' }, account), 409, 'VERSION_CONFLICT')).currentHead).toEqual(deleted.head)
    expect((await failure(await fixture.call('POST', `${prefix}/lifecycle/restore`, { ...restoreRequest, expectedGeneration: 1, mutationId: 'stale-restore-generation' }, account), 409, 'VERSION_CONFLICT')).currentHead).toEqual(deleted.head)
    const restored = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/lifecycle/restore`, restoreRequest, account))
    expect(restored.head).toMatchObject({ version: 4, generation: 3, changeSeq: 4, title: renamed.head.title, manifestDigest: renamed.head.manifestDigest })
    expect(restored.head).not.toHaveProperty('deletedAt')
    expect(restored.manifest).toEqual(renamed.manifest)
    expect(await changes(fixture, account, deleted.head.changeSeq)).toEqual({ changes: [{ seq: 4, operation: 'restore', mutationId: restoreRequest.mutationId, head: restored.head }], cursor: 4, hasMore: false })
    expect(await responseJson<MutationResponse>(await fixture.call('DELETE', `${prefix}/lifecycle`, deleteRequest, account))).toEqual({ ...deleted, replayed: true })
    expect(await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/lifecycle/restore`, restoreRequest, account))).toEqual({ ...restored, replayed: true })
    expect(await changes(fixture, account, restored.head.changeSeq)).toEqual({ changes: [], cursor: 4, hasMore: false })
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/lifecycle`, undefined, account))).toEqual({ head: restored.head, manifest: restored.manifest })
    expect(await responseJson<CanvasListResponse>(await fixture.call('GET', `${prefix}?state=deleted`, undefined, account))).toEqual({ items: [] })
    const stored = await fixture.readUnit(canvasDomain.name) as StoredUnit<typeof canvasDomain>
    expect(stored.tables.heads[canvasKey(account, 'lifecycle')]).toMatchObject(restored.head)
    expect(Object.values(stored.tables.receipts).map(row => row.head.version).sort()).toEqual([1, 2, 3, 4])
  })

  it('rejects malformed UTF-8/JSON and applies the byte limit to the complete HTTP request envelope', async (test) => {
    const fixture = await loadCanvasFixture({ test, canvasLimits: {
      maxRequestBytes: 400, maxObjectBytes: 400, maxHeadBytes: 8192, maxMetadataBytes: 8192,
      maxDocumentBytes: 128 * 1024, maxAccountBytes: 256 * 1024, maxVerificationAttemptBytes: 64 * 1024,
      maxTitleBytes: 128, maxSearchBytes: 16, maxPageSize: 2, defaultPageSize: 1,
      maxObjectsPerDocument: 16, maxClosureObjects: 32,
    } })
    const account = await fixture.register('wire-owner')
    expect(fixture.config.limits.maxRequestBytes).toBe(400)
    await failure(await fixture.raw('POST', prefix, '{', account), 400, 'BAD_REQUEST')
    const invalidUtf8 = Buffer.concat([
      Buffer.from('{"id":"utf8","title":"'), Buffer.from([0xc3, 0x28]), Buffer.from('","mutationId":"utf8-create"}'),
    ])
    await failure(await fixture.raw('POST', prefix, invalidUtf8, account), 400, 'BAD_REQUEST')
    await failure(await fixture.call('POST', prefix, { id: 'surrogate', title: '\ud800', mutationId: 'surrogate-create' }, account), 400, 'BAD_REQUEST')
    const small: CanvasCreateRequest = { id: 'wire-exact', title: 'Exact request', mutationId: 'wire-create' }
    await failure(await fixture.raw('POST', prefix, JSON.stringify(small), account, { 'content-type': 'text/plain' }), 415, 'UNSUPPORTED_MEDIA_TYPE')
    await failure(await fixture.call('POST', prefix, small, account, { origin: 'https://another.invalid' }), 403, 'FORBIDDEN')
    await failure(await fixture.call('POST', prefix, small, account, { 'sec-fetch-site': 'cross-site' }), 403, 'FORBIDDEN')
    await failure(await fixture.call('POST', prefix, { ...small, schoolId: 'forged', userKey: 'forged:owner', role: 'SUPER_ADMIN' }, account), 400, 'BAD_REQUEST')

    const envelope: CanvasCreateRequest = { id: 'i'.repeat(128), title: '界'.repeat(42), mutationId: 'm'.repeat(128) }
    const envelopeText = canonicalStringify(envelope)
    expect(Buffer.byteLength(envelope.title, 'utf8')).toBeLessThanOrEqual(fixture.config.limits.maxTitleBytes)
    expect(envelopeText.length).toBeLessThan(fixture.config.limits.maxRequestBytes)
    expect(Buffer.byteLength(envelopeText, 'utf8')).toBeGreaterThan(fixture.config.limits.maxRequestBytes)
    await failure(await fixture.raw('POST', prefix, envelopeText, account), 413, 'PAYLOAD_TOO_LARGE')
    expect(fixture.domain.table('heads').size).toBe(0)
    expect(fixture.domain.table('objects').size).toBe(0)

    const text = canonicalStringify(small)
    const exact = `${text}${' '.repeat(fixture.config.limits.maxRequestBytes - Buffer.byteLength(text, 'utf8'))}`
    expect(Buffer.byteLength(exact, 'utf8')).toBe(fixture.config.limits.maxRequestBytes)
    const accepted = await responseJson<MutationResponse>(await fixture.raw('POST', prefix, exact, account), 201)
    expect(accepted.head).toMatchObject({ id: small.id, version: 1 })
    const over = canonicalStringify({ ...small, id: 'wire-over', mutationId: 'wire-over-create' })
    const oversized = `${over}${' '.repeat(fixture.config.limits.maxRequestBytes + 1 - Buffer.byteLength(over, 'utf8'))}`
    await failure(await fixture.raw('POST', prefix, oversized, account), 413, 'PAYLOAD_TOO_LARGE')
    await failure(await fixture.call('POST', prefix, { id: 'title-over', title: '界'.repeat(43), mutationId: 'title-over-create' }, account), 413, 'TITLE_TOO_LARGE')
    await failure(await fixture.call('GET', `${prefix}?search=${encodeURIComponent('界'.repeat(6))}`, undefined, account), 413, 'SEARCH_TOO_LARGE')
    expect(await responseJson<CanvasListResponse>(await fixture.call('GET', prefix, undefined, account))).toEqual({ items: [accepted.head] })
  })

  it('measures complete canonical object bytes, accepts the exact limit, and refuses invalid or noncanonical uploads without publication', async (test) => {
    const fixture = await loadCanvasFixture({ test, canvasLimits: {
      maxRequestBytes: 2048, maxObjectBytes: 1024, maxHeadBytes: 8192, maxMetadataBytes: 8192,
      maxDocumentBytes: 128 * 1024, maxAccountBytes: 256 * 1024, maxVerificationAttemptBytes: 64 * 1024,
      maxTitleBytes: 128, maxObjectsPerDocument: 16, maxClosureObjects: 32,
    } })
    const account = await fixture.register('object-bytes-owner')
    const created = await create(fixture, account, 'object-bytes', 'Bytes')
    const empty = { ...created.manifest, metadata: { text: '' } }
    const remaining = fixture.config.limits.maxObjectBytes - canonicalByteLength(empty)
    expect(remaining).toBeGreaterThan(0)
    const padding = `${'界'.repeat(Math.floor(remaining / 3))}${'a'.repeat(remaining % 3)}`
    const value = { ...empty, metadata: { text: padding } }
    const object = encoded(value)
    expect(object.bytes.byteLength).toBe(fixture.config.limits.maxObjectBytes)
    expect(padding.length).toBeLessThan(fixture.config.limits.maxObjectBytes)
    await upload(fixture, account, 'object-bytes', object)
    await download(fixture, account, 'object-bytes', object)
    const count = fixture.domain.table('objects').size
    const tooLarge = encoded({ ...value, metadata: { text: `${padding}a` } })
    expect(tooLarge.bytes.byteLength).toBe(fixture.config.limits.maxObjectBytes + 1)
    expect(tooLarge.bytes.byteLength).toBeLessThan(fixture.config.limits.maxRequestBytes)
    await failure(await fixture.raw('PUT', `${prefix}/object-bytes/objects/${tooLarge.digest}`, tooLarge.bytes, account), 413, 'OBJECT_TOO_LARGE')
    for (const invalid of [Buffer.from('{'), Buffer.from([0x7b, 0xff, 0x7d])]) {
      await failure(await fixture.raw('PUT', `${prefix}/object-bytes/objects/${hash(invalid)}`, invalid, account), 400, 'BAD_OBJECT')
    }
    const noncanonical = Buffer.from(`${canonicalStringify(created.manifest)}\n`)
    await failure(await fixture.raw('PUT', `${prefix}/object-bytes/objects/${hash(noncanonical)}`, noncanonical, account), 400, 'NON_CANONICAL_OBJECT')
    await failure(await fixture.raw('PUT', `${prefix}/object-bytes/objects/${'0'.repeat(64)}`, canonicalBytes(created.manifest), account), 400, 'DIGEST_MISMATCH')
    const forged = canonicalBytes({ ...created.manifest, userKey: 'another:account' })
    await failure(await fixture.raw('PUT', `${prefix}/object-bytes/objects/${hash(forged)}`, forged, account), 400, 'BAD_OBJECT')
    expect(fixture.domain.table('objects').size).toBe(count)
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/object-bytes`, undefined, account))).toEqual({ head: created.head, manifest: created.manifest })
    const committed = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/object-bytes/commit`, {
      expectedVersion: 1, mutationId: 'commit-exact-object', manifestDigest: object.digest,
    } satisfies CanvasCommitRequest, account))
    expect(committed.head.version).toBe(2)
    expect(committed.manifest).toEqual(value)
    expect(await readFile(fixture.blobPath(account, 'object-bytes', object.digest))).toEqual(Buffer.from(object.bytes))
    const stored = await fixture.readUnit(canvasDomain.name) as StoredUnit<typeof canvasDomain>
    expect(stored.tables.objects[canvasRecordKey(account.actor.schoolId, account.actor.userKey, 'object-bytes', object.digest)]?.bytes).toBe(1024)
  })

  it('unregisters learning routes on fiber disposal and reopens durable heads, full private blobs, and original mutation receipts with a new Loader', async (test) => {
    const fixture = await loadCanvasFixture({ test })
    const account = await fixture.register('restart-owner')
    const device = await fixture.login('restart-owner')
    const created = await create(fixture, account, 'restart-canvas', 'Before restart')
    const graph = privateGraph(created)
    for (const object of graph.uploads) await upload(fixture, account, 'restart-canvas', object)
    const commitRequest: CanvasCommitRequest = { expectedVersion: 1, expectedGeneration: 1, mutationId: 'restart-commit', manifestDigest: graph.manifest.digest }
    const committed = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/restart-canvas/commit`, commitRequest, account))
    const renamed = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/restart-canvas/rename`, {
      expectedVersion: committed.head.version, mutationId: 'restart-rename', title: 'Durable renamed Canvas',
    } satisfies CanvasRenameRequest, account))
    const originalContext = fixture.context
    const facility = originalContext.storageDomain
    const learningEntry = [...originalContext.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-learning-host')
    if (learningEntry?.fiber === undefined) throw new Error('Real Loader did not own a learning-host fiber')
    expect(facility.get('physicsos_learning')).toBeDefined()
    expect(facility.get('physicsos_canvas')).toBeDefined()
    await learningEntry.fiber.dispose()
    expect(facility.get('physicsos_learning')).toBeUndefined()
    expect(facility.get('physicsos_canvas')).toBeUndefined()
    for (const path of [`${prefix}/restart-canvas`, '/physicsos/learning/attempts']) {
      const unregistered = await fixture.call('GET', path, undefined, device)
      expect(unregistered.status).toBe(404)
      expect(await unregistered.text()).toBe('')
    }
    expect(await responseJson(await fixture.call('GET', '/physicsos/auth/me', undefined, device))).toMatchObject({ user: { username: account.user.username } })
    expect(await readFile(fixture.blobPath(account, 'restart-canvas', graph.scene.digest))).toEqual(Buffer.from(graph.scene.bytes))
    const persistedBeforeRestart = await fixture.readUnit(canvasDomain.name) as StoredUnit<typeof canvasDomain>
    expect(persistedBeforeRestart.tables.heads[canvasKey(account, 'restart-canvas')]).toMatchObject(renamed.head)

    await fixture.restart()
    expect(fixture.context).not.toBe(originalContext)
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/restart-canvas`, undefined, device))).toEqual({ head: renamed.head, manifest: renamed.manifest })
    for (const object of graph.uploads) await download(fixture, device, 'restart-canvas', object)
    await download(fixture, device, 'restart-canvas', encoded(renamed.manifest))
    const reauthenticated = await fixture.login('restart-owner')
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/restart-canvas`, undefined, reauthenticated))).toEqual({ head: renamed.head, manifest: renamed.manifest })
    const canvasPath = join(fixture.root, 'storages', 'physicsos_canvas.json')
    const beforeRetries = await readFile(canvasPath, 'utf8')
    const replay = await responseJson<MutationResponse>(await fixture.call('POST', `${prefix}/restart-canvas/commit`, commitRequest, device))
    expect(replay).toEqual({ ...committed, replayed: true })
    const createRetry: CanvasCreateRequest = { id: 'restart-canvas', title: 'Before restart', mutationId: 'create-restart-canvas' }
    expect(await responseJson<MutationResponse>(await fixture.call('POST', prefix, createRetry, reauthenticated))).toEqual({ ...created, replayed: true })
    expect(await changes(fixture, reauthenticated, renamed.head.changeSeq)).toEqual({ changes: [], cursor: renamed.head.changeSeq, hasMore: false })
    expect(await responseJson<CanvasOpenResponse>(await fixture.call('GET', `${prefix}/restart-canvas`, undefined, account))).toEqual({ head: renamed.head, manifest: renamed.manifest })
    expect(await readFile(canvasPath, 'utf8')).toBe(beforeRetries)
  })
})
