import { describe, expect, it } from 'vitest'

import {
  POINT_SOURCE_SPREADING,
  REFERENCE_INTENSITY,
  intensityFromSoundLevel,
  intensityRatioOf,
  levelDifference,
  noiseReadingOf,
  soundLevelAt,
  soundLevelFromIntensity,
} from '../src/noise.ts'

/* A machine rated at 100 dB of sound power, heard 1 m away with no barrier. */
const R = noiseReadingOf(100, 1, 0)

describe('sound level and distance', () => {
  it('falls 6 dB every time the distance doubles', () => {
    /* The rule every textbook states, and it falls out of 10lg(I/I₀) with
       I = P/(4πr²) rather than being a separate fact to memorise. */
    const at1 = soundLevelAt(100, 1, 0)
    const at2 = soundLevelAt(100, 2, 0)
    const at4 = soundLevelAt(100, 4, 0)
    expect(at1 - at2).toBeCloseTo(6.0206, 3)
    expect(at2 - at4).toBeCloseTo(6.0206, 3)
    /* And at ten times the distance: 20 dB, whatever the source. */
    expect(soundLevelAt(80, 1, 0) - soundLevelAt(80, 10, 0)).toBeCloseTo(20, 9)
  })

  it('relates the level to the intensity through the reference', () => {
    /* I₀ is 10⁻¹² W/m², so 0 dB is exactly that intensity and 10 dB is ten
       times it. */
    expect(soundLevelFromIntensity(REFERENCE_INTENSITY)).toBeCloseTo(0, 12)
    expect(soundLevelFromIntensity(10 * REFERENCE_INTENSITY)).toBeCloseTo(10, 12)
    expect(intensityFromSoundLevel(R.level)).toBeCloseTo(R.intensity, 15)
  })

  it('subtracts the source spreading, so 1 m is not the source level', () => {
    /* 10·lg(4π) = 10.99 dB: the power has already spread over a whole sphere by
       the time it reaches the first metre. */
    expect(POINT_SOURCE_SPREADING).toBeCloseTo(10.9921, 3)
    expect(R.level).toBeCloseTo(100 - POINT_SOURCE_SPREADING, 9)
    expect(R.level).toBeCloseTo(89.0079, 3)
  })

  it('treats a barrier as a subtraction, and keeps it separate from distance', () => {
    /* A 15 dB barrier at 4 m does the same thing as a 15 dB barrier at 1 m:
       the two effects are independent facts and they add. */
    const bare = noiseReadingOf(100, 4, 0)
    const walled = noiseReadingOf(100, 4, 15)
    expect(walled.level).toBeCloseTo(bare.level - 15, 9)
    expect(walled.levelWithoutBarrier).toBeCloseTo(bare.level, 9)
    expect(walled.barrierSaving).toBeCloseTo(15, 9)
  })

  it('makes 6 dB a quarter of the intensity, not a quarter of the loudness', () => {
    /* The logarithm is what makes the scale worth its awkwardness: a barrier
       that removes "only" 6 dB has cut the energy to a quarter. */
    expect(intensityRatioOf(levelDifference(90, 84))).toBeCloseTo(3.981, 3)
    expect(intensityRatioOf(10)).toBeCloseTo(10, 12)
    expect(intensityRatioOf(20)).toBeCloseTo(100, 12)
    expect(intensityRatioOf(0)).toBeCloseTo(1, 12)
  })

  it('reads a quiet room and a loud machine on the same scale', () => {
    /* 30 dB is a whisper, 90 dB is a lorry — both are just ratios to I₀. */
    expect(soundLevelFromIntensity(1e-9)).toBeCloseTo(30, 9)
    expect(soundLevelFromIntensity(1e-3)).toBeCloseTo(90, 9)
    expect(intensityFromSoundLevel(30)).toBeCloseTo(1e-9, 18)
  })
})
