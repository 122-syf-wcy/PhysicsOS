import {
  check,
  summarizeVerification,
  derivedScalar,
  derivedVector,
  toCanonicalVector,
  supported,
  unsupportedModel,
  invalidModelCondition,
  withinTolerance,
  DEFAULT_TOLERANCE,
  type ModelSupport,
  type PhysicsEngine,
  type SimulationRequest,
  type SimulationResult,
  type VerificationCheck,
  type VerificationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'
import { validateScene, type PhysicsScene } from '@physicsos/physics-scene'

import { collisionModelOf, type CollisionModelId } from './collision-model.ts'
import {
  resolveCollisionScene,
  simulateCollision,
  type CollisionPhysicsEvent,
  type ResolvedCollisionScene,
} from './collision-solver.ts'

export const COLLISION_ENGINE_ID = 'engine-collision'
export const COLLISION_ENGINE_VERSION = '1.0.0'

const DEFAULT_DURATION_SECONDS = 10

export function createCollisionSimulationRequest(
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

/** Single forward pass to an arbitrary time; the timeline uses this for seek. */
const stateAtResolved = (resolved: ResolvedCollisionScene, time: number): SimulationState => {
  const simulation = simulateCollision(resolved, { startTime: 0, endTime: time })
  return simulation.states[simulation.states.length - 1] ?? stateOfEmpty()
}

const stateOfEmpty = (): SimulationState => ({
  time: quantity(0, 's', 'time'),
  objects: [],
  derived: [],
})

const buildVerification = (
  scene: PhysicsScene,
  resolved: ResolvedCollisionScene,
  model: CollisionModelId,
  states: readonly SimulationState[],
  firstWallContactAt: number | null,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  /* Restitution range: the solver reads min(eA, eB); a value outside [0,1]
     would violate the restitution definition, so it is a hard model error. */
  let restitutionValid = true
  for (const body of scene.bodies) {
    const e = body.material?.restitution === undefined ? 1 : body.material.restitution
    if (!Number.isFinite(e) || e < 0 || e > 1) restitutionValid = false
  }
  checks.push(
    check('restitution_in_range', 'constraint', restitutionValid, {
      message: 'Every body restitution is within [0, 1].',
    }),
  )

  /* Masses positive and radii finite — the solver divides by mass. */
  let bodiesValid = true
  for (const body of scene.bodies) {
    const mass = canonicalValue(body.mass)
    const radius = body.shape.type === 'circle' ? canonicalValue(body.shape.radius) : Number.NaN
    if (!(mass > 0) || !Number.isFinite(radius) || radius <= 0) bodiesValid = false
  }
  checks.push(
    check('collision_body_valid', 'constraint', bodiesValid, {
      message: 'Every collision body has positive mass and a finite positive radius.',
    }),
  )

  /* Momentum conservation: internal impulses are equal and opposite, so with
     no external impulse the total momentum vector is an invariant. Gravity
     counts, and so does a wall reflection — the wall pushes back on the
     system, so once a body has touched a wall Σp legitimately changes. The
     check therefore covers only the free-flight window before the first wall
     contact. */
  const hasGravity = resolved.gravity.x !== 0 || resolved.gravity.y !== 0
  const momentumStates =
    firstWallContactAt === null
      ? states
      : states.filter((state) => state.time.value < firstWallContactAt)
  if (!hasGravity && momentumStates.length > 1) {
    const first = momentumStates[0]
    let conserved = first !== undefined
    let p0: { x: number; y: number } | undefined
    if (first !== undefined) {
      try {
        const total = toCanonicalVector(derivedVector(first.derived, 'total_momentum')).vectorSI
        p0 = { x: total.x, y: total.y }
      } catch {
        conserved = false
      }
    }
    for (let i = 1; i < momentumStates.length && conserved; i += 1) {
      const state = momentumStates[i]
      if (state === undefined || p0 === undefined) {
        conserved = false
        break
      }
      try {
        const total = toCanonicalVector(derivedVector(state.derived, 'total_momentum')).vectorSI
        if (
          !withinTolerance(total.x, p0.x, DEFAULT_TOLERANCE) ||
          !withinTolerance(total.y, p0.y, DEFAULT_TOLERANCE)
        ) {
          conserved = false
        }
      } catch {
        conserved = false
      }
    }
    checks.push(
      check('momentum_conservation', 'conservation', conserved, {
        message:
          firstWallContactAt === null
            ? '无外力时总动量守恒：内部冲量等大反向，Σp 恒定。'
            : '首次碰壁前总动量守恒：内部冲量等大反向；墙壁反弹属外冲量，之后 Σp 可变。',
        ...(p0 === undefined ? {} : { details: { p0 } }),
      }),
    )
  }

  /* Kinetic energy: only the fully elastic model conserves it. The perfect and
     partial models must LOSE energy (the solver's e < 1 does that), so the
     invariant is only asserted when every pair is elastic. */
  if (model === 'elastic_collision' && states.length > 0) {
    const first = states[0]
    let conserved = first !== undefined
    let k0 = 0
    if (first !== undefined) {
      try {
        k0 = derivedScalar(first.derived, 'total_kinetic_energy').value
      } catch {
        conserved = false
      }
    }
    for (let i = 1; i < states.length && conserved; i += 1) {
      const state = states[i]
      if (state === undefined) {
        conserved = false
        break
      }
      try {
        const k = derivedScalar(state.derived, 'total_kinetic_energy').value
        if (!withinTolerance(k, k0, DEFAULT_TOLERANCE)) conserved = false
      } catch {
        conserved = false
      }
    }
    checks.push(
      check('energy_conservation', 'conservation', conserved, {
        message: '完全弹性碰撞中动能守恒：Σ½mv² 恒定。',
        details: { k0 },
      }),
    )
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export class CollisionEngine implements PhysicsEngine<PhysicsScene, CollisionPhysicsEvent> {
  readonly engineId = COLLISION_ENGINE_ID
  readonly engineVersion = COLLISION_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(COLLISION_ENGINE_ID, [
        {
          condition: 'scene_valid',
          message: error instanceof Error ? error.message : 'Scene validation failed.',
        },
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        COLLISION_ENGINE_ID,
        sceneVerification.errors.map((issue) => ({
          condition: issue.code,
          message: issue.message,
        })),
      )
    }
    if (scene.dimension !== '2d') {
      return unsupportedModel(
        [{ condition: 'scene_is_2d', message: 'Collision engine supports 2D scenes only.' }],
        COLLISION_ENGINE_ID,
      )
    }
    if (scene.bodies.length < 2) {
      return unsupportedModel(
        [
          {
            condition: 'at_least_two_bodies',
            message: 'A collision experiment needs at least two bodies.',
          },
        ],
        COLLISION_ENGINE_ID,
      )
    }
    if (scene.particles.length > 0) {
      return unsupportedModel(
        [{ condition: 'no_particles', message: 'Collision scenes carry no particles.' }],
        COLLISION_ENGINE_ID,
      )
    }
    const hasEmFields = scene.fields.some(
      (field) =>
        field.type === 'uniform_electric' ||
        field.type === 'uniform_magnetic' ||
        field.type === 'point_charge',
    )
    if (hasEmFields) {
      return unsupportedModel(
        [
          {
            condition: 'no_em_fields',
            message: 'Collision scenes cannot carry electric or magnetic fields.',
          },
        ],
        COLLISION_ENGINE_ID,
      )
    }
    for (const body of scene.bodies) {
      if (body.shape.type !== 'circle') {
        return unsupportedModel(
          [{ condition: 'circle_bodies', message: 'Collision bodies must be circles in V1.' }],
          COLLISION_ENGINE_ID,
        )
      }
      const mass = canonicalValue(body.mass)
      if (!(mass > 0)) {
        return invalidModelCondition(COLLISION_ENGINE_ID, [
          {
            condition: 'mass_positive',
            message: `Body "${body.id}" mass must be > 0, got ${mass}.`,
          },
        ])
      }
    }
    const model = collisionModelOf(scene)
    return supported(model ?? 'elastic_collision', this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const sceneVerification = validateScene(scene)
    const support = this.canHandle(scene)
    return summarizeVerification(
      [
        ...sceneVerification.checks,
        check('collision_model_supported', 'constraint', support.supported, {
          message: support.supported
            ? 'Scene satisfies the collision model assumptions.'
            : support.failedConditions.map((failure) => failure.message).join(' '),
        }),
      ],
      sceneVerification.warnings,
      sceneVerification.errors,
    )
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    return stateAtResolved(resolveCollisionScene(scene), canonicalValue(time))
  }

  simulate(
    scene: PhysicsScene,
    request: SimulationRequest,
  ): SimulationResult<CollisionPhysicsEvent> {
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

    const model = collisionModelOf(scene) ?? 'elastic_collision'
    const resolved = resolveCollisionScene(scene)
    const startTime = request.options.startTime ? canonicalValue(request.options.startTime) : 0
    const endTime = request.options.endTime
      ? canonicalValue(request.options.endTime)
      : DEFAULT_DURATION_SECONDS
    if (endTime < startTime) {
      throw new PhysicsOSError('INVALID_SIMULATION_RANGE', 'endTime must be >= startTime.')
    }

    const simulation = simulateCollision(resolved, { startTime, endTime })
    const states = simulation.states
    const events = simulation.events

    const verification = buildVerification(
      scene,
      resolved,
      model,
      states,
      simulation.firstWallContactAt,
    )
    const startedAt = new Date().toISOString()

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events,
      measurements: [],
      derivedQuantities: states[states.length - 1]?.derived ?? [],
      verification,
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'numerical',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const collisionEngine = new CollisionEngine()
