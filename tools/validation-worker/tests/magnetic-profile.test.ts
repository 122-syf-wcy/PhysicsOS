import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { derivedScalar } from '../../../packages/physics-core/src/index.ts'
import { MagneticEngine } from '../../../packages/engine-magnetic/src/index.ts'
import { createMagneticWorkspaceRuntime } from '../../../overlays/harness/files/packages/client/ui-physicsos/src/client/physics/magnetic-workspace-runtime.ts'
import { MAGNETIC_VALIDATION_PROFILE, MECHANICS_VALIDATION_PROFILE, UNSUPPORTED_VALIDATION_PROFILE,
  isQuestionCodeValidationProfile, requiredValidationChecks } from '../../../packages/shared/src/index.ts'
import { evaluateObservation, type Observation } from '../src/verdict.ts'
import { evaluateCandidate } from '../src/server.ts'
import { planScene } from '../src/planner.ts'
import type { BrowserFrame, DrawnBody } from '../src/types.ts'
import { magneticScene, magneticRuntime, magneticSample, realMagneticPlan } from './magnetic-fixture.ts'

const real = realMagneticPlan()
const observation = (): Observation => {
  const frames = real.plan.frames.map(frame => magneticSample(frame.snapshot)), changed = magneticSample(real.plan.changedFrame!.snapshot)
  return { validationProfile: MAGNETIC_VALIDATION_PROFILE, parameter: real.plan.parameter,
    firstFrameAcknowledged: true, nativeSurface: true, frames, changedFrame: changed, parameterChanged: true,
    originalPaintHash: frames[0]!.paintHash, changedPaintHash: changed.paintHash,
    mobile: { viewportWidth: 219, scrollWidth: 219, overflow: false },
    candidateSha256: 'a'.repeat(64), expectedSceneSha256: 'b'.repeat(64), candidateSceneSha256: 'b'.repeat(64),
    expectedSceneRevision: 3, candidateSceneRevision: 3 }
}
const failed = (value: Observation) => evaluateObservation(value).checks.filter(check => !check.passed).map(check => check.name)
const drawing = (frame: BrowserFrame, x: number, y: number): BrowserFrame => {
  const draw = frame.drawnBodies![0]!, [a, b, c, d, e, f] = draw.transform
  return { ...frame, drawnBodies: [{ ...draw, x, y, pixelX: a * x + c * y + e, pixelY: b * x + d * y + f }] }
}

describe('narrow uniform magnetic circular native-motion policy', () => {
  it('uses the real engine support/plan despite captureRaw deliberately having no model field', () => {
    const runtime = createMagneticWorkspaceRuntime(real.scene), raw = runtime.captureRaw()
    expect(raw.engineInfo).not.toHaveProperty('model')
    expect(new MagneticEngine().canHandle(real.scene)).toMatchObject({ supported: true, modelId: 'uniform-magnetic-field-charged-particle-2d' })
    expect(derivedScalar(raw.result!.derivedQuantities, 'cyclotron_radius').value * 100).toBeCloseTo(2.609375, 10)
    const period = derivedScalar(raw.result!.derivedQuantities, 'cyclotron_period').value
    expect(period).toBeCloseTo(1.6395186660921733e-7, 19)
    expect(real.plan.validationProfile).toEqual(MAGNETIC_VALIDATION_PROFILE)
    expect(real.plan.frames.map(frame => (frame.snapshot.clock as { time: number }).time)).toEqual([0, period / 4, period / 2, 3 * period / 4])
    expect(real.plan.frames.every(frame => (frame.snapshot.view as { bodies: unknown[] }).bodies.length === 0)).toBe(true)
    // Clockwise in mathematical y-up coordinates; bridge adds its actual box-centre cm offset.
    const points = real.plan.frames.map(frame => (frame.snapshot.view as { particles: { at: { x: number; y: number } }[] }).particles[0]!.at)
    expect(points[0]!.x).toBeCloseTo(12, 10)
    expect(points[0]!.y).toBeCloseTo(6.75 + 2.609375, 10)
    expect(points[1]!.x).toBeGreaterThan(points[0]!.x)
    expect(points[1]!.y).toBeLessThan(points[0]!.y)
    expect(real.plan.parameter).toEqual({ id: 'v0', from: 1e6, to: 1.1e6 })
    expect(real.plan.changedFrame!.snapshot.revision).toBe(4)
    expect((real.plan.changedFrame!.snapshot.clock as { time: number }).time).toBe(period / 4)
    expect(real.plan.changedFrame!.snapshot.view).toMatchObject({ extent: (real.plan.frames[0]!.snapshot.view as Record<string, unknown>).extent,
      field: (real.plan.frames[0]!.snapshot.view as Record<string, unknown>).field })
  })

  it('shares the exact mandatory motion inventory and rejects altered profile fields/versions', () => {
    const value = observation(), verdict = evaluateObservation(value)
    expect(verdict.checks.filter(check => !check.passed)).toEqual([])
    expect(verdict.passed).toBe(true)
    expect(verdict.checks.map(check => check.name)).toEqual(requiredValidationChecks(MAGNETIC_VALIDATION_PROFILE))
    for (const profile of [{ ...MAGNETIC_VALIDATION_PROFILE, version: 2 }, { ...MAGNETIC_VALIDATION_PROFILE, skipMotion: true }, { id: 'magnetic', version: 1 }]) {
      expect(isQuestionCodeValidationProfile(profile)).toBe(false)
      expect(evaluateObservation({ ...value, validationProfile: profile as typeof MAGNETIC_VALIDATION_PROFILE })).toMatchObject({ passed: false, validationProfile: UNSUPPORTED_VALIDATION_PROFILE })
    }
  })

  it.each(['static', 'reverse', 'offset', 'SI', 'only-text', 'covered', 'other-surface', 'other-index', 'moving-CTM', 'singular-CTM'] as const)(
    'rejects false native motion evidence: %s', mode => {
      const value = observation()
      const frames = value.frames.map((frame, index) => {
        const point = frame.engineBody!, first = value.frames[0]!.engineBody!, last = value.frames[(4 - index) % 4]!.engineBody!
        if (mode === 'static') return drawing(frame, first.x, first.y)
        if (mode === 'reverse') return drawing(frame, last.x, last.y)
        if (mode === 'offset') return drawing(frame, point.x + 0.01, point.y)
        if (mode === 'SI') return drawing(frame, point.x / 100, point.y / 100)
        if (mode === 'only-text') return { ...frame, drawnBodies: [] }
        const draw = frame.drawnBodies![0]!
        if (mode === 'covered') return { ...frame, drawnBodies: [{ ...draw, paintedPixels: 0, paintedPatches: 0 }] }
        if (mode === 'other-surface') return { ...frame, drawnBodies: [{ ...draw, surface: index }] }
        if (mode === 'other-index') return { ...frame, drawnBodies: [{ ...draw, drawIndex: index }] }
        const transform: DrawnBody['transform'] = mode === 'singular-CTM' ? [0, 0, 0, 0, draw.pixelX, draw.pixelY]
          : [10, 0, 0, -10, 40 + index, 210]
        return { ...frame, drawnBodies: [{ ...draw, transform, pixelX: transform[0] * point.x + transform[4], pixelY: transform[3] * point.y + transform[5] }] }
      })
      expect(failed({ ...value, frames })).toContain('geometry-follows-engine')
    })

  it('does not grant a magnetic ground projection fallback or treat a period closure as motion', () => {
    const value = observation()
    expect(failed({ ...value, frames: [value.frames[0]!, { ...value.frames[0]!, time: value.frames[1]!.time * 4 }] })).toContain('motion-sampled')
    const frames = value.frames.map(frame => ({ ...drawing(frame, 0, 0), engineGround: { from: 0, to: 24, y: 0 },
      drawnGrounds: [{ source: 'canvas-2d-line-stroke' as const, surface: 0, strokeIndex: 0, from: { x: 0, y: 0 }, to: { x: 24, y: 0 },
        transform: [10, 0, 0, -10, 40, 210] as const, pixelFrom: { x: 40, y: 210 }, pixelTo: { x: 280, y: 210 }, paintedPatches: 4 }] }))
    expect(failed({ ...value, frames })).toContain('geometry-follows-engine')
  })

  it.each(['stale', 'wrong-revision', 'wrong-phase', 'wrong-parameter', 'wrong-ratio', 'wrong-geometry'] as const)(
    'requires real v0 edit revision, phase and changed native geometry: %s', mode => {
      const value = observation()
      if (mode === 'stale') expect(failed({ ...value, changedFrame: value.frames[1]!, changedPaintHash: value.frames[1]!.paintHash })).toContain('parameter-change')
      if (mode === 'wrong-revision') expect(failed({ ...value, changedFrame: { ...value.changedFrame!, revision: 3 } })).toContain('parameter-change')
      if (mode === 'wrong-phase') expect(failed({ ...value, changedFrame: { ...value.changedFrame!, time: 0 } })).toContain('parameter-change')
      if (mode === 'wrong-parameter' || mode === 'wrong-ratio') expect(failed({ ...value, parameter: { ...value.parameter!, ...(mode === 'wrong-parameter' ? { id: 'q' } : { to: 1e6 + 1 }) } })).toContain('parameter-change')
      if (mode === 'wrong-geometry') expect(failed({ ...value, changedFrame: drawing(value.changedFrame!, value.frames[1]!.engineBody!.x, value.frames[1]!.engineBody!.y) })).toContain('parameter-change')
    })

  it('retains first-frame, runtime error, scene binding, visible subject and mobile layout requirements', () => {
    const value = observation()
    expect(failed({ ...value, firstFrameAcknowledged: false })).toContain('first-frame')
    expect(failed({ ...value, runtimeError: 'CORS_ERROR' })).toContain('runtime-error')
    expect(failed({ ...value, candidateSceneSha256: 'f'.repeat(64) })).toContain('scene-binding')
    expect(failed({ ...value, candidateSceneRevision: 99 })).toContain('scene-binding')
    expect(failed({ ...value, nativeSurface: false })).toContain('subject-drawn')
    expect(failed({ ...value, mobile: { viewportWidth: 219, scrollWidth: 600, overflow: true } })).toContain('mobile-layout')
  })

  it('refuses a fake runtime without raw engine facts, an unregistered experiment and stale/incorrect raw revisions', () => {
    const runtime = createMagneticWorkspaceRuntime(real.scene)
    expect(() => planScene({ ...real.scene }, () => ({ getSnapshot: () => runtime.getSnapshot() }), 'magnetic-circular')).toThrow()
    expect(() => planScene({ ...real.scene }, magneticRuntime, 'magnetic-other')).toThrow(expect.objectContaining({ code: 'PROFILE_UNSUPPORTED' }))
    for (const mode of ['identity', 'revision', 'verification', 'SI', 'stale-edit', 'stale-view'] as const) {
      const source = createMagneticWorkspaceRuntime(magneticScene()), old = source.getSnapshot()
      const factory = () => ({ getSnapshot: () => source.getSnapshot(),
        editParameter(id: string, value: number) { return mode === 'stale-edit' ? old : source.editParameter(id, value) },
        seek(time: number) { const snapshot = source.seek(time); return mode === 'stale-view' && snapshot.sceneRevision !== old.sceneRevision ? old
          : mode === 'SI' ? { ...snapshot, view: { ...snapshot.view,
            particles: snapshot.view.particles.map(p => ({ ...p, at: { x: p.at.x / 100, y: p.at.y / 100 } })) } } : snapshot },
        captureRaw() { const raw = source.captureRaw(); return mode === 'identity' ? { ...raw, engineInfo: { ...raw.engineInfo, id: 'engine-child' } }
          : mode === 'revision' ? { ...raw, result: { ...raw.result!, sceneRevision: 99 } }
            : mode === 'verification' ? { ...raw, result: { ...raw.result!, verification: { ...raw.result!.verification, status: 'failed' as const } } } : raw },
      })
      expect(() => planScene({ ...real.scene }, factory, 'magnetic-circular')).toThrow(expect.objectContaining({ code: 'INVALID_SNAPSHOT' }))
    }
  })

  it('never opens pinned magnetic frames without independent canonical planning and an exact profile match', async () => {
    const newContext = vi.fn(() => { throw new Error('candidate must remain unopened') }), browser = { newContext } as unknown as Browser
    const request = { wrapperUrl: 'https://app.invalid/wrapper.html', entryUrl: 'https://app.invalid/index.html', token: 'channel'.repeat(4),
      validationProfile: MAGNETIC_VALIDATION_PROFILE, scene: { ...real.scene }, experimentId: 'magnetic-circular',
      frames: [{ frameId: 'fake0', snapshot: {} }, { frameId: 'fake1', snapshot: {} }], changedFrame: { frameId: 'fake-change', snapshot: {} },
      expected: { candidateSha256: 'a'.repeat(64), sceneSha256: 'b'.repeat(64), sceneRevision: 3 } }
    await expect(evaluateCandidate(browser, request)).rejects.toMatchObject({ status: 503 })
    const { scene: _scene, experimentId: _experimentId, ...pinnedOnly } = request
    expect(await evaluateCandidate(browser, pinnedOnly)).toMatchObject({ passed: false, validationProfile: MAGNETIC_VALIDATION_PROFILE })
    const planner = vi.fn(() => ({ ...real.plan, validationProfile: MECHANICS_VALIDATION_PROFILE }))
    expect(await evaluateCandidate(browser, request, undefined, planner)).toMatchObject({ passed: false, validationProfile: MAGNETIC_VALIDATION_PROFILE })
    expect(planner).toHaveBeenCalledWith(request.scene, 'magnetic-circular')
    expect(newContext).not.toHaveBeenCalled()
  })
})
