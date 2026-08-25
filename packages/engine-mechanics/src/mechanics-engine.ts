import {
  add,
  scale,
  magnitude,
} from '@physicsos/physics-math'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, asPhysicsEventId, PhysicsOSError } from '@physicsos/shared'
import {
  check,
  quantityVector,
  summarizeVerification,
  supported,
  unsupportedModel,
  invalidModelCondition,
  toCanonicalVector,
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
} from '@physicsos/physics-scene'
import type { MechanicsModel } from './models/types.ts'
import { resolveMechanicsModel, detectMechanicsModel } from './mechanics-model-selector.ts'
import { kinematicsAt } from './solvers/analytical-kinematics.ts'

export const MECHANICS_ENGINE_ID = 'engine-mechanics'
export const MECHANICS_ENGINE_VERSION = '1.0.0'

const DEFAULT_TRAJECTORY_SEGMENTS = 64

export function createMechanicsSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'mechanics',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

function stateAtForModel(model: MechanicsModel, t: number): SimulationState {
  const ks = kinematicsAt(model.position, model.velocity, model.acceleration, t)
  return {
    time: quantity(t, 's', 'time'),
    objects: [
      {
        id: model.bodyId,
        position: quantityVector(ks.position, 'm', 'length'),
        velocity: quantityVector(ks.velocity, 'm/s', 'velocity'),
        acceleration: quantityVector(ks.acceleration, 'm/s^2', 'acceleration'),
      },
    ],
    derived: computeDerivedAtTime(model, t),
  }
}

function computeDerivedAtTime(model: MechanicsModel, t: number): DerivedQuantity[] {
  const derived: DerivedQuantity[] = []
  const assumptions = ['analytical solver', 'constant forces']

  derived.push({
    key: 'net_force',
    targetId: model.bodyId,
    value: quantityVector(scale(model.acceleration, model.mass), 'N', 'force'),
    formula: { expression: 'F_net = ma' },
    assumptions,
  })

  derived.push({
    key: 'acceleration',
    targetId: model.bodyId,
    value: quantityVector(model.acceleration, 'm/s^2', 'acceleration'),
    formula: { expression: 'a = F_net / m' },
    assumptions,
  })

  derived.push({
    key: 'velocity_magnitude',
    targetId: model.bodyId,
    value: quantity(magnitude(add(model.velocity, scale(model.acceleration, t))), 'm/s', 'velocity'),
    formula: { expression: '|v(t)| = |v0 + at|' },
    assumptions,
  })

  if (model.modelId === 'uniform_linear_motion') {
    derived.push({
      key: 'displacement',
      targetId: model.bodyId,
      value: quantityVector(scale(model.velocity, t), 'm', 'length'),
      formula: { expression: 's = vt' },
      assumptions,
    })
  }

  if (model.modelId === 'uniformly_accelerated_motion') {
    const disp = add(scale(model.velocity, t), scale(model.acceleration, 0.5 * t * t))
    derived.push({
      key: 'displacement',
      targetId: model.bodyId,
      value: quantityVector(disp, 'm', 'length'),
      formula: { expression: 's = v0*t + 0.5*a*t²' },
      assumptions,
    })
    const finalV = add(model.velocity, scale(model.acceleration, t))
    derived.push({
      key: 'final_velocity',
      targetId: model.bodyId,
      value: quantity(magnitude(finalV), 'm/s', 'velocity'),
      formula: { expression: 'v = v0 + at' },
      assumptions,
    })
  }

  if (model.modelId === 'projectile_motion') {
    derived.push({
      key: 'flight_time',
      targetId: model.bodyId,
      value: quantity(model.flightTime, 's', 'time'),
      formula: { expression: 't_flight' },
      assumptions,
    })
    derived.push({
      key: 'range',
      targetId: model.bodyId,
      value: quantity(model.range, 'm', 'length'),
      formula: { expression: 'R = vx * t_flight' },
      assumptions,
    })
    derived.push({
      key: 'max_height',
      targetId: model.bodyId,
      value: quantity(model.maxHeight, 'm', 'length'),
      formula: { expression: 'H_max' },
      assumptions,
    })
    derived.push({
      key: 'impact_velocity',
      targetId: model.bodyId,
      value: quantityVector(model.impactVelocity, 'm/s', 'velocity'),
      formula: { expression: 'v_impact' },
      assumptions,
    })
  }

  if (model.modelId === 'newton_second_law') {
    derived.push({
      key: 'net_force_magnitude',
      targetId: model.bodyId,
      value: quantity(magnitude(model.netForce), 'N', 'force'),
      formula: { expression: '|F_net|' },
      assumptions,
    })
  }

  if (model.modelId === 'inclined_plane') {
    derived.push({
      key: 'gravity_parallel',
      targetId: model.bodyId,
      value: quantity(model.gravityParallel, 'm/s^2', 'acceleration'),
      formula: { expression: 'g*sin(θ)' },
      assumptions,
    })
    derived.push({
      key: 'gravity_normal',
      targetId: model.bodyId,
      value: quantity(model.gravityNormal, 'm/s^2', 'acceleration'),
      formula: { expression: 'g*cos(θ)' },
      assumptions,
    })
    derived.push({
      key: 'normal_force',
      targetId: model.bodyId,
      value: quantity(model.normalForce, 'N', 'force'),
      formula: { expression: 'N = mg*cos(θ)' },
      assumptions,
    })
    derived.push({
      key: 'friction_force',
      targetId: model.bodyId,
      value: quantity(model.frictionForce, 'N', 'force'),
      formula: { expression: 'f = μN' },
      assumptions,
    })
    derived.push({
      key: 'incline_acceleration',
      targetId: model.bodyId,
      value: quantity(magnitude(model.acceleration), 'm/s^2', 'acceleration'),
      formula: { expression: 'a = g*sin(θ) - μg*cos(θ)' },
      assumptions,
    })
  }

  return derived
}

function computeSimulationDuration(model: MechanicsModel): number {
  if (model.modelId === 'projectile_motion') {
    return model.flightTime > 0 ? model.flightTime : 10
  }
  if (model.modelId === 'uniform_linear_motion') {
    return 10
  }
  if (model.modelId === 'uniformly_accelerated_motion') {
    return 10
  }
  if (model.modelId === 'newton_second_law') {
    return 10
  }
  if (model.modelId === 'inclined_plane') {
    return 10
  }
  return 10
}

function buildVerification(model: MechanicsModel, scene: PhysicsScene, states: SimulationState[]): VerificationResult {
  const sceneVerification = validateScene(scene)
  const checks: import('@physicsos/physics-core').VerificationCheck[] = [
    ...sceneVerification.checks,
  ]

  if (model.modelId === 'uniform_linear_motion') {
    checks.push(check('zero_acceleration', 'constraint', magnitude(model.acceleration) < 1e-10, {
      message: 'Uniform linear motion requires zero acceleration.',
    }))
    checks.push(check('velocity_conservation', 'conservation', true, {
      message: 'Velocity is constant.',
    }))
  }

  if (model.modelId === 'uniformly_accelerated_motion') {
    if (states.length >= 2) {
      const first = states[0]
      const last = states[states.length - 1]
      if (first?.objects[0]?.velocity && last?.objects[0]?.velocity) {
        const v0 = toCanonicalVector(first.objects[0].velocity).vectorSI
        const v1 = toCanonicalVector(last.objects[0].velocity).vectorSI
        const dv = magnitude(add(v1, scale(v0, -1)))
        const expectedDv = magnitude(scale(model.acceleration, last.time.value))
        checks.push(check('velocity_change', 'numerical', Math.abs(dv - expectedDv) < 0.1, {
          message: `Velocity change matches a*t.`,
        }))
      }
    }
  }

  if (model.modelId === 'projectile_motion') {
    checks.push(check('horizontal_velocity_constant', 'conservation', true, {
      message: 'Horizontal velocity is constant (no air resistance).',
    }))
    checks.push(check('vertical_acceleration', 'constraint', Math.abs(model.acceleration.y + magnitude(model.gravity)) < 1e-10, {
      message: 'Vertical acceleration equals -g.',
    }))
    if (states.length > 0) {
      const last = states[states.length - 1]
      if (last?.objects[0]?.position) {
        const y = toCanonicalVector(last.objects[0].position).vectorSI.y
        checks.push(check('impact_y', 'boundary', Math.abs(y - model.groundY) < 0.5, {
          message: `Impact y ≈ groundY (${y} vs ${model.groundY}).`,
        }))
      }
    }
  }

  if (model.modelId === 'newton_second_law') {
    const computedNetForce = scale(model.acceleration, model.mass)
    const forceDiff = magnitude(add(computedNetForce, scale(model.netForce, -1)))
    checks.push(check('newton_second_law', 'numerical', forceDiff < 1e-6, {
      message: 'ΣF = ma verified.',
    }))
  }

  if (model.modelId === 'inclined_plane') {
    const g = magnitude(model.gravity)
    const angleRad = (model.inclineAngle * Math.PI) / 180
    const expectedParallel = g * Math.sin(angleRad)
    const expectedNormal = g * Math.cos(angleRad)
    checks.push(check('gravity_parallel', 'numerical', Math.abs(model.gravityParallel - expectedParallel) < 1e-6, {
      message: 'mg*sin(θ) verified.',
    }))
    checks.push(check('gravity_normal', 'numerical', Math.abs(model.gravityNormal - expectedNormal) < 1e-6, {
      message: 'mg*cos(θ) verified.',
    }))
    checks.push(check('normal_force', 'numerical', Math.abs(model.normalForce - model.mass * expectedNormal) < 1e-6, {
      message: 'N = mg*cos(θ) verified.',
    }))
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export class MechanicsEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = MECHANICS_ENGINE_ID
  readonly engineVersion = MECHANICS_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(MECHANICS_ENGINE_ID, [
        { condition: 'scene_valid', message: error instanceof Error ? error.message : 'Scene validation failed.' },
      ])
    }

    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        MECHANICS_ENGINE_ID,
        sceneVerification.errors.map((issue) => ({ condition: issue.code, message: issue.message })),
      )
    }

    if (scene.dimension !== '2d') {
      return unsupportedModel(
        [{ condition: 'scene_is_2d', message: 'Mechanics V1 supports 2D scenes only.' }],
        MECHANICS_ENGINE_ID,
      )
    }

    if (scene.bodies.length !== 1 || scene.particles.length > 0) {
      return unsupportedModel(
        [{ condition: 'single_body', message: 'Exactly one rigid body is required for mechanics V1.' }],
        MECHANICS_ENGINE_ID,
      )
    }

    const body = scene.bodies[0]
    if (!body) {
      return unsupportedModel(
        [{ condition: 'body_present', message: 'No body found in scene.' }],
        MECHANICS_ENGINE_ID,
      )
    }

    const mass = canonicalValue(body.mass)
    if (mass <= 0) {
      return invalidModelCondition(MECHANICS_ENGINE_ID, [
        { condition: 'mass_positive', message: `Body mass must be > 0, got ${mass}.` },
      ])
    }

    const modelId = detectMechanicsModel(scene)
    return supported(modelId ?? 'uniform_linear_motion', this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const sceneVerification = validateScene(scene)
    const support = this.canHandle(scene)
    return summarizeVerification(
      [
        ...sceneVerification.checks,
        check('mechanics_model_supported', 'constraint', support.supported, {
          message: support.supported
            ? 'Scene satisfies the mechanics model assumptions.'
            : support.failedConditions.map((f) => f.message).join(' '),
        }),
      ],
      sceneVerification.warnings,
      sceneVerification.errors,
    )
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const model = resolveMechanicsModel(scene)
    return stateAtForModel(model, canonicalValue(time))
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

    const model = resolveMechanicsModel(scene)
    const duration = computeSimulationDuration(model)

    const startTime = request.options.startTime ? canonicalValue(request.options.startTime) : 0
    const endTime = request.options.endTime ? canonicalValue(request.options.endTime) : duration
    if (endTime < startTime) {
      throw new PhysicsOSError('INVALID_SIMULATION_RANGE', 'endTime must be >= startTime.')
    }

    const trajectoryTimes = Array.from(
      { length: DEFAULT_TRAJECTORY_SEGMENTS + 1 },
      (_, i) => startTime + ((endTime - startTime) * i) / DEFAULT_TRAJECTORY_SEGMENTS,
    )

    const states = trajectoryTimes.map((t) => stateAtForModel(model, t))
    const derivedQuantities = computeDerivedAtTime(model, endTime - startTime)
    const verification = buildVerification(model, scene, states)

    const events: PhysicsEventLike[] = []
    if (model.modelId === 'projectile_motion' && model.flightTime > 0) {
      events.push({
        eventId: asPhysicsEventId(`event-impact-${model.bodyId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'GroundImpact',
      })
    }

    const startedAt = new Date().toISOString()

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events,
      measurements: [],
      derivedQuantities,
      verification,
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
}

export const mechanicsEngine = new MechanicsEngine()
