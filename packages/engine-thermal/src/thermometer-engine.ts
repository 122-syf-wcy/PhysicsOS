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
import {
  CELSIUS_ZERO_IN_KELVIN,
  thermometerBenchesOf,
  validateScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolveThermometerModel, type ResolvedThermometerModel } from './thermometer-model.ts'
import {
  THERMOMETER_RELATIVE_TOLERANCE,
  boreArea,
  columnLengthAt,
  expansionVolume,
  scaleFactor,
  thermometerReadingOf,
} from './thermometer.ts'

export const THERMOMETER_ENGINE_ID = 'engine-thermometer'
export const THERMOMETER_ENGINE_VERSION = '1.0.0'
export const LIQUID_IN_GLASS_MODEL = 'liquid_in_glass_thermometer'

const THERMOMETER_ASSUMPTIONS = [
  'the glass does not expand: only the liquid does',
  'the bore is uniform, so volume maps to height exactly',
  'the liquid expands linearly over the range being read',
  'the thermometer has reached thermal equilibrium with what it is dipped in',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const kelvin = (value: number): Quantity<'temperature'> => quantity(value, 'K', 'temperature')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const cubicMetres = (value: number): Quantity<'volume'> => quantity(value, 'm^3', 'volume')
const squareMetres = (value: number): Quantity<'area'> => quantity(value, 'm^2', 'area')
const dimensionless = (value: number): Quantity<'dimensionless'> =>
  quantity(value, '', 'dimensionless')

/** Solve the scene's thermometer; the single entry point UI layers reuse. */
export const resolveThermometer = (scene: PhysicsScene): ResolvedThermometerModel =>
  resolveThermometerModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedThermometerModel): DerivedQuantity[] => {
  const assumptions = [...THERMOMETER_ASSUMPTIONS]
  const reading = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient,
    model.temperature - CELSIUS_ZERO_IN_KELVIN,
    model.icePointLength,
  )
  return [
    {
      key: 'bulb_volume',
      targetId: model.benchId,
      value: cubicMetres(reading.bulbVolume),
      formula: { expression: 'V₀' },
      assumptions,
    },
    {
      key: 'bore_area',
      targetId: model.benchId,
      value: squareMetres(reading.boreArea),
      formula: { expression: 'A = π(d/2)²' },
      assumptions,
    },
    {
      key: 'expansion_coefficient',
      targetId: model.benchId,
      value: dimensionless(reading.expansionCoefficient),
      formula: { expression: 'β（单位 1/K）' },
      assumptions,
    },
    {
      key: 'scale_factor',
      targetId: model.benchId,
      value: metres(reading.scale),
      formula: { expression: 'k = V₀·β/A（米每摄氏度）' },
      assumptions,
    },
    {
      key: 'ice_point',
      targetId: model.benchId,
      value: metres(reading.icePoint),
      formula: { expression: '0 °C 时的液柱长' },
      assumptions,
    },
    {
      key: 'steam_point',
      targetId: model.benchId,
      value: metres(reading.steamPoint),
      formula: { expression: '100 °C 时的液柱长' },
      assumptions,
    },
    {
      key: 'centigrade_span',
      targetId: model.benchId,
      value: metres(reading.span),
      formula: { expression: '两个固定点之间的液柱长度' },
      assumptions,
    },
    {
      key: 'column_length',
      targetId: model.benchId,
      value: metres(reading.column),
      formula: { expression: 'h = h₀ + k·t' },
      assumptions,
    },
    {
      key: 'reading_temperature',
      targetId: model.benchId,
      value: kelvin(model.temperature),
      formula: { expression: 't（泡所在的温度）' },
      assumptions,
    },
  ]
}

/**
 * The instrument is at rest in a bath: the column stands where the temperature
 * puts it, so the reading is the same at every instant. `time` is accepted so
 * the engine satisfies the same interface as the timed benches.
 */
const stateOf = (model: ResolvedThermometerModel, timeSeconds: number): SimulationState => {
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
  Math.max(THERMOMETER_RELATIVE_TOLERANCE, THERMOMETER_RELATIVE_TOLERANCE * Math.abs(scale))

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedThermometerModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]
  const reading = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient,
    model.temperature - CELSIUS_ZERO_IN_KELVIN,
    model.icePointLength,
  )

  /* The column's rise IS the volume the liquid gained, divided by the bore. Two
     computations — one through ΔV = V₀βΔT then /A, one through the sensitivity
     k = V₀β/A — and they have to agree at every temperature, which is what makes
     the scale read correctly rather than merely evenly. */
  const at100 = columnLengthAt(model.icePointLength, reading.scale, 100) - model.icePointLength
  const fromVolume = expansionVolume(model.bulbVolume, model.expansionCoefficient, 100) / boreArea(model.boreDiameter)
  checks.push(
    check(
      'column_from_expansion',
      'constraint',
      within(at100, fromVolume, fromVolume) &&
        within(
          reading.scale,
          scaleFactor(model.bulbVolume, boreArea(model.boreDiameter), model.expansionCoefficient),
          reading.scale,
        ),
      {
        message:
          '液柱的升高就是液体多出来的体积除以细管截面积：Δh = V₀βΔT/A。两条算法（先算体积再除面积、直接乘灵敏度）必须一致。',
        targetId: model.benchId,
        details: { riseAt100: at100, fromVolume, scale: reading.scale },
      },
    ),
  )

  /* The scale is UNIFORM, and that is a consequence rather than a convention:
     the expansion is linear in temperature, so equal temperature steps are
     equal distances. Checked by comparing several intervals, not one. */
  const intervals = [
    [0, 10],
    [30, 40],
    [80, 90],
  ] as const
  const rises = intervals.map(
    ([from, to]) =>
      columnLengthAt(model.icePointLength, reading.scale, to) -
      columnLengthAt(model.icePointLength, reading.scale, from),
  )
  checks.push(
    check(
      'scale_is_uniform',
      'constraint',
      rises.every(rise => within(rise, rises[0] ?? 0, rises[0] ?? 1)),
      {
        message:
          '刻度是均匀的：膨胀与温度成正比，所以**每一度在玻璃上都是同样长的一段** —— 这是线性膨胀的结果，不是画刻度时的约定。',
        targetId: model.benchId,
        details: { intervalRises: rises },
      },
    ),
  )

  /* The two fixed points: whatever the bulb and the bore are, the distance from
     0 °C to 100 °C is the span that gets divided into a hundred degrees. A
     better instrument has a LONGER span (a finer scale), not a different one. */
  const better = thermometerReadingOf(
    model.bulbVolume,
    model.boreDiameter,
    model.expansionCoefficient * 2,
    model.temperature - CELSIUS_ZERO_IN_KELVIN,
    model.icePointLength,
  )
  checks.push(
    check(
      'fixed_points_define_the_span',
      'constraint',
      within(reading.span, 100 * reading.scale, reading.span) &&
        /* Twice the expansion, twice the span: the scale is finer, and the two
           fixed points are still 0 and 100. */
        within(better.span, 2 * reading.span, 2 * reading.span) &&
        within(better.degreesPerMetre, reading.degreesPerMetre / 2, reading.degreesPerMetre / 2),
      {
        message:
          '两个固定点定标：0 °C 与 100 °C 之间的液柱长度就是这把尺子的量程，把它分成 100 等份才有"度"；液体膨胀得越厉害，这一段越长、刻度越细。',
        targetId: model.benchId,
        details: {
          icePoint: reading.icePoint,
          steamPoint: reading.steamPoint,
          span: reading.span,
          spanAtDoubleExpansion: better.span,
        },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createThermometerSimulationRequest(
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

export class ThermometerEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = THERMOMETER_ENGINE_ID
  readonly engineVersion = THERMOMETER_ENGINE_VERSION
  readonly domain = 'thermal' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (thermometerBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Thermometer Engine requires exactly one thermometer bench.')],
        THERMOMETER_ENGINE_ID,
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
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_thermometer_scene',
            'Thermometer Engine models pure thermometer benches without motion objects, fields, circuits or other benches.',
          ),
        ],
        THERMOMETER_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(THERMOMETER_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        THERMOMETER_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      resolveThermometerModel(scene)
      return supported(LIQUID_IN_GLASS_MODEL, this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(THERMOMETER_ENGINE_ID, [
        failure(
          'thermometer_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved as a thermometer.',
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
    return stateOf(resolveThermometerModel(scene), timeSeconds)
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
    const model = resolveThermometerModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state: the column stands where the temperature puts it, so a longer
         run would be the same reading at a different clock. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-thermometer-ready-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'ThermometerReady',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'thermal-expansion-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const thermometerEngine = new ThermometerEngine()
