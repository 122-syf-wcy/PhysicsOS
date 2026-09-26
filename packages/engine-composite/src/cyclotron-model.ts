/**
 * Ideal time-varying-field cyclotron model.
 *
 * Between accelerating gaps the particle follows the exact uniform-B circular
 * orbit. The gap is treated as impulsive and synchronized: every half
 * cyclotron period the field reverses and the particle gains up to qV of
 * kinetic energy. The final crossing contributes only the energy needed to
 * reach the extraction radius, so the model never exceeds vmax = qBR/m.
 */
import { magnitude, vec3, type Vector3 } from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { toCanonicalVector } from '@physicsos/physics-core'
import { PhysicsOSError } from '@physicsos/shared'
import { cyclotronBenchOf, type FieldSample, type PhysicsScene } from '@physicsos/physics-scene'

import { compositeMotionAt } from '@physicsos/physics-composite-core'

export const CYCLOTRON_TIME_VARYING_MODEL = 'cyclotron_time_varying_field'

export interface CyclotronModel {
  readonly modelId: typeof CYCLOTRON_TIME_VARYING_MODEL
  readonly benchId: string
  readonly particleId: string
  readonly mass: number
  readonly charge: number
  readonly magneticFluxDensity: number
  readonly magneticFieldZ: number
  readonly gapVoltage: number
  readonly gapWidth: number
  readonly deeRadius: number
  readonly initialPosition: Vector3
  readonly initialVelocity: Vector3
  readonly initialSpeed: number
  readonly initialRadius: number
  readonly period: number
  readonly frequency: number
  readonly maxSpeed: number
  readonly maxKineticEnergy: number
  readonly accelerationCount: number
  readonly extractionTime: number
}

const fail = (code: string, message: string): never => {
  throw new PhysicsOSError(code, message)
}

const positive = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) fail(code, message)
  return value
}

const sampleOf = (model: CyclotronModel): FieldSample => ({
  electricField: vec3(0, 0, 0),
  magneticFluxDensity: vec3(0, 0, model.magneticFieldZ),
  gravity: vec3(0, 0, 0),
  regionIds: [],
})

export const resolveCyclotronModel = (scene: PhysicsScene): CyclotronModel => {
  const bench = cyclotronBenchOf(scene)
  const particle = scene.particles[0]
  if (bench === undefined || scene.cyclotronBenches?.length !== 1) {
    throw new PhysicsOSError(
      'CYCLOTRON_SINGLE_BENCH',
      'Cyclotron model requires exactly one cyclotron bench.',
    )
  }
  if (particle === undefined || particle.charge === undefined) {
    throw new PhysicsOSError('CYCLOTRON_PARTICLE', 'Cyclotron model requires one charged particle.')
  }

  const mass = positive(canonicalValue(particle.mass), 'CYCLOTRON_MASS', 'Mass must be > 0.')
  const charge = canonicalValue(particle.charge)
  if (!Number.isFinite(charge) || charge === 0) {
    fail('CYCLOTRON_CHARGE', 'Charge must be finite and non-zero.')
  }
  const magneticFluxDensity = positive(
    canonicalValue(bench.magneticFluxDensity),
    'CYCLOTRON_MAGNETIC_FIELD',
    'Magnetic flux density must be > 0.',
  )
  const gapVoltage = positive(
    canonicalValue(bench.gapVoltage),
    'CYCLOTRON_GAP_VOLTAGE',
    'Gap voltage must be > 0.',
  )
  const gapWidth = positive(
    canonicalValue(bench.gapWidth),
    'CYCLOTRON_GAP_WIDTH',
    'Gap width must be > 0.',
  )
  const deeRadius = positive(
    canonicalValue(bench.deeRadius),
    'CYCLOTRON_DEE_RADIUS',
    'Dee radius must be > 0.',
  )
  const initialPosition = toCanonicalVector(particle.position).vectorSI
  const initialVelocity = toCanonicalVector(particle.velocity).vectorSI
  const initialSpeed = magnitude(initialVelocity)
  if (
    !Number.isFinite(initialSpeed) ||
    initialSpeed <= 0 ||
    Math.abs(initialPosition.y) > 1e-15 ||
    Math.abs(initialPosition.z) > 1e-15 ||
    Math.abs(initialVelocity.y) > 1e-15 * initialSpeed ||
    Math.abs(initialVelocity.z) > 1e-15 * initialSpeed
  ) {
    fail(
      'CYCLOTRON_UNSUPPORTED_GEOMETRY',
      'The ideal cyclotron model starts in the gap plane with velocity along the gap normal.',
    )
  }

  const angularFrequency = (Math.abs(charge) * magneticFluxDensity) / mass
  const period = (2 * Math.PI) / angularFrequency
  const maxSpeed = (Math.abs(charge) * magneticFluxDensity * deeRadius) / mass
  if (initialSpeed > maxSpeed * (1 + 1e-12)) {
    fail(
      'CYCLOTRON_CAPACITY_EXCEEDED',
      'The initial orbit already exceeds the dee radius and cannot be accelerated.',
    )
  }
  const initialRadius = initialSpeed / angularFrequency
  const maxKineticEnergy = 0.5 * mass * maxSpeed * maxSpeed
  const initialKineticEnergy = 0.5 * mass * initialSpeed * initialSpeed
  const energyStep = Math.abs(charge) * gapVoltage
  const rawCrossings = (maxKineticEnergy - initialKineticEnergy) / energyStep
  const accelerationCount = rawCrossings <= 1e-12 ? 0 : Math.ceil(rawCrossings - 1e-12)
  const magneticFieldZ =
    bench.magneticOrientation === 'into_page' ? -magneticFluxDensity : magneticFluxDensity

  return {
    modelId: CYCLOTRON_TIME_VARYING_MODEL,
    benchId: bench.id,
    particleId: particle.id,
    mass,
    charge,
    magneticFluxDensity,
    magneticFieldZ,
    gapVoltage,
    gapWidth,
    deeRadius,
    initialPosition,
    initialVelocity,
    initialSpeed,
    initialRadius,
    period,
    frequency: 1 / period,
    maxSpeed,
    maxKineticEnergy,
    accelerationCount,
    extractionTime: (accelerationCount * period) / 2,
  }
}

/**
 * Ideal square-wave gap field in V/m. The sign alternates every half period;
 * only its reversal instants matter in the impulsive-gap model.
 */
export const gapElectricFieldAt = (model: CyclotronModel, timeSeconds: number): number => {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    fail('INVALID_SIMULATION_TIME', 'Simulation time must be finite and non-negative.')
  }
  const halfPeriodIndex = Math.floor(timeSeconds / (model.period / 2) + 1e-12)
  const sign = halfPeriodIndex % 2 === 0 ? 1 : -1
  return (sign * model.gapVoltage) / model.gapWidth
}

export const speedAfterCrossings = (model: CyclotronModel, crossings: number): number => {
  const count = Math.max(0, Math.floor(crossings))
  const energy = Math.min(
    model.maxKineticEnergy,
    0.5 * model.mass * model.initialSpeed * model.initialSpeed +
      count * Math.abs(model.charge) * model.gapVoltage,
  )
  return Math.sqrt((2 * energy) / model.mass)
}

export interface CyclotronCrossingState {
  readonly index: number
  readonly position: Vector3
  readonly velocity: Vector3
  readonly speed: number
  readonly radius: number
}

export const crossingStateOf = (
  model: CyclotronModel,
  crossingIndex: number,
): CyclotronCrossingState => {
  const index = Math.max(0, Math.min(Math.floor(crossingIndex), model.accelerationCount))
  const speed = speedAfterCrossings(model, index)
  const initialSign = model.initialVelocity.x >= 0 ? 1 : -1
  const direction = initialSign * (index % 2 === 0 ? 1 : -1)
  return {
    index,
    position: vec3(0, 0, 0),
    velocity: vec3(direction * speed, 0, 0),
    speed,
    radius: speed / ((Math.abs(model.charge) * model.magneticFluxDensity) / model.mass),
  }
}

export interface CyclotronMotion {
  readonly position: Vector3
  readonly velocity: Vector3
  readonly acceleration: Vector3
  readonly speed: number
  readonly radius: number
  readonly kineticEnergy: number
  readonly crossingsCompleted: number
  readonly gapElectricField: number
}

export const cyclotronMotionAt = (model: CyclotronModel, timeSeconds: number): CyclotronMotion => {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    fail('INVALID_SIMULATION_TIME', 'Simulation time must be finite and non-negative.')
  }
  const halfPeriod = model.period / 2
  const rawCrossings = Math.floor(timeSeconds / halfPeriod + 1e-12)
  const crossingsCompleted = Math.min(rawCrossings, model.accelerationCount)
  const start = crossingStateOf(model, crossingsCompleted)
  const dt = Math.max(0, timeSeconds - crossingsCompleted * halfPeriod)
  const motion = compositeMotionAt(
    model.charge,
    model.mass,
    start.position,
    start.velocity,
    sampleOf(model),
    dt,
  )
  const speed = magnitude(motion.velocity)
  return {
    ...motion,
    speed,
    radius: speed / ((Math.abs(model.charge) * model.magneticFluxDensity) / model.mass),
    kineticEnergy: 0.5 * model.mass * speed * speed,
    crossingsCompleted,
    gapElectricField: gapElectricFieldAt(model, timeSeconds),
  }
}

export const cyclotronPeriodQuantity = (model: CyclotronModel): Quantity<'time'> =>
  quantity(model.period, 's', 'time')
