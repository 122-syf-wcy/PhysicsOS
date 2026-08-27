import { canonicalValue } from '@physicsos/physics-units'
import {
  thermalBenchesOf,
  type PhysicsScene,
  type ThermalSample,
} from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of one sample on a constant-power heating bench.
 * Temperatures are in kelvin throughout; the UI converts to °C at its own
 * boundary.
 */
export interface ResolvedThermalSample {
  readonly sampleId: string
  /** Sample mass (kg), > 0. */
  readonly mass: number
  /** Specific heat below the melting point (J/(kg·K)), > 0. */
  readonly solidSpecificHeat: number
  /** Specific heat above the melting point (J/(kg·K)), > 0. */
  readonly liquidSpecificHeat: number
  /** Latent heat of fusion (J/kg), ≥ 0; zero means an amorphous sample. */
  readonly latentHeat: number
  /** Melting point (K). */
  readonly meltingPoint: number
  /** Temperature at t = 0 (K). */
  readonly initialTemperature: number
  /** True when the sample has a fixed melting point (latent heat > 0). */
  readonly crystalline: boolean
  /**
   * True when the sample starts at or above its melting point — already liquid,
   * so the run is a single warming segment. That is how a water-versus-oil
   * comparison is stated.
   */
  readonly startsMolten: boolean
}

/**
 * Canonical (SI) view of a constant-power heating bench. The primary sample's
 * fields sit on the model itself so the existing single-sample solvers keep
 * working; a comparison sample, when present, is heated by the same power
 * alongside it.
 */
export interface ResolvedThermalModel extends ResolvedThermalSample {
  readonly benchId: string
  /** Heater power delivered to EACH sample (W), > 0. */
  readonly heaterPower: number
  /**
   * How long the heater is left on (s). Required for an already-liquid run,
   * which has no melting plateau to stop at; omitted for a melting run, whose
   * length the engine derives.
   */
  readonly runDuration?: number
  readonly comparisonSample?: ResolvedThermalSample
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const resolveSample = (sample: ThermalSample): ResolvedThermalSample => {
  const mass = positiveOrThrow(
    canonicalValue(sample.mass),
    'THERMAL_SAMPLE_MASS',
    'Sample mass must be finite and > 0.',
  )
  const solidSpecificHeat = positiveOrThrow(
    canonicalValue(sample.solidSpecificHeat),
    'THERMAL_SOLID_SPECIFIC_HEAT',
    'Solid specific heat must be finite and > 0.',
  )
  const liquidSpecificHeat = positiveOrThrow(
    canonicalValue(sample.liquidSpecificHeat),
    'THERMAL_LIQUID_SPECIFIC_HEAT',
    'Liquid specific heat must be finite and > 0.',
  )

  const latentHeat = canonicalValue(sample.latentHeat)
  if (!Number.isFinite(latentHeat) || latentHeat < 0) {
    throw modelError('THERMAL_LATENT_HEAT', 'Latent heat must be finite and ≥ 0.')
  }

  const meltingPoint = canonicalValue(sample.meltingPoint)
  const initialTemperature = canonicalValue(sample.initialTemperature)
  if (!Number.isFinite(meltingPoint) || !Number.isFinite(initialTemperature)) {
    throw modelError('THERMAL_TEMPERATURES', 'Temperatures must be finite.')
  }

  return {
    sampleId: sample.id,
    mass,
    solidSpecificHeat,
    liquidSpecificHeat,
    latentHeat,
    meltingPoint,
    initialTemperature,
    crystalline: latentHeat > 0,
    startsMolten: initialTemperature >= meltingPoint,
  }
}

/**
 * Resolve the scene's thermal bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a scene the model cannot honour.
 */
export const resolveThermalModel = (scene: PhysicsScene): ResolvedThermalModel => {
  const benches = thermalBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('THERMAL_SINGLE_BENCH', 'Thermal Engine requires exactly one heating bench.')
  }

  const heaterPower = positiveOrThrow(
    canonicalValue(bench.heaterPower),
    'THERMAL_HEATER_POWER',
    'Heater power must be finite and > 0.',
  )

  const runDuration = bench.runDuration === undefined
    ? undefined
    : positiveOrThrow(
      canonicalValue(bench.runDuration),
      'THERMAL_RUN_DURATION',
      'Run duration must be finite and > 0.',
    )

  const sample = resolveSample(bench.sample)
  const comparisonSample = bench.comparisonSample === undefined
    ? undefined
    : resolveSample(bench.comparisonSample)

  const needsDuration = sample.startsMolten || comparisonSample?.startsMolten === true
  if (needsDuration && runDuration === undefined) {
    throw modelError(
      'THERMAL_RUN_DURATION',
      'An already-liquid sample needs a run duration; there is no melting plateau to stop at.',
    )
  }

  return {
    benchId: bench.id,
    heaterPower,
    ...sample,
    ...(runDuration === undefined ? {} : { runDuration }),
    ...(comparisonSample === undefined ? {} : { comparisonSample }),
  }
}
