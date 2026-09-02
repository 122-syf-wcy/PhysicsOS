import { canonicalValue } from '@physicsos/physics-units'
import { waveBenchesOf, type PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * The three closed-form wave sub-models this engine solves.
 *
 * - `travelling_wave`: one sinusoidal wave running along a rope,
 *   y(x, t) = A·sin(2π(x/λ − f·t)); v = λf and T = 1/f.
 * - `wave_interference`: two coherent, equal-amplitude sources; the path
 *   difference Δ = |r₂ − r₁| at the observation point decides constructive
 *   (Δ = nλ) or destructive (Δ = (n + ½)λ) superposition.
 * - `standing_wave`: a string clamped at both ends in its n-th harmonic,
 *   L = n·λ/2, f_n = n·v/(2L), y(x, t) = A·sin(nπx/L)·cos(2πf_n·t).
 */
export type WaveSubModel = 'travelling_wave' | 'wave_interference' | 'standing_wave'

/**
 * Canonical (SI) view of a wave bench. Every value is finite and in SI: metres,
 * hertz, metres per second. Amplitude is stored in metres even though the bench
 * authors it in centimetres, so the displacement samples and the amplitude live
 * in one unit system.
 *
 * `wavelength`, `frequency` and `waveSpeed` are always populated, whichever of
 * them the bench authored — the model is where the missing member of v = λf is
 * derived exactly once.
 */
export interface ResolvedWaveModel {
  readonly benchId: string
  readonly subModel: WaveSubModel
  /** Peak displacement A (m), > 0. */
  readonly amplitude: number
  /** Wavelength λ (m), > 0. */
  readonly wavelength: number
  /** Frequency f (Hz), > 0. */
  readonly frequency: number
  /** Propagation speed v = λf (m/s), > 0. */
  readonly waveSpeed: number
  /* ------------------------------------------------------------ travelling -- */
  /** Length of rope drawn (m), > 0; travelling only. */
  readonly ropeLength?: number
  /* ---------------------------------------------------------- interference -- */
  /** Separation between the two coherent sources (m), > 0. */
  readonly sourceSeparation?: number
  /** Distance from source 1 to the observation point (m), > 0. */
  readonly pathOne?: number
  /** Distance from source 2 to the observation point (m), > 0. */
  readonly pathTwo?: number
  /* -------------------------------------------------------------- standing -- */
  /** Length of the clamped string L (m), > 0. */
  readonly stringLength?: number
  /** Harmonic number n ≥ 1 (integral). */
  readonly harmonic?: number
}

const modelError = (code: string, message: string): PhysicsOSError =>
  new PhysicsOSError(code, message)

const positiveOrThrow = (value: number, code: string, message: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw modelError(code, message)
  return value
}

/**
 * Resolve the scene's wave bench into canonical SI numbers. Throws
 * `PhysicsOSError` on structural violations; `canHandle` converts those into
 * model-support failures instead of solving a scene the model cannot honour.
 */
export const resolveWaveModel = (scene: PhysicsScene): ResolvedWaveModel => {
  const benches = waveBenchesOf(scene)
  const bench = benches[0]
  if (bench === undefined || benches.length !== 1) {
    throw modelError('WAVE_SINGLE_BENCH', 'Wave Engine requires exactly one wave bench.')
  }

  const amplitude = positiveOrThrow(
    canonicalValue(bench.amplitude),
    'WAVE_AMPLITUDE',
    'Wave amplitude must be finite and > 0.',
  )

  if (bench.type === 'standing') {
    if (bench.stringLength === undefined) {
      throw modelError('WAVE_STRING_LENGTH', 'String length must be defined for a standing bench.')
    }
    if (bench.harmonic === undefined) {
      throw modelError('WAVE_HARMONIC', 'Harmonic number must be defined for a standing bench.')
    }
    if (bench.waveSpeed === undefined) {
      throw modelError('WAVE_SPEED', 'Wave speed must be defined for a standing bench.')
    }
    const stringLength = positiveOrThrow(
      canonicalValue(bench.stringLength),
      'WAVE_STRING_LENGTH',
      'String length must be finite and > 0.',
    )
    const harmonic = bench.harmonic
    if (!Number.isInteger(harmonic) || harmonic < 1) {
      throw modelError('WAVE_HARMONIC', 'Harmonic number must be an integer ≥ 1.')
    }
    const waveSpeed = positiveOrThrow(
      canonicalValue(bench.waveSpeed),
      'WAVE_SPEED',
      'Wave speed must be finite and > 0.',
    )
    /* L = n·λ/2 and v = λf are the two facts; λ and f follow, never the reverse. */
    const wavelength = (2 * stringLength) / harmonic
    const frequency = waveSpeed / wavelength
    return {
      benchId: bench.id,
      subModel: 'standing_wave',
      amplitude,
      wavelength,
      frequency,
      waveSpeed,
      stringLength,
      harmonic,
    }
  }

  if (bench.wavelength === undefined) {
    throw modelError(
      'WAVE_WAVELENGTH',
      `Wavelength must be defined for a ${bench.type} bench.`,
    )
  }
  const wavelength = positiveOrThrow(
    canonicalValue(bench.wavelength),
    'WAVE_WAVELENGTH',
    'Wavelength must be finite and > 0.',
  )
  const frequency = positiveOrThrow(
    canonicalValue(bench.frequency),
    'WAVE_FREQUENCY',
    'Frequency must be finite and > 0.',
  )
  const waveSpeed = wavelength * frequency

  if (bench.type === 'interference') {
    if (bench.sourceSeparation === undefined) {
      throw modelError(
        'WAVE_SOURCE_SEPARATION',
        'Source separation must be defined for an interference bench.',
      )
    }
    if (bench.pathOne === undefined || bench.pathTwo === undefined) {
      throw modelError(
        'WAVE_PATHS',
        'Both path lengths must be defined for an interference bench.',
      )
    }
    return {
      benchId: bench.id,
      subModel: 'wave_interference',
      amplitude,
      wavelength,
      frequency,
      waveSpeed,
      sourceSeparation: positiveOrThrow(
        canonicalValue(bench.sourceSeparation),
        'WAVE_SOURCE_SEPARATION',
        'Source separation must be finite and > 0.',
      ),
      pathOne: positiveOrThrow(
        canonicalValue(bench.pathOne),
        'WAVE_PATHS',
        'Path length r₁ must be finite and > 0.',
      ),
      pathTwo: positiveOrThrow(
        canonicalValue(bench.pathTwo),
        'WAVE_PATHS',
        'Path length r₂ must be finite and > 0.',
      ),
    }
  }

  /* travelling */
  const ropeLength =
    bench.ropeLength === undefined
      ? wavelength * 3
      : positiveOrThrow(
          canonicalValue(bench.ropeLength),
          'WAVE_ROPE_LENGTH',
          'Rope length must be finite and > 0.',
        )
  return {
    benchId: bench.id,
    subModel: 'travelling_wave',
    amplitude,
    wavelength,
    frequency,
    waveSpeed,
    ropeLength,
  }
}

/* ------------------------------------------------------------ closed forms -- */

/** Travelling wave displacement y(x, t) = A·sin(2π(x/λ − f·t)). */
export const travellingDisplacement = (
  model: ResolvedWaveModel,
  x: number,
  t: number,
): number =>
  model.amplitude * Math.sin(2 * Math.PI * (x / model.wavelength - model.frequency * t))

/** Transverse velocity ∂y/∂t of the rope at (x, t) for a travelling wave. */
export const travellingTransverseVelocity = (
  model: ResolvedWaveModel,
  x: number,
  t: number,
): number =>
  -2 *
  Math.PI *
  model.frequency *
  model.amplitude *
  Math.cos(2 * Math.PI * (x / model.wavelength - model.frequency * t))

/** Standing wave displacement y(x, t) = A·sin(nπx/L)·cos(2πf·t). */
export const standingDisplacement = (model: ResolvedWaveModel, x: number, t: number): number => {
  const stringLength = model.stringLength ?? 0
  const harmonic = model.harmonic ?? 1
  return (
    model.amplitude *
    Math.sin((harmonic * Math.PI * x) / stringLength) *
    Math.cos(2 * Math.PI * model.frequency * t)
  )
}

/** Path difference Δ = |r₂ − r₁| of an interference model (m). */
export const pathDifferenceOf = (model: ResolvedWaveModel): number =>
  Math.abs((model.pathTwo ?? 0) - (model.pathOne ?? 0))

/**
 * Resultant amplitude at the observation point for two equal-amplitude
 * coherent sources: A_P = |2A·cos(πΔ/λ)|. The 1/r fall-off is deliberately
 * ignored — the textbook rule is stated for equal amplitudes at P.
 */
export const resultantAmplitudeOf = (model: ResolvedWaveModel): number =>
  Math.abs(2 * model.amplitude * Math.cos((Math.PI * pathDifferenceOf(model)) / model.wavelength))

export type InterferenceVerdict = 'constructive' | 'destructive' | 'partial'

/**
 * Classify Δ/λ: an integer means the two waves arrive in phase (加强), a
 * half-integer means anti-phase (减弱), anything else is a partial sum. The
 * tolerance is on the fractional part so a stated Δ = 0.4 m with λ = 0.2 m does
 * not fall through on floating-point noise.
 */
export const interferenceVerdictOf = (
  model: ResolvedWaveModel,
  tolerance = 1e-9,
): InterferenceVerdict => {
  const ratio = pathDifferenceOf(model) / model.wavelength
  const fractional = ratio - Math.floor(ratio)
  if (fractional <= tolerance || 1 - fractional <= tolerance) return 'constructive'
  if (Math.abs(fractional - 0.5) <= tolerance) return 'destructive'
  return 'partial'
}

/** Displacement at the observation point P of an interference model at time t. */
export const interferenceDisplacementAt = (model: ResolvedWaveModel, t: number): number => {
  const pathOne = model.pathOne ?? 0
  const pathTwo = model.pathTwo ?? 0
  const phase = (r: number) => 2 * Math.PI * (model.frequency * t - r / model.wavelength)
  return model.amplitude * (Math.sin(phase(pathOne)) + Math.sin(phase(pathTwo)))
}

/** Node positions x_m = m·L/n, m = 0..n, of a standing wave (m). */
export const nodePositionsOf = (model: ResolvedWaveModel): number[] => {
  const stringLength = model.stringLength ?? 0
  const harmonic = model.harmonic ?? 1
  return Array.from({ length: harmonic + 1 }, (_, index) => (index * stringLength) / harmonic)
}

/** Antinode positions x_m = (m + ½)·L/n, m = 0..n−1, of a standing wave (m). */
export const antinodePositionsOf = (model: ResolvedWaveModel): number[] => {
  const stringLength = model.stringLength ?? 0
  const harmonic = model.harmonic ?? 1
  return Array.from({ length: harmonic }, (_, index) => ((index + 0.5) * stringLength) / harmonic)
}
