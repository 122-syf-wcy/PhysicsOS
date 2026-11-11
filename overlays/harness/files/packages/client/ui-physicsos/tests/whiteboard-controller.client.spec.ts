import { describe, expect, it } from 'vitest'
import type { DrawingDiagram, SourceImage, WhiteboardDocument } from '@physicsos/physics-whiteboard'
import { createWhiteboardController, type WhiteboardDraft } from '../src/client/whiteboard/controller.ts'
import type { WhiteboardApi, WhiteboardGeneration, WhiteboardRecord } from '../src/client/whiteboard/api.ts'

const source: SourceImage = { id: 'img-1', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 800, height: 400, byteLength: 90, viewBox: { x: 0, y: 0, width: 800, height: 400 } }
const diagram: DrawingDiagram = { schemaVersion: 1, sourceImageId: source.id, sourceImageSha256: source.sha256, viewBox: source.viewBox,
  primitives: [{ id: 'surface', type: 'line', points: [[20, 300], [780, 300]] }], uncertainties: [] }
const document: WhiteboardDocument = { schemaVersion: 1, id: 'board-1', title: 'Lesson', scene: { elements: [], appState: {} }, sourceImages: [source], appliedGenerationIds: [] }
const record: WhiteboardRecord = { document, revision: 1, updatedAt: '2026-11-10T01:00:00Z' }
const job: WhiteboardGeneration = { id: 'job-1', whiteboardId: 'board-1', imageId: 'img-1', status: 'queued' }
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

function fixture(overrides: Partial<WhiteboardApi> = {}) {
  let namespace: string | undefined = 'account-a'
  let counter = 0
  let remote = structuredClone(record)
  const drafts = new Map<string, WhiteboardDraft>()
  const api: WhiteboardApi = {
    list: async () => [{ id: 'board-1', title: remote.document.title, revision: remote.revision, updatedAt: remote.updatedAt }],
    create: async input => ({ ...record, document: { ...document, id: 'board-new', title: input.title } }),
    read: async () => remote,
    save: async input => { if (input.expectedRevision !== remote.revision) throw Object.assign(new Error('Revision changed'), { status: 409 }); remote = { document: input.document, revision: remote.revision + 1, updatedAt: record.updatedAt }; return remote },
    uploadImage: async () => source,
    readImage: async () => ({ source, blob: new Blob(['owned image bytes'], { type: 'image/png' }) }),
    startGeneration: async () => job,
    readGeneration: async () => ({ ...job, status: 'ready', result: diagram }),
    cancelGeneration: async () => ({ ...job, status: 'cancelled' }),
    ...overrides,
  }
  const controller = createWhiteboardController({ api, getNamespace: () => namespace, id: () => `operation-${++counter}`,
    cache: { read: async (owner, id) => drafts.get(`${owner}:${id}`), write: async (owner, id, draft) => { drafts.set(`${owner}:${id}`, structuredClone(draft)) } },
    schedule: () => undefined, cancelSchedule: () => undefined,
  })
  return { controller, drafts, setNamespace: (owner: string | undefined) => { namespace = owner; controller.resetNamespace() }, remote: () => remote }
}

describe('owned durable whiteboard editing', () => {
  it('opens a saved full scene and preserves edits made while an earlier save is in flight', async () => {
    const first = deferred<WhiteboardRecord>()
    const requestSent = deferred<void>()
    let saved = 0
    const captures: WhiteboardDocument[] = []
    const f = fixture({ save: async input => { captures.push(input.document); requestSent.resolve(); saved += 1; return saved === 1 ? first.promise : { ...record, document: input.document, revision: 3 } } })
    await f.controller.open('board-1')
    f.controller.edit({ elements: [{ id: 'pen-first', type: 'freedraw', points: [[0, 0], [1, 2]], pressures: [0.2, 0.9] }], appState: {} })
    const saving = f.controller.save()
    await requestSent.promise
    f.controller.edit({ elements: [{ id: 'pen-first', type: 'freedraw', points: [[0, 0], [1, 2]], pressures: [0.2, 0.9] }, { id: 'label-late', type: 'text', text: 'F' }], appState: {} })
    first.resolve({ ...record, document: captures[0]!, revision: 2 })
    await saving
    expect(f.controller.getSnapshot().record?.document.scene.elements).toHaveLength(2)
    expect(captures.at(-1)?.scene.elements).toHaveLength(2)
    expect(f.controller.getSnapshot().dirty).toBe(false)
  })
  it('recovers full offline pressure strokes from its account-scoped draft without replacing them with an older server head', async () => {
    const f = fixture()
    await f.controller.open('board-1')
    f.controller.edit({ elements: [{ id: 'pressure', type: 'freedraw', points: [[1, 2], [3, 4]], pressures: [0.11, 0.91] }], appState: { scrollX: 11 } })
    await Promise.resolve(); await Promise.resolve()
    f.controller.close()
    await f.controller.open('board-1')
    expect(f.controller.getSnapshot().record?.document.scene).toEqual({ elements: [{ id: 'pressure', type: 'freedraw', points: [[1, 2], [3, 4]], pressures: [0.11, 0.91] }], appState: { scrollX: 11 } })
    expect(f.controller.getSnapshot().dirty).toBe(true)
    f.setNamespace('account-b')
    await f.controller.open('board-1')
    expect(f.controller.getSnapshot().record?.document.scene.elements).toEqual([])
  })
  it('retries the same lost-response operation receipt instead of issuing a second mutation', async () => {
    const identities: string[] = []
    let attempts = 0
    const f = fixture({ save: async input => { identities.push(input.operationId); if (++attempts === 1) throw new Error('Response was lost'); return { ...record, document: input.document, revision: 2 } } })
    await f.controller.open('board-1')
    f.controller.edit({ elements: [{ id: 'line', type: 'line', points: [[0, 0], [2, 3]] }], appState: {} })
    await expect(f.controller.save()).rejects.toThrow('Response was lost')
    expect(f.controller.getSnapshot().dirty).toBe(true)
    await f.controller.save()
    expect(identities).toHaveLength(2)
    expect(identities[1]).toBe(identities[0])
    expect(f.controller.getSnapshot().status).toBe('saved')
  })
  it('retains local edits on CAS conflict and does not claim they were saved', async () => {
    const f = fixture({ save: async () => { throw Object.assign(new Error('Changed on another device'), { status: 409 }) } })
    await f.controller.open('board-1')
    f.controller.rename('Unsaved lesson')
    await expect(f.controller.save()).rejects.toThrow('Changed on another device')
    expect(f.controller.getSnapshot()).toMatchObject({ dirty: true, status: 'conflict' })
    expect(f.controller.getSnapshot().record?.document.title).toBe('Unsaved lesson')
  })
  it('reloads an explicitly requested server head instead of accidentally reusing its dirty local draft', async () => {
    const f = fixture()
    await f.controller.open('board-1')
    f.controller.rename('Uncommitted title')
    await f.controller.reload()
    expect(f.controller.getSnapshot().record?.document.title).toBe('Lesson')
    expect(f.controller.getSnapshot().dirty).toBe(false)
  })
  it('discards an old read completion after switching accounts', async () => {
    const read = deferred<WhiteboardRecord>()
    const f = fixture({ read: async () => read.promise })
    const opening = f.controller.open('board-1')
    f.setNamespace('account-b')
    read.resolve(record)
    await opening
    expect(f.controller.getSnapshot()).toMatchObject({ namespace: 'account-b', dirty: false })
    expect(f.controller.getSnapshot().record).toBeUndefined()
  })
  it('inserts a validated ready diagram into the current human scene once and reveals only real output', async () => {
    const f = fixture()
    await f.controller.open('board-1')
    await f.controller.generate('img-1')
    expect(f.controller.getSnapshot().revealId).toBeUndefined()
    f.controller.edit({ elements: [{ id: 'late-pen', type: 'freedraw', points: [[1, 2], [3, 4]], pressures: [0.3, 0.8] }], appState: {} })
    await f.controller.poll()
    expect(f.controller.getSnapshot().record?.document.scene.elements).toMatchObject([{ id: 'late-pen' }, { id: 'generation:job-1:surface', type: 'line', x: 20, y: 300, width: 760 }])
    expect(f.controller.getSnapshot().revealId).toBe('job-1')
    await f.controller.poll()
    expect(f.controller.getSnapshot().record?.document.scene.elements).toHaveLength(2)
  })
  it('ignores ready completion after cancel, including an already pending poll', async () => {
    const read = deferred<WhiteboardGeneration>()
    const f = fixture({ readGeneration: async () => read.promise })
    await f.controller.open('board-1')
    await f.controller.generate('img-1')
    const polling = f.controller.poll()
    await f.controller.cancelGeneration()
    read.resolve({ ...job, status: 'ready', result: diagram })
    await polling
    expect(f.controller.getSnapshot().job?.status).toBe('cancelled')
    expect(f.controller.getSnapshot().record?.document.scene.elements).toEqual([])
  })
  it('refuses foreign ready output and reports source mismatch as error', async () => {
    const f = fixture({ readGeneration: async () => ({ ...job, status: 'ready', result: { ...diagram, sourceImageSha256: 'b'.repeat(64) } }) })
    await f.controller.open('board-1')
    await f.controller.generate('img-1')
    await expect(f.controller.poll()).rejects.toThrow(/source|hash/i)
    expect(f.controller.getSnapshot().revealId).toBeUndefined()
    expect(f.controller.getSnapshot().job?.status).toBe('error')
    expect(f.controller.getSnapshot().record?.document.scene.elements).toEqual([])
  })
  it('rejects a ready task with no real primitive artifact', async () => {
    const f = fixture({ readGeneration: async () => ({ ...job, status: 'ready' }) })
    await f.controller.open('board-1')
    await f.controller.generate('img-1')
    await expect(f.controller.poll()).rejects.toThrow(/artifact|result|diagram/i)
    expect(f.controller.getSnapshot().revealId).toBeUndefined()
    expect(f.controller.getSnapshot().record?.document.scene.elements).toEqual([])
  })
  it('reuses the exact generation operation after a lost start response', async () => {
    const identities: string[] = []
    const f = fixture({ startGeneration: async input => { identities.push(input.operationId); if (identities.length === 1) throw new Error('Start response lost'); return job } })
    await f.controller.open('board-1')
    await expect(f.controller.generate('img-1')).rejects.toThrow('Start response lost')
    await f.controller.generate('img-1')
    expect(identities).toHaveLength(2)
    expect(identities[1]).toBe(identities[0])
    expect(f.controller.getSnapshot().job?.id).toBe('job-1')
  })
  it('resumes the actual server-owned generation job after a fresh document load', async () => {
    const f = fixture({ read: async () => ({ ...record, activeGeneration: { jobId: 'job-1', imageId: 'img-1' } }) })
    await f.controller.open('board-1')
    await f.controller.poll()
    expect(f.controller.getSnapshot().record?.document.scene.elements).toMatchObject([{ id: 'generation:job-1:surface' }])
    expect(f.controller.getSnapshot().revealId).toBe('job-1')
  })
  it('keeps real job state retryable when a polling response is lost', async () => {
    let reads = 0
    const f = fixture({ readGeneration: async () => { if (++reads === 1) throw new Error('Network interrupted'); return { ...job, status: 'ready', result: diagram } } })
    await f.controller.open('board-1'); await f.controller.generate('img-1')
    await expect(f.controller.poll()).rejects.toThrow('Network interrupted')
    expect(f.controller.getSnapshot().job?.status).toBe('queued')
    await f.controller.poll()
    expect(f.controller.getSnapshot().record?.document.scene.elements).toHaveLength(1)
  })

  it('preserves local work as conflict when replayed save receipt is older than the observed server head', async () => {
    const local = { ...document, title: 'Local draft' }
    const f = fixture({ read: async () => ({ ...record, revision: 3, document: { ...document, title: 'Other device' } }), save: async () => ({ ...record, revision: 2, document: local }) })
    f.drafts.set('account-a:board-1', { record: { ...record, document: local }, dirty: true, pendingSave: { document: local, expectedRevision: 1, operationId: 'old-receipt' } })
    await f.controller.open('board-1')
    await expect(f.controller.save()).rejects.toMatchObject({ status: 409 })
    expect(f.controller.getSnapshot()).toMatchObject({ status: 'conflict', dirty: true, record: { document: { title: 'Local draft' } } })
  })

  it('restores the saved undo and redo differences across normal close and reopening', async () => {
    const f = fixture(); await f.controller.open('board-1')
    const scene = { elements: [{ id: 'pen', type: 'freedraw', points: [[0, 0], [1, 2]], pressures: [0.1, 0.9] }], appState: {} }
    f.controller.edit(scene); await f.controller.save(); f.controller.close(); await f.controller.open('board-1')
    expect(f.controller.getSnapshot().record?.document.history?.undo).toHaveLength(1)
    f.controller.undo(); expect(f.controller.getSnapshot().record?.document.scene.elements).toEqual([])
    await f.controller.save(); f.controller.close(); await f.controller.open('board-1')
    f.controller.redo(); expect(f.controller.getSnapshot().record?.document.scene).toEqual(scene)
  })
  it('recovers a ready job without a cached draft and includes its insertion in durable undo', async () => {
    const f = fixture({ read: async () => ({ ...record, recoverableGenerations: [{ jobId: job.id, imageId: source.id, status: 'ready' }] }) })
    await f.controller.open('board-1')
    expect(f.controller.getSnapshot().record?.document.scene.elements).toHaveLength(1)
    f.controller.undo(); expect(f.controller.getSnapshot().record?.document.scene.elements).toEqual([])
    f.controller.redo(); expect(f.controller.getSnapshot().record?.document.scene.elements).toHaveLength(1)
  })

})
