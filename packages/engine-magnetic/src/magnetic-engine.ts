import {
  add,
  cross,
  dot,
  magnitude,
  normalize,
  scale,
  subtract,
  type Vector3,
} from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'
import {
  DEFAULT_TOLERANCE,
  EngineUnsupportedError,
  check,
  invalidModelCondition,
  quantityVector,
  summarizeVerification,
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
  type Particle,
  type PhysicsScene,
  type UniformMagneticField,
} from '@physicsos/physics-scene'

export const MAGNETIC_MODEL_ID = 'uniform-magnetic-field-charged-particle-2d' as const

export const MAGNETIC_MODEL_ASSUMPTIONS = [
  'uniform magnetic field',
  'velocity perpendicular B',
  'magnetic force only',
  'ignore electric field',
  'ignore gravity',
] as const

// A SimulationResult is also the source of renderer-neutral trajectory facts.
// Keep the five verifier checkpoints, but provide enough analytical states for
// a circular path to remain circular when an Observation is drawn as a polyline.
const DEFAULT_TRAJECTORY_SEGMENTS = 64

/** Builds a contract-valid request for host adapters without leaking ID branding. */
export const createMagneticSimulationRequest = (
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest => ({
  schemaVersion: 'simulation-request/1.0',
  simulationId: asSimulationId(simulationId),
  sceneId: scene.id,
  sceneRevision: scene.revision,
  requestedDomain: 'magnetic',
  options: {},
  trace: {
    traceId: asTraceId(traceId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
  },
})

interface MagneticModel {
  readonly particle: Particle
  readonly field: UniformMagneticField
  readonly charge: number
  readonly mass: number
  readonly position: Vector3
  readonly velocity: Vector3
  readonly magneticField: Vector3
  readonly fieldMagnitude: number
  readonly speed: number
  readonly radius: number
  readonly period: number
  readonly angularVelocity: number
  readonly forceMagnitude: number
  readonly rotationDirection: -1 | 1
  readonly orbitCenter: Vector3
}

const rotateAroundAxis = (vector: Vector3, axis: Vector3, radians: number): Vector3 => {
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  )
}

const supportFailure = (condition: string, message: string) => ({ condition, message })

/** Analytical solver for the deliberately frozen magnetic circular-motion model. */
export class MagneticEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = 'engine-magnetic'
  readonly engineVersion = '1.0.0'
  readonly domain = 'magnetic' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(MAGNETIC_MODEL_ID, [
        supportFailure(
          'scene_valid',
          error instanceof Error ? error.message : 'Scene validation failed.',
        ),
      ])
    }

    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        MAGNETIC_MODEL_ID,
        sceneVerification.errors.map((issue) => supportFailure(issue.code, issue.message)),
      )
    }

    if (scene.dimension !== '2d') {
      return unsupportedModel(
        [supportFailure('scene_is_2d', 'The current magnetic model supports 2D scenes only.')],
        MAGNETIC_MODEL_ID,
      )
    }

    if (scene.particles.length !== 1) {
      return unsupportedModel(
        [supportFailure('single_particle', 'Exactly one charged particle is required.')],
        MAGNETIC_MODEL_ID,
      )
    }

    const magneticFields = scene.fields.filter(
      (field): field is UniformMagneticField => field.type === 'uniform_magnetic',
    )
    if (magneticFields.length !== 1 || scene.fields.length !== 1) {
      return unsupportedModel(
        [
          supportFailure(
            'single_uniform_magnetic_field',
            'Exactly one uniform magnetic field and no other fields are supported.',
          ),
        ],
        MAGNETIC_MODEL_ID,
      )
    }

    if (scene.forces.length > 0 || scene.boundaries.length > 0 || scene.constraints.length > 0) {
      return unsupportedModel(
        [
          supportFailure(
            'magnetic_force_only',
            'Explicit forces, boundaries and constraints are outside this model.',
          ),
        ],
        MAGNETIC_MODEL_ID,
      )
    }

    const particle = scene.particles[0]
    const field = magneticFields[0]
    if (particle === undefined || field === undefined) {
      return unsupportedModel(
        [supportFailure('model_objects_present', 'The particle or magnetic field is missing.')],
        MAGNETIC_MODEL_ID,
      )
    }
    if (field.regionId !== undefined) {
      return unsupportedModel(
        [
          supportFailure(
            'global_uniform_magnetic_field',
            'Regional magnetic fields and boundary interaction are outside this model.',
          ),
        ],
        MAGNETIC_MODEL_ID,
      )
    }
    if (particle.charge === undefined || canonicalValue(particle.charge) === 0) {
      return invalidModelCondition(MAGNETIC_MODEL_ID, [
        supportFailure('particle_charge_non_zero', `Particle "${particle.id}" must have q != 0.`),
      ])
    }

    const velocity = toCanonicalVector(particle.velocity).vectorSI
    const magneticField = toCanonicalVector(field.magneticFluxDensity).vectorSI
    const speed = magnitude(velocity)
    const fieldMagnitude = magnitude(magneticField)
    if (speed === 0) {
      return invalidModelCondition(MAGNETIC_MODEL_ID, [
        supportFailure('particle_speed_non_zero', 'Circular motion requires a non-zero speed.'),
      ])
    }
    if (fieldMagnitude === 0) {
      return invalidModelCondition(MAGNETIC_MODEL_ID, [
        supportFailure(
          'magnetic_field_non_zero',
          'The magnetic field must have non-zero strength.',
        ),
      ])
    }

    const fieldInPlane = Math.hypot(magneticField.x, magneticField.y) / fieldMagnitude
    if (fieldInPlane > DEFAULT_TOLERANCE.angular) {
      return invalidModelCondition(MAGNETIC_MODEL_ID, [
        supportFailure(
          'magnetic_field_perpendicular_to_scene',
          'The 2D model requires B to point into or out of the scene plane.',
        ),
      ])
    }

    const normalizedDot = Math.abs(dot(velocity, magneticField)) / (speed * fieldMagnitude)
    if (normalizedDot > DEFAULT_TOLERANCE.angular) {
      return invalidModelCondition(MAGNETIC_MODEL_ID, [
        supportFailure(
          'velocity_perpendicular_b',
          'The current model requires v perpendicular to B.',
        ),
      ])
    }

    return supported(MAGNETIC_MODEL_ID, this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const sceneVerification = validateScene(scene)
    const support = this.canHandle(scene)
    return summarizeVerification(
      [
        ...sceneVerification.checks,
        check('magnetic_model_supported', 'constraint', support.supported, {
          message: support.supported
            ? 'Scene satisfies the frozen magnetic model assumptions.'
            : support.failedConditions.map((failure) => failure.message).join(' '),
          details: {
            expected: MAGNETIC_MODEL_ASSUMPTIONS,
            actual: support.supported
              ? MAGNETIC_MODEL_ASSUMPTIONS
              : support.failedConditions.map((failure) => failure.condition),
            tolerance: DEFAULT_TOLERANCE,
          },
        }),
      ],
      sceneVerification.warnings,
      sceneVerification.errors,
    )
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    return this.stateAtModel(this.resolveModel(scene), canonicalValue(time))
  }

  /** Timeline-facing convenience that keeps unit construction inside the engine boundary. */
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

    const model = this.resolveModel(scene)
    const startTime =
      request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const endTime =
      request.options.endTime === undefined ? model.period : canonicalValue(request.options.endTime)
    if (endTime < startTime) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Simulation endTime must be greater than or equal to startTime.',
        { details: { startTime, endTime } },
      )
    }

    const verificationTimes = [
      0,
      model.period / 4,
      model.period / 2,
      (3 * model.period) / 4,
      model.period,
    ]
    const trajectoryTimes = Array.from(
      { length: DEFAULT_TRAJECTORY_SEGMENTS + 1 },
      (_, index) => startTime + ((endTime - startTime) * index) / DEFAULT_TRAJECTORY_SEGMENTS,
    )
    const sampleTimes = [...new Set([startTime, endTime, ...trajectoryTimes, ...verificationTimes])]
      .filter((time) => time >= startTime && time <= endTime)
      .sort((left, right) => left - right)
    const startedAt = new Date().toISOString()

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states: sampleTimes.map((time) => this.stateAtModel(model, time)),
      events: [],
      measurements: [],
      derivedQuantities: this.derivedQuantities(model),
      verification: summarizeVerification(
        [],
        [
          {
            code: 'VERIFICATION_PENDING',
            severity: 'warning',
            message:
              'Simulation completed; an external Physics Verifier must validate this result.',
          },
        ],
        [],
      ),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'analytical',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }

  private resolveModel(scene: PhysicsScene): MagneticModel {
    const support = this.canHandle(scene)
    if (!support.supported) throw new EngineUnsupportedError(this.engineId, support)

    const particle = scene.particles[0]
    const field = scene.fields.find(
      (candidate): candidate is UniformMagneticField => candidate.type === 'uniform_magnetic',
    )
    if (particle === undefined || field === undefined || particle.charge === undefined) {
      throw new PhysicsOSError(
        'MAGNETIC_MODEL_INVARIANT',
        'Supported magnetic model lost its inputs.',
      )
    }

    const charge = canonicalValue(particle.charge)
    const mass = canonicalValue(particle.mass)
    const position = toCanonicalVector(particle.position).vectorSI
    const velocity = toCanonicalVector(particle.velocity).vectorSI
    const magneticField = toCanonicalVector(field.magneticFluxDensity).vectorSI
    const fieldMagnitude = magnitude(magneticField)
    const speed = magnitude(velocity)
    const radius = (mass * speed) / (Math.abs(charge) * fieldMagnitude)
    const period = (2 * Math.PI * mass) / (Math.abs(charge) * fieldMagnitude)
    const angularVelocity = (Math.abs(charge) * fieldMagnitude) / mass
    const forceMagnitude = Math.abs(charge) * speed * fieldMagnitude
    const axis = normalize(magneticField)
    const orbitCenter = subtract(
      position,
      scale(cross(axis, velocity), mass / (charge * fieldMagnitude)),
    )
    const rotationDirection: -1 | 1 = -charge * magneticField.z > 0 ? 1 : -1

    return {
      particle,
      field,
      charge,
      mass,
      position,
      velocity,
      magneticField,
      fieldMagnitude,
      speed,
      radius,
      period,
      angularVelocity,
      forceMagnitude,
      rotationDirection,
      orbitCenter,
    }
  }

  private stateAtModel(model: MagneticModel, time: number): SimulationState {
    const axis = normalize(model.magneticField)
    const radians = (-model.charge * model.fieldMagnitude * time) / model.mass
    const radial = subtract(model.position, model.orbitCenter)
    const position = add(model.orbitCenter, rotateAroundAxis(radial, axis, radians))
    const velocity = rotateAroundAxis(model.velocity, axis, radians)
    const force = scale(cross(velocity, model.magneticField), model.charge)
    const acceleration = scale(force, 1 / model.mass)

    return {
      time: quantity(time, 's', 'time'),
      objects: [
        {
          id: model.particle.id,
          position: quantityVector(position, 'm', 'length'),
          velocity: quantityVector(velocity, 'm/s', 'velocity'),
          acceleration: quantityVector(acceleration, 'm/s^2', 'acceleration'),
          values: { lorentz_force: quantityVector(force, 'N', 'force') },
        },
      ],
      derived: [
        {
          key: 'lorentz_force_vector',
          targetId: model.particle.id,
          value: quantityVector(force, 'N', 'force'),
          formula: { expression: 'F = q(v × B)' },
          assumptions: [...MAGNETIC_MODEL_ASSUMPTIONS],
        },
      ],
    }
  }

  private derivedQuantities(model: MagneticModel): DerivedQuantity[] {
    const initialForce = scale(cross(model.velocity, model.magneticField), model.charge)
    const assumptions = (): string[] => [...MAGNETIC_MODEL_ASSUMPTIONS]
    return [
      {
        key: 'cyclotron_radius',
        targetId: model.particle.id,
        value: quantity(model.radius, 'm', 'length'),
        formula: { expression: 'r = mv / |q|B' },
        assumptions: assumptions(),
      },
      {
        key: 'cyclotron_period',
        targetId: model.particle.id,
        value: quantity(model.period, 's', 'time'),
        formula: { expression: 'T = 2πm / |q|B' },
        assumptions: assumptions(),
      },
      {
        key: 'angular_velocity',
        targetId: model.particle.id,
        value: quantity(model.angularVelocity, 'rad/s', 'angular_velocity'),
        formula: { expression: 'ω = |q|B / m' },
        assumptions: assumptions(),
      },
      {
        key: 'lorentz_force_magnitude',
        targetId: model.particle.id,
        value: quantity(model.forceMagnitude, 'N', 'force'),
        formula: { expression: 'F = |q|vB' },
        assumptions: assumptions(),
      },
      {
        key: 'lorentz_force_vector',
        targetId: model.particle.id,
        value: quantityVector(initialForce, 'N', 'force'),
        formula: { expression: 'F = q(v × B)' },
        assumptions: assumptions(),
      },
      {
        key: 'orbit_center',
        targetId: model.particle.id,
        value: quantityVector(model.orbitCenter, 'm', 'length'),
        formula: { expression: 'c = r₀ - (m/qB)(B̂ × v₀)' },
        assumptions: assumptions(),
      },
      {
        key: 'rotation_direction',
        targetId: model.particle.id,
        value: quantity(model.rotationDirection, '', 'dimensionless'),
        formula: { expression: 'direction = sign(-qBz)' },
        assumptions: assumptions(),
      },
    ]
  }
}
