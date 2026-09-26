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
export type WaveSubModel =
  | 'travelling_wave'
  | 'wave_interference'
  | 'standing_wave'
  | 'longitudinal_wave'
  | 'reflection_refraction'
  | 'wave_diffraction'
  | 'wave_doppler'

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
  /* ------------------------------------------------------- longitudinal -- */
  /** Drawn length of the medium (m), > 0. */
  readonly mediumLength?: number
  /* ------------------------------------------------ reflection / refraction -- */
  /** Incident speed (m/s), > 0. */
  readonly incidentSpeed?: number
  /** Speed beyond the boundary (m/s), > 0. */
  readonly transmittedWaveSpeed?: number
  /** Angle of incidence from the normal (rad). */
  readonly incidentAngleRad?: number
  /** Angle of refraction from the normal (rad), absent above the critical angle. */
  readonly refractedAngleRad?: number
  /** Critical angle (rad), present only for transmission into a faster medium. */
  readonly criticalAngleRad?: number
  /* --------------------------------------------------------- diffraction -- */
  /** Slit width (m), > 0. */
  readonly slitWidth?: number
  /** Slit-to-screen distance (m), > 0. */
  readonly screenDistance?: number
  /** Reported diffraction order m >= 1. */
  readonly diffractionOrder?: number
  /** Central maximum width on the screen (m), > 0. */
  readonly centralMaximumWidth?: number
  /* ------------------------------------------------------------ Doppler -- */
  /** Source speed along the source-observer line (m/s), >= 0 and < v. */
  readonly sourceSpeed?: number
  /** Observer speed along the source-observer line (m/s), >= 0. */
  readonly observerSpeed?: number
  readonly sourceDirection?: 'approaching' | 'receding'
  readonly observerDirection?: 'approaching' | 'receding' | 'stationary'
  /** Observed frequency (Hz), derived from the signed motion. */
  readonly observedFrequency?: number
  /** Wavelength in the medium launched towards the observer (m), > 0. */
  readonly observedWavelength?: number
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

  const frequency = positiveOrThrow(
    canonicalValue(bench.frequency),
    'WAVE_FREQUENCY',
    'Wave frequency must be finite and > 0.',
  )

  if (bench.type === 'reflection_refraction') {
    if (
      bench.incidentSpeed === undefined ||
      bench.transmittedWaveSpeed === undefined ||
      bench.incidentAngle === undefined
    ) {
      throw modelError(
        'WAVE_BOUNDARY_GEOMETRY',
        'Reflection/refraction requires incident speed, transmitted speed and incident angle.',
      )
    }
    const incidentSpeed = positiveOrThrow(
      canonicalValue(bench.incidentSpeed),
      'WAVE_INCIDENT_SPEED',
      'Incident wave speed must be finite and > 0.',
    )
    const transmittedWaveSpeed = positiveOrThrow(
      canonicalValue(bench.transmittedWaveSpeed),
      'WAVE_TRANSMITTED_SPEED',
      'Transmitted wave speed must be finite and > 0.',
    )
    const incidentAngleRad = canonicalValue(bench.incidentAngle)
    if (
      !Number.isFinite(incidentAngleRad) ||
      incidentAngleRad < 0 ||
      incidentAngleRad >= Math.PI / 2
    ) {
      throw modelError('WAVE_INCIDENT_ANGLE', 'Incident angle must lie in [0, π/2).')
    }
    const ratio = (transmittedWaveSpeed / incidentSpeed) * Math.sin(incidentAngleRad)
    const criticalAngleRad =
      transmittedWaveSpeed > incidentSpeed
        ? Math.asin(incidentSpeed / transmittedWaveSpeed)
        : undefined
    return {
      benchId: bench.id,
      subModel: 'reflection_refraction',
      amplitude,
      wavelength: incidentSpeed / frequency,
      frequency,
      waveSpeed: incidentSpeed,
      incidentSpeed,
      transmittedWaveSpeed,
      incidentAngleRad,
      ...(ratio <= 1 ? { refractedAngleRad: Math.asin(Math.min(1, ratio)) } : {}),
      ...(criticalAngleRad === undefined ? {} : { criticalAngleRad }),
    }
  }

  if (bench.type === 'doppler') {
    if (
      bench.waveSpeed === undefined ||
      bench.sourceSpeed === undefined ||
      bench.observerSpeed === undefined ||
      bench.sourceDirection === undefined ||
      bench.observerDirection === undefined
    ) {
      throw modelError(
        'WAVE_DOPPLER_GEOMETRY',
        'Doppler model requires wave, source and observer speeds plus both motion directions.',
      )
    }
    const waveSpeed = positiveOrThrow(
      canonicalValue(bench.waveSpeed),
      'WAVE_SPEED',
      'Wave speed must be finite and > 0.',
    )
    const sourceSpeed = canonicalValue(bench.sourceSpeed)
    const observerSpeed = canonicalValue(bench.observerSpeed)
    if (!Number.isFinite(sourceSpeed) || sourceSpeed < 0 || sourceSpeed >= waveSpeed) {
      throw modelError(
        'WAVE_DOPPLER_SOURCE_SPEED',
        'Doppler source speed must be finite and satisfy 0 <= vs < v.',
      )
    }
    if (!Number.isFinite(observerSpeed) || observerSpeed < 0) {
      throw modelError('WAVE_DOPPLER_OBSERVER_SPEED', 'Observer speed must be finite and >= 0.')
    }
    const signedSourceSpeed = bench.sourceDirection === 'approaching' ? sourceSpeed : -sourceSpeed
    const signedObserverSpeed =
      bench.observerDirection === 'approaching'
        ? observerSpeed
        : bench.observerDirection === 'receding'
          ? -observerSpeed
          : 0
    const observedFrequency =
      (frequency * (waveSpeed + signedObserverSpeed)) / (waveSpeed - signedSourceSpeed)
    const observedWavelength = (waveSpeed - signedSourceSpeed) / frequency
    return {
      benchId: bench.id,
      subModel: 'wave_doppler',
      amplitude,
      wavelength: waveSpeed / frequency,
      frequency,
      waveSpeed,
      sourceSpeed,
      observerSpeed,
      sourceDirection: bench.sourceDirection,
      observerDirection: bench.observerDirection,
      observedFrequency,
      observedWavelength,
    }
  }

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
    throw modelError('WAVE_WAVELENGTH', `Wavelength must be defined for a ${bench.type} bench.`)
  }
  const wavelength = positiveOrThrow(
    canonicalValue(bench.wavelength),
    'WAVE_WAVELENGTH',
    'Wavelength must be finite and > 0.',
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
      throw modelError('WAVE_PATHS', 'Both path lengths must be defined for an interference bench.')
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

  if (bench.type === 'longitudinal') {
    const mediumLength =
      bench.mediumLength === undefined
        ? wavelength * 3
        : positiveOrThrow(
            canonicalValue(bench.mediumLength),
            'WAVE_MEDIUM_LENGTH',
            'Medium length must be finite and > 0.',
          )
    return {
      benchId: bench.id,
      subModel: 'longitudinal_wave',
      amplitude,
      wavelength,
      frequency,
      waveSpeed,
      mediumLength,
    }
  }

  if (bench.type === 'diffraction') {
    if (bench.slitWidth === undefined || bench.screenDistance === undefined) {
      throw modelError(
        'WAVE_DIFFRACTION_GEOMETRY',
        'Diffraction requires slitWidth and screenDistance.',
      )
    }
    const slitWidth = positiveOrThrow(
      canonicalValue(bench.slitWidth),
      'WAVE_SLIT_WIDTH',
      'Slit width must be finite and > 0.',
    )
    const screenDistance = positiveOrThrow(
      canonicalValue(bench.screenDistance),
      'WAVE_SCREEN_DISTANCE',
      'Screen distance must be finite and > 0.',
    )
    const diffractionOrder = bench.diffractionOrder ?? 1
    if (!Number.isInteger(diffractionOrder) || diffractionOrder < 1) {
      throw modelError('WAVE_DIFFRACTION_ORDER', 'Diffraction order must be an integer >= 1.')
    }
    return {
      benchId: bench.id,
      subModel: 'wave_diffraction',
      amplitude,
      wavelength,
      frequency,
      waveSpeed,
      slitWidth,
      screenDistance,
      diffractionOrder,
      centralMaximumWidth: (2 * screenDistance * wavelength) / slitWidth,
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

export interface ReflectionRefractionReading {
  /** Reflection angle in degrees, equal to the incident angle. */
  readonly reflectionAngle: number
  /** Refraction angle in degrees, absent when the refracted branch does not exist. */
  readonly refractedAngle: number | undefined
  /** Critical angle in degrees, present only when entering a faster medium. */
  readonly criticalAngle: number | undefined
  readonly reflectionAngleRad: number
  readonly refractedAngleRad: number | undefined
  readonly criticalAngleRad: number | undefined
  readonly totalInternalReflection: boolean
}

export const reflectionRefractionReadingOf = (
  model: ResolvedWaveModel,
): ReflectionRefractionReading => {
  if (model.subModel !== 'reflection_refraction') {
    throw modelError(
      'WAVE_WRONG_SUBMODEL',
      'Reflection/refraction reading requires a boundary wave model.',
    )
  }
  const degrees = (radians: number): number => (radians * 180) / Math.PI
  return {
    reflectionAngle: degrees(model.incidentAngleRad ?? 0),
    refractedAngle:
      model.refractedAngleRad === undefined ? undefined : degrees(model.refractedAngleRad),
    criticalAngle:
      model.criticalAngleRad === undefined ? undefined : degrees(model.criticalAngleRad),
    reflectionAngleRad: model.incidentAngleRad ?? 0,
    refractedAngleRad: model.refractedAngleRad,
    criticalAngleRad: model.criticalAngleRad,
    totalInternalReflection: model.refractedAngleRad === undefined,
  }
}

/* ------------------------------------------------------------ closed forms -- */

/** Travelling wave displacement y(x, t) = A·sin(2π(x/λ − f·t)). */
export const travellingDisplacement = (model: ResolvedWaveModel, x: number, t: number): number =>
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

/** Longitudinal displacement ξ(x,t) = A·sin(2π(x/λ − f·t)), positive along +x. */
export const longitudinalDisplacementAt = (
  model: ResolvedWaveModel,
  x: number,
  t: number,
): number => model.amplitude * Math.sin(2 * Math.PI * (x / model.wavelength - model.frequency * t))

/** Longitudinal particle velocity ∂ξ/∂t. */
export const longitudinalParticleVelocityAt = (
  model: ResolvedWaveModel,
  x: number,
  t: number,
): number =>
  -2 *
  Math.PI *
  model.frequency *
  model.amplitude *
  Math.cos(2 * Math.PI * (x / model.wavelength - model.frequency * t))

/** Strain ∂ξ/∂x; negative strain is compression and positive strain is rarefaction. */
export const longitudinalStrainAt = (model: ResolvedWaveModel, x: number, t: number): number =>
  ((2 * Math.PI * model.amplitude) / model.wavelength) *
  Math.cos(2 * Math.PI * (x / model.wavelength - model.frequency * t))

export type LongitudinalPressureState = 'compression' | 'rarefaction' | 'equilibrium'

export const longitudinalPressureStateAt = (
  model: ResolvedWaveModel,
  x: number,
  t: number,
): LongitudinalPressureState => {
  const strain = longitudinalStrainAt(model, x, t)
  const tolerance = 1e-12 * ((2 * Math.PI * model.amplitude) / model.wavelength)
  if (Math.abs(strain) <= tolerance) return 'equilibrium'
  return strain < 0 ? 'compression' : 'rarefaction'
}

/** Angle of the m-th single-slit minimum, sinθ = mλ/a (radians). */
export const diffractionMinimumAngle = (model: ResolvedWaveModel, order: number): number => {
  if (model.subModel !== 'wave_diffraction' || model.slitWidth === undefined) {
    throw modelError('WAVE_WRONG_SUBMODEL', 'Diffraction minimum requires a diffraction model.')
  }
  if (!Number.isInteger(order) || order < 1) {
    throw modelError('WAVE_DIFFRACTION_ORDER', 'Diffraction order must be an integer >= 1.')
  }
  const sine = (order * model.wavelength) / model.slitWidth
  if (sine > 1 + 1e-12) {
    throw modelError(
      'WAVE_DIFFRACTION_ORDER_UNAVAILABLE',
      'This diffraction order has no real angle for the stated slit and wavelength.',
    )
  }
  return Math.asin(Math.min(1, sine))
}

/** Normalized single-slit intensity I/I0 = sinc²(πa sinθ/λ). */
export const singleSlitIntensityRatio = (model: ResolvedWaveModel, angleRad: number): number => {
  if (model.subModel !== 'wave_diffraction' || model.slitWidth === undefined) {
    throw modelError('WAVE_WRONG_SUBMODEL', 'Diffraction intensity requires a diffraction model.')
  }
  const beta = (Math.PI * model.slitWidth * Math.sin(angleRad)) / model.wavelength
  if (Math.abs(beta) < 1e-12) return 1
  const sinc = Math.sin(beta) / beta
  return Math.abs(sinc) < 1e-12 ? 0 : sinc * sinc
}

/** Signed source speed: positive when approaching. */
const signedSourceSpeedOf = (model: ResolvedWaveModel): number =>
  model.sourceDirection === 'approaching' ? (model.sourceSpeed ?? 0) : -(model.sourceSpeed ?? 0)

/** Signed observer speed: positive when approaching. */
const signedObserverSpeedOf = (model: ResolvedWaveModel): number => {
  if (model.observerDirection === 'stationary') return 0
  return model.observerDirection === 'approaching'
    ? (model.observerSpeed ?? 0)
    : -(model.observerSpeed ?? 0)
}

/** Observed frequency f′ = f(v + v_o)/(v − v_s), with signed line-of-sight speeds. */
export const dopplerObservedFrequency = (model: ResolvedWaveModel): number => {
  if (model.subModel !== 'wave_doppler') {
    throw modelError('WAVE_WRONG_SUBMODEL', 'Doppler frequency requires a Doppler model.')
  }
  return (
    (model.frequency * (model.waveSpeed + signedObserverSpeedOf(model))) /
    (model.waveSpeed - signedSourceSpeedOf(model))
  )
}

/** Wavelength launched into the medium, λ′ = (v − v_s)/f. */
export const dopplerObservedWavelength = (model: ResolvedWaveModel): number => {
  if (model.subModel !== 'wave_doppler') {
    throw modelError('WAVE_WRONG_SUBMODEL', 'Doppler wavelength requires a Doppler model.')
  }
  return (model.waveSpeed - signedSourceSpeedOf(model)) / model.frequency
}

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
export const resultantAmplitudeOf = (model: ResolvedWaveModel): number => {
  const phaseFactor = Math.cos((Math.PI * pathDifferenceOf(model)) / model.wavelength)
  /* cos(π·(n + ½)) lands at ~1e-16, not 0; a destructive point reports an exact
     zero rather than a floating-point remnant dressed up as an amplitude. */
  const snapped = Math.abs(phaseFactor) < 1e-12 ? 0 : phaseFactor
  return Math.abs(2 * model.amplitude * snapped)
}

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
