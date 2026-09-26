import { canonicalValue } from '@physicsos/physics-units'
import { PhysicsOSError } from '@physicsos/shared'
import { modernPhysicsBenchOf, type PhysicsScene } from '@physicsos/physics-scene'

export const PLANCK_CONSTANT = 6.62607015e-34
export const LIGHT_SPEED = 2.99792458e8
export const ELECTRON_CHARGE = 1.602176634e-19
export const PHOTOELECTRIC_EFFECT_MODEL = 'photoelectric_effect'

export interface PhotoelectricModel {
  readonly modelId: typeof PHOTOELECTRIC_EFFECT_MODEL
  readonly benchId: string
  readonly workFunction: number
  readonly photonWavelength: number
  readonly lightIntensity: number
  readonly cathodeArea: number
  readonly quantumEfficiency: number
  readonly photonFrequency: number
  readonly photonEnergy: number
  readonly thresholdFrequency: number
  readonly thresholdWavelength: number
  readonly emits: boolean
  readonly maxKineticEnergy: number
  readonly stoppingPotential: number
  readonly photonFlux: number
  readonly photocurrent: number
}

/** Resolve the bench into SI facts and every quantity the one-photon law implies. */
export const resolvePhotoelectricModel = (scene: PhysicsScene): PhotoelectricModel => {
  const benches = scene.modernPhysicsBenches ?? []
  const bench = modernPhysicsBenchOf(scene)
  if (bench === undefined || benches.length !== 1) {
    throw new PhysicsOSError(
      'MODERN_SINGLE_BENCH',
      'Photoelectric model requires exactly one modern-physics bench.',
    )
  }
  if (bench.type !== PHOTOELECTRIC_EFFECT_MODEL) {
    throw new PhysicsOSError(
      'MODERN_UNSUPPORTED_MODEL',
      `Modern physics bench type "${String(bench.type)}" is not implemented.`,
    )
  }

  const workFunction = canonicalValue(bench.workFunction)
  const photonWavelength = canonicalValue(bench.photonWavelength)
  const lightIntensity = canonicalValue(bench.lightIntensity)
  const cathodeArea = canonicalValue(bench.cathodeArea)
  if (
    !Number.isFinite(workFunction) ||
    workFunction <= 0 ||
    !Number.isFinite(photonWavelength) ||
    photonWavelength <= 0 ||
    !Number.isFinite(lightIntensity) ||
    lightIntensity < 0 ||
    !Number.isFinite(cathodeArea) ||
    cathodeArea <= 0 ||
    !Number.isFinite(bench.quantumEfficiency) ||
    bench.quantumEfficiency < 0 ||
    bench.quantumEfficiency > 1
  ) {
    throw new PhysicsOSError(
      'MODERN_INVALID_BENCH',
      'Photoelectric bench values must be finite, with positive wavelength/work function/area and efficiency in [0, 1].',
    )
  }

  const photonFrequency = LIGHT_SPEED / photonWavelength
  const photonEnergy = PLANCK_CONSTANT * photonFrequency
  const thresholdFrequency = workFunction / PLANCK_CONSTANT
  const thresholdWavelength = (PLANCK_CONSTANT * LIGHT_SPEED) / workFunction
  const emits = photonEnergy >= workFunction
  const maxKineticEnergy = emits ? photonEnergy - workFunction : 0
  const stoppingPotential = maxKineticEnergy / ELECTRON_CHARGE
  const photonFlux = (lightIntensity * cathodeArea) / photonEnergy
  const photocurrent = emits ? ELECTRON_CHARGE * bench.quantumEfficiency * photonFlux : 0

  return {
    modelId: PHOTOELECTRIC_EFFECT_MODEL,
    benchId: bench.id,
    workFunction,
    photonWavelength,
    lightIntensity,
    cathodeArea,
    quantumEfficiency: bench.quantumEfficiency,
    photonFrequency,
    photonEnergy,
    thresholdFrequency,
    thresholdWavelength,
    emits,
    maxKineticEnergy,
    stoppingPotential,
    photonFlux,
    photocurrent,
  }
}
