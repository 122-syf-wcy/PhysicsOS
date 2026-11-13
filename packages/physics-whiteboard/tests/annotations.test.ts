import { describe, expect, it } from 'vitest'
import * as whiteboard from '../src/index.ts'

const codec = whiteboard as unknown as {
  parseCanvasAnnotations?: (input: unknown) => unknown
  readCanvasAnnotations?: (metadata?: unknown) => unknown
}
const scene = { schemaVersion: 1, primitives: [{ id: 'ink', type: 'polyline', points: [[-20, 4], [10, 8]],
  samples: [{ x: -20, y: 4, pressure: 0.1, time: 13 }, { x: 10, y: 8, pressure: 0.9, time: 15 }] }] }

describe('canvas annotation metadata', () => {
  it('reads an old document as an empty annotation layer', () => {
    expect(codec.readCanvasAnnotations?.({ projectId: 'project-1' })).toEqual({ schemaVersion: 1, primitives: [] })
  })
  it('round-trips raw world coordinates, pressure and time with no decimation', () => {
    expect(codec.parseCanvasAnnotations?.(JSON.parse(JSON.stringify(scene)))).toEqual(scene)
  })
  it('rejects unsafe types and extra executable reference fields', () => {
    expect(codec.parseCanvasAnnotations).toBeTypeOf('function')
    expect(() => codec.parseCanvasAnnotations?.({ schemaVersion: 1, primitives: [{ id: 'x', type: 'image', url: 'https://example.org/x' }] })).toThrow()
    expect(() => codec.parseCanvasAnnotations?.({ ...scene, primitives: [{ ...scene.primitives[0], link: 'javascript:alert(1)' }] })).toThrow()
  })
  it('rejects duplicate IDs, mismatched samples and non-finite geometry', () => {
    expect(codec.parseCanvasAnnotations).toBeTypeOf('function')
    for (const input of [{ ...scene, primitives: [...scene.primitives, ...scene.primitives] },
      { ...scene, primitives: [{ ...scene.primitives[0], samples: [{ x: 0, y: 4, pressure: 2, time: 13 }] }] },
      { schemaVersion: 1, primitives: [{ id: 'bad', type: 'line', points: [[0, 0], [Infinity, 1]] }] }]) {
      expect(() => codec.parseCanvasAnnotations?.(input)).toThrow()
    }
  })
})
