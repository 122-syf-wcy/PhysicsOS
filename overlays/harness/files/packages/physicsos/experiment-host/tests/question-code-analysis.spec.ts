import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { QuestionCodeArtifactService } from '../src/question-code-service.ts'
import type { QuestionCodeRecord } from '../src/question-code-domain.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it.each([
  ['drawingTimeoutMs', 0], ['drawingTimeoutMs', 1.5], ['drawingTimeoutMs', Number.NaN], ['drawingTimeoutMs', 60_001],
  ['drawingConcurrency', 0], ['drawingConcurrency', 1.5], ['drawingConcurrency', Number.POSITIVE_INFINITY], ['drawingConcurrency', 17],
] as const)('rejects invalid deployment drawing limit %s=%s before creating an artifact worker', (field, value) => {
  expect(() => new QuestionCodeArtifactService({} as never, {
    root: '/tmp/invalid-question-drawing-config', identity: () => undefined, [field]: value,
  })).toThrow()
})

it('honours a validated operator drawing deadline and publishes no artifact after it expires', async () => {
  const root = await mkdtemp(join(tmpdir(), 'question-drawing-deadline-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const rows = new Map<string, QuestionCodeRecord>()
  const domain = { table: () => ({ get: (id: string) => rows.get(id), entries: () => rows.entries(), put: async (id: string, row: QuestionCodeRecord) => { rows.set(id, row) } }) }
  const service = new QuestionCodeArtifactService(domain as never, {
    root, identity: () => ({ sessionOwnerKey: () => 'school:student' }) as never, drawingTimeoutMs: 1,
  })
  await service.initialize()
  cleanups.push(() => service.close())
  const scene = createConvexLensScene({ sceneId: 'deadline-question', focalLength: 23, objectDistance: 62, now: '2026-11-10T00:00:00Z' })
  await expect(service.create({ ownerSessionId: 'deadline-parent', childSessionId: 'deadline-child', scene, experimentId: 'convex-lens',
    source: { title: '严格截止', summary: '不能发布超时校验结果', stylesheet: '', rendererJs: `export function renderFrame(snapshot) {
      const root = document.getElementById('canvas'), canvas = document.createElement('canvas'); root.replaceChildren(canvas);
      const ctx = canvas.getContext('2d'); ctx.beginPath();
      ctx.arc(snapshot.view.opticalObjects[0].at.x, snapshot.view.opticalObjects[0].at.y, 3, 0, Math.PI * 2); ctx.fill();
    }` } })).rejects.toMatchObject({ code: 'SOURCE_ANALYSIS_TIMEOUT' })
  expect(rows.size).toBe(0)
})

it('returns the same frozen artifact when a generation create response is retried after publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'question-receipt-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const rows = new Map<string, QuestionCodeRecord>()
  const domain = { table: () => ({ get: (id: string) => rows.get(id), entries: () => rows.entries(), put: async (id: string, row: QuestionCodeRecord) => { rows.set(id, row) } }) }
  const service = new QuestionCodeArtifactService(domain as never, {
    root, identity: () => ({ sessionOwnerKey: (id: string) => id === 'receipt-parent' ? 'school:student' : undefined }) as never,
    imageAssets: { manifest: () => [], nativeFallback: () => ({ status: 'unavailable', mode: 'native', code: 'IMAGE_TIMEOUT' }), files: () => new Map() } as never,
  })
  await service.initialize()
  cleanups.push(() => service.close())
  const scene = createConvexLensScene({ sceneId: 'receipt-question', focalLength: 23, objectDistance: 62, now: '2026-11-10T00:00:00Z' })
  const input = { ownerSessionId: 'receipt-parent', childSessionId: 'receipt-child', scene, experimentId: 'convex-lens', generationId: 'owned-generation',
    source: { title: '可恢复的题目绘图', summary: '相同任务只提交一份已验证产物', stylesheet: '', rendererJs: `export function renderFrame(snapshot) {
      const root = document.getElementById('canvas'), canvas = document.createElement('canvas'); root.replaceChildren(canvas);
      const ctx = canvas.getContext('2d'); ctx.beginPath();
      ctx.arc(snapshot.view.opticalObjects[0].at.x, snapshot.view.opticalObjects[0].at.y, 3, 0, Math.PI * 2); ctx.fill();
    }` } }
  const first = await service.create(input)
  const retried = await service.create(input)
  expect(retried.artifactId).toBe(first.artifactId)
  expect(rows.size).toBe(1)
})

it('bounds actual artifact validation for repeated shared coordinate helpers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bounded-question-analysis-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const rows = new Map<string, QuestionCodeRecord>()
  // The storage boundary is inert; package, syntax, geometry, blob and record
  // validation are the actual artifact service, without a test-only API.
  const domain = { table: () => ({ get: (id: string) => rows.get(id), entries: () => rows.entries(), put: async (id: string, row: QuestionCodeRecord) => { rows.set(id, row) } }) }
  const service = new QuestionCodeArtifactService(domain as never, {
    root, identity: () => ({ sessionOwnerKey: (id: string) => id === 'bounded-parent' ? 'school:student' : undefined }) as never,
  })
  await service.initialize()
  cleanups.push(() => service.close())
  const helpers = Array.from({ length: 9 }, (_, index) =>
    `function coordinate${index}(view) { return coordinate${index + 1}(view) + 0 * coordinate${index + 1}(view); }`).join('\n')
  const rendererJs = `export function renderFrame(snapshot) {
    const view = snapshot.view, root = document.getElementById('canvas');
    const canvas = document.createElement('canvas'); root.replaceChildren(canvas);
    const ctx = canvas.getContext('2d'); ctx.beginPath();
    ctx.arc(coordinate0(view), view.opticalObjects[0].at.y, 3, 0, Math.PI * 2); ctx.fill();
  }\n${helpers}\nfunction coordinate9(view) { return view.opticalObjects[0].at.x; }`
  const scene = createConvexLensScene({ sceneId: 'bounded-question', focalLength: 23, objectDistance: 62, now: '2026-11-10T00:00:00Z' })
  const started = Date.now()
  const ref = await service.create({ ownerSessionId: 'bounded-parent', childSessionId: 'bounded-child', scene,
    experimentId: 'convex-lens', source: { title: '共享坐标绘图', summary: '完整校验引擎坐标', rendererJs, stylesheet: '' } })
  expect(ref).toMatchObject({ status: 'ready', rendererKind: 'independent' })
  expect(rows.get(ref.artifactId)?.sceneId).toBe('bounded-question')
  expect(Date.now() - started).toBeLessThan(1_500)
}, 10_000)

/** Distinct alias paths share the same projection proof, as in native layout helpers. */
function coordinateDrawing(depth: number, leaf: string): string {
  const helpers = Array.from({ length: depth }, (_, index) => `function coordinate${index}(view) {
    const left=coordinate${index + 1}(view), right=coordinate${index + 1}(view);
    return (left+right)/2;
  }`).join('\n')
  return `export function renderFrame(snapshot) {
    const view=snapshot.view, canvas=document.createElement('canvas');
    document.getElementById('canvas').replaceChildren(canvas);
    const ctx=canvas.getContext('2d'); ctx.beginPath();
    ctx.arc(coordinate0(view),20,3,0,6.28); ctx.fill();
  }\n${helpers}\nfunction coordinate${depth}(view){return ${leaf};}`
}
async function coordinateArtifacts() {
  const root = await mkdtemp(join(tmpdir(), 'question-coordinate-proof-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const rows = new Map<string, QuestionCodeRecord>()
  const domain = { table: () => ({ get: (id: string) => rows.get(id), entries: () => rows.entries(), put: async (id: string, row: QuestionCodeRecord) => { rows.set(id, row) } }) }
  const service = new QuestionCodeArtifactService(domain as never, {
    root, identity: () => ({ sessionOwnerKey: () => 'school:student' }) as never,
  })
  cleanups.push(() => service.close())
  await service.initialize()
  const scene = createConvexLensScene({ sceneId: 'coordinate-proof', focalLength: 23, objectDistance: 62, now: '2026-11-19T00:00:00Z' })
  return { rows, create: (rendererJs: string) => service.create({ ownerSessionId: 'coordinate-parent', childSessionId: 'coordinate-child', scene,
    experimentId: 'convex-lens', source: { title: '共享投影证明', summary: '坐标来自引擎视图', rendererJs, stylesheet: '' } }) }
}
it('validates a shared coordinate DAG across distinct alias paths within the unchanged analysis budget', async () => {
  const h = await coordinateArtifacts()
  const ref = await h.create(coordinateDrawing(9, 'view.opticalObjects[0].at.x'))
  expect(ref).toMatchObject({ status: 'ready', rendererKind: 'independent' })
  expect(h.rows.get(ref.artifactId)?.sceneId).toBe('coordinate-proof')
})
it('reuses an exact bounded path without treating a recursive branch as a completed proof', async () => {
  const h = await coordinateArtifacts()
  const repeated = Array.from({ length: 16 }, (_, i) =>
    `function path${i}(view) { return (path${i + 1}(view) + path${i + 1}(view)) / 2 }`).join('\n')
  const drawing = coordinateDrawing(0, 'path0(view)') + `\n${repeated}\nfunction path16(view, remaining = 0) {
    if (remaining > 0) return path16(view, remaining - 1);
    return view.opticalObjects[0].at.x;
  }`
  await expect(h.create(drawing)).resolves.toMatchObject({ status: 'ready', rendererKind: 'independent' })
})
it.each([
  ['constant helpers', coordinateDrawing(9, '10')],
  ['view chrome instead of apparatus', coordinateDrawing(9, 'view.extent.width')],
  ['cyclic helper returns', coordinateDrawing(2, 'coordinate0(view)')],
] as const)('does not borrow a completed geometry proof for %s', async (_name, rendererJs) => {
  const h = await coordinateArtifacts()
  await expect(h.create(rendererJs)).rejects.toMatchObject({ code: 'INVALID_SOURCE', sourceValidationReason: 'missing_engine_geometry' })
  expect(h.rows.size).toBe(0)
})
