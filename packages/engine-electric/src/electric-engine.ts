import {
  add,
  dot,
  isFiniteVector,
  magnitude,
  scale,
  type Vector3,
} from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'
import {
  EngineUnsupportedError,
  invalidModelCondition,
  quantityVector,
  supported,
  toCanonicalVector,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationResult,
} from '@physicsos/physics-core'
import {
  validateScene,
  type PhysicsScene,
  type UniformElectricField,
} from '@physicsos/physics-scene'
import { verifyElectricSimulation } from '@physicsos/physics-verifier'

import { electricForce } from './electrostatics.ts'

export const ELECTRIC_ENGINE_ID = 'engine-electric'
export const ELECTRIC_ENGINE_VERSION = '1.0.0'
export const UNIFORM_ELECTRIC_PARTICLE_MODEL = 'charged_particle_uniform_electric_field'

const DEFAULT_DURATION_SECONDS = 5
const DEFAULT_TRAJECTORY_SEGMENTS = 120
const ASSUMPTIONS = [
  'uniform electric field',
  'electric force only',
  '2D analytical motion',
] as const

export interface UniformElectricParticleModel {
  readonly modelId: typeof UNIFORM_ELECTRIC_PARTICLE_MODEL
  readonly particleId: string
  readonly fieldId: string
  readonly mass: number
  readonly charge: number
  readonly position: Vector3
  readonly velocity: Vector3
  readonly electricField: Vector3
  readonly force: Vector3
  readonly acceleration: Vector3
}

const uniformElectricFields = (scene: PhysicsScene): UniformElectricField[] =>
  scene.fields.filter((field): field is UniformElectricField => field.type === 'uniform_electric')

const failure = (condition: string, message: string) => ({ condition, message })

export function createElectricSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'electric',
    options: {
      ...(scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime }),
    },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

export const resolveUniformElectricModel = (scene: PhysicsScene): UniformElectricParticleModel => {
  const engine = new ElectricEngine()
  const support = engine.canHandle(scene)
  if (!support.supported) throw new EngineUnsupportedError(engine.engineId, support)

  const particle = scene.particles[0]
  const field = uniformElectricFields(scene)[0]
  if (particle === undefined || particle.charge === undefined || field === undefined) {
    throw new PhysicsOSError('ELECTRIC_MODEL_INCOMPLETE', 'Electric model inputs are incomplete.')
  }

  const mass = canonicalValue(particle.mass)
  const charge = canonicalValue(particle.charge)
  const position = toCanonicalVector(particle.position).vectorSI
  const velocity = toCanonicalVector(particle.velocity).vectorSI
  const electricField = toCanonicalVector(field.fieldStrength).vectorSI
  const force = electricForce(charge, electricField)
  const acceleration = scale(force, 1 / mass)

  return {
    modelId: UNIFORM_ELECTRIC_PARTICLE_MODEL,
    particleId: particle.id,
    fieldId: field.id,
    mass,
    charge,
    position,
    velocity,
    electricField,
    force,
    acceleration,
  }
}

const derivedAt = (model: UniformElectricParticleModel, time: number): DerivedQuantity[] => {
  const displacement = add(scale(model.velocity, time), scale(model.acceleration, 0.5 * time * time))
  const velocity = add(model.velocity, scale(model.acceleration, time))
  const electricPotentialChange = -dot(model.electricField, displacement)
  const potentialEnergyChange = model.charge * electricPotentialChange
  const work = dot(model.force, displacement)
  const kineticEnergy = 0.5 * model.mass * magnitude(velocity) ** 2
  const initialKineticEnergy = 0.5 * model.mass * magnitude(model.velocity) ** 2

  return [
    {
      key: 'electric_field_vector',
      targetId: model.fieldId,
      value: quantityVector(model.electricField, 'V/m', 'electric_field'),
      formula: { expression: 'E = constant' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_field_magnitude',
      targetId: model.fieldId,
      value: quantity(magnitude(model.electricField), 'V/m', 'electric_field'),
      formula: { expression: '|E|' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_force_vector',
      targetId: model.particleId,
      value: quantityVector(model.force, 'N', 'force'),
      formula: { expression: 'F = qE' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_force_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(model.force), 'N', 'force'),
      formula: { expression: '|F| = |qE|' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'acceleration_vector',
      targetId: model.particleId,
      value: quantityVector(model.acceleration, 'm/s^2', 'acceleration'),
      formula: { expression: 'a = qE / m' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'acceleration_magnitude',
      targetId: model.particleId,
      value: quantity(magnitude(model.acceleration), 'm/s^2', 'acceleration'),
      formula: { expression: '|a| = |qE| / m' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'displacement_vector',
      targetId: model.particleId,
      value: quantityVector(displacement, 'm', 'length'),
      formula: { expression: 'Δr = v0t + 0.5at²' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'speed',
      targetId: model.particleId,
      value: quantity(magnitude(velocity), 'm/s', 'velocity'),
      formula: { expression: '|v0 + at|' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_potential_change',
      targetId: model.particleId,
      value: quantity(electricPotentialChange, 'V', 'electric_potential'),
      formula: { expression: 'Δφ = -E · Δr' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'electric_potential_energy_change',
      targetId: model.particleId,
      value: quantity(potentialEnergyChange, 'J', 'energy'),
      formula: { expression: 'ΔU = qΔφ' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'work_by_electric_field',
      targetId: model.particleId,
      value: quantity(work, 'J', 'energy'),
      formula: { expression: 'W = F · Δr = -ΔU' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'kinetic_energy',
      targetId: model.particleId,
      value: quantity(kineticEnergy, 'J', 'energy'),
      formula: { expression: 'K = 0.5m|v|²' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'kinetic_energy_change',
      targetId: model.particleId,
      value: quantity(kineticEnergy - initialKineticEnergy, 'J', 'energy'),
      formula: { expression: 'ΔK = W_electric' },
      assumptions: [...ASSUMPTIONS],
    },
  ]
}

const stateForModel = (model: UniformElectricParticleModel, time: number): SimulationState => {
  const position = add(
    add(model.position, scale(model.velocity, time)),
    scale(model.acceleration, 0.5 * time * time),
  )
  const velocity = add(model.velocity, scale(model.acceleration, time))
  return {
    time: quantity(time, 's', 'time'),
    objects: [
      {
        id: model.particleId,
        position: quantityVector(position, 'm', 'length'),
        velocity: quantityVector(velocity, 'm/s', 'velocity'),
        acceleration: quantityVector(model.acceleration, 'm/s^2', 'acceleration'),
        values: {
          electricField: quantityVector(model.electricField, 'V/m', 'electric_field'),
          electricForce: quantityVector(model.force, 'N', 'force'),
        },
      },
    ],
    derived: derivedAt(model, time),
  }
}

/** Evaluate a previously resolved model without revalidating the immutable Scene. */
export const evaluateUniformElectricState = (
  model: UniformElectricParticleModel,
  seconds: number,
): SimulationState => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new PhysicsOSError('INVALID_SIMULATION_TIME', 'Electric state time must be finite and non-negative.')
  }
  return stateForModel(model, seconds)
}

export class ElectricEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = ELECTRIC_ENGINE_ID
  readonly engineVersion = ELECTRIC_ENGINE_VERSION
  readonly domain = 'electric' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(ELECTRIC_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        ELECTRIC_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }
    if (scene.dimension !== '2d') {
      return unsupportedModel([failure('scene_is_2d', 'Electric V1 supports 2D scenes only.')], ELECTRIC_ENGINE_ID)
    }
    if (scene.particles.length !== 1 || scene.bodies.length > 0) {
      return unsupportedModel(
        [failure('single_particle', 'Electric V1 requires exactly one particle and no rigid bodies.')],
        ELECTRIC_ENGINE_ID,
      )
    }
    if (scene.fields.length !== 1 || uniformElectricFields(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_uniform_electric_field', 'Electric V1 requires one global uniform electric field.')],
        ELECTRIC_ENGINE_ID,
      )
    }
    if (scene.forces.length > 0 || scene.boundaries.length > 0 || scene.constraints.length > 0) {
      return unsupportedModel(
        [failure('electric_force_only', 'Electric V1 does not combine explicit forces, boundaries or constraints.')],
        ELECTRIC_ENGINE_ID,
      )
    }
    const particle = scene.particles[0]
    const field = uniformElectricFields(scene)[0]
    if (particle === undefined || particle.charge === undefined || field === undefined) {
      return invalidModelCondition(ELECTRIC_ENGINE_ID, [
        failure('charge_defined', 'The particle charge and electric field must be defined.'),
      ])
    }
    const mass = canonicalValue(particle.mass)
    if (!Number.isFinite(mass) || mass <= 0) {
      return invalidModelCondition(ELECTRIC_ENGINE_ID, [
        failure('mass_positive', 'Particle mass must be greater than zero.'),
      ])
    }
    const fieldVector = toCanonicalVector(field.fieldStrength).vectorSI
    if (!isFiniteVector(fieldVector) || Math.abs(fieldVector.z) > 1e-10) {
      return invalidModelCondition(ELECTRIC_ENGINE_ID, [
        failure('field_vector_2d', 'Electric V1 requires a finite field vector in the xy plane.'),
      ])
    }
    return supported(UNIFORM_ELECTRIC_PARTICLE_MODEL, this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) {
      return { status: 'passed', checks: [], warnings: [], errors: [] }
    }
    return {
      status: 'failed',
      checks: support.failedConditions.map((entry) => ({
        id: entry.condition,
        type: 'constraint',
        passed: false,
        message: entry.message,
      })),
      warnings: [],
      errors: support.failedConditions.map((entry) => ({
        code: entry.condition,
        severity: 'error',
        message: entry.message,
      })),
    }
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const seconds = canonicalValue(time)
    return evaluateUniformElectricState(resolveUniformElectricModel(scene), seconds)
  }

  stateAtSeconds(scene: PhysicsScene, seconds: number): SimulationState {
    return this.stateAt(scene, quantity(seconds, 's', 'time'))
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
        {
          details: {
            requestSceneId: request.sceneId,
            sceneId: scene.id,
            requestRevision: request.sceneRevision,
            sceneRevision: scene.revision,
          },
        },
      )
    }

    const model = resolveUniformElectricModel(scene)
    const startTime = request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const sceneDuration = scene.timeline.endTime === undefined
      ? DEFAULT_DURATION_SECONDS
      : canonicalValue(scene.timeline.endTime)
    const endTime = request.options.endTime === undefined ? sceneDuration : canonicalValue(request.options.endTime)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
      throw new PhysicsOSError('INVALID_SIMULATION_RANGE', 'Electric simulation range must satisfy 0 <= startTime <= endTime.')
    }

    const times = Array.from(
      { length: DEFAULT_TRAJECTORY_SEGMENTS + 1 },
      (_, index) => startTime + ((endTime - startTime) * index) / DEFAULT_TRAJECTORY_SEGMENTS,
    )
    const states = times.map((time) => stateForModel(model, time))
    const startedAt = new Date().toISOString()
    const pending: SimulationResult<PhysicsEventLike> = {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events: [],
      measurements: [],
      derivedQuantities: derivedAt(model, endTime),
      verification: { status: 'passed', checks: [], warnings: [], errors: [] },
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'analytical-uniform-electric',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
    return { ...pending, verification: verifyElectricSimulation(scene, pending) }
  }
}

export const electricEngine = new ElectricEngine()
