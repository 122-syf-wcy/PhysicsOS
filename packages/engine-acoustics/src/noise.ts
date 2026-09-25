/**
 * Sound level: the decibel scale, and what distance does to it.
 *
 * Self-contained physics, kept apart from the engine class the way every other
 * slice keeps its closed forms apart. The whole subject is two logarithms:
 *
 *   L = 10·lg(I / I₀)        the scale the ear actually works on
 *   I = P / (4πr²)           a point source spreading its power over a sphere
 *
 * Combine them and the famous rule falls out:
 *
 *   L(r) = Lw − 20·lg(r) − 10·lg(4π)
 *
 * so **doubling the distance costs 6 dB**, whatever the source is. And because
 * the scale is logarithmic, "6 dB less" is a quarter of the intensity — which
 * is why a barrier does not have to remove all the sound to be worth building.
 */

/** Reference intensity the decibel scale is defined against (W/m²). */
export const REFERENCE_INTENSITY = 1e-12

/** 10·lg(4π) — the constant a point source's level falls by at 1 m (dB). */
export const POINT_SOURCE_SPREADING = 10 * Math.log10(4 * Math.PI)

/**
 * Sound level from intensity: L = 10·lg(I/I₀) (dB).
 *
 * A RATIO of intensities, which is why the result can be negative: an
 * intensity below the reference is a negative decibel reading, not an error.
 */
export const soundLevelFromIntensity = (intensity: number): number =>
  10 * Math.log10(intensity / REFERENCE_INTENSITY)

/** Intensity a sound level corresponds to: I = I₀·10^(L/10) (W/m²). */
export const intensityFromSoundLevel = (level: number): number =>
  REFERENCE_INTENSITY * 10 ** (level / 10)

/**
 * Sound level at a distance from a point source of sound power level `Lw` (dB).
 *
 * The source is rated by its POWER level — what a machine's plate says — and
 * the level at your ear is that minus the spreading, minus whatever a barrier
 * takes out. Each term is a separate fact about the world, so they are separate
 * arguments rather than one pre-mixed number.
 */
export const soundLevelAt = (
  soundPowerLevel: number,
  distance: number,
  barrierAttenuation: number,
): number =>
  soundPowerLevel - 20 * Math.log10(distance) - POINT_SOURCE_SPREADING - barrierAttenuation

/** What a sound-level meter reads at its position. */
export interface NoiseReading {
  readonly soundPowerLevel: number
  readonly distance: number
  readonly barrierAttenuation: number
  /** Level at the meter (dB). */
  readonly level: number
  /** Intensity there (W/m²). */
  readonly intensity: number
  /** Level the same source would give with no barrier (dB) — the control. */
  readonly levelWithoutBarrier: number
  /** What the barrier is worth at this distance (dB) — its own number back. */
  readonly barrierSaving: number
}

export const noiseReadingOf = (
  soundPowerLevel: number,
  distance: number,
  barrierAttenuation: number,
): NoiseReading => {
  const level = soundLevelAt(soundPowerLevel, distance, barrierAttenuation)
  return {
    soundPowerLevel,
    distance,
    barrierAttenuation,
    level,
    intensity: intensityFromSoundLevel(level),
    levelWithoutBarrier: soundLevelAt(soundPowerLevel, distance, 0),
    /* Stated rather than derived: a barrier's insertion loss is measured, and its
       size at the meter is the same number that was subtracted. */
    barrierSaving: barrierAttenuation,
  }
}

/**
 * How much quieter a sound level is than another (dB).
 *
 * Both a difference and a RATIO of intensities, which is the point of the
 * scale: 6 dB quieter is a quarter of the intensity, 10 dB is a tenth, and
 * 20 dB is a hundredth.
 */
export const levelDifference = (louder: number, quieter: number): number => louder - quieter

/** The intensity ratio between two levels: 10^(ΔL/10). */
export const intensityRatioOf = (levelDifferenceDb: number): number =>
  10 ** (levelDifferenceDb / 10)
