import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import type { CanvasController } from '../src/client/canvas/types.ts'

const controllers: CanvasController[] = []
const databases: string[] = []
const scene = { schemaVersion: 1, primitives: [{ id: 'human-ink', type: 'polyline', points: [[-20, 4], [10, 8]],
  samples: [{ x: -20, y: 4, pressure: 0.1, time: 13 }, { x: 10, y: 8, pressure: 0.9, time: 15 }] }] }
const fixture = () => {
  const name = `canvas-annotations-${randomUUID()}`; databases.push(name)
  const controller = createCanvasController({ api: createCanvasApi(async () => { throw new Error('Offline') }),
    persistence: createCanvasPersistence({ name, hash: async value => createHash('sha256').update(canonicalStringify(value)).digest('hex') }),
    hash: async value => createHash('sha256').update(canonicalStringify(value)).digest('hex'),
    getAccount: () => undefined, online: () => false, createRuntime: async () => { throw new Error('No experiment needed') },
    schedule: () => 0, cancel: () => undefined, window: null, document: null, channel: null })
  controllers.push(controller); return controller
}
afterEach(async () => { await Promise.all(controllers.splice(0).map(controller => controller.dispose())); await Promise.all(databases.splice(0).map(name => deleteDB(name))) })

describe('canvas annotations through existing persistence and history', () => {
  it('retains linear raw-sample history rather than copying the entire layer into each stroke edit', async () => {
    const controller = fixture(); const canvas = await controller.create('Long handwriting')
    for (let stroke = 0; stroke < 12; stroke++) {
      const samples = Array.from({ length: 100 }, (_, i) => ({ x: i, y: stroke * 20, pressure: i / 100, time: i }))
      await controller.appendAnnotations(canvas, { schemaVersion: 1, primitives: [{ id: `ink-${stroke}`, type: 'polyline', points: samples.map(p => [p.x, p.y]), samples }] })
    }
    const graph = await controller.exportGraph(canvas)
    const count = (value: unknown): number => {
      if (!value || typeof value !== 'object') return 0
      if (Array.isArray(value)) return value.reduce((sum, item) => sum + count(item), 0)
      return Object.entries(value).reduce((sum, [key, item]) => sum + (key === 'samples' && Array.isArray(item) ? item.length : count(item)), 0)
    }
    // Live scene plus one retained delta per stroke: 1,200 + 1,200 samples.
    expect(count(graph)).toBe(2400)
  })
  it('persists one ink operation, exports it and restores the raw stroke through undo', async () => {
    const controller = fixture()
    const canvas = await controller.create('Paper')
    const commands = controller as unknown as { appendAnnotations?: (id: string, input: unknown) => Promise<void> }
    expect(commands.appendAnnotations).toBeTypeOf('function')
    const before = controller.documentSource(canvas).getSnapshot().editSequence
    await commands.appendAnnotations?.(canvas, scene)
    expect(controller.documentSource(canvas).getSnapshot().editSequence).toBe(before + 1)
    expect((await controller.exportGraph(canvas)).manifest.metadata?.physicsosAnnotations).toEqual(scene)
    await controller.undo(canvas)
    expect(controller.documentSource(canvas).getSnapshot().manifest?.metadata?.physicsosAnnotations).toBeUndefined()
    await controller.redo(canvas)
    const exported = await controller.exportGraph(canvas)
    expect(exported.manifest.metadata?.physicsosAnnotations).toEqual(scene)
    const imported = await controller.importGraph(exported)
    expect(imported).not.toBe(canvas)
    expect((await controller.exportGraph(imported)).manifest.metadata?.physicsosAnnotations).toEqual(scene)
  })
  it('preserves project metadata and rejects stale/foreign annotation proposals', async () => {
    const controller = fixture(); const canvas = await controller.create('Paper')
    await controller.assignProject(canvas, 'project-1')
    const commands = controller as unknown as { appendAnnotations?: (id: string, input: unknown, expected?: unknown) => Promise<void> }
    expect(commands.appendAnnotations).toBeTypeOf('function')
    await commands.appendAnnotations?.(canvas, scene)
    expect(controller.documentSource(canvas).getSnapshot().manifest?.metadata?.studyProjectId).toBe('project-1')
    const state = controller.documentSource(canvas).getSnapshot()
    await expect(commands.appendAnnotations?.(canvas, { schemaVersion: 1, primitives: [{ id: 'ai', type: 'line', points: [[0, 0], [1, 1]] }] },
      { namespace: 'foreign', editSequence: state.editSequence })).rejects.toThrow(/ACCOUNT|STALE/)
    await expect(commands.appendAnnotations?.(canvas, { schemaVersion: 1, primitives: [{ id: 'ai', type: 'line', points: [[0, 0], [1, 1]] }] },
      { namespace: state.namespace, editSequence: state.editSequence - 1 })).rejects.toThrow(/STALE/)
    expect(controller.documentSource(canvas).getSnapshot().manifest?.metadata?.physicsosAnnotations).toEqual(scene)
    await controller.assignProject(canvas, 'project-2')
    await controller.undo(canvas)
    expect(controller.documentSource(canvas).getSnapshot().manifest?.metadata?.studyProjectId).toBe('project-2')
    expect(controller.documentSource(canvas).getSnapshot().manifest?.metadata?.physicsosAnnotations).toBeUndefined()
  })
})
