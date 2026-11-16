import { describe, expect, it } from 'vitest'
import { evaluateObservation, type Observation, type SampledFrame } from '../src/index.ts'
import type { DrawnBody } from '../src/types.ts'

const SHA = 'a'.repeat(64)
/** Synthetic probe records for verdict rules only; real pixels are exercised in driver.e2e. */
const draw = (x = 0, y = 0, overrides: Partial<DrawnBody> = {}): DrawnBody => ({
  source: 'canvas-2d-arc-fill', surface: 0, drawIndex: 0,
  x, y, transform: [20, 0, 0, -20, 60, 200], pixelX: 60 + x * 20, pixelY: 200 - y * 20,
  paintedPixels: 25,
  ...overrides,
})
const frame = (overrides: Partial<SampledFrame> = {}): SampledFrame => ({
  time: 0,
  engineBody: { x: 0, y: 0 },
  drawnBodies: [draw()],
  paintHash: 'b'.repeat(64),
  geometryCount: 1,
  opaquePixels: 900,
  distinctColors: 20,
  ...overrides,
})
const moving = (overrides: Partial<SampledFrame> = {}): SampledFrame => frame({
  time: 1.5, engineBody: { x: 2, y: 3 }, drawnBodies: [draw(2, 3)], paintHash: 'c'.repeat(64), ...overrides,
})
const base = (overrides: Partial<Observation> = {}): Observation => ({
  firstFrameAcknowledged: true,
  frames: [frame(), moving()],
  nativeSurface: true,
  parameterChanged: true,
  changedFrame: frame({ engineBody: { x: 1, y: 0 }, drawnBodies: [draw(1, 0)], paintHash: 'd'.repeat(64) }),
  originalPaintHash: 'b'.repeat(64),
  changedPaintHash: 'd'.repeat(64),
  mobile: { viewportWidth: 219, scrollWidth: 219, overflow: false },
  candidateSha256: SHA,
  expectedSceneSha256: 'e'.repeat(64),
  candidateSceneSha256: 'e'.repeat(64),
  expectedSceneRevision: 3,
  candidateSceneRevision: 3,
  ...overrides,
})

const failing = (observation: Observation): string[] => evaluateObservation(observation).checks.filter(check => !check.passed).map(check => check.name)

describe('experiment acceptance verdict', () => {
  it('passes attributable native geometry without any renderer stamps', () => {
    const verdict = evaluateObservation(base())
    expect(verdict.passed).toBe(true)
    expect(verdict.checks).toHaveLength(8)
    expect(base().frames.every(item => item.stamped === undefined)).toBe(true)
  })

  it('fails a candidate that never acknowledges its first frame', () => {
    expect(failing(base({ firstFrameAcknowledged: false }))).toContain('first-frame')
  })

  it('fails on a runtime error even when pixels exist', () => {
    expect(failing(base({ runtimeError: 'RENDER_FAILED' }))).toContain('runtime-error')
  })

  it('fails a blank or background-only canvas', () => {
    const blank = base({ frames: [frame({ opaquePixels: 0, distinctColors: 1, geometryCount: 0 }), moving({ opaquePixels: 0, distinctColors: 1, geometryCount: 0 })] })
    expect(failing(blank)).toContain('subject-drawn')
  })

  it('fails when no visible canvas/svg exists at all', () => {
    expect(failing(base({ nativeSurface: false }))).toContain('subject-drawn')
  })

  it.each(['x', 'y'] as const)('rejects the wrong drawn %s even with accurate stamps', axis => {
    const incorrect = draw(2, 3, { [axis]: 9 })
    expect(failing(base({ frames: [frame(), moving({ drawnBodies: [incorrect], stamped: { bodyX: 2, bodyY: 3 } })] })))
      .toContain('geometry-follows-engine')
  })

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0', null])('rejects incomplete/non-finite/non-numeric coordinates: %s', invalid => {
    for (const axis of ['x', 'y'] as const) {
      expect(failing(base({ frames: [frame({ drawnBodies: [draw(0, 0, { [axis]: invalid as number })] }), moving()] })))
        .toContain('geometry-follows-engine')
      expect(failing(base({ frames: [frame({ engineBody: { x: 0, y: 0, [axis]: invalid as number } }), moving()] })))
        .toContain('geometry-follows-engine')
    }
  })

  it('does not filter a single unverified frame out of an otherwise valid run', () => {
    expect(failing(base({ frames: [frame(), moving({ drawnBodies: undefined })] }))).toContain('geometry-follows-engine')
    expect(failing(base({ frames: [frame({ engineBody: undefined }), moving()] }))).toContain('geometry-follows-engine')
  })

  it.each([
    { bodyY: 0 }, { bodyX: 0 }, { bodyX: 0, bodyY: 0 },
    { bodyX: Number.NaN, bodyY: 0 }, { bodyX: 0, bodyY: Number.POSITIVE_INFINITY },
  ])('never substitutes legacy stamps for real geometry: %j', stamped => {
    const names = failing(base({ frames: [frame({ drawnBodies: undefined, stamped }), moving({ drawnBodies: undefined, stamped: { bodyX: 2, bodyY: 3 } })] }))
    expect(names).toContain('geometry-follows-engine')
    expect(names).toContain('motion-sampled')
  })

  it('does not call a different static trajectory dot the moving body in each frame', () => {
    const dots = [draw(), draw(2, 3, { drawIndex: 1 })]
    expect(failing(base({ frames: [frame({ drawnBodies: dots }), moving({ drawnBodies: dots })] })))
      .toContain('geometry-follows-engine')
  })

  it('does not infer a fresh projection per frame to make wrong drawing appear correct', () => {
    const shifted = draw(2, 3, { transform: [20, 0, 0, -20, 61, 200], pixelX: 101 })
    expect(failing(base({ frames: [frame(), moving({ drawnBodies: [shifted] })] }))).toContain('geometry-follows-engine')
  })

  it.each([
    { paintedPixels: 0 }, { paintedPixels: 15 }, { paintedPixels: Number.NaN },
    { pixelX: Number.POSITIVE_INFINITY }, { pixelY: 201 },
    { transform: [20, 0, 0, 0, 60, 200] }, { transform: [20, 0, 0, Number.NaN, 60, 200] },
    { source: 'renderer-stamp' },
  ])('rejects unusable native pixel/projection evidence: %j', invalid => {
    expect(failing(base({ frames: [frame({ drawnBodies: [draw(0, 0, invalid as unknown as Partial<DrawnBody>)] }), moving()] })))
      .toContain('geometry-follows-engine')
  })

  it('fails a static picture across sampled times', () => {
    expect(failing(base({ frames: [frame(), moving({ paintHash: frame().paintHash })] }))).toContain('motion-sampled')
  })

  it('does not mistake background or text changes for motion of a static body', () => {
    expect(failing(base({ frames: [frame(), frame({ time: 1, paintHash: 'f'.repeat(64) })] }))).toContain('motion-sampled')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('does not discard invalid sampled times: %s', time => {
    expect(failing(base({ frames: [frame(), moving(), moving({ time, paintHash: 'f'.repeat(64) })] }))).toContain('motion-sampled')
  })

  it('fails when a parameter change repaints identically', () => {
    expect(failing(base({ changedPaintHash: 'b'.repeat(64), changedFrame: frame() }))).toContain('parameter-change')
  })

  it('requires geometry for the changed frame, not only a new hash', () => {
    expect(failing(base({ changedFrame: undefined }))).toContain('parameter-change')
    expect(failing(base({ changedFrame: frame({ drawnBodies: undefined, paintHash: 'd'.repeat(64), stamped: { bodyX: 0, bodyY: 0 } }) }))).toContain('parameter-change')
    expect(failing(base({ changedFrame: frame({ drawnBodies: [draw(5, 0)], paintHash: 'd'.repeat(64) }) }))).toContain('parameter-change')
    expect(failing(base({ changedFrame: frame({ engineBody: undefined, paintHash: 'd'.repeat(64) }) }))).toContain('parameter-change')
  })

  it('binds repaint hashes to the actually sampled frames', () => {
    expect(failing(base({ changedPaintHash: 'f'.repeat(64) }))).toContain('parameter-change')
    expect(failing(base({ originalPaintHash: 'f'.repeat(64) }))).toContain('parameter-change')
  })

  it('fails when the parameter change was never observed', () => {
    expect(failing(base({ parameterChanged: undefined }))).toContain('parameter-change')
  })

  it('fails horizontal overflow on the smallest mobile stage', () => {
    expect(failing(base({ mobile: { viewportWidth: 219, scrollWidth: 260, overflow: true } }))).toContain('mobile-layout')
  })

  it('fails a candidate bound to another scene revision or digest', () => {
    expect(failing(base({ candidateSceneSha256: 'f'.repeat(64) }))).toContain('scene-binding')
    expect(failing(base({ candidateSceneRevision: 2 }))).toContain('scene-binding')
  })

  it('fails closed when there are no sampled frames', () => {
    const names = failing(base({ frames: [] }))
    expect(names).toContain('subject-drawn')
    expect(names).toContain('geometry-follows-engine')
    expect(names).toContain('motion-sampled')
  })
})
