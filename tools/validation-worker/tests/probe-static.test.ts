import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { canvasDrawProbeScript } from '../src/draw-probe.ts'

describe('native draw probe source', () => {
  it('parses both legacy mechanics and opt-in optics native probe scripts without engine data interpolation', () => {
    for (const optics of [false, true]) expect(() => new Script(canvasDrawProbeScript('privateProbe', optics))).not.toThrow()
    const source = canvasDrawProbeScript('privateProbe', true)
    expect(source).not.toMatch(/snapshot|engineBody|opticalRays/)
    expect(source).toContain("source: 'canvas-2d-segment-stroke'")
    expect(source).toContain("source: 'canvas-2d-triangle-fill'")
    expect(source).toContain('unchanged(context')
    expect(source).toContain('elementFromPoint')
  })
})
