import { describe, expect, it } from 'vitest'

import {
  EARTH_GRAVITATIONAL_PARAMETER,
  centripetalAcceleration,
  circularOrbitPeriod,
  circularOrbitSpeed,
  gravitationalAcceleration,
  orbitReadingOf,
} from '../src/orbit.ts'

/* 420 km above the ground: r = 6.8e6 m. That is the ISS's orbit, and its period
   comes out at 93 minutes, which is the number the station actually has. */
const R = 6.8e6

describe('circular orbits', () => {
  it('gives the ISS its real 7.66 km/s and 93 minutes', () => {
    const reading = orbitReadingOf(EARTH_GRAVITATIONAL_PARAMETER, R, 420_000)
    expect(reading.speed).toBeCloseTo(7656, 0)
    expect(reading.period / 60).toBeCloseTo(93.0, 1)
    /* A 420-tonne station in that orbit is held by 3.6 MN of gravity. */
    expect(reading.force).toBeCloseTo(3.62e6, -4)
  })

  it('makes gravity supply exactly the acceleration the speed demands', () => {
    const reading = orbitReadingOf(EARTH_GRAVITATIONAL_PARAMETER, R, 1)
    /* This IS what a circular orbit is: two independently computed
       accelerations that have to agree. */
    expect(reading.requiredAcceleration).toBeCloseTo(reading.suppliedAcceleration, 9)
    expect(reading.requiredAcceleration).toBeCloseTo(centripetalAcceleration(reading.speed, R), 12)
    expect(reading.suppliedAcceleration).toBeCloseTo(
      gravitationalAcceleration(EARTH_GRAVITATIONAL_PARAMETER, R),
      12,
    )
  })

  it('slows a higher orbit down and lengthens its period', () => {
    /* Four times the radius: half the speed, eight times the period — Kepler's
       third law falls straight out of v = √(GM/r). */
    const low = orbitReadingOf(EARTH_GRAVITATIONAL_PARAMETER, R, 1)
    const high = orbitReadingOf(EARTH_GRAVITATIONAL_PARAMETER, 4 * R, 1)
    expect(high.speed / low.speed).toBeCloseTo(0.5, 12)
    expect(high.period / low.period).toBeCloseTo(8, 12)
    /* And the period is the radius over the speed, times 2π. */
    expect(high.period).toBeCloseTo((2 * Math.PI * 4 * R) / high.speed, 6)
  })

  it('asks for a geostationary orbit at 35 786 km', () => {
    /* The classic number, recovered by solving GM/r³ = (2π/T)² for T = 1 day. */
    const day = 86_164
    const radius = Math.cbrt((EARTH_GRAVITATIONAL_PARAMETER * day * day) / (4 * Math.PI ** 2))
    expect(radius / 1000).toBeCloseTo(42_164, -1)
    expect(circularOrbitPeriod(EARTH_GRAVITATIONAL_PARAMETER, radius) / 3600).toBeCloseTo(23.93, 1)
    expect(circularOrbitSpeed(EARTH_GRAVITATIONAL_PARAMETER, radius)).toBeCloseTo(3075, 0)
  })

  it('makes the force on a heavier satellite larger but its orbit identical', () => {
    const light = orbitReadingOf(EARTH_GRAVITATIONAL_PARAMETER, R, 100)
    const heavy = orbitReadingOf(EARTH_GRAVITATIONAL_PARAMETER, R, 1000)
    expect(heavy.force / light.force).toBeCloseTo(10, 12)
    /* Mass cancels out of the orbit itself: only GM and r decide it. */
    expect(heavy.speed).toBeCloseTo(light.speed, 12)
    expect(heavy.period).toBeCloseTo(light.period, 12)
  })
})
