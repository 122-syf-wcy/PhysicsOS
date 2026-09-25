import { canonicalValue } from '@physicsos/physics-units'
import {
  thermometerBenchesOf,
  type PhysicsScene,
  type ThermometerBench,
} from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Canonical (SI) view of the instrument: the bulb, the bore, the filling liquid,
 * where the temperature is and where the lower fixed point sits.
 *
 * Every one of them is a fact about the THERMOMETER rather than about the thing
 * being measured — which is what makes this bench different from the heating
 * benches beside it. They ask what the sample does; this one asks how a
 * thermometer is built and why its scale is even.
 */
export interface ResolvedThermometerModel {
  readonly benchId: string
  /** Bulb volume at the lower fixed point (m³), > 0. */
  readonly bulbVolume: number
  /** Bore diameter (m), > 0. */
  readonly boreDiameter: number
  /** Volumetric expansion coefficient of the filling liquid (1/K), > 0. */
  readonly expansionCoefficient: number
  /** Temperature the bulb sits in (K). */
  readonly temperature: number
  /** Column length at the lower fixed point (m), > 0. */
  readonly icePointLength: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

const benchOf = (bench: ThermometerBench): ResolvedThermometerModel => {
  const temperature = canonicalValue(bench.temperature)
  if (!Number.isFinite(temperature)) {
    throw modelError(
      'THERMOMETER_TEMPERATURE',
      `Thermometer bench "${bench.id}" temperature must be finite.`,
    )
  }
  return {
    benchId: bench.id,
    bulbVolume: positiveOrThrow(
      canonicalValue(bench.bulbVolume),
      'THERMOMETER_BULB',
      `Thermometer bench "${bench.id}" bulb volume must be finite and > 0.`,
    ),
    boreDiameter: positiveOrThrow(
      canonicalValue(bench.boreDiameter),
      'THERMOMETER_BORE',
      `Thermometer bench "${bench.id}" bore diameter must be finite and > 0.`,
    ),
    expansionCoefficient: positiveOrThrow(
      canonicalValue(bench.expansionCoefficient),
      'THERMOMETER_EXPANSION',
      `Thermometer bench "${bench.id}" expansion coefficient must be finite and > 0.`,
    ),
    temperature,
    icePointLength: positiveOrThrow(
      canonicalValue(bench.icePointLength),
      'THERMOMETER_ICE_POINT',
      `Thermometer bench "${bench.id}" ice-point length must be finite and > 0.`,
    ),
  }
}

/**
 * Resolve the scene's thermometer into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving an instrument the model cannot honour.
 */
export const resolveThermometerModel = (scene: PhysicsScene): ResolvedThermometerModel => {
  const benches = thermometerBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError(
      'THERMOMETER_SINGLE_BENCH',
      'Thermometer Engine requires exactly one thermometer bench.',
    )
  }
  return benchOf(bench)
}
