import {
  pressureBenchesOf,
  type PhysicsScene,
  type PressureBench,
} from '@physicsos/physics-scene'
import { canonicalValue, type Quantity } from '@physicsos/physics-units'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of a pressure rig. Which fields exist depends on the
 * sub-model: a solid rig resolves a force and two contact areas, a liquid rig a
 * density and two depths, an atmospheric rig the pressure and the two instrument
 * geometries. Keeping the union tagged means the closed-form solvers below
 * cannot read a field the bench's own type never carried.
 */
export type ResolvedPressureModel =
  | {
    readonly benchId: string
    readonly type: 'solid'
    /** Gravitational field strength (m/s²), > 0. */
    readonly gravity: number
    /** Perpendicular force on the contact face (N), ≥ 0. */
    readonly force: number
    /** Loaded contact area (m²), > 0. */
    readonly area: number
    /** The same force on another face (m²), > 0; absent when not authored. */
    readonly comparisonArea: number | undefined
  }
  | {
    readonly benchId: string
    readonly type: 'liquid'
    readonly gravity: number
    /** Density of the probed liquid (kg/m³), > 0. */
    readonly liquidDensity: number
    /** Probe depth below the surface (m), ≥ 0. */
    readonly depth: number
    /** Second probe depth in the same liquid (m), ≥ 0; absent when not authored. */
    readonly comparisonDepth: number | undefined
    /** A second liquid probed at `depth` (kg/m³), > 0; absent when not authored. */
    readonly comparisonLiquidDensity: number | undefined
  }
  | {
    readonly benchId: string
    readonly type: 'atmospheric'
    readonly gravity: number
    /** Atmospheric pressure both instruments read (Pa), > 0. */
    readonly atmosphericPressure: number
    /** Density of the barometer fluid (kg/m³), > 0. */
    readonly barometerFluidDensity: number
    /** Radius of each Magdeburg hemisphere (m), > 0. */
    readonly hemisphereRadius: number
  }

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const nonNegativeOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value < 0) throw modelError(code, message)
  return value
}

/**
 * A quantity the sub-model cannot run without. Absent means the bench was
 * authored for a different sub-model, which is a structural fault rather than a
 * value to default — a made-up area would produce a confident wrong reading.
 */
const requiredOrThrow = (
  value: Quantity<'force'> | Quantity<'area'> | Quantity<'density'> | Quantity<'length'> | Quantity<'acceleration'> | Quantity<'pressure'> | undefined,
  code: string,
  message: string,
): number => {
  if (value === undefined) throw modelError(code, message)
  return canonicalValue(value)
}

const optional = (
  value: Quantity<'area'> | Quantity<'density'> | Quantity<'length'> | undefined,
): number | undefined => (value === undefined ? undefined : canonicalValue(value))

const gravityOfOrThrow = (bench: PressureBench, code: string): number =>
  positiveOrThrow(
    requiredOrThrow(bench.gravity, code, 'Pressure bench needs a positive gravitational field strength.'),
    code,
    'Pressure bench needs a positive gravitational field strength.',
  )

const resolveSolid = (bench: PressureBench): ResolvedPressureModel => {
  const gravity = gravityOfOrThrow(bench, 'PRESSURE_GRAVITY')
  const force = nonNegativeOrThrow(
    requiredOrThrow(bench.force, 'PRESSURE_FORCE', 'Solid pressure bench needs a force ≥ 0.'),
    'PRESSURE_FORCE',
    'Solid pressure bench needs a force ≥ 0.',
  )
  const area = positiveOrThrow(
    requiredOrThrow(bench.area, 'PRESSURE_AREA', 'Solid pressure bench needs a contact area > 0.'),
    'PRESSURE_AREA',
    'Solid pressure bench needs a contact area > 0.',
  )
  const comparisonArea = optional(bench.comparisonArea)
  if (comparisonArea !== undefined && (!Number.isFinite(comparisonArea) || comparisonArea <= 0)) {
    throw modelError('PRESSURE_COMPARISON_AREA', 'The comparison contact area must be > 0.')
  }
  return { benchId: bench.id, type: 'solid', gravity, force, area, comparisonArea }
}

const resolveLiquid = (bench: PressureBench): ResolvedPressureModel => {
  const gravity = gravityOfOrThrow(bench, 'PRESSURE_GRAVITY')
  const liquidDensity = positiveOrThrow(
    requiredOrThrow(
      bench.liquidDensity,
      'PRESSURE_LIQUID_DENSITY',
      'Liquid pressure bench needs a liquid density > 0.',
    ),
    'PRESSURE_LIQUID_DENSITY',
    'Liquid pressure bench needs a liquid density > 0.',
  )
  const depth = nonNegativeOrThrow(
    requiredOrThrow(bench.depth, 'PRESSURE_DEPTH', 'Liquid pressure bench needs a probe depth ≥ 0.'),
    'PRESSURE_DEPTH',
    'Liquid pressure bench needs a probe depth ≥ 0.',
  )
  const comparisonDepth = optional(bench.comparisonDepth)
  if (comparisonDepth !== undefined && (!Number.isFinite(comparisonDepth) || comparisonDepth < 0)) {
    throw modelError('PRESSURE_COMPARISON_DEPTH', 'The comparison depth must be ≥ 0.')
  }
  const comparisonLiquidDensity = optional(bench.comparisonLiquidDensity)
  if (
    comparisonLiquidDensity !== undefined &&
    (!Number.isFinite(comparisonLiquidDensity) || comparisonLiquidDensity <= 0)
  ) {
    throw modelError(
      'PRESSURE_COMPARISON_LIQUID_DENSITY',
      'The comparison liquid density must be > 0.',
    )
  }
  return {
    benchId: bench.id,
    type: 'liquid',
    gravity,
    liquidDensity,
    depth,
    comparisonDepth,
    comparisonLiquidDensity,
  }
}

const resolveAtmospheric = (bench: PressureBench): ResolvedPressureModel => {
  const gravity = gravityOfOrThrow(bench, 'PRESSURE_GRAVITY')
  const atmosphericPressure = positiveOrThrow(
    requiredOrThrow(
      bench.atmosphericPressure,
      'PRESSURE_ATMOSPHERIC',
      'Atmospheric bench needs an atmospheric pressure > 0.',
    ),
    'PRESSURE_ATMOSPHERIC',
    'Atmospheric bench needs an atmospheric pressure > 0.',
  )
  const barometerFluidDensity = positiveOrThrow(
    requiredOrThrow(
      bench.barometerFluidDensity,
      'PRESSURE_BAROMETER_FLUID',
      'Atmospheric bench needs a barometer fluid density > 0.',
    ),
    'PRESSURE_BAROMETER_FLUID',
    'Atmospheric bench needs a barometer fluid density > 0.',
  )
  const hemisphereRadius = positiveOrThrow(
    requiredOrThrow(
      bench.hemisphereRadius,
      'PRESSURE_HEMISPHERE_RADIUS',
      'Atmospheric bench needs a hemisphere radius > 0.',
    ),
    'PRESSURE_HEMISPHERE_RADIUS',
    'Atmospheric bench needs a hemisphere radius > 0.',
  )
  return {
    benchId: bench.id,
    type: 'atmospheric',
    gravity,
    atmosphericPressure,
    barometerFluidDensity,
    hemisphereRadius,
  }
}

/**
 * Resolve the scene's pressure bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a bench the model cannot honour.
 */
export const resolvePressureModel = (scene: PhysicsScene): ResolvedPressureModel => {
  const benches = pressureBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('PRESSURE_SINGLE_BENCH', 'Pressure Engine requires exactly one bench.')
  }
  if (bench.type === 'solid') return resolveSolid(bench)
  if (bench.type === 'liquid') return resolveLiquid(bench)
  return resolveAtmospheric(bench)
}
