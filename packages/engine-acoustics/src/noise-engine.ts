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
  type QuantityVector,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import { noiseBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveNoiseModel, type ResolvedNoiseModel } from './noise-model.ts'
import {
  POINT_SOURCE_SPREADING,
  REFERENCE_INTENSITY,
  intensityFromSoundLevel,
  intensityRatioOf,
  noiseReadingOf,
  soundLevelAt,
  soundLevelFromIntensity,
} from './noise.ts'

export const NOISE_ENGINE_ID = 'engine-noise-level'
export const NOISE_ENGINE_VERSION = '1.0.0'
export const POINT_SOURCE_NOISE_MODEL = 'point_source_sound_level'

const NOISE_ASSUMPTIONS = [
  'the source is a POINT source radiating equally in all directions',
  'free field: no reflections from the ground or from walls',
  'the air absorbs nothing over the distances being compared',
  "the barrier's insertion loss is a measured figure, not one this model derives",
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const decibels = (value: number): Quantity<'dimensionless'> => quantity(value, '', 'dimensionless')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')

/** Solve the scene's noise rig; the single entry point UI layers reuse. */
export const resolveNoise = (scene: PhysicsScene): ResolvedNoiseModel => resolveNoiseModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedNoiseModel): DerivedQuantity[] => {
  const assumptions = [...NOISE_ASSUMPTIONS]
  const reading = noiseReadingOf(model.soundPowerLevel, model.distance, model.barrierAttenuation)
  return [
    {
      key: 'sound_power_level',
      targetId: model.benchId,
      value: decibels(reading.soundPowerLevel),
      formula: { expression: 'Lw' },
      assumptions,
    },
    {
      key: 'listener_distance',
      targetId: model.benchId,
      value: metres(reading.distance),
      formula: { expression: 'r' },
      assumptions,
    },
    {
      key: 'spreading_loss',
      targetId: model.benchId,
      value: decibels(-20 * Math.log10(reading.distance) - POINT_SOURCE_SPREADING),
      formula: { expression: 'ΔL_距离 = −20·lg r − 10·lg(4π)' },
      assumptions,
    },
    {
      key: 'barrier_attenuation',
      targetId: model.benchId,
      value: decibels(reading.barrierAttenuation),
      formula: { expression: 'A（隔声量，实测值）' },
      assumptions,
    },
    {
      key: 'sound_level',
      targetId: model.benchId,
      value: decibels(reading.level),
      formula: { expression: 'L = Lw − 20·lg r − 10·lg(4π) − A' },
      assumptions,
    },
    {
      key: 'sound_intensity',
      targetId: model.benchId,
      value: quantity(reading.intensity, 'W/m^2', 'intensity'),
      formula: { expression: 'I = I₀·10^(L/10)' },
      assumptions,
    },
    {
      key: 'level_without_barrier',
      targetId: model.benchId,
      value: decibels(reading.levelWithoutBarrier),
      formula: { expression: 'A = 0 时的声级（对照组）' },
      assumptions,
    },
  ]
}

/**
 * The rig is at rest and the source is steady, so the meter reads the same at
 * every instant. `time` is accepted so the engine satisfies the same interface
 * as the timed benches.
 */
const stateOf = (model: ResolvedNoiseModel, timeSeconds: number): SimulationState => {
  const values: Record<string, Quantity | QuantityVector> = {}
  for (const entry of derivedOf(model)) values[entry.key] = entry.value
  return {
    time: quantity(timeSeconds, 's', 'time'),
    objects: [{ id: model.benchId, values }],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const within = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-9 * Math.max(Math.abs(expected), 1)

const buildVerification = (scene: PhysicsScene, model: ResolvedNoiseModel): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const reading = noiseReadingOf(model.soundPowerLevel, model.distance, model.barrierAttenuation)

  /* The level computed from the power level and the distance, against the level
     computed from the INTENSITY: I = P/(4πr²) then L = 10·lg(I/I₀). Two routes
     through the same physics, and a slipped 4π or a mistaken 20 for a 10 shows
     up as a disagreement rather than as a plausible number. */
  const power = REFERENCE_INTENSITY * 10 ** (model.soundPowerLevel / 10)
  const intensityAtDistance = power / (4 * Math.PI * model.distance ** 2)
  const levelFromIntensity = soundLevelFromIntensity(intensityAtDistance) - model.barrierAttenuation
  checks.push(
    check('level_from_intensity', 'constraint', within(levelFromIntensity, reading.level), {
      message:
        '声级的两个算法一致：由 Lw 与距离直接算出的 L，和"先算声强 I = P/(4πr²) 再取 10·lg(I/I₀)"得到的 L 必须相同。',
      targetId: model.benchId,
      details: { fromPowerAndDistance: reading.level, fromIntensity: levelFromIntensity },
    }),
  )

  /* Distance doubling costs 6 dB — checked as a RATIO at two distances, so it
     holds whatever the source is and wherever the first measurement is taken. */
  const atR = soundLevelAt(model.soundPowerLevel, model.distance, 0)
  const at2R = soundLevelAt(model.soundPowerLevel, 2 * model.distance, 0)
  const at10R = soundLevelAt(model.soundPowerLevel, 10 * model.distance, 0)
  checks.push(
    check(
      'doubling_distance_costs_six_decibels',
      'constraint',
      within(atR - at2R, 20 * Math.log10(2)) && within(atR - at10R, 20),
      {
        message:
          '距离加倍少 6 dB：因为 I = P/(4πr²) 与 L = 10·lg(I/I₀) 合起来就是 L 与 lg r 成正比，r 加倍恰好让 lg r 增加 lg2，对应 20lg2 = 6.02 dB。',
        targetId: model.benchId,
        details: { levelAtDistance: atR, atDoubleDistance: at2R, atTenTimes: at10R },
      },
    ),
  )

  /* The barrier is a SUBTRACTION, independent of the distance: moving the meter
     and raising a wall are separate things, so a barrier's saving must not
     change when the listener walks away. */
  const walled = soundLevelAt(model.soundPowerLevel, 4 * model.distance, model.barrierAttenuation)
  const bare = soundLevelAt(model.soundPowerLevel, 4 * model.distance, 0)
  checks.push(
    check(
      'barrier_is_an_independent_subtraction',
      'constraint',
      within(bare - walled, model.barrierAttenuation) &&
        within(reading.level, reading.levelWithoutBarrier - model.barrierAttenuation),
      {
        message:
          '屏障是独立的减法：隔声量在哪个距离上都是同一个数，与距离衰减互不影响 —— 退后一步和加一道墙是两件事。',
        targetId: model.benchId,
        details: { bare, walled, barrierAttenuation: model.barrierAttenuation },
      },
    ),
  )

  /* And the point of a logarithmic scale: 6 dB is a quarter of the intensity,
     not a sixth of it. Checked through the ratio, which is what the ear and the
     energy actually disagree about. */
  checks.push(
    check(
      'decibels_are_a_ratio_not_a_difference',
      'constraint',
      within(intensityRatioOf(20 * Math.log10(2)), 4) &&
        within(intensityRatioOf(10), 10) &&
        within(intensityRatioOf(20), 100) &&
        within(intensityFromSoundLevel(reading.level), reading.intensity),
      {
        message:
          'dB 是对数：少 6 dB 意味着声强只剩四分之一（不是少了六分之一），少 10 dB 是十之一，少 20 dB 是百之一。',
        targetId: model.benchId,
        details: {
          sixDecibelsRatio: intensityRatioOf(20 * Math.log10(2)),
          tenDecibelsRatio: intensityRatioOf(10),
        },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createNoiseSimulationRequest(
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

export class NoiseEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = NOISE_ENGINE_ID
  readonly engineVersion = NOISE_ENGINE_VERSION
  /* The acoustics shelf reports the `wave` domain, exactly as the echo-range
     engine beside it does: `domainOfEngine` maps the engine id back to the shelf. */
  readonly domain = 'wave' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (noiseBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Noise Engine requires exactly one noise bench.')],
        NOISE_ENGINE_ID,
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
      (scene.thermalBenches ?? []).length > 0 ||
      (scene.leverBenches ?? []).length > 0 ||
      (scene.pressureBenches ?? []).length > 0 ||
      (scene.currentBenches ?? []).length > 0 ||
      (scene.energyBenches ?? []).length > 0 ||
      (scene.lightBenches ?? []).length > 0 ||
      (scene.transformerBenches ?? []).length > 0 ||
      (scene.thermometerBenches ?? []).length > 0 ||
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_noise_scene',
            'Noise Engine models pure noise benches without motion objects, fields, circuits or other benches.',
          ),
        ],
        NOISE_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(NOISE_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        NOISE_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveNoiseModel(scene)
      return supported(POINT_SOURCE_NOISE_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(NOISE_ENGINE_ID, [
        failure(
          'noise_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved as a noise rig.',
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
    return stateOf(resolveNoiseModel(scene), timeSeconds)
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
    const model = resolveNoiseModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state: the source is steady and nothing moves, so a longer run would
         be the same reading at a different clock. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-noise-meter-ready-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'NoiseMeterReady',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'point-source-level-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const noiseEngine = new NoiseEngine()
