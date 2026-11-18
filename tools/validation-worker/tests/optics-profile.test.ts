import { describe, expect, it } from 'vitest'
import { OPTICS_VALIDATION_PROFILE, MECHANICS_VALIDATION_PROFILE, requiredValidationChecks } from '../../../packages/shared/src/index.ts'
import { evaluateObservation, type Observation } from '../src/verdict.ts'
import { opticsGeometry, opticsSemanticState } from '../src/optics-verdict.ts'
import { staticOpticsFacts } from '../src/static-optics.ts'
import { planScene } from '../src/planner.ts'
import { createOpticsWorkspaceRuntime } from '../../../overlays/harness/files/packages/client/ui-physicsos/src/client/physics/optics-workspace-runtime.ts'
import { realOpticsPlan, opticsSample } from './optics-fixture.ts'

const real = realOpticsPlan()
function observation(): Observation {
  const first = opticsSample(real.plan.frames[0]!.snapshot), repeat = opticsSample(real.plan.frames[1]!.snapshot)
  const changed = opticsSample(real.plan.changedFrame!.snapshot)
  return {
    validationProfile: OPTICS_VALIDATION_PROFILE, firstFrameAcknowledged: true, nativeSurface: true,
    frames: [first, repeat], changedFrame: changed, parameterChanged: true,
    originalPaintHash: first.paintHash, changedPaintHash: changed.paintHash,
    parameterControl: { id: 'object-height', from: 6, to: 6.5, nativeContract: true, intentMatched: true },
    mobile: { viewportWidth: 219, scrollWidth: 219, overflow: false }, mobileFrame: opticsSample(real.plan.changedFrame!.snapshot, 3),
    candidateSha256: 'a'.repeat(64), expectedSceneSha256: 'b'.repeat(64), candidateSceneSha256: 'b'.repeat(64),
    expectedSceneRevision: 3, candidateSceneRevision: 3,
  }
}
const failures = (value: Observation) => evaluateObservation(value).checks.filter(check => !check.passed).map(check => check.name)

describe('concrete static thin-lens validation policy', () => {
  it('plans same-time same-fact replay and an exact real object-height edit from the native optics runtime', () => {
    expect(real.plan.validationProfile).toEqual(OPTICS_VALIDATION_PROFILE)
    expect(real.plan.frames.map(frame => frame.snapshot.clock)).toEqual([
      { time: 0, total: 0, running: false, rate: 1 }, { time: 0, total: 0, running: false, rate: 1 },
    ])
    expect(real.plan.frames[0]?.snapshot).toEqual(real.plan.frames[1]?.snapshot)
    expect(real.plan.parameter).toEqual({ id: 'object-height', from: 6, to: 6.5 })
    expect(staticOpticsFacts(real.plan.changedFrame!.snapshot)?.object.height).toBe(6.5)
    expect(staticOpticsFacts(real.plan.changedFrame!.snapshot)?.image.height).not.toBe(staticOpticsFacts(real.plan.frames[0]!.snapshot)?.image.height)
  })

  it('passes native axis-calibrated geometry, exact semantics, frozen replay, parameter control and resized same-state visibility', () => {
    const verdict = evaluateObservation(observation())
    expect(verdict.passed).toBe(true)
    expect(verdict.validationProfile).toEqual(OPTICS_VALIDATION_PROFILE)
    expect(verdict.checks.map(check => check.name)).toEqual(requiredValidationChecks(OPTICS_VALIDATION_PROFILE))
    expect(verdict.checks).not.toContainEqual(expect.objectContaining({ name: 'motion-sampled' }))
    expect(opticsGeometry(observation().frames[0]!)).toBeDefined()
    expect(opticsSemanticState(observation().frames[0]!)).toBe(true)
  })

  it('does not grant the motion policy a static waiver', () => {
    expect(failures({ ...observation(), validationProfile: MECHANICS_VALIDATION_PROFILE })).toContain('motion-sampled')
    expect(failures({ ...observation(), validationProfile: MECHANICS_VALIDATION_PROFILE })).toContain('geometry-follows-engine')
  })

  it('refuses static opt-in when an arbitrary runtime lacks concrete raw engine identity', () => {
    const frame = createOpticsWorkspaceRuntime(real.scene).getSnapshot()
    expect(() => planScene({ ...real.scene }, () => ({ getSnapshot: () => frame }), 'convex-lens')).toThrow(expect.objectContaining({ code: 'PROFILE_UNSUPPORTED' }))
  })

  it.each(['source', 'opticalRays', 'opticalImages', 'verification', 'height-unit', 'hidden-image', 'virtual', 'curve'] as const)('does not infer absent or unsupported facts: %s', mode => {
    const frame = structuredClone(real.plan.frames[0]!.snapshot)
    const view = frame.view as Record<string, unknown>
    if (mode === 'source') frame.source = 'child-engine'
    if (mode === 'opticalRays' || mode === 'opticalImages') view[mode] = []
    if (mode === 'verification') frame.verification = []
    if (mode === 'height-unit') ((frame.inspector as { parameters?: { id: string; unit: string }[] }[])[0]!.parameters!.find(item => item.id === 'object-height')!).unit = 'm'
    if (mode === 'hidden-image') (view.visible as Record<string, unknown>).image = false
    if (mode === 'virtual') (view.opticalImages as Record<string, unknown>[])[0]!.nature = 'virtual'
    if (mode === 'curve') (view.opticalElements as Record<string, unknown>[])[0]!.kind = 'curved_mirror'
    expect(staticOpticsFacts(frame)).toBeUndefined()
  })

  it.each(['ray', 'image', 'axis', 'triangle', 'covered', 'taint', 'no-facts'] as const)('rejects wrong or unpainted actual geometry: %s', mode => {
    const value = observation(), first = value.frames[0]!
    let invalid = structuredClone(first)
    if (mode === 'ray' || mode === 'image' || mode === 'axis') {
      const index = mode === 'axis' ? 0 : mode === 'image' ? 2 : 4
      const line = invalid.drawnSegments![index]!
      const x = line.pixelTo.x + 2
      invalid = { ...invalid, drawnSegments: invalid.drawnSegments!.map((item, i) => i === index ? { ...item, to: { ...item.to, x }, pixelTo: { ...item.pixelTo, x } } : item) }
    }
    if (mode === 'triangle') invalid = { ...invalid, drawnTriangles: [] }
    if (mode === 'covered') invalid = { ...invalid, drawnSegments: invalid.drawnSegments!.map(item => ({ ...item, paintedPatches: 0 })) }
    if (mode === 'taint') invalid = { ...invalid, taintedSurfaces: 1 }
    if (mode === 'no-facts') invalid = { ...invalid, optics: undefined }
    expect(failures({ ...value, frames: [invalid, value.frames[1]!] })).toContain('geometry-follows-engine')
  })

  it('does not use stamps, generic nonblank screenshots, or other-surface semantics as a geometry proof', () => {
    const value = observation(), first = value.frames[0]!
    expect(failures({ ...value, frames: [{ ...first, drawnSegments: [], drawnTriangles: [], stamped: { bodyX: 0, bodyY: 0 } }, value.frames[1]!] }))
      .toContain('geometry-follows-engine')
    expect(failures({ ...value, frames: [{ ...first, drawnTexts: first.drawnTexts!.map(item => ({ ...item, surface: 9 })) }, value.frames[1]!] })).toContain('semantic-state')
  })

  it('rejects CSS distortion or unreadably shrunk native geometry/ink instead of counting backing pixels as visible evidence', () => {
    const value = observation(), first = value.frames[0]!
    for (const drawnSurfaces of [[], [{ ...first.drawnSurfaces![0]!, displayWidth: 300 }],
      [{ ...first.drawnSurfaces![0]!, displayWidth: 6, displayHeight: 3 }]]) {
      expect(failures({ ...value, frames: [{ ...first, drawnSurfaces }, value.frames[1]!] })).toContain('geometry-follows-engine')
    }
    expect(failures({ ...value, frames: [{ ...first, drawnTexts: first.drawnTexts!.map(item => ({ ...item, inkHeight: 1 })) }, value.frames[1]!] })).toContain('semantic-state')
  })

  it.each(['time', 'facts', 'paint', 'geometry'] as const)('does not label changed %s as same frozen frame', mode => {
    const value = observation(), repeat = value.frames[1]!
    const invalid = mode === 'time' ? { ...repeat, time: 0.0001 } : mode === 'facts' ? { ...repeat, snapshotSha256: 'f'.repeat(64) }
      : mode === 'paint' ? { ...repeat, paintHash: 'f'.repeat(64) } : { ...repeat, drawnSegments: [] }
    expect(failures({ ...value, frames: [value.frames[0]!, invalid] })).toContain('static-frame-stable')
  })

  it.each(['wrong-id', 'wrong-unit-contract', 'forged-intent', 'no-control', 'no-change', 'wrong-geometry', 'wrong-semantics'] as const)('requires exact semantic parameter behavior: %s', mode => {
    const value = observation()
    const invalid = mode === 'wrong-id' ? { ...value, parameterControl: { ...value.parameterControl!, id: 'speed' } }
      : mode === 'wrong-unit-contract' ? { ...value, parameterControl: { ...value.parameterControl!, nativeContract: false } }
        : mode === 'forged-intent' ? { ...value, parameterControl: { ...value.parameterControl!, intentMatched: false } }
          : mode === 'no-control' ? { ...value, parameterControl: undefined }
            : mode === 'no-change' ? { ...value, changedFrame: value.frames[0], changedPaintHash: value.frames[0]?.paintHash }
              : { ...value, changedFrame: { ...value.changedFrame!, ...(mode === 'wrong-geometry' ? { drawnTriangles: [] } : { drawnTexts: [] }) } }
    expect(failures(invalid)).toContain('parameter-change')
  })

  it('requires frozen same-state visible geometry and exact semantics at mobile size', () => {
    const value = observation()
    for (const mobileFrame of [undefined, { ...value.mobileFrame!, optics: undefined }, { ...value.mobileFrame!, drawnSegments: [] },
      { ...value.mobileFrame!, drawnTexts: [] }, { ...value.mobileFrame!, snapshotSha256: 'f'.repeat(64) }]) {
      expect(failures({ ...value, mobileFrame })).toContain('mobile-geometry')
    }
    expect(failures({ ...value, mobile: { viewportWidth: 219, scrollWidth: 500, overflow: true } })).toContain('mobile-layout')
  })

  it('retains first-frame, runtime-error, digest/revision binding and mobile layout checks under the static policy', () => {
    const value = observation()
    expect(failures({ ...value, firstFrameAcknowledged: false })).toContain('first-frame')
    expect(failures({ ...value, runtimeError: 'CORS_ERROR' })).toContain('runtime-error')
    expect(failures({ ...value, candidateSceneSha256: 'f'.repeat(64) })).toContain('scene-binding')
    expect(failures({ ...value, candidateSceneRevision: 99 })).toContain('scene-binding')
    expect(failures({ ...value, nativeSurface: false })).toContain('subject-drawn')
  })

  it('rejects unknown or forged policy versions and unknown domains instead of widening acceptance', () => {
    for (const profile of [{ id: OPTICS_VALIDATION_PROFILE.id, version: 2 }, { id: 'arbitrary-static', version: 1 }, { ...OPTICS_VALIDATION_PROFILE, motion: false }]) {
      const verdict = evaluateObservation({ ...observation(), validationProfile: profile as typeof OPTICS_VALIDATION_PROFILE })
      expect(verdict.passed).toBe(false)
      expect(verdict.checks).toEqual([{ name: 'profile-binding', passed: false, detail: 'unsupported-runtime@1' }])
    }
    expect(() => planScene({ ...real.scene }, () => ({ getSnapshot: () => ({ ...createOpticsWorkspaceRuntime(real.scene).getSnapshot(), domain: 'circuit' }) }), 'convex-lens'))
      .toThrow(expect.objectContaining({ code: 'PROFILE_UNSUPPORTED' }))
  })
})
