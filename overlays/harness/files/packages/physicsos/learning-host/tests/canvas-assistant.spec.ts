import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CanvasBlobStore } from '../src/canvas-blob-store.ts'
import { canvasHash } from '../src/canvas-blob-store.ts'
import { canonicalBytes } from '@physicsos/physics-workbench/json'
import { CanvasService } from '../src/canvas-service.ts'
import { resolveCanvasConfig } from '../src/canvas-config.ts'
import { openCanvasDomain } from '../src/canvas-domain.ts'
import { openCanvasAssistantDomain } from '../src/canvas-assistant-domain.ts'
import { CanvasAssistantService } from '../src/canvas-assistant-service.ts'
import type { CanvasAssistantModel, CanvasAssistantServiceOptions } from '../src/canvas-assistant-types.ts'
import type { UsageModelReceiptInput } from '../src/usage-types.ts'
import { loadCanvasFixture, responseJson, CANVAS_FIXTURE_TIMEOUT } from './canvas-fixture.ts'

const a = { schoolId: 'school', userKey: 'school:teacher', username: 'teacher', role: 'TEACHER' as const }
const b = { ...a, userKey: 'school:other', username: 'other' }
const proposal = { summary: '补充受力方向，结果需要物理引擎另行验证。', findings: [], scene: { schemaVersion: 1, primitives: [{ id: 'force', type: 'arrow', points: [[-20, 10], [30, 10]] }] } }
async function fixture(overrides: Partial<CanvasAssistantModel> = {}, settings: Partial<CanvasAssistantServiceOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'canvas-assistant-'))
  const receipts: UsageModelReceiptInput[] = []; let calls = 0
  let ctx: Context; let backend: JsonStorageBackend; let canvas: CanvasService; let assistant: CanvasAssistantService
  const model: CanvasAssistantModel = { provider: 'configured-pool', model: 'configured-model', prepareImage: async () => ({ attachment: { id: 'admitted-image' } }),
    run: async (_request, _signal, started) => { await started?.(); calls++; return { proposal, usage: { inputTokens: 13, outputTokens: 7 } } }, ...overrides }
  const open = async () => {
    ctx = new Context(); await ctx.plugin(Storage); backend = new JsonStorageBackend(join(root, 'domain')); ctx.storage.backend.register('json', backend); ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'json' }))
    const config = resolveCanvasConfig({ canvasDshHome: root })
    canvas = new CanvasService(await openCanvasDomain(ctx), new CanvasBlobStore(config.root), config); await canvas.initialize()
    assistant = new CanvasAssistantService(await openCanvasAssistantDomain(ctx), canvas, { model, recordUsage: async input => { receipts.push(input) }, ...settings }); await assistant.initialize()
  }
  const close = async () => { await assistant?.dispose(); await assistant?.domain.close(); await canvas?.dispose(); await canvas?.domain.close(); await backend?.close(); await ctx?.fiber.dispose() }
  onTestFinished(async () => { await close(); await rm(root, { recursive: true, force: true }) })
  await open()
  return { get canvas() { return canvas }, get assistant() { return assistant }, get calls() { return calls }, receipts, restart: async () => { await close(); await open() } }
}
async function input(f: Awaited<ReturnType<typeof fixture>>, operationId = 'draw-one') {
  const saved = await f.canvas.create(a, { id: 'lesson', title: '课堂画布', mutationId: 'create' })
  return { operationId, mode: 'draw' as const, prompt: '补充受力示意图', expectedVersion: saved.head.version, expectedGeneration: saved.head.generation, manifestDigest: saved.head.manifestDigest, namespace: 'school:teacher', editSequence: 2, viewport: { x: 20, y: 10, zoom: 1.2, width: 1000, height: 700 }, selectedNodeIds: [] }
}
async function settled(service: CanvasAssistantService, id: string) {
  for (let i = 0; i < 1000; i++) { const job = await service.read(a, 'lesson', id); if (['ready', 'error', 'cancelled'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('Assistant job did not settle')
}

describe('owned saved-canvas assistant jobs', () => {
  it('admits bounded relevant geometry for a selected node without copying or changing dense raw offscreen ink', async () => {
    let observed: { context: { canvas: { annotations: { primitives: { id: string; points?: number[][]; samples?: unknown[] }[] } } } } | undefined
    const f = await fixture({ run: async (request, _signal, admission) => { await admission?.(); observed = JSON.parse(request.prompt); expect(Buffer.byteLength(request.prompt)).toBeLessThan(256 * 1024); return { proposal } } })
    const body = await input(f); const saved = await f.canvas.open(a, 'lesson')
    const primitive = (id: string, offset: number) => {
      const samples = Array.from({ length: 5000 }, (_, index) => ({ x: offset + index / 100, y: offset + Math.sin(index / 100) * 8, pressure: index / 5000, time: index }))
      return { id, type: 'polyline', points: samples.map(p => [p.x, p.y]), samples }
    }
    const annotations = { schemaVersion: 1, primitives: [primitive('nearby', 20), primitive('far-away', 50000)] }
    const manifest = { ...saved.manifest, nodes: [{ id: 'small-note', kind: 'note', body: 'One relevant note', format: 'plain', layout: { x: 0, y: 0, width: 200, height: 100, zIndex: 0 } }], metadata: { physicsosAnnotations: annotations } }
    const bytes = canonicalBytes(manifest); const digest = canvasHash(bytes)
    await f.canvas.uploadObject(a, 'lesson', digest, bytes)
    const committed = await f.canvas.commit(a, 'lesson', { expectedVersion: saved.head.version, expectedGeneration: saved.head.generation, mutationId: 'dense-ink', manifestDigest: digest })
    const job = await f.assistant.create(a, 'lesson', { ...body, mode: 'check', expectedVersion: committed.head.version, manifestDigest: committed.head.manifestDigest, selectedNodeIds: ['small-note'] })
    expect((await settled(f.assistant, job.id)).status).toBe('ready')
    expect(observed?.context.canvas.annotations.primitives.map(p => p.id)).toEqual(['nearby'])
    expect(observed?.context.canvas.annotations.primitives[0]?.samples).toBeUndefined()
    expect(observed?.context.canvas.annotations.primitives[0]?.points?.length).toBeLessThanOrEqual(256)
    expect((await f.canvas.open(a, 'lesson')).manifest.metadata?.physicsosAnnotations).toEqual(annotations)
  })
  // Removing owner/head admission would disclose a foreign or obsolete proposal.
  it('singleflights durable proposals and records the actual numeric usage once without editing physics', async () => {
    const f = await fixture(); const body = await input(f)
    const [first, duplicate] = await Promise.all([f.assistant.create(a, 'lesson', body), f.assistant.create(a, 'lesson', body)])
    expect(duplicate.id).toBe(first.id)
    const ready = await settled(f.assistant, first.id)
    expect(ready.status).toBe('ready'); expect(ready.result).toEqual(proposal)
    expect(ready.binding).toEqual({ canvasId: 'lesson', namespace: 'school:teacher', editSequence: 2, head: { version: body.expectedVersion, generation: body.expectedGeneration, manifestDigest: body.manifestDigest } })
    expect(f.calls).toBe(1); expect(f.receipts).toHaveLength(1); expect(f.receipts[0]?.usage).toEqual({ inputTokens: 13, outputTokens: 7 })
    expect(f.receipts[0]?.owner).toEqual({ schoolId: 'school', userKey: 'school:teacher' })
    expect((await f.canvas.open(a, 'lesson')).manifest.nodes).toEqual([])
    await f.restart(); expect((await f.assistant.read(a, 'lesson', first.id)).result).toEqual(proposal); expect(f.receipts).toHaveLength(1)
    await expect(f.assistant.read(b, 'lesson', first.id)).rejects.toMatchObject({ status: 404 })
  })
  it('rejects stale heads, client-authored context and nonexistent selection before model admission', async () => {
    const f = await fixture(); const body = await input(f)
    await expect(f.assistant.create(a, 'lesson', { ...body, expectedVersion: body.expectedVersion + 1 })).rejects.toMatchObject({ status: 409 })
    await expect(f.assistant.create(a, 'lesson', { ...body, scene: { invented: true } })).rejects.toMatchObject({ status: 400 })
    await expect(f.assistant.create(a, 'lesson', { ...body, selectedNodeIds: ['foreign-node'] })).rejects.toMatchObject({ status: 400 })
    expect(f.calls).toBe(0); expect(f.receipts).toEqual([])
  })
  it('does not expose a ready candidate after the saved canvas head changes', async () => {
    const f = await fixture(); const body = await input(f); const job = await f.assistant.create(a, 'lesson', body); await settled(f.assistant, job.id)
    await f.canvas.rename(a, 'lesson', { expectedVersion: body.expectedVersion, mutationId: 'rename', title: '新课堂' })
    await expect(f.assistant.read(a, 'lesson', job.id)).rejects.toMatchObject({ status: 409, code: 'ASSISTANT_STALE' })
  })
  it('cancels a live request, ignores a late proposal and retains its received usage', async () => {
    let release!: () => void; let entered!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }); const started = new Promise<void>(resolve => { entered = resolve })
    const f = await fixture({ run: async (_request, _signal, admission) => { await admission?.(); entered(); await waiting; return { proposal, usage: { inputTokens: 8, outputTokens: 3 } } } })
    const body = await input(f); const job = await f.assistant.create(a, 'lesson', body); await started
    await f.assistant.cancel(a, 'lesson', job.id, { operationId: 'cancel' }); release()
    await f.restart()
    const cancelled = await f.assistant.read(a, 'lesson', job.id)
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.result).toBeUndefined(); expect(f.receipts).toHaveLength(1); expect(f.receipts[0]?.usage).toEqual({ inputTokens: 8, outputTokens: 3 })
  })
  it.each([
    { ...proposal, scene: { schemaVersion: 1, primitives: [{ id: 'unsafe', type: 'image', src: 'https://attacker.invalid/private' }] } },
    { ...proposal, scene: { schemaVersion: 1, primitives: [{ id: 'unsafe', type: 'line', points: [[0, 0], [1, 1]], script: 'secret' }] } },
    { ...proposal, findings: [{ severity: 'info', message: '来自伪造节点', nodeIds: ['foreign-node'] }] },
    { ...proposal, scene: { schemaVersion: 1, primitives: Array.from({ length: 201 }, (_, i) => ({ id: `p-${i}`, type: 'line', points: [[0, 0], [1, 1]] })) } },
  ])('rejects unsafe/unbound/oversized primitive proposals with a safe error and still charges actual usage', async unsafe => {
    const f = await fixture({ run: async (_request, _signal, admission) => { await admission?.(); return { proposal: unsafe, usage: { inputTokens: 9, outputTokens: 4 } } } })
    const body = await input(f); const job = await f.assistant.create(a, 'lesson', body); const result = await settled(f.assistant, job.id)
    expect(result.status).toBe('error'); expect(result.result).toBeUndefined(); expect(result.error).not.toContain('attacker'); expect(result.error).not.toContain('secret'); expect(f.receipts[0]?.usage).toEqual({ inputTokens: 9, outputTokens: 4 })
  })
  it('recovers an interrupted real request as an error and settles one missing-usage receipt', async () => {
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve })
    const f = await fixture({ run: async (_request, signal, admission) => { await admission?.(); entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return { error: 'MODEL_ABORTED' } } })
    const body = await input(f); const job = await f.assistant.create(a, 'lesson', body); await started; await f.restart()
    expect((await f.assistant.read(a, 'lesson', job.id)).status).toBe('error'); expect(f.receipts).toHaveLength(1); expect(f.receipts[0]?.usage).toBeUndefined()
    await f.restart(); expect(f.receipts).toHaveLength(1)
  })
  it('settles timeout as an error and never invents usage for preflight rejection', async () => {
    const f = await fixture({ run: async () => ({ error: 'MODEL_UNAVAILABLE' }) }, { jobTimeoutMs: 20 })
    const body = await input(f); const job = await f.assistant.create(a, 'lesson', body)
    expect((await settled(f.assistant, job.id)).status).toBe('error'); await f.restart(); expect(f.receipts).toEqual([])
  })
  it('ends an aborted model timeout as a terminal error with a missing-usage receipt', async () => {
    let entered!: () => void; const admitted = new Promise<void>(resolve => { entered = resolve })
    const f = await fixture({ run: async (_request, signal, admission) => { await admission?.(); entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return { error: 'MODEL_ABORTED' } } }, { jobTimeoutMs: 1000 })
    const body = await input(f); const job = await f.assistant.create(a, 'lesson', body)
    await admitted
    expect((await settled(f.assistant, job.id)).status).toBe('error'); expect(f.receipts).toHaveLength(1); expect(f.receipts[0]?.usage).toBeUndefined()
  })
  it('supplies only the saved selected note and metadata, without trusting a client-authored scene', async () => {
    let observed: unknown
    const f = await fixture({ run: async (request, _signal, admission) => { await admission?.(); observed = JSON.parse(request.prompt); return { proposal } } })
    const body = await input(f)
    const saved = await f.canvas.open(a, 'lesson')
    const manifest = { ...saved.manifest, nodes: [
      { id: 'owned-note', kind: 'note', body: '保存的真实条件', format: 'plain', layout: { x: 0, y: 0, width: 200, height: 100, zIndex: 0 } },
      { id: 'unselected-note', kind: 'note', body: '未选择的条件', format: 'plain', layout: { x: 400, y: 0, width: 200, height: 100, zIndex: 0 } },
    ] }
    const bytes = canonicalBytes(manifest); const digest = canvasHash(bytes)
    await f.canvas.uploadObject(a, 'lesson', digest, bytes)
    const committed = await f.canvas.commit(a, 'lesson', { expectedVersion: saved.head.version, expectedGeneration: saved.head.generation, mutationId: 'saved-note', manifestDigest: digest })
    const job = await f.assistant.create(a, 'lesson', { ...body, expectedVersion: committed.head.version, manifestDigest: committed.head.manifestDigest, selectedNodeIds: ['owned-note'] }); await settled(f.assistant, job.id)
    expect(observed).toMatchObject({ context: { canvas: { nodes: [{ id: 'owned-note', body: '保存的真实条件' }] } } })
    expect(JSON.stringify(observed)).not.toContain('未选择的条件')
  })
  it('admits an optional image through the existing image service and rejects invalid base64 before model submission', async () => {
    let prepared = 0
    const f = await fixture({ prepareImage: async bytes => { prepared++; if (Buffer.from(bytes).toString() !== 'owned image') throw new Error('Invalid fixture bytes'); return { attachment: { attachmentId: 'validated-source' } } } })
    const body = await input(f)
    await expect(f.assistant.create(a, 'lesson', { ...body, image: { mimeType: 'image/png', base64: '!!!!' } })).rejects.toMatchObject({ status: 400 })
    expect(prepared).toBe(0)
    const job = await f.assistant.create(a, 'lesson', { ...body, image: { mimeType: 'image/png', base64: Buffer.from('owned image').toString('base64') } })
    expect((await settled(f.assistant, job.id)).status).toBe('ready'); expect(prepared).toBe(1)
  })
  it('reserves the global model capacity across simultaneous accounts before durable submission', async () => {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve })
    const f = await fixture({ run: async (_request, _signal, admission) => { await admission?.(); await waiting; return { proposal } } }, { maxConcurrentJobs: 1 })
    const body = await input(f)
    const other = await f.canvas.create(b, { id: 'lesson', title: '第二课堂', mutationId: 'create' })
    const results = await Promise.allSettled([
      f.assistant.create(a, 'lesson', body),
      f.assistant.create(b, 'lesson', { ...body, expectedVersion: other.head.version, expectedGeneration: other.head.generation, manifestDigest: other.head.manifestDigest, namespace: 'school:other' }),
    ])
    release()
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { status: 429, code: 'ASSISTANT_BUSY' } }])
  })
  it('retains the latest bounded jobs without permanently disabling accounts or replaying expired operation IDs', async () => {
    const f = await fixture({}, { maxJobs: 1 }); const body = await input(f)
    const first = await f.assistant.create(a, 'lesson', body); await settled(f.assistant, first.id)
    const next = await f.assistant.create(a, 'lesson', { ...body, operationId: 'second-draw' }); await settled(f.assistant, next.id)
    expect(f.calls).toBe(2); expect((await f.assistant.read(a, 'lesson', next.id)).status).toBe('ready')
    await expect(f.assistant.read(a, 'lesson', first.id)).rejects.toMatchObject({ status: 410, code: 'ASSISTANT_EXPIRED' })
    await f.restart()
    await expect(f.assistant.create(a, 'lesson', body)).rejects.toMatchObject({ status: 410, code: 'ASSISTANT_EXPIRED' })
    expect(f.calls).toBe(2); expect(f.receipts).toHaveLength(2)
  })
  it('requests a bounded artifact budget and compact schema from the configured model', async () => {
    let observed: { maxTokens: number; schema: { properties: { scene: { properties: { primitives: { minItems?: number } } } } } } | undefined
    const f = await fixture({ run: async (request, _signal, admission) => { await admission?.(); observed = request as never; return { proposal } } })
    const body = await input(f); const job = await f.assistant.create(a, 'lesson', body); await settled(f.assistant, job.id)
    expect(observed).toBeDefined()
    // A reasoning channel otherwise spends the whole budget thinking; the
    // artifact budget must stay well inside the channel's own ceiling.
    expect(observed!.maxTokens).toBeGreaterThan(0); expect(observed!.maxTokens).toBeLessThanOrEqual(8000)
    expect(observed!.schema.properties.scene.properties.primitives.minItems).toBe(1)
  })
  it('allows new cancellation operations on a long-lived account beyond the full-job retention count', async () => {
    const f = await fixture({}, { maxJobs: 1 }); const body = await input(f)
    const job = await f.assistant.create(a, 'lesson', body); await settled(f.assistant, job.id)
    for (let i = 0; i < 8; i++) {
      const response = await f.assistant.cancel(a, 'lesson', job.id, { operationId: `cancel-${i}` })
      expect(response.status).toBe('ready')
    }
    await f.restart(); expect((await f.assistant.read(a, 'lesson', job.id)).status).toBe('ready'); expect(f.calls).toBe(1)
  })
})

describe('shipping assistant route composition', () => {
  it('requires actual auth and serves real saved-head jobs on the canvas prefix', async () => {
    const f = await loadCanvasFixture(); const owner = await f.register('assistant-owner'); const other = await f.register('assistant-other')
    const saved = await responseJson<{ head: { version: number; generation: number; manifestDigest: string } }>(await f.call('POST', '/physicsos/learning/canvases', { id: 'lesson', title: '课堂', mutationId: 'create' }, owner), 201)
    const body = { operationId: 'check', mode: 'check', prompt: '检查画布', expectedVersion: saved.head.version, expectedGeneration: saved.head.generation, manifestDigest: saved.head.manifestDigest, namespace: 'qualified-owner', editSequence: 0, viewport: { x: 0, y: 0, zoom: 1, width: 800, height: 600 }, selectedNodeIds: [] }
    const path = '/physicsos/learning/canvases/lesson/assistant/jobs'
    expect((await f.call('POST', path, body)).status).toBe(401)
    expect((await f.call('POST', path, body, other)).status).toBe(404)
    const job = await responseJson<{ id: string; binding: { canvasId: string } }>(await f.call('POST', path, body, owner), 202)
    expect(job.binding.canvasId).toBe('lesson')
    expect((await f.call('GET', `${path}/${job.id}`, undefined, other)).status).toBe(404)
    expect((await f.call('GET', `${path}/${job.id}`, undefined, owner)).status).toBe(200)
  }, CANVAS_FIXTURE_TIMEOUT)
})
