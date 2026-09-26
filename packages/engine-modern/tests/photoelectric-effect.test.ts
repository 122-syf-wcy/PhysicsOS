import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'
import {
  createPhotoelectricEffectScene,
  modernPhysicsBenchOf,
  validateScene,
} from '@physicsos/physics-scene'

import {
  MODERN_ENGINE_ID,
  PHOTOELECTRIC_EFFECT_MODEL,
  ModernPhysicsEngine,
  createModernSimulationRequest,
  observeModernPhysicsScene,
  resolvePhotoelectricModel,
} from '../src/index.ts'

const PLANCK = 6.62607015e-34
const LIGHT_SPEED = 2.99792458e8
const ELECTRON_CHARGE = 1.602176634e-19

const scalar = (result: ReturnType<ModernPhysicsEngine['simulate']>, key: string): number => {
  const value = result.derivedQuantities.find((entry) => entry.key === key)?.value
  if (value === undefined || 'vector' in value) throw new Error(`missing scalar ${key}`)
  return value.value
}

const simulate = (scene: ReturnType<typeof createPhotoelectricEffectScene>) =>
  new ModernPhysicsEngine().simulate(
    scene,
    createModernSimulationRequest(scene, 'sim-photoelectric', 'trace-photoelectric'),
  )

describe('photoelectric-effect model', () => {
  it('builds and validates a modern-physics scene', () => {
    const scene = createPhotoelectricEffectScene({
      workFunctionEv: 2,
      photonWavelengthNm: 400,
      lightIntensity: 10,
    })
    expect(modernPhysicsBenchOf(scene)?.type).toBe('photoelectric_effect')
    expect(validateScene(scene).status).toBe('passed')
  })

  it('derives photon energy, threshold and maximum kinetic energy from hf = W + Kmax', () => {
    const scene = createPhotoelectricEffectScene({
      workFunctionEv: 2,
      photonWavelengthNm: 400,
    })
    const model = resolvePhotoelectricModel(scene)
    const frequency = LIGHT_SPEED / 400e-9
    expect(model.modelId).toBe(PHOTOELECTRIC_EFFECT_MODEL)
    expect(model.photonEnergy).toBeCloseTo(PLANCK * frequency, 31)
    expect(model.thresholdFrequency).toBeCloseTo(model.workFunction / PLANCK, 20)
    expect(model.thresholdWavelength).toBeCloseTo((PLANCK * LIGHT_SPEED) / model.workFunction, 20)
    expect(model.maxKineticEnergy).toBeCloseTo(PLANCK * frequency - model.workFunction, 31)
    expect(model.stoppingPotential).toBeCloseTo(model.maxKineticEnergy / ELECTRON_CHARGE, 20)
  })

  it('emits no photoelectrons below the threshold and never reports negative kinetic energy', () => {
    const scene = createPhotoelectricEffectScene({
      workFunctionEv: 2,
      photonWavelengthNm: 700,
    })
    const model = resolvePhotoelectricModel(scene)
    const result = simulate(scene)
    expect(model.emits).toBe(false)
    expect(model.maxKineticEnergy).toBe(0)
    expect(scalar(result, 'max_kinetic_energy')).toBe(0)
    expect(scalar(result, 'photocurrent')).toBe(0)
  })

  it('doubles photocurrent with intensity while leaving Kmax unchanged', () => {
    const low = simulate(
      createPhotoelectricEffectScene({
        workFunctionEv: 2,
        photonWavelengthNm: 400,
        lightIntensity: 5,
      }),
    )
    const high = simulate(
      createPhotoelectricEffectScene({
        workFunctionEv: 2,
        photonWavelengthNm: 400,
        lightIntensity: 10,
      }),
    )
    expect(scalar(high, 'photocurrent')).toBeCloseTo(2 * scalar(low, 'photocurrent'), 28)
    expect(scalar(high, 'max_kinetic_energy')).toBeCloseTo(scalar(low, 'max_kinetic_energy'), 31)
  })

  it('passes the photoelectric law and intensity-independence checks', () => {
    const result = simulate(
      createPhotoelectricEffectScene({ workFunctionEv: 2, photonWavelengthNm: 400 }),
    )
    expect(result.verification.status).toBe('passed')
    expect(
      result.verification.checks.find((entry) => entry.id === 'photoelectric_equation')?.passed,
    ).toBe(true)
    expect(
      result.verification.checks.find((entry) => entry.id === 'threshold_frequency_relation')
        ?.passed,
    ).toBe(true)
    expect(
      result.verification.checks.find((entry) => entry.id === 'intensity_does_not_change_kmax')
        ?.passed,
    ).toBe(true)
  })

  it('projects verified engine facts into observations', () => {
    const scene = createPhotoelectricEffectScene({ workFunctionEv: 2, photonWavelengthNm: 400 })
    const simulation = simulate(scene)
    const observed = observeModernPhysicsScene({ scene, simulation })
    expect(observed.sceneRevision).toBe(scene.revision)
    expect(observed.observations.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(['photon_energy', 'photocurrent', 'stopping_potential']),
    )
  })

  it('returns UNSUPPORTED_MODEL for a modern model the engine does not implement', () => {
    const scene = createPhotoelectricEffectScene()
    Reflect.set(modernPhysicsBenchOf(scene)!, 'type', 'atomic_energy_level')
    const support = new ModernPhysicsEngine().canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.reason).toBe('unsupported_model')
      expect(support.failedConditions[0]?.condition).toBe('supported_modern_model')
    }
  })

  it('rejects a non-positive photon wavelength instead of returning fake emission', () => {
    const scene = createPhotoelectricEffectScene()
    modernPhysicsBenchOf(scene)!.photonWavelength = quantity(0, 'm', 'length')
    const support = new ModernPhysicsEngine().canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) expect(support.reason).toBe('unsupported_model')
  })

  it('keeps the stable engine identity', () => {
    expect(new ModernPhysicsEngine().engineId).toBe(MODERN_ENGINE_ID)
    expect(new ModernPhysicsEngine().domain).toBe('modern_physics')
  })
})
