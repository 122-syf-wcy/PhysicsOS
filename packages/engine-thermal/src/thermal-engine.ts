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
import { thermalBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import {
  heatingTimingOf,
  sampleHeatFromSegments,
  sampleStateAt,
  thermalStateAt,
} from './heating-curve.ts'
import {
  resolveThermalModel,
  type ResolvedThermalModel,
  type ResolvedThermalSample,
} from './thermal-model.ts'

export const THERMAL_ENGINE_ID = 'engine-thermal'
export const THERMAL_ENGINE_VERSION = '1.0.0'
export const HEATING_CURVE_MODEL = 'constant_power_heating'

/**
 * Sampled states across the run. 96 even segments is enough that both sloped
 * segments and the plateau each get a couple of dozen points at the textbook
 * proportions, so the graph reads as three distinct stretches.
 */
const TRAJECTORY_SEGMENTS = 96

/** Relative tolerance for closed-form self-consistency checks. */
const THERMAL_RELATIVE_TOLERANCE = 1e-9

const THERMAL_ASSUMPTIONS = [
  'the heater delivers constant power and the sample absorbs all of it',
  'no heat is lost to the surroundings or the container',
  'the sample is uniform in temperature at every instant',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const joules = (value: number): Quantity<'energy'> => quantity(value, 'J', 'energy')
const kelvin = (value: number): Quantity<'temperature'> => quantity(value, 'K', 'temperature')
const seconds = (value: number): Quantity<'time'> => quantity(value, 's', 'time')
const watts = (value: number): Quantity<'power'> => quantity(value, 'W', 'power')
const specificHeat = (value: number): Quantity<'specific_heat'> =>
  quantity(value, 'J/(kg*K)', 'specific_heat')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

const activeSpecificHeatOf = (sample: ResolvedThermalSample): number =>
  sample.startsMolten ? sample.liquidSpecificHeat : sample.solidSpecificHeat

/** Solve the scene's heating curve; the single entry point UI layers reuse. */
export const resolveHeatingCurve = (scene: PhysicsScene): ResolvedThermalModel =>
  resolveThermalModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedThermalModel): DerivedQuantity[] => {
  const assumptions = [...THERMAL_ASSUMPTIONS]
  const { warmUpTime, meltingDuration, totalTime } = heatingTimingOf(model)
  const items: DerivedQuantity[] = [
    {
      key: 'heater_power',
      targetId: model.benchId,
      value: watts(model.heaterPower),
      formula: { expression: 'P' },
      assumptions,
    },
  ]

  if (model.startsMolten) {
    const end = thermalStateAt(model, totalTime)
    items.push(
      {
        key: 'absorbed_heat',
        targetId: model.benchId,
        value: joules(model.heaterPower * totalTime),
        formula: { expression: 'Q = P·t' },
        assumptions,
      },
      {
        key: 'temperature_rise',
        targetId: model.sampleId,
        value: kelvin(end.temperature - model.initialTemperature),
        formula: { expression: 'ΔT = Q/(c·m)' },
        assumptions,
      },
      {
        key: 'specific_heat',
        targetId: model.sampleId,
        value: specificHeat(activeSpecificHeatOf(model)),
        formula: { expression: 'c' },
        assumptions,
      },
    )
    const comparison = model.comparisonSample
    if (comparison !== undefined) {
      const comparisonEnd = sampleStateAt(
        comparison,
        model.heaterPower,
        totalTime,
        model.runDuration,
      )
      items.push(
        {
          key: 'comparison_temperature_rise',
          targetId: comparison.sampleId,
          value: kelvin(comparisonEnd.temperature - comparison.initialTemperature),
          formula: { expression: 'ΔT′ = Q/(c′·m)' },
          assumptions,
        },
        {
          key: 'comparison_specific_heat',
          targetId: comparison.sampleId,
          value: specificHeat(activeSpecificHeatOf(comparison)),
          formula: { expression: 'c′' },
          assumptions,
        },
      )
    }
    return items
  }

  items.push(
    {
      key: 'melting_point',
      targetId: model.sampleId,
      value: kelvin(model.meltingPoint),
      formula: { expression: 'T_熔' },
      assumptions,
    },
    {
      key: 'warm_up_time',
      targetId: model.sampleId,
      value: seconds(warmUpTime),
      formula: { expression: 't₁ = c_固·m·ΔT/P' },
      assumptions,
    },
    {
      key: 'melting_duration',
      targetId: model.sampleId,
      value: seconds(meltingDuration),
      formula: { expression: 't_熔 = mL/P' },
      assumptions,
    },
    {
      /* The heat the plateau swallows without moving the thermometer — the
         number the whole lesson is about. */
      key: 'melting_heat',
      targetId: model.sampleId,
      value: joules(model.mass * model.latentHeat),
      formula: { expression: 'Q_熔 = mL' },
      assumptions,
    },
    {
      key: 'warm_up_heat',
      targetId: model.sampleId,
      value: joules(
        model.mass * model.solidSpecificHeat * (model.meltingPoint - model.initialTemperature),
      ),
      formula: { expression: 'Q₁ = c_固·m·ΔT' },
      assumptions,
    },
    {
      key: 'total_heat',
      targetId: model.benchId,
      value: joules(model.heaterPower * totalTime),
      formula: { expression: 'Q_总 = P·t' },
      assumptions,
    },
  )
  return items
}

const stateOf = (model: ResolvedThermalModel, timeSeconds: number): SimulationState => {
  const state = thermalStateAt(model, timeSeconds)
  const comparison = model.comparisonSample
  const comparisonState = comparison === undefined
    ? undefined
    : sampleStateAt(comparison, model.heaterPower, timeSeconds, model.runDuration)
  return {
    time: seconds(timeSeconds),
    objects: [
      {
        id: model.benchId,
        values: {
          temperature: kelvin(state.temperature),
          heat_absorbed: joules(state.heatAbsorbed),
          melted_fraction: dimensionless(state.meltedFraction),
        },
      },
      { id: model.sampleId, values: { temperature: kelvin(state.temperature) } },
      ...(comparison === undefined || comparisonState === undefined
        ? []
        : [{ id: comparison.sampleId, values: { temperature: kelvin(comparisonState.temperature) } }]),
    ],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedThermalModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const { warmUpTime, meltingDuration, meltingEndTime, totalTime } = heatingTimingOf(model)

  const energyResidualOf = (sample: ResolvedThermalSample): number =>
    Array.from({ length: TRAJECTORY_SEGMENTS + 1 }, (_, index) => {
      const time = (index / TRAJECTORY_SEGMENTS) * totalTime
      return Math.abs(
        sampleHeatFromSegments(sample, model.heaterPower, time, model.runDuration) -
          model.heaterPower * time,
      )
    }).reduce((worst, value) => Math.max(worst, value), 0)

  /* Energy accounting from two directions: what the heater put in (P·t) against
     what the segments absorbed (c_固·m·ΔT + mL·x + c_液·m·ΔT). They only agree
     if every segment boundary is in the right place. */
  const worstEnergyResidual = energyResidualOf(model)
  const totalHeat = model.heaterPower * totalTime
  checks.push(
    check(
      'energy_conservation',
      'conservation',
      worstEnergyResidual <= THERMAL_RELATIVE_TOLERANCE * totalHeat,
      {
        message: '能量守恒：分段吸热 c·m·ΔT + mL 与加热器供热 P·t 处处相等。',
        targetId: model.benchId,
        details: { totalHeat, worstResidual: worstEnergyResidual },
      },
    ),
  )

  const comparison = model.comparisonSample
  if (comparison !== undefined) {
    const comparisonResidual = energyResidualOf(comparison)
    const primaryEnd = thermalStateAt(model, totalTime)
    const comparisonEnd = sampleStateAt(
      comparison,
      model.heaterPower,
      totalTime,
      model.runDuration,
    )
    const primaryRise = primaryEnd.temperature - model.initialTemperature
    const comparisonRise = comparisonEnd.temperature - comparison.initialTemperature
    const primaryC = activeSpecificHeatOf(model)
    const comparisonC = activeSpecificHeatOf(comparison)
    const expectedRiseRatio = comparisonC / primaryC
    const measuredRiseRatio = comparisonRise === 0
      ? Number.POSITIVE_INFINITY
      : primaryRise / comparisonRise

    checks.push(
      check(
        'equal_heat_absorbed',
        'conservation',
        comparisonResidual <= THERMAL_RELATIVE_TOLERANCE * totalHeat,
        {
          message: '控制变量：两边加热器功率相同、加热时间相同，吸收的热量完全相同。',
          targetId: comparison.sampleId,
          details: { totalHeat, comparisonResidual },
        },
      ),
    )
    checks.push(
      check(
        'specific_heat_ratio',
        'constraint',
        Math.abs(measuredRiseRatio - expectedRiseRatio) <=
          THERMAL_RELATIVE_TOLERANCE * expectedRiseRatio,
        {
          message: '同样的热量下升温与比热容成反比：ΔT / ΔT′ = c′ / c。',
          targetId: model.sampleId,
          details: {
            primaryRise,
            comparisonRise,
            expectedRiseRatio,
            measuredRiseRatio,
          },
        },
      ),
    )
  }

  if (!model.startsMolten) {
  /* Slopes are P/(mc): the ratio of the two sloped segments is exactly the
     inverse ratio of the specific heats, which is how the graph is read. */
  const solidSlope = model.heaterPower / (model.mass * model.solidSpecificHeat)
  const liquidSlope = model.heaterPower / (model.mass * model.liquidSpecificHeat)
  const expectedRatio = model.liquidSpecificHeat / model.solidSpecificHeat
  checks.push(
    check(
      'heating_rate_ratio',
      'constraint',
      Math.abs(solidSlope / liquidSlope - expectedRatio) <=
        THERMAL_RELATIVE_TOLERANCE * expectedRatio,
      {
        message: '升温快慢由比热容决定：两段斜率之比等于比热容的反比。',
        targetId: model.sampleId,
        details: { solidSlope, liquidSlope, expectedRatio },
      },
    ),
  )

  if (model.crystalline) {
    /* The headline fact: the thermometer does not move for the whole mL/P, even
       though the heater never stops. Sampled across the plateau, not just at
       its ends. */
    const plateauResidual = Array.from({ length: 17 }, (_, index) => {
      const time = warmUpTime + (index / 16) * meltingDuration
      return Math.abs(thermalStateAt(model, time).temperature - model.meltingPoint)
    }).reduce((worst, value) => Math.max(worst, value), 0)
    checks.push(
      check(
        'melting_plateau',
        'constraint',
        meltingDuration > 0 &&
          plateauResidual <= THERMAL_RELATIVE_TOLERANCE * model.meltingPoint,
        {
          message: '晶体熔化时持续吸热但温度不变，图像上是一段水平线。',
          targetId: model.sampleId,
          details: { meltingDuration, plateauTemperature: model.meltingPoint, plateauResidual },
        },
      ),
    )
    /* And it is not a rounding artefact: the plateau lasts exactly mL/P. */
    const expectedDuration = (model.mass * model.latentHeat) / model.heaterPower
    checks.push(
      check(
        'plateau_duration',
        'constraint',
        Math.abs(meltingEndTime - warmUpTime - expectedDuration) <=
          THERMAL_RELATIVE_TOLERANCE * expectedDuration,
        {
          message: '熔化耗时 t = mL/P：熔化热全部由加热器在这段时间里供给。',
          targetId: model.sampleId,
          details: { measured: meltingEndTime - warmUpTime, expected: expectedDuration },
        },
      ),
    )
  } else {
    /* Amorphous: no fixed melting point, so the curve never stops rising. */
    const beforeSoftening = thermalStateAt(model, warmUpTime * 0.99).temperature
    const afterSoftening = thermalStateAt(model, warmUpTime * 1.01).temperature
    checks.push(
      check(
        'amorphous_no_plateau',
        'constraint',
        meltingDuration === 0 && afterSoftening > beforeSoftening,
        {
          message: '非晶体没有固定熔点：整个加热过程温度持续上升，图像上没有水平段。',
          targetId: model.sampleId,
          details: { beforeSoftening, afterSoftening },
        },
      ),
    )
  }
  }

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createThermalSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'thermal',
    options: {},
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class ThermalEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = THERMAL_ENGINE_ID
  readonly engineVersion = THERMAL_ENGINE_VERSION
  readonly domain = 'thermal' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (thermalBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Thermal Engine requires exactly one heating bench.')],
        THERMAL_ENGINE_ID,
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
      (scene.fluidTanks ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_thermal_scene',
            'Thermal Engine models pure heating scenes without motion objects, fields, circuits, optics, acoustics or fluid rigs.',
          ),
        ],
        THERMAL_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(THERMAL_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        THERMAL_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveThermalModel(scene)
      return supported(HEATING_CURVE_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(THERMAL_ENGINE_ID, [
        failure(
          'heating_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved for heating.',
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
    return stateOf(resolveThermalModel(scene), timeSeconds)
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
    const model = resolveThermalModel(scene)
    const { warmUpTime, meltingEndTime, totalTime } = heatingTimingOf(model)

    const states = Array.from({ length: TRAJECTORY_SEGMENTS + 1 }, (_, index) =>
      stateOf(model, (index / TRAJECTORY_SEGMENTS) * totalTime),
    )

    const events: PhysicsEventLike[] = [
      {
        eventId: asPhysicsEventId(`event-heating-started-${model.benchId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: 'HeatingStarted',
        time: 0,
      },
    ]
    if (!model.startsMolten) {
      events.push({
        eventId: asPhysicsEventId(`event-melting-started-${model.benchId}`),
        sceneId: scene.id,
        revision: scene.revision,
        type: model.crystalline ? 'MeltingStarted' : 'SofteningStarted',
        time: warmUpTime,
      })
      if (model.crystalline) {
        events.push({
          eventId: asPhysicsEventId(`event-melting-complete-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'MeltingComplete',
          time: meltingEndTime,
        })
      }
    }

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
        solver: 'heating-curve-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const thermalEngine = new ThermalEngine()
