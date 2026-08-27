import { canonicalValue } from '@physicsos/physics-units'
import { thermalBenchesOf, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of a constant-power heating bench. Temperatures are in
 * kelvin throughout; the UI converts to °C at its own boundary.
 */
export interface ResolvedThermalModel {
  readonly benchId: string
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
  /** Temperature at t = 0 (K), below the melting point. */
  readonly initialTemperature: number
  /** Heater power (W), > 0. */
  readonly heaterPower: number
  /** True when the sample has a fixed melting point (latent heat > 0). */
  readonly crystalline: boolean
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
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
  const sample = bench.sample

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
  const heaterPower = positiveOrThrow(
    canonicalValue(bench.heaterPower),
    'THERMAL_HEATER_POWER',
    'Heater power must be finite and > 0.',
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
  if (initialTemperature >= meltingPoint) {
    throw modelError(
      'THERMAL_ALREADY_MELTED',
      'The sample must start below its melting point so there is a solid phase to heat.',
    )
  }

  return {
    benchId: bench.id,
    sampleId: sample.id,
    mass,
    solidSpecificHeat,
    liquidSpecificHeat,
    latentHeat,
    meltingPoint,
    initialTemperature,
    heaterPower,
    crystalline: latentHeat > 0,
  }
}
