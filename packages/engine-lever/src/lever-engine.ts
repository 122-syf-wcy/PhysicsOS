import {
  check,
  invalidModelCondition,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { leverBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveLeverModel, type ResolvedLeverModel } from './lever-model.ts'
import {
  MAX_TILT_RADIANS,
  TIP_DURATION,
  leverRunDuration,
  leverStateAt,
  momentsOf,
} from './statics.ts'

export const LEVER_ENGINE_ID = 'engine-lever'
export const LEVER_ENGINE_VERSION = '1.0.0'
export const MOMENT_BALANCE_MODEL = 'class_one_moment_balance'

const TRAJECTORY_SEGMENTS = 24

const LEVER_RELATIVE_TOLERANCE = 1e-9

const LEVER_ASSUMPTIONS = [
  'class-1 lever: the fulcrum sits between the two loads',
  'statics: each weight is mg and each moment is F·l; no rotation inertia',
  'the beam is rigid and the hangers stay on their arms',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const newtons = (value: number): Quantity<'force'> => quantity(value, 'N', 'force')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const newtonMetres = (value: number): Quantity<'torque'> => quantity(value, 'N*m', 'torque')
const radians = (value: number): Quantity<'angle'> => quantity(value, 'rad', 'angle')
const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** Solve the scene's lever; the single entry point UI layers reuse. */
export const resolveMomentBalance = (scene: PhysicsScene): ResolvedLeverModel =>
  resolveLeverModel(scene)

const derivedOf = (model: ResolvedLeverModel): DerivedQuantity[] => {
  const assumptions = [...LEVER_ASSUMPTIONS]
  const moments = momentsOf(model)
  const ratio = moments.rightMoment === 0 ? Number.POSITIVE_INFINITY : moments.leftMoment / moments.rightMoment
  return [
    {
      key: 'left_weight',
      targetId: model.left.hangerId,
      value: newtons(moments.leftWeight),
      formula: { expression: 'G₁ = m₁g' },
      assumptions,
    },
    {
      key: 'right_weight',
      targetId: model.right.hangerId,
      value: newtons(moments.rightWeight),
      formula: { expression: 'G₂ = m₂g' },
      assumptions,
    },
    {
      key: 'left_arm',
      targetId: model.left.hangerId,
      value: metres(model.left.armLength),
      formula: { expression: 'l₁' },
      assumptions,
    },
    {
      key: 'right_arm',
      targetId: model.right.hangerId,
      value: metres(model.right.armLength),
      formula: { expression: 'l₂' },
      assumptions,
    },
    {
      key: 'left_moment',
      targetId: model.left.hangerId,
      value: newtonMetres(moments.leftMoment),
      formula: { expression: 'M₁ = G₁·l₁' },
      assumptions,
    },
    {
      key: 'right_moment',
      targetId: model.right.hangerId,
      value: newtonMetres(moments.rightMoment),
      formula: { expression: 'M₂ = G₂·l₂' },
      assumptions,
    },
    {
      key: 'moment_ratio',
      targetId: model.leverId,
      value: dimensionless(ratio),
      formula: { expression: 'M₁/M₂' },
      assumptions,
    },
  ]
}

const stateOf = (model: ResolvedLeverModel, timeSeconds: number): SimulationState => {
  const state = leverStateAt(model, timeSeconds)
  return {
    time: seconds(timeSeconds),
    objects: [
      {
        id: model.leverId,
        values: {
          tilt: radians(state.tilt),
          net_moment: newtonMetres(state.moments.netMoment),
        },
      },
      {
        id: model.left.hangerId,
        values: {
          weight: newtons(state.moments.leftWeight),
          moment: newtonMetres(state.moments.leftMoment),
        },
      },
      {
        id: model.right.hangerId,
        values: {
          weight: newtons(state.moments.rightWeight),
          moment: newtonMetres(state.moments.rightMoment),
        },
      },
    ],
    derived: derivedOf(model),
  }
}

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedLeverModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const moments = momentsOf(model)

  const leftWeightResidual = Math.abs(moments.leftWeight - model.left.mass * model.gravity)
  const rightWeightResidual = Math.abs(moments.rightWeight - model.right.mass * model.gravity)
  const weightScale = Math.max(moments.leftWeight, moments.rightWeight, 1)
  checks.push(
    check(
      'weight_from_mass',
      'constraint',
      leftWeightResidual <= LEVER_RELATIVE_TOLERANCE * weightScale &&
        rightWeightResidual <= LEVER_RELATIVE_TOLERANCE * weightScale,
      {
        message: '钩码重力：G = mg，两边都按质量乘重力加速度取值。',
        targetId: model.leverId,
        details: {
          leftWeight: moments.leftWeight,
          rightWeight: moments.rightWeight,
        },
      },
    ),
  )

  const leftMomentResidual = Math.abs(moments.leftMoment - moments.leftWeight * model.left.armLength)
  const rightMomentResidual = Math.abs(
    moments.rightMoment - moments.rightWeight * model.right.armLength,
  )
  const momentScale = Math.max(moments.leftMoment, moments.rightMoment, 1e-12)
  checks.push(
    check(
      'moment_from_force',
      'constraint',
      leftMomentResidual <= LEVER_RELATIVE_TOLERANCE * momentScale &&
        rightMomentResidual <= LEVER_RELATIVE_TOLERANCE * momentScale,
      {
        message: '力矩定义：M = F·l，力臂是支点到力的作用线的垂直距离。',
        targetId: model.leverId,
        details: {
          leftMoment: moments.leftMoment,
          rightMoment: moments.rightMoment,
        },
      },
    ),
  )

  checks.push(
    check(
      'arms_opposite',
      'constraint',
      model.left.side === 'left' && model.right.side === 'right',
      {
        message: '第一类杠杆：支点在中间，两力在支点两侧。',
        targetId: model.leverId,
      },
    ),
  )

  /* The beam's tilt is a display of the moment difference, not a second law:
     balanced ⇔ level, otherwise it tips toward the larger moment. Sampling
     the finished pose, not just the algebra, so a drawing bug would fail. */
  const finished = leverStateAt(model, leverRunDuration())
  const tiltAgrees = moments.balanced
    ? Math.abs(finished.tilt) <= LEVER_RELATIVE_TOLERANCE
    : Math.sign(finished.tilt) === Math.sign(moments.netMoment) &&
      Math.abs(Math.abs(finished.tilt) - MAX_TILT_RADIANS) <=
        LEVER_RELATIVE_TOLERANCE * MAX_TILT_RADIANS
  checks.push(
    check('moment_balance', 'constraint', tiltAgrees, {
      message: moments.balanced
        ? '杠杆平衡：F₁l₁ = F₂l₂，杠杆保持水平。'
        : '力矩不平衡：杠杆向力矩较大的一侧倾斜。',
      targetId: model.leverId,
      details: {
        leftMoment: moments.leftMoment,
        rightMoment: moments.rightMoment,
        netMoment: moments.netMoment,
        tilt: finished.tilt,
        balanced: moments.balanced,
      },
    }),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

export function createLeverSimulationRequest(
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

export class LeverEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = LEVER_ENGINE_ID
  readonly engineVersion = LEVER_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (leverBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_lever', 'Lever Engine requires exactly one lever.')],
        LEVER_ENGINE_ID,
      )
    }
    if (
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0 ||
      scene.forces.length > 0 ||
      scene.regions.length > 0 ||
      scene.boundaries.length > 0 ||
      scene.constraints.length > 0 ||
      scene.circuits.length > 0 ||
      (scene.opticalBenches ?? []).length > 0 ||
      (scene.acousticBenches ?? []).length > 0 ||
      (scene.fluidTanks ?? []).length > 0 ||
      (scene.thermalBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_lever_scene',
            'Lever Engine models pure class-1 lever scenes without motion objects, fields, circuits, optics, acoustics, fluid or thermal rigs.',
          ),
        ],
        LEVER_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(LEVER_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        LEVER_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveLeverModel(scene)
      return supported(MOMENT_BALANCE_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(LEVER_ENGINE_ID, [
        failure(
          'lever_model_resolvable',
          error instanceof Error ? error.message : 'The lever cannot be resolved for statics.',
        ),
      ])
    }
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
    const timeSeconds = canonicalValue(time)
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(resolveLeverModel(scene), timeSeconds)
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

    const startedAt = new Date().toISOString()
    const model = resolveLeverModel(scene)
    const totalTime = leverRunDuration()
    const moments = momentsOf(model)

    const states = Array.from({ length: TRAJECTORY_SEGMENTS + 1 }, (_, index) =>
      stateOf(model, (index / TRAJECTORY_SEGMENTS) * totalTime),
    )

    const events: PhysicsEventLike[] = moments.balanced
      ? [
          {
            eventId: asPhysicsEventId(`event-lever-balanced-${model.leverId}`),
            sceneId: scene.id,
            revision: scene.revision,
            type: 'LeverBalanced',
            time: 0,
          },
        ]
      : [
          {
            eventId: asPhysicsEventId(`event-lever-settling-${model.leverId}`),
            sceneId: scene.id,
            revision: scene.revision,
            type: 'LeverSettling',
            time: 0,
          },
          {
            eventId: asPhysicsEventId(`event-lever-tipped-${model.leverId}`),
            sceneId: scene.id,
            revision: scene.revision,
            type: 'LeverTipped',
            time: TIP_DURATION,
          },
        ]

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events,
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'lever-statics-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const leverEngine = new LeverEngine()
