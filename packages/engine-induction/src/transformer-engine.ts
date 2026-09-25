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
import { transformerBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveTransformerModel, type ResolvedTransformerModel } from './transformer-model.ts'
import {
  TRANSFORMER_RELATIVE_TOLERANCE,
  transformerReadingOf,
} from './transformer.ts'

export const TRANSFORMER_ENGINE_ID = 'engine-transformer'
export const TRANSFORMER_ENGINE_VERSION = '1.0.0'
export const IDEAL_TRANSFORMER_MODEL = 'ideal_transformer'

const TRANSFORMER_ASSUMPTIONS = [
  'the core carries all the flux: no leakage, so both windings see the same dΦ/dt',
  'ideal windings: no resistance, so U = N·dΦ/dt exactly',
  'no core losses: hysteresis and eddy currents are ignored',
  'the load draws whatever current the turns ratio implies, with no phase shift',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const volts = (value: number): Quantity<'electric_potential'> =>
  quantity(value, 'V', 'electric_potential')
const amperes = (value: number): Quantity<'electric_current'> =>
  quantity(value, 'A', 'electric_current')
const watts = (value: number): Quantity<'power'> => quantity(value, 'W', 'power')
const webersPerSecond = (value: number): Quantity<'magnetic_flux_rate'> =>
  quantity(value, 'Wb/s', 'magnetic_flux_rate')
const turns = (value: number): Quantity<'dimensionless'> => quantity(value, '', 'dimensionless')

/** Solve the scene's transformer; the single entry point UI layers reuse. */
export const resolveTransformer = (scene: PhysicsScene): ResolvedTransformerModel =>
  resolveTransformerModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedTransformerModel): DerivedQuantity[] => {
  const assumptions = [...TRANSFORMER_ASSUMPTIONS]
  const reading = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    model.secondaryTurns,
  )
  return [
    {
      key: 'primary_voltage',
      targetId: model.benchId,
      value: volts(reading.primaryVoltage),
      formula: { expression: 'U₁' },
      assumptions,
    },
    {
      key: 'turns_ratio',
      targetId: model.benchId,
      value: turns(reading.turnsRatio),
      formula: { expression: 'N₁/N₂' },
      assumptions,
    },
    {
      key: 'flux_rate',
      targetId: model.benchId,
      value: webersPerSecond(model.fluxRate),
      formula: { expression: 'dΦ/dt = U₁/N₁' },
      assumptions,
    },
    {
      key: 'secondary_voltage',
      targetId: model.benchId,
      value: volts(reading.secondaryVoltage),
      formula: { expression: 'U₂ = U₁·N₂/N₁' },
      assumptions,
    },
    {
      key: 'secondary_current',
      targetId: model.benchId,
      value: amperes(reading.secondaryCurrent),
      formula: { expression: 'I₂ = I₁·N₁/N₂' },
      assumptions,
    },
    {
      key: 'primary_power',
      targetId: model.benchId,
      value: watts(reading.primaryPower),
      formula: { expression: 'P₁ = U₁I₁' },
      assumptions,
    },
    {
      key: 'secondary_power',
      targetId: model.benchId,
      value: watts(reading.secondaryPower),
      formula: { expression: 'P₂ = U₂I₂' },
      assumptions,
    },
  ]
}

/**
 * A transformer has no position in time to report: the ratios hold at every
 * instant of the cycle, so the state IS the settled reading. `time` is accepted
 * so the engine satisfies the same interface as the timed benches.
 */
const stateOf = (model: ResolvedTransformerModel, timeSeconds: number): SimulationState => {
  const values: Record<string, Quantity | QuantityVector> = {}
  for (const entry of derivedOf(model)) values[entry.key] = entry.value
  return {
    time: quantity(timeSeconds, 's', 'time'),
    objects: [{ id: model.benchId, values }],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const within = (actual: number, expected: number, scale: number): boolean =>
  Math.abs(actual - expected) <=
  Math.max(TRANSFORMER_RELATIVE_TOLERANCE, TRANSFORMER_RELATIVE_TOLERANCE * Math.abs(scale))

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedTransformerModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const reading = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    model.secondaryTurns,
  )

  /* Every turn of every winding sees the same dΦ/dt — that is the ONE assumption
     the machine rests on. Recovering the flux rate from each winding's own
     voltage and turns and comparing them is what checks it. */
  const fluxFromPrimary = reading.primaryVoltage / model.primaryTurns
  const fluxFromSecondary = reading.secondaryVoltage / model.secondaryTurns
  checks.push(
    check(
      'both_windings_share_one_flux',
      'constraint',
      within(fluxFromSecondary, fluxFromPrimary, fluxFromPrimary),
      {
        message:
          '同一个磁通：每个绕组的电压都等于自己的匝数乘以 dΦ/dt —— 两侧算出的 dΦ/dt 必须相同，这就是 U₁/U₂ = N₁/N₂ 的来源。',
        targetId: model.benchId,
        details: { fluxFromPrimary, fluxFromSecondary },
      },
    ),
  )

  /* And the power balance, which is what "ideal" means: step the voltage up and
     the current comes down, so the product does not move. */
  checks.push(
    check(
      'power_passes_through_unchanged',
      'conservation',
      within(reading.secondaryPower, reading.primaryPower, reading.primaryPower),
      {
        message: '理想变压器不改变功率：U₁I₁ = U₂I₂ —— 升压必然降流，反之亦然。',
        targetId: model.benchId,
        details: { primaryPower: reading.primaryPower, secondaryPower: reading.secondaryPower },
      },
    ),
  )

  /* The turns ratio as a ratio, computed at a different secondary winding: it
     is the ratio of the two counts and nothing else about the machine. */
  const doubled = transformerReadingOf(
    model.primaryVoltage,
    model.primaryCurrent,
    model.primaryTurns,
    2 * model.secondaryTurns,
  )
  checks.push(
    check(
      'output_scales_with_the_turns_ratio',
      'constraint',
      within(doubled.secondaryVoltage, 2 * reading.secondaryVoltage, 2 * reading.secondaryVoltage) &&
        within(doubled.secondaryCurrent, reading.secondaryCurrent / 2, reading.secondaryCurrent / 2) &&
        within(doubled.secondaryPower, reading.primaryPower, reading.primaryPower),
      {
        message:
          '匝比就是这台机器：副绕组匝数加倍，电压加倍、电流减半，而功率一动不动。',
        targetId: model.benchId,
        details: {
          secondaryVoltage: reading.secondaryVoltage,
          atDoubleTurns: doubled.secondaryVoltage,
          secondaryCurrent: reading.secondaryCurrent,
          currentAtDoubleTurns: doubled.secondaryCurrent,
        },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createTransformerSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'induction',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class TransformerEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = TRANSFORMER_ENGINE_ID
  readonly engineVersion = TRANSFORMER_ENGINE_VERSION
  readonly domain = 'induction' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (transformerBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Transformer Engine requires exactly one transformer bench.')],
        TRANSFORMER_ENGINE_ID,
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
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_transformer_scene',
            'Transformer Engine models pure transformer benches without motion objects, fields, circuits or other benches.',
          ),
        ],
        TRANSFORMER_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(TRANSFORMER_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        TRANSFORMER_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveTransformerModel(scene)
      return supported(IDEAL_TRANSFORMER_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(TRANSFORMER_ENGINE_ID, [
        failure(
          'transformer_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved as a transformer.',
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
    return stateOf(resolveTransformerModel(scene), timeSeconds)
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
    const model = resolveTransformerModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state: the ratios hold at every instant of the cycle, so a run of
         states would be the same reading at a different clock. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-transformer-settled-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'TransformerReadingSettled',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'ideal-transformer-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const transformerEngine = new TransformerEngine()
