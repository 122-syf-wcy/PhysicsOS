import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished } from 'vitest'
import { diffScene, insertDiagram, type WhiteboardDocument } from '@physicsos/physics-whiteboard'
import type { UsageModelReceiptInput } from '../src/usage-types.ts'
import { CanvasBlobStore, canvasHash } from '../src/canvas-blob-store.ts'
import { openWhiteboardDomain } from '../src/whiteboard-domain.ts'
import { createWhiteboardModel } from '../src/whiteboard-model.ts'
import { WhiteboardService } from '../src/whiteboard-service.ts'
import type { WhiteboardModel, WhiteboardServiceOptions } from '../src/whiteboard-types.ts'
const a = { schoolId: 'school-a', userKey: 'school-a:teacher', username: 'teacher', role: 'TEACHER' as const }
const b = { ...a, userKey: 'school-a:other', username: 'other' }
async function fixture(overrides: Partial<WhiteboardModel> = {}, settings: Partial<WhiteboardServiceOptions> = {}) {
  const path = await mkdtemp(join(tmpdir(), 'whiteboard-real-storage-'))
  let ctx: Context; let backend: JsonStorageBackend; let service: WhiteboardService
  let draws = 0; const receipts: string[] = []
  const model: WhiteboardModel = { provider: 'test-provider', model: 'test-vision', prepareImage: async () => ({ width: 800, height: 400, attachment: { attachmentId: 'test-image', width: 800, height: 400 } }),
    draw: async request => { draws++; return { diagram: { schemaVersion: 1, sourceImageId: request.source.id, sourceImageSha256: request.source.sha256, viewBox: request.source.viewBox, primitives: [{ id: 'rail', type: 'line', points: [[10, 300], [790, 300]] }], uncertainties: [] }, usage: { inputTokens: 10, outputTokens: 5 } } }, ...overrides }
  const providerModel: WhiteboardModel = { ...model, draw: async (request, signal, onRequestStart) => { await onRequestStart?.(); return model.draw(request, signal) } }
  const open = async () => { ctx = new Context(); await ctx.plugin(Storage); backend = new JsonStorageBackend(join(path, 'domain')); ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' })); service = new WhiteboardService(await openWhiteboardDomain(ctx), new CanvasBlobStore(join(path, 'physicsos', 'canvases', 'v1')), { model: providerModel, recordUsage: async input => { receipts.push(input.id) }, ...settings }); await service.initialize() }
  const close = async () => { await service?.dispose(); await service?.domain.close(); await backend?.close(); await ctx?.fiber.dispose() }
  onTestFinished(async () => { await close(); await rm(path, { recursive: true, force: true }) })
  await open()
  return { get service() { return service }, get draws() { return draws }, receipts, restart: async () => { await close(); await open() } }
}
async function withImage(f: Awaited<ReturnType<typeof fixture>>) {
  const record = await f.service.create(a, { title: 'Lesson', operationId: 'create' })
  const source = await f.service.upload(a, record.document.id, { mimeType: 'image/png', base64: Buffer.from('exact-original-bytes').toString('base64'), operationId: 'image' })
  const saved = await f.service.save(a, record.document.id, { document: { ...record.document, sourceImages: [source] }, expectedRevision: 1, operationId: 'attach-image' })
  return { record: saved, source }
}
const waitReady = async (service: WhiteboardService, boardId: string, jobId: string) => { for (let i = 0; i < 80; i++) { const job = await service.readGeneration(a, boardId, jobId); if (['ready', 'error', 'cancelled'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 10)) }; throw new Error('Job did not settle') }
describe('real durable whiteboard storage and jobs', () => {
  it('preserves full pressure strokes and exact CAS receipts across restart and rejects foreign ownership', async () => {
    const f = await fixture(); const record = await f.service.create(a, { title: 'Lesson', operationId: 'create-1' })
    const points = Array.from({ length: 5001 }, (_, i) => [i / 8, (i % 113) / 7]); const pressures = points.map((_, i) => (i % 100) / 100)
    const payload = { document: { ...record.document, scene: { elements: [{ id: 'pen', type: 'freedraw', points, pressures }], appState: { zoom: { value: 2 } } } }, expectedRevision: 1, operationId: 'save-1' }
    const saved = await f.service.save(a, record.document.id, payload)
    expect(saved.revision).toBe(2)
    await f.restart()
    expect(await f.service.save(a, record.document.id, payload)).toEqual(saved)
    expect((await f.service.read(a, record.document.id)).document.scene.elements[0]).toMatchObject({ points, pressures })
    await expect(f.service.read(b, record.document.id)).rejects.toMatchObject({ status: 404 })
    await expect(f.service.save(a, record.document.id, { ...payload, operationId: 'other' })).rejects.toMatchObject({ status: 409 })
    expect(await f.service.list(b)).toEqual([])
  })
  it('retains original bytes privately without bumping the document revision until the explicit CAS save', async () => {
    const f = await fixture(); const { record, source } = await withImage(f)
    expect(record.revision).toBe(2)
    await f.restart()
    const original = await f.service.readImage(a, record.document.id, source.id)
    expect(Buffer.from(original.base64, 'base64').toString()).toBe('exact-original-bytes')
    await expect(f.service.readImage(b, record.document.id, source.id)).rejects.toMatchObject({ status: 404 })
  })
  it('singleflights one exact generation receipt and persists the validated artifact and usage', async () => {
    const f = await fixture(); const { record, source } = await withImage(f)
    const input = { imageId: source.id, expectedRevision: record.revision, operationId: 'generate-1' }
    const [first, second] = await Promise.all([f.service.generate(a, record.document.id, input), f.service.generate(a, record.document.id, input)])
    expect(first.id).toBe(second.id)
    const ready = await waitReady(f.service, record.document.id, first.id)
    expect(ready.status).toBe('ready'); expect(ready.result?.primitives).toHaveLength(1); expect(f.draws).toBe(1)
    await f.restart()
    expect((await f.service.readGeneration(a, record.document.id, first.id)).result).toEqual(ready.result)
    expect(f.receipts).toHaveLength(1)
    expect((await f.service.read(a, record.document.id)).document.scene.elements).toEqual([])
  })
  it('rejects foreign/malformed model output as a real error without a ready artifact', async () => {
    const f = await fixture({ draw: async () => ({ diagram: { schemaVersion: 1, primitives: [] } }) }); const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'bad-model' })
    const result = await waitReady(f.service, record.document.id, job.id)
    expect(result.status).toBe('error'); expect(result.result).toBeUndefined(); expect(result.error).not.toContain('stack')
  })
  it('cancels a pending model operation and cannot publish a late successful result', async () => {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve })
    const f = await fixture({ draw: async request => { await waiting; return { diagram: { schemaVersion: 1, sourceImageId: request.source.id, sourceImageSha256: request.source.sha256, viewBox: request.source.viewBox, primitives: [{ id: 'rail', type: 'line', points: [[1, 1], [2, 2]] }], uncertainties: [] } } } }); const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'cancel-model' })
    await f.service.cancelGeneration(a, record.document.id, job.id, { operationId: 'cancel-1' }); release()
    expect((await waitReady(f.service, record.document.id, job.id)).status).toBe('cancelled')
  })
  it('settles an aborted model timeout as error instead of leaving validating forever', async () => {
    const f = await fixture({ draw: async (_request, signal) => { await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }) }); return { error: 'MODEL_ABORTED' } } }, { jobTimeoutMs: 20 })
    const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'timeout-model' })
    expect((await waitReady(f.service, record.document.id, job.id)).status).toBe('error')
  })

  it('recovers an interrupted draw as an explicit error and records missing usage once without duplicating the model call', async () => {
    let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve })
    const f = await fixture({ draw: async (_request, signal) => { started(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return { error: 'MODEL_ABORTED' } } })
    const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'restart-model' })
    await entered; await f.restart()
    expect((await f.service.readGeneration(a, record.document.id, job.id)).status).toBe('error')
    expect(f.receipts).toHaveLength(1)
    await f.restart(); expect(f.receipts).toHaveLength(1)
  })

  it('advertises a ready unapplied artifact to a fresh device until its insertion is saved', async () => {
    const f = await fixture(); const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'offline-ready' })
    const ready = await waitReady(f.service, record.document.id, job.id)
    await f.restart()
    const restored = await f.service.read(a, record.document.id)
    expect(restored.recoverableGenerations).toContainEqual({ jobId: job.id, imageId: source.id, status: 'ready' })
    const applied = insertDiagram(restored.document, ready.result!, job.id)
    await f.service.save(a, record.document.id, { document: applied, expectedRevision: restored.revision, operationId: 'apply-recovered' })
    expect((await f.service.read(a, record.document.id)).recoverableGenerations ?? []).not.toContainEqual({ jobId: job.id, imageId: source.id, status: 'ready' })
    expect(f.draws).toBe(1)
  })
  it('retains received numerical usage when the output exceeds the independent artifact byte limit', async () => {
    const recorded: UsageModelReceiptInput[] = []
    const f = await fixture({ draw: async () => ({ diagram: { oversized: 'x'.repeat(40000) }, usage: { inputTokens: 123, outputTokens: 45 } }) }, { maxDocumentBytes: 16384, recordUsage: async input => { recorded.push(input) } })
    const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'artifact-limit' })
    expect((await waitReady(f.service, record.document.id, job.id)).status).toBe('error')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.usage).toEqual({ inputTokens: 123, outputTokens: 45 })
    await f.restart(); expect(recorded).toHaveLength(1)
  })
  it('shares full large-stroke geometry across 100 small saved edits and their persisted differences', async () => {
    const f = await fixture(); let remote = await f.service.create(a, { title: 'Large classroom', operationId: 'large-create' })
    const points = Array.from({ length: 350001 }, (_, i) => [i / 8, (i % 113) / 7])
    const pressures = points.map((_, i) => (i % 101) / 100)
    let document: WhiteboardDocument = { ...remote.document, scene: { elements: [{ id: 'large-pen', type: 'freedraw', points, pressures }, { id: 'label', type: 'text', text: '0', x: 20, y: 20 }], appState: {} } }
    const completeBytes = Buffer.byteLength(JSON.stringify(document))
    expect(completeBytes).toBeGreaterThan(8 * 1024 * 1024)
    remote = await f.service.save(a, document.id, { document, expectedRevision: 1, operationId: 'large-initial' })
    const allocated = () => [...f.service.domain.table('accounts').entries()].flatMap(([, account]) => Object.values(account.allocations)).reduce((sum, value) => sum + value.bytes, 0)
    const initialBytes = allocated()
    for (let edit = 1; edit <= 100; edit++) {
      const scene = { ...document.scene, elements: [document.scene.elements[0]!, { id: 'label', type: 'text', text: String(edit), x: 20, y: 20 }] }
      document = { ...document, scene, history: { undo: [...(document.history?.undo ?? []), diffScene(document.scene, scene)], redo: [] } }
      remote = await f.service.save(a, document.id, { document, expectedRevision: remote.revision, operationId: `large-edit-${edit}` })
      expect(allocated() - initialBytes).toBeLessThan(2 * 1024 * 1024)
      if (edit % 25 === 0) console.info(JSON.stringify({ capacityEdits: edit, completeBytes, allocatedBytes: allocated(), growthBytes: allocated() - initialBytes }))
    }
    await f.restart()
    const restored = await f.service.read(a, document.id)
    expect(restored.document.scene.elements[0]?.points).toEqual(points)
    expect(restored.document.scene.elements[0]?.pressures).toEqual(pressures)
    expect(restored.document.history?.undo).toHaveLength(100)
    expect(restored.document.scene.elements[1]?.text).toBe('100')
  }, 450000)

  it('opens a pre-manifest full JSON document without migration or data loss', async () => {
    const f = await fixture(); const initial = await f.service.create(a, { title: 'Legacy', operationId: 'legacy-create' })
    const legacy = { ...initial.document, scene: { elements: [{ id: 'old-pen', type: 'freedraw', points: [[0, 0], [8, 9]], pressures: [0.2, 0.7] }], appState: { scrollX: 14 } } }
    const bytes = Buffer.from(JSON.stringify(legacy)); const digest = canvasHash(bytes)
    await f.service.blobs.publish({ schoolId: a.schoolId, userKey: a.userKey, canvasId: `whiteboard.${legacy.id}` }, digest, [bytes], { expectedBytes: bytes.length, maxBytes: bytes.length })
    const [key, account] = [...f.service.domain.table('accounts').entries()][0]!
    account.boards[legacy.id]!.document = { digest, bytes: bytes.length }
    await f.service.domain.table('accounts').put(key, account)
    await f.restart()
    expect((await f.service.read(a, legacy.id)).document).toEqual(legacy)
  })

  it('explains a text-only model capability error without publishing any diagram', async () => {
    const f = await fixture({ draw: async () => ({ error: 'MODEL_VISION_UNAVAILABLE' }) }); const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'vision-disabled' })
    const result = await waitReady(f.service, record.document.id, job.id)
    expect(result.status).toBe('error'); expect(result.error).toContain('图像输入'); expect(result.result).toBeUndefined()
  })

  it('does not settle nonexistent calls when real adapter vision preflight rejects across retries and restart', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let calls = 0
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }), async *stream() { calls++; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const recorded: UsageModelReceiptInput[] = []
    const adapter = createWhiteboardModel(ctx, { provider: 'test-provider', model: 'text-only' })
    const f = await fixture({}, { model: { ...adapter, prepareImage: async () => ({ width: 800, height: 400, attachment: { attachmentId: 'test-image', width: 800, height: 400 } }) }, recordUsage: async input => { recorded.push(input) } })
    const { record, source } = await withImage(f)
    for (const operationId of ['preflight-1', 'preflight-retry']) {
      const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId })
      const result = await waitReady(f.service, record.document.id, job.id)
      expect(result.status).toBe('error'); expect(result.error).toContain('图像输入')
      await f.restart()
    }
    expect(calls).toBe(0); expect(recorded).toEqual([])
    const attempts = [...f.service.domain.table('accounts').entries()].flatMap(([, account]) => Object.values(account.jobs).map(job => job.attempt))
    expect(attempts).toEqual([0, 0])
  })
  it('still settles one missing-usage receipt for a real stream failure, including after restart', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let calls = 0
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), async *stream() { calls++; throw new Error('Upstream transport failed') } } as never)
    const recorded: UsageModelReceiptInput[] = []
    const adapter = createWhiteboardModel(ctx, { provider: 'test-provider', model: 'vision' })
    const f = await fixture({}, { model: { ...adapter, prepareImage: async () => ({ width: 800, height: 400, attachment: { attachmentId: 'test-image', width: 800, height: 400 } }) }, recordUsage: async input => { recorded.push(input) } })
    const { record, source } = await withImage(f)
    const job = await f.service.generate(a, record.document.id, { imageId: source.id, expectedRevision: record.revision, operationId: 'real-failure' })
    expect((await waitReady(f.service, record.document.id, job.id)).status).toBe('error')
    await f.restart()
    expect(calls).toBe(1); expect(recorded).toHaveLength(1); expect(recorded[0]?.usage).toBeUndefined()
  })

})
