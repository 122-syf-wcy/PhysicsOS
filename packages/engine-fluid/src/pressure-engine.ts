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
import { pressureBenchesOf, validateScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asPhysicsEventId, asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import { resolvePressureModel, type ResolvedPressureModel } from './pressure-model.ts'
import {
  PRESSURE_RELATIVE_TOLERANCE,
  atmosphericPressureOf,
  hemisphereForceBySurfaceIntegral,
  hydrostaticPressureByIntegration,
  liquidPressureOf,
  solidPressureOf,
} from './pressure.ts'

export const PRESSURE_ENGINE_ID = 'engine-pressure'
export const PRESSURE_ENGINE_VERSION = '1.0.0'
export const SOLID_PRESSURE_MODEL = 'solid_contact_pressure'
export const LIQUID_PRESSURE_MODEL = 'hydrostatic_pressure'
export const ATMOSPHERIC_PRESSURE_MODEL = 'atmospheric_pressure'

const PRESSURE_ASSUMPTIONS = [
  'statics: the apparatus is at rest and every reading is taken in equilibrium',
  'the contact face is flat and the force acts perpendicular to it',
  'liquid density is uniform, so p = ρgh holds at every depth below the surface',
  'the Torricelli tube is long enough that the mercury column never tops out',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

const newtons = (value: number): Quantity<'force'> => quantity(value, 'N', 'force')
const metres = (value: number): Quantity<'length'> => quantity(value, 'm', 'length')
const squareMetres = (value: number): Quantity<'area'> => quantity(value, 'm^2', 'area')
const density = (value: number): Quantity<'density'> => quantity(value, 'kg/m^3', 'density')
const pascals = (value: number): Quantity<'pressure'> => quantity(value, 'Pa', 'pressure')

/** Solve the scene's pressure bench; the single entry point UI layers reuse. */
export const resolvePressure = (scene: PhysicsScene): ResolvedPressureModel =>
  resolvePressureModel(scene)

/* ------------------------------------------------------------- state/dqs -- */

const derivedOf = (model: ResolvedPressureModel): DerivedQuantity[] => {
  const assumptions = [...PRESSURE_ASSUMPTIONS]
  if (model.type === 'solid') {
    const reading = solidPressureOf(model)
    const entries: DerivedQuantity[] = [
      {
        key: 'contact_force',
        targetId: model.benchId,
        value: newtons(reading.force),
        formula: { expression: 'F' },
        assumptions,
      },
      {
        key: 'contact_area',
        targetId: model.benchId,
        value: squareMetres(reading.area),
        formula: { expression: 'S' },
        assumptions,
      },
      {
        key: 'contact_pressure',
        targetId: model.benchId,
        value: pascals(reading.pressure),
        formula: { expression: 'p = F/S' },
        assumptions,
      },
    ]
    if (reading.comparisonArea !== undefined && reading.comparisonPressure !== undefined) {
      entries.push(
        {
          key: 'comparison_area',
          targetId: model.benchId,
          value: squareMetres(reading.comparisonArea),
          formula: { expression: 'S₂' },
          assumptions,
        },
        {
          key: 'comparison_pressure',
          targetId: model.benchId,
          value: pascals(reading.comparisonPressure),
          formula: { expression: 'p₂ = F/S₂' },
          assumptions,
        },
      )
    }
    return entries
  }

  if (model.type === 'liquid') {
    const reading = liquidPressureOf(model)
    const entries: DerivedQuantity[] = [
      {
        key: 'liquid_density',
        targetId: model.benchId,
        value: density(reading.liquidDensity),
        formula: { expression: 'ρ' },
        assumptions,
      },
      {
        key: 'probe_depth',
        targetId: model.benchId,
        value: metres(reading.depth),
        formula: { expression: 'h' },
        assumptions,
      },
      {
        key: 'liquid_pressure',
        targetId: model.benchId,
        value: pascals(reading.pressure),
        formula: { expression: 'p = ρgh' },
        assumptions,
      },
    ]
    if (reading.comparisonDepth !== undefined && reading.comparisonDepthPressure !== undefined) {
      entries.push({
        key: 'comparison_depth_pressure',
        targetId: model.benchId,
        value: pascals(reading.comparisonDepthPressure),
        formula: { expression: 'p₂ = ρgh₂' },
        assumptions,
      })
    }
    if (
      reading.comparisonLiquidDensity !== undefined &&
      reading.comparisonLiquidPressure !== undefined
    ) {
      entries.push({
        key: 'comparison_liquid_pressure',
        targetId: model.benchId,
        value: pascals(reading.comparisonLiquidPressure),
        formula: { expression: 'p₃ = ρ₂gh' },
        assumptions,
      })
    }
    return entries
  }

  const reading = atmosphericPressureOf(model)
  return [
    {
      key: 'atmospheric_pressure',
      targetId: model.benchId,
      value: pascals(reading.atmosphericPressure),
      formula: { expression: 'p₀' },
      assumptions,
    },
    {
      key: 'barometer_column',
      targetId: model.benchId,
      value: metres(reading.columnHeight),
      formula: { expression: 'h = p₀/(ρ_液·g)' },
      assumptions,
    },
    {
      key: 'hemisphere_force',
      targetId: model.benchId,
      value: newtons(reading.hemisphereForce),
      formula: { expression: 'F = p₀·πr²' },
      assumptions,
    },
  ]
}

/**
 * The apparatus is static, so the rig is in the same configuration at every
 * instant and the state is the settled reading rather than a snapshot of a
 * changing one. `time` is accepted so the engine satisfies the same interface
 * as the timed benches, and it does not change a single value.
 */
const stateOf = (model: ResolvedPressureModel, timeSeconds: number): SimulationState => {
  const values: Record<string, Quantity | QuantityVector> = {}
  for (const entry of derivedOf(model)) values[entry.key] = entry.value
  return {
    time: quantity(timeSeconds, 's', 'time'),
    objects: [{ id: model.benchId, values }],
    derived: derivedOf(model),
  }
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  model: ResolvedPressureModel,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  if (model.type === 'solid') {
    const reading = solidPressureOf(model)
    /* The claim the experiment makes is that pressure is NOT the force: the
       same F on a smaller face reads a larger p, in exact inverse proportion.
       Recovering F from each face and comparing the ratio against the areas
       tests that relationship directly rather than restating p = F/S. */
    const fromLoaded = reading.pressure * reading.area
    const ratioHolds =
      reading.comparisonArea === undefined ||
      reading.comparisonPressure === undefined ||
      Math.abs(
        reading.comparisonPressure / reading.pressure - reading.area / reading.comparisonArea,
      ) <=
        PRESSURE_RELATIVE_TOLERANCE * (reading.area / reading.comparisonArea)
    checks.push(
      check(
        'contact_force_invariant',
        'constraint',
        Math.abs(fromLoaded - reading.force) <=
          PRESSURE_RELATIVE_TOLERANCE * Math.max(reading.force, 1) && ratioHolds,
        {
          message:
            '压力与压强的关系：两个受力面上的 F = p·S 相同，且压强与受力面积成反比 —— 面积变成几分之一，压强就变成几倍。',
          targetId: model.benchId,
          details: {
            force: reading.force,
            pressure: reading.pressure,
            area: reading.area,
            comparisonArea: reading.comparisonArea,
            comparisonPressure: reading.comparisonPressure,
          },
        },
      ),
    )
    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  if (model.type === 'liquid') {
    const reading = liquidPressureOf(model)
    /* dp/dh = ρg is the differential law; p = ρgh is its solution for uniform
       density. Integrating the gradient down to the probe must reproduce the
       product, so a missing g or a missing density cannot satisfy both. */
    const integrated = hydrostaticPressureByIntegration(
      reading.liquidDensity,
      model.gravity,
      reading.depth,
    )
    checks.push(
      check(
        'hydrostatic_gradient_integral',
        'constraint',
        Math.abs(integrated - reading.pressure) <=
          PRESSURE_RELATIVE_TOLERANCE * Math.max(reading.pressure, 1),
        {
          message: '静水压强：由 dp/dh = ρg 沿深度积分所得压强与 p = ρgh 一致。',
          targetId: model.benchId,
          details: {
            fromProduct: reading.pressure,
            fromIntegral: integrated,
            depth: reading.depth,
          },
        },
      ),
    )

    if (reading.comparisonDepth !== undefined && reading.comparisonDepthPressure !== undefined) {
      /* The depth dependence the experiment exists to show: doubling the depth
         doubles the pressure above the surface. Checked at a genuinely
         different depth rather than by re-reading the same product. */
      const doubled = liquidPressureOf({ ...model, depth: reading.comparisonDepth })
      checks.push(
        check(
          'pressure_proportional_to_depth',
          'constraint',
          reading.depth > 0 &&
            reading.comparisonDepth > reading.depth &&
            Math.abs(
              reading.comparisonDepthPressure / reading.pressure -
                reading.comparisonDepth / reading.depth,
            ) <=
              PRESSURE_RELATIVE_TOLERANCE * (reading.comparisonDepth / reading.depth) &&
            Math.abs(doubled.pressure - reading.comparisonDepthPressure) <=
              PRESSURE_RELATIVE_TOLERANCE * Math.max(reading.comparisonDepthPressure, 1),
          {
            message: '压强与深度成正比：同种液体中深度变为几倍，压强就变为几倍。',
            targetId: model.benchId,
            details: {
              depth: reading.depth,
              comparisonDepth: reading.comparisonDepth,
              pressure: reading.pressure,
              comparisonPressure: reading.comparisonDepthPressure,
            },
          },
        ),
      )
    }

    if (
      reading.comparisonLiquidDensity !== undefined &&
      reading.comparisonLiquidPressure !== undefined
    ) {
      checks.push(
        check(
          'pressure_proportional_to_density',
          'constraint',
          Math.abs(
            reading.comparisonLiquidPressure / reading.pressure -
              reading.comparisonLiquidDensity / reading.liquidDensity,
          ) <=
            PRESSURE_RELATIVE_TOLERANCE * (reading.comparisonLiquidDensity / reading.liquidDensity),
          {
            message: '压强与液体密度成正比：同一深度处换用密度更大的液体，压强按密度之比增大。',
            targetId: model.benchId,
            details: {
              liquidDensity: reading.liquidDensity,
              comparisonLiquidDensity: reading.comparisonLiquidDensity,
              pressure: reading.pressure,
              comparisonPressure: reading.comparisonLiquidPressure,
            },
          },
        ),
      )
    }
    return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
  }

  const reading = atmosphericPressureOf(model)
  /* F = p₀·πr² is the projected-area shortcut. Integrating p·cosθ over the
     curved surface of the hemisphere is a different computation that must land
     on the same number, which is what makes the shortcut safe to use. */
  const integrated = hemisphereForceBySurfaceIntegral(
    reading.atmosphericPressure,
    model.hemisphereRadius,
  )
  checks.push(
    check(
      'hemisphere_projected_force',
      'constraint',
      Math.abs(integrated - reading.hemisphereForce) <=
        PRESSURE_RELATIVE_TOLERANCE * Math.max(reading.hemisphereForce, 1),
      {
        message:
          '马德堡半球的拉力等于大气压乘以半球的投影面积 πr²：沿球面积分 p·cosθ 与 p₀·πr² 一致。',
        targetId: model.benchId,
        details: {
          fromProjectedArea: reading.hemisphereForce,
          fromSurfaceIntegral: integrated,
          radius: model.hemisphereRadius,
        },
      },
    ),
  )

  /* The column height is obtained by dividing p₀ by ρ_Hg·g. Re-deriving p₀ by
     integrating the hydrostatic gradient from the vacuum at the top of the tube
     down to the free surface is the arithmetic run backwards, so a unit slip in
     either the column or the pressure cannot pass both. */
  const fromColumn = hydrostaticPressureByIntegration(
    model.barometerFluidDensity,
    model.gravity,
    reading.columnHeight,
  )
  checks.push(
    check(
      'barometer_column_balance',
      'constraint',
      Math.abs(fromColumn - reading.atmosphericPressure) <=
        PRESSURE_RELATIVE_TOLERANCE * reading.atmosphericPressure,
      {
        message: '托里拆利管平衡：管内真空到液面的汞柱自重压强 ρ_汞·g·h 恰好等于大气压 p₀。',
        targetId: model.benchId,
        details: {
          atmosphericPressure: reading.atmosphericPressure,
          columnHeight: reading.columnHeight,
          fromColumn,
        },
      },
    ),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createPressureSimulationRequest(
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

/* ----------------------------------------------------------- the engine -- */

const modelNameOf = (type: ResolvedPressureModel['type']): string =>
  type === 'solid'
    ? SOLID_PRESSURE_MODEL
    : type === 'liquid'
      ? LIQUID_PRESSURE_MODEL
      : ATMOSPHERIC_PRESSURE_MODEL

export class PressureEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = PRESSURE_ENGINE_ID
  readonly engineVersion = PRESSURE_ENGINE_VERSION
  readonly domain = 'mechanics' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (pressureBenchesOf(scene).length !== 1) {
      return unsupportedModel(
        [failure('single_bench', 'Pressure Engine requires exactly one pressure bench.')],
        PRESSURE_ENGINE_ID,
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
      (scene.inductionBenches ?? []).length > 0 ||
      (scene.waveBenches ?? []).length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_pressure_scene',
            'Pressure Engine models pure pressure benches without motion objects, fields, circuits, optics or other benches.',
          ),
        ],
        PRESSURE_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(PRESSURE_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        PRESSURE_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    try {
      const model = resolvePressureModel(scene)
      return supported(modelNameOf(model.type), this.domain)
    } catch (error: unknown) {
      return invalidModelCondition(PRESSURE_ENGINE_ID, [
        failure(
          'pressure_model_resolvable',
          error instanceof Error ? error.message : 'The bench cannot be resolved for pressure.',
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
    return stateOf(resolvePressureModel(scene), timeSeconds)
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
    const model = resolvePressureModel(scene)

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      /* One state, because nothing about this apparatus depends on the clock.
         A trajectory longer than a single instant would be an invented curve. */
      states: [stateOf(model, 0)],
      events: [
        {
          eventId: asPhysicsEventId(`event-pressure-settled-${model.benchId}`),
          sceneId: scene.id,
          revision: scene.revision,
          type: 'PressureReadingSettled',
          time: 0,
        },
      ],
      measurements: [],
      derivedQuantities: derivedOf(model),
      verification: buildVerification(scene, model),
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'pressure-closed-form',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const pressureEngine = new PressureEngine()
