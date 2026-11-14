import { describe, expect, it } from 'vitest'
import { evaluateObservation, type Observation, type SampledFrame } from '../src/index.ts'

const SHA = 'a'.repeat(64)
const frame = (overrides: Partial<SampledFrame> = {}): SampledFrame => ({
  time: 0,
  engineBody: { x: 0, y: 0 },
  stamped: { bodyX: 0, bodyY: 0, clockTime: 0 },
  paintHash: SHA.slice(0, 8) + 'b'.repeat(56),
  geometryCount: 12,
  opaquePixels: 900,
  distinctColors: 20,
  ...overrides,
})
const base = (overrides: Partial<Observation> = {}): Observation => ({
  firstFrameAcknowledged: true,
  frames: [
    frame(),
    frame({ time: 1.5, engineBody: { x: 2, y: 12 }, stamped: { bodyX: 2, bodyY: 12, clockTime: 1.5 }, paintHash: 'c'.repeat(64) }),
  ],
  nativeSurface: true,
  parameterChanged: true,
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
  it('passes a candidate that paints, moves with the engine, repaints and fits mobile', () => {
    const verdict = evaluateObservation(base())
    expect(verdict.passed).toBe(true)
    expect(verdict.checks).toHaveLength(8)
  })

  it('fails a candidate that never acknowledges its first frame', () => {
    expect(failing(base({ firstFrameAcknowledged: false }))).toContain('first-frame')
  })

  it('fails on a runtime error even when pixels exist', () => {
    expect(failing(base({ runtimeError: 'RENDER_FAILED' }))).toContain('runtime-error')
  })

  it('fails a blank or background-only canvas', () => {
    const blank = base({ frames: [frame({ opaquePixels: 0, distinctColors: 1, geometryCount: 0 }), frame({ time: 1, paintHash: 'f'.repeat(64), opaquePixels: 0, distinctColors: 1, geometryCount: 0 })] })
    expect(failing(blank)).toContain('subject-drawn')
  })

  it('fails when no canvas/svg exists at all', () => {
    expect(failing(base({ nativeSurface: false }))).toContain('subject-drawn')
  })

  it('fails when the drawn position disagrees with the engine snapshot', () => {
    expect(failing(base({ frames: [frame(), frame({ time: 1, engineBody: { x: 2, y: 12 }, stamped: { bodyX: 2, bodyY: 13 }, paintHash: 'c'.repeat(64) })] })))
      .toContain('geometry-follows-engine')
  })

  it('fails when no engine position is stamped anywhere (unverifiable)', () => {
    expect(failing(base({ frames: [frame({ stamped: undefined }), frame({ time: 1, stamped: undefined, paintHash: 'c'.repeat(64) })] })))
      .toContain('geometry-follows-engine')
  })

  it('fails a static picture across sampled times', () => {
    expect(failing(base({ frames: [frame(), frame({ time: 1, paintHash: frame().paintHash })] }))).toContain('motion-sampled')
  })

  it('fails when a parameter change repaints identically', () => {
    expect(failing(base({ changedPaintHash: 'b'.repeat(64) }))).toContain('parameter-change')
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
    expect(names).toContain('motion-sampled')
  })
})
