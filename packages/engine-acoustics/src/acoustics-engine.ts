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
import { acousticBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveAcousticModel, type ResolvedAcousticModel } from './acoustics-model.ts'
import { echoTimingOf, pulseStateAt } from './echo.ts'

export const ACOUSTICS_ENGINE_ID = 'engine-acoustics'
export const ACOUSTICS_ENGINE_VERSION = '1.0.0'
export const ECHO_RANGING_MODEL = 'echo_ranging'

/**
 * Sampled states across the round trip. 64 even segments of 2d/v put sample 32
 * exactly on the reflection instant d/v, so the trajectory kink is exact
 * rather than interpolated.
 */
const TRAJECTORY_SEGMENTS = 64

/** Relative tolerance for closed-form self-consistency checks. */
const ECHO_RELATIVE_TOLERANCE = 1e-9

const ECHO_ASSUMPTIONS = [
  'ray acoustics: the pulse travels in a straight line at constant sound speed',
  'ideal reflection off the wall (no absorption, no spreading loss)',
  'still medium; the source and the wall do not move during the round trip',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')

/** Solve the scene's echo range; the single entry point UI layers reuse. */
export const resolveEchoRanging = (scene: PhysicsScene): ResolvedAcousticModel =>
  resolveAcousticModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedAcousticModel): DerivedQuantity[] => {
  const assumptions = [...ECHO_ASSUMPTIONS]
  const { oneWayTime, roundTripTime } = echoTimingOf(model)
  return [
    {
      key: 'wall_distance',
      targetId: model.reflectorId,
      value: metres(model.wallDistance),
      formula: { expression: 'd = x_壁 − x_源' },
      assumptions,
    },
    {
      key: 'sound_speed',
      targetId: model.benchId,
      value: quantity(model.soundSpeed, 'm/s', 'velocity'),
      formula: { expression: 'v' },
      assumptions,
    },
    {
      key: 'one_way_time',
      targetId: model.benchId,
      value: seconds(oneWayTime),
      formula: { expression: 't₁ = d/v' },
      assumptions,
    },
    {
      key: 'echo_time',
      targetId: model.benchId,
      value: seconds(roundTripTime),
      formula: { expression: 't = 2d/v' },
      assumptions,
    },
    {
      /* The measurement the lab exists for: recover the distance from the
         measured echo delay. Identical to wall_distance when the model is
         self-consistent — the verification below asserts exactly that. */
      key: 'measured_distance',
      targetId: model.reflectorId,
      value: metres((model.soundSpeed * roundTripTime) / 2),
      formula: { expression: 'd = v·t/2' },
      assumptions,
    },
  ]
}

const stateOf = (model: ResolvedAcousticModel, timeSeconds: number): SimulationState => {
  const pulse = pulseStateAt(model, timeSeconds)
  return {
    time: seconds(timeSeconds),
    objects: [
      { id: model.sourceId, values: { position_x: metres(model.sourceX) } },
      { id: model.reflectorId, values: { position_x: metres(model.reflectorX) } },
      {
        id: model.benchId,
        values: {
          pulse_position_x: metres(pulse.x),
          pulse_travelled: metres(pulse.travelled),
        },
      },
    ],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedAcousticModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const { oneWayTime, roundTripTime } = echoTimingOf(model)

  /* d = v·t/2 must recover the wall distance from the round-trip delay. */
  const recovered = (model.soundSpeed * roundTripTime) / 2
  const distanceResidual = Math.abs(recovered - model.wallDistance)
  checks.push(
    check(
      'echo_distance_formula',
      'constraint',
      distanceResidual <= ECHO_RELATIVE_TOLERANCE * model.wallDistance,
      {
        message: '回声测距公式 d = v·t/2 与几何距离一致。',
        targetId: model.reflectorId,
        details: { recovered, wallDistance: model.wallDistance, residual: distanceResidual },
      },
    ),
  )

  /* The wall does not move: out and back cover the same distance at the same
     speed, so both legs take the same time. */
  const returnLeg = roundTripTime - oneWayTime
  checks.push(
    check(
      'reflection_symmetry',
      'constraint',
      Math.abs(returnLeg - oneWayTime) <= ECHO_RELATIVE_TOLERANCE * oneWayTime,
      {
        message: '往返对称：去程与回程时间相等（t₁ = t₂ = d/v）。',
        targetId: model.benchId,
        details: { oneWayTime, returnLeg },
      },
    ),
  )

  /* Uniform propagation on both legs: sampled speeds must equal v exactly. */
  const speedOn = (t0: number, t1: number): number =>
    Math.abs(pulseStateAt(model, t1).x - pulseStateAt(model, t0).x) / (t1 - t0)
  const outboundSpeed = speedOn(0.1 * oneWayTime, 0.9 * oneWayTime)
  const returnSpeed = speedOn(
    oneWayTime + 0.1 * oneWayTime,
    oneWayTime + 0.9 * oneWayTime,
  )
  const speedsUniform =
    Math.abs(outboundSpeed - model.soundSpeed) <= ECHO_RELATIVE_TOLERANCE * model.soundSpeed &&
    Math.abs(returnSpeed - model.soundSpeed) <= ECHO_RELATIVE_TOLERANCE * model.soundSpeed
  checks.push(
    check('pulse_speed_constant', 'constraint', speedsUniform, {
      message: '声速恒定：脉冲在去程与回程都以 v 匀速传播。',
      targetId: model.benchId,
      details: { outboundSpeed, returnSpeed, soundSpeed: model.soundSpeed },
    }),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createAcousticsSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'wave',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class AcousticsEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = ACOUSTICS_ENGINE_ID
  readonly engineVersion = ACOUSTICS_ENGINE_VERSION
  readonly domain = 'wave' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (acousticBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_range', 'Acoustics Engine requires exactly one echo range.')],
        ACOUSTICS_ENGINE_ID,
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
      (scene.opticalBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_acoustics_scene',
            'Acoustics Engine models pure echo-range scenes without motion objects, fields, circuits or optics.',
          ),
        ],
        ACOUSTICS_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(ACOUSTICS_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        ACOUSTICS_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveAcousticModel(scene)
      return supported(ECHO_RANGING_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(ACOUSTICS_ENGINE_ID, [
        failure(
          'echo_model_resolvable',
          error instanceof Error ? error.message : 'The range cannot be resolved for echo timing.',
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
    return stateOf(resolveAcousticModel(scene), timeSeconds)
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
    const model = resolveAcousticModel(scene)
    const { oneWayTime, roundTripTime } = echoTimingOf(model)

    const states = Array.from({ length: TRAJECTORY_SEGMENTS + 1 }, (_, index) =>
      stateOf(model, (index / TRAJECTORY_SEGMENTS) * roundTripTime),
    )

    const events: PhysicsEventLike[] = [
      {
        eventId: asPhysicsEventId(`event-pulse-emitted-${model.benchId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'PulseEmitted',
        time: 0,
      },
      {
        eventId: asPhysicsEventId(`event-pulse-reflected-${model.benchId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'PulseReflected',
        time: oneWayTime,
      },
      {
        eventId: asPhysicsEventId(`event-echo-received-${model.benchId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'EchoReceived',
        time: roundTripTime,
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
        solver: 'echo-ranging-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const acousticsEngine = new AcousticsEngine()
