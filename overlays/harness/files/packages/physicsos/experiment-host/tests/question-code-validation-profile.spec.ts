import { describe, expect, it } from 'vitest'
import { createOpticalBenchScene, createMechanicsScene } from '@physicsos/physics-scene'
import { MECHANICS_VALIDATION_PROFILE, OPTICS_VALIDATION_PROFILE, UNSUPPORTED_VALIDATION_PROFILE } from '@physicsos/shared'
import { selectQuestionCodeValidationProfile } from '../src/question-code-validation-profile.ts'

const lens = (distance = 30) => createOpticalBenchScene({ sceneId: 'profile-lens', revision: 4, now: '2026-11-18T00:00:00Z',
  object: { position: -distance, height: 6 }, element: { type: 'thin_lens', position: 0, focalLength: 10 } })

describe('trusted frozen-scene validation profile selection', () => {
  it('supports only verified real-image thin-lens optics, independently of scene titles and metadata hints', () => {
    const scene = lens()
    scene.metadata.title = 'arbitrary scene title'
    const hinted = { ...scene, metadata: { ...scene.metadata, validationProfile: { id: 'child-static', version: 9 } } }
    expect(selectQuestionCodeValidationProfile(hinted, 'convex-lens')).toEqual(OPTICS_VALIDATION_PROFILE)
  })

  it('retains native-motion policy for the mechanics engine', () => {
    const scene = createMechanicsScene({ sceneId: 'motion', revision: 3, model: 'projectile_motion',
      position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 10, z: 0 }, gravity: { x: 0, y: -10, z: 0 },
      endTime: 2, now: '2026-11-18T00:00:00Z' })
    expect(selectQuestionCodeValidationProfile(scene, 'projectile-oblique')).toEqual(MECHANICS_VALIDATION_PROFILE)
    expect(selectQuestionCodeValidationProfile(scene, 'convex-lens')).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
  })

  it.each([10, 5])('keeps focal and virtual-image thin-lens cases explicitly unsupported: u=%s', distance => {
    expect(selectQuestionCodeValidationProfile(lens(distance), 'convex-lens')).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
  })

  it('never trusts an unregistered template or an arbitrary child-provided static domain', () => {
    expect(selectQuestionCodeValidationProfile(lens(), 'unknown-optics')).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
    expect(selectQuestionCodeValidationProfile(lens(), 'uniform-linear')).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
    expect(selectQuestionCodeValidationProfile({ domain: 'optics', view: { opticalRays: [{ points: [] }] } }, 'convex-lens')).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
  })

  it('rejects mixed apparatus instead of treating a static lens as a generic domain waiver', () => {
    const scene = { ...lens(), noiseBenches: [{ id: 'not-a-lens' }] }
    expect(selectQuestionCodeValidationProfile(scene, 'convex-lens')).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
  })

  it('does not generalize to plane mirrors, curved mirrors, circuits or failed optics scenes', () => {
    for (const [scene, experimentId] of [
      [createOpticalBenchScene({ object: { position: -20, height: 6 }, element: { type: 'plane_mirror', position: 0 } }), 'plane-mirror'],
      [createOpticalBenchScene({ object: { position: -30, height: 6 }, element: { type: 'curved_mirror', position: 0, focalLength: 10 } }), 'concave-mirror'],
      [lens(-20), 'convex-lens'],
    ] as const) expect(selectQuestionCodeValidationProfile(scene, experimentId)).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
  })
})
