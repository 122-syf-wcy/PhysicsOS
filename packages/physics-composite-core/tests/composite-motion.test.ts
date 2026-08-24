import { describe, expect, it } from 'vitest'

import { add, magnitude, scale, subtract, vec3, type Vector3 } from '@physicsos/physics-math'
import type { PhysicsOSError } from '@physicsos/shared'
import type { FieldSample } from '@physicsos/physics-scene'

import {
  compositeForce,
  compositeMotionAt,
  cyclotronPeriod,
  driftVelocity,
  gyroRadius,
} from '../src/index.ts'

const sampleOf = (
  electricField: Vector3 = vec3(0, 0, 0),
  magneticFluxDensity: Vector3 = vec3(0, 0, 0),
  gravity: Vector3 = vec3(0, 0, 0),
): FieldSample => ({ electricField, magneticFluxDensity, gravity, regionIds: [] })

/** The thrown `PhysicsOSError` code, which is what downstream layers branch on. */
const thrownCode = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return (error as PhysicsOSError).code
  }
  throw new Error('expected the call to throw, but it returned')
}

/* ------------------------------------------------------ RK4 reference only -- */

/**
 * Acceleration written out in plain arithmetic rather than reusing
 * `compositeForce`, so the numerical reference below shares no code at all with
 * the closed form it is checking. A reference that imports the thing under test
 * cannot catch a sign error in that thing.
 *
 * This integrator exists ONLY in the test suite. Production code must stay
 * analytic (docs/15-RUNTIME-ARCHITECTURE.md §4).
 */
const accelerationOf = (charge: number, mass: number, v: Vector3, f: FieldSample): Vector3 => {
  const b = f.magneticFluxDensity
  const lorentzX = v.y * b.z - v.z * b.y
  const lorentzY = v.z * b.x - v.x * b.z
  const lorentzZ = v.x * b.y - v.y * b.x
  return {
    x: (charge * (f.electricField.x + lorentzX)) / mass + f.gravity.x,
    y: (charge * (f.electricField.y + lorentzY)) / mass + f.gravity.y,
    z: (charge * (f.electricField.z + lorentzZ)) / mass + f.gravity.z,
  }
}

const rungeKutta4 = (
  charge: number,
  mass: number,
  position0: Vector3,
  velocity0: Vector3,
  sample: FieldSample,
  duration: number,
  steps: number,
): { position: Vector3; velocity: Vector3 } => {
  const h = duration / steps
  let r = position0
  let v = velocity0

  for (let step = 0; step < steps; step += 1) {
    const k1v = accelerationOf(charge, mass, v, sample)
    const k1r = v

    const v2 = add(v, scale(k1v, h / 2))
    const k2v = accelerationOf(charge, mass, v2, sample)
    const k2r = v2

    const v3 = add(v, scale(k2v, h / 2))
    const k3v = accelerationOf(charge, mass, v3, sample)
    const k3r = v3

    const v4 = add(v, scale(k3v, h))
    const k4v = accelerationOf(charge, mass, v4, sample)
    const k4r = v4

    const weigh = (a: Vector3, b: Vector3, c: Vector3, d: Vector3): Vector3 => ({
      x: ((a.x + 2 * b.x + 2 * c.x + d.x) * h) / 6,
      y: ((a.y + 2 * b.y + 2 * c.y + d.y) * h) / 6,
      z: ((a.z + 2 * b.z + 2 * c.z + d.z) * h) / 6,
    })

    r = add(r, weigh(k1r, k2r, k3r, k4r))
    v = add(v, weigh(k1v, k2v, k3v, k4v))
  }

  return { position: r, velocity: v }
}

/* ------------------------------------------------------------- basic cases -- */

describe('compositeMotionAt with one field', () => {
  it('is uniformly accelerated in a pure electric field', () => {
    const charge = 2e-6
    const mass = 5e-9
    const sample = sampleOf(vec3(1500, 0, 0))
    const expected = (charge * 1500) / mass

    const state = compositeMotionAt(charge, mass, vec3(0, 0, 0), vec3(0, 0, 0), sample, 2e-3)
    expect(state.acceleration.x).toBeCloseTo(expected, 6)
    expect(state.velocity.x).toBeCloseTo(expected * 2e-3, 9)
    expect(state.position.x).toBeCloseTo(0.5 * expected * 2e-3 ** 2, 12)
    expect(state.position.y).toBe(0)
  })

  it('carries an initial velocity through the ½at² term', () => {
    const charge = -1e-6
    const mass = 2e-9
    const sample = sampleOf(vec3(0, 800, 0))
    const acceleration = (charge * 800) / mass
    const dt = 1.5e-3

    const state = compositeMotionAt(charge, mass, vec3(1, 2, 0), vec3(400, -50, 0), sample, dt)
    expect(state.position.x).toBeCloseTo(1 + 400 * dt, 12)
    expect(state.position.y).toBeCloseTo(2 - 50 * dt + 0.5 * acceleration * dt * dt, 9)
  })

  it('conserves speed exactly in a pure magnetic field', () => {
    const charge = 2e-3
    const mass = 4e-4
    const sample = sampleOf(undefined, vec3(0, 0, 0.5))
    const velocity0 = vec3(300, 0, 0)
    const period = cyclotronPeriod(charge, mass, sample) as number

    for (const fraction of [0.01, 0.25, 0.5, 0.77, 1, 1.37, 3.5]) {
      const state = compositeMotionAt(
        charge,
        mass,
        vec3(0, 0, 0),
        velocity0,
        sample,
        fraction * period,
      )
      expect(Math.abs(magnitude(state.velocity) - 300) / 300).toBeLessThan(1e-9)
    }
  })

  it('traces a circle of radius r = mv/(qB) about the expected centre', () => {
    const charge = 2e-3
    const mass = 4e-4
    const sample = sampleOf(undefined, vec3(0, 0, 0.5))
    const velocity0 = vec3(300, 0, 0)
    const radius = gyroRadius(charge, mass, velocity0, sample) as number
    expect(radius).toBeCloseTo((mass * 300) / (charge * 0.5), 9)

    /* A positive charge moving +x through +z is pushed -y, so the centre sits below. */
    const centre = vec3(0, -radius, 0)
    const period = cyclotronPeriod(charge, mass, sample) as number
    for (const fraction of [0.13, 0.4, 0.61, 0.95, 1.37]) {
      const state = compositeMotionAt(
        charge,
        mass,
        vec3(0, 0, 0),
        velocity0,
        sample,
        fraction * period,
      )
      expect(magnitude(subtract(state.position, centre))).toBeCloseTo(radius, 9)
    }
  })

  it('returns to the start after exactly one period', () => {
    const charge = 2e-3
    const mass = 4e-4
    const sample = sampleOf(undefined, vec3(0, 0, 0.5))
    const period = cyclotronPeriod(charge, mass, sample) as number

    const state = compositeMotionAt(
      charge,
      mass,
      vec3(0.1, 0.2, 0),
      vec3(300, 0, 0),
      sample,
      period,
    )
    expect(magnitude(subtract(state.position, vec3(0.1, 0.2, 0)))).toBeLessThan(1e-12)
    expect(magnitude(subtract(state.velocity, vec3(300, 0, 0)))).toBeLessThan(1e-9)
  })

  it('reverses the gyration sense with the sign of the charge', () => {
    const mass = 4e-4
    const sample = sampleOf(undefined, vec3(0, 0, 0.5))
    const dt = 1e-4

    const positive = compositeMotionAt(2e-3, mass, vec3(0, 0, 0), vec3(300, 0, 0), sample, dt)
    const negative = compositeMotionAt(-2e-3, mass, vec3(0, 0, 0), vec3(300, 0, 0), sample, dt)

    /* Same field, same initial velocity, opposite deflection. */
    expect(positive.velocity.y).toBeLessThan(0)
    expect(negative.velocity.y).toBeGreaterThan(0)
    expect(negative.velocity.y).toBeCloseTo(-positive.velocity.y, 12)
    expect(positive.position.y).toBeLessThan(0)
    expect(negative.position.y).toBeCloseTo(-positive.position.y, 12)
  })
})

describe('compositeMotionAt in crossed fields', () => {
  it('goes straight at the selector speed, because the net force vanishes', () => {
    const charge = 1e-6
    const mass = 1e-9
    const sample = sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5))
    const velocity0 = vec3(2000, 0, 0)

    expect(magnitude(compositeForce(charge, mass, velocity0, sample).totalForce)).toBeLessThan(
      1e-15,
    )

    for (const dt of [1e-6, 1e-4, 1e-2, 1]) {
      const state = compositeMotionAt(charge, mass, vec3(0, 0, 0), velocity0, sample, dt)
      /* Straight line at constant velocity: r = v₀t, to the scale of the run. */
      expect(magnitude(subtract(state.position, scale(velocity0, dt))) / (2000 * dt)).toBeLessThan(
        1e-9,
      )
      expect(magnitude(subtract(state.velocity, velocity0)) / 2000).toBeLessThan(1e-9)
      expect(magnitude(state.acceleration)).toBeLessThan(1e-6)
    }
  })

  it('drifts at v_d while looping, when injected off the selector speed', () => {
    const charge = 1e-6
    const mass = 1e-9
    const sample = sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5))
    const drift = driftVelocity(charge, mass, sample) as Vector3
    const period = cyclotronPeriod(charge, mass, sample) as number

    /* After a whole number of periods the loop closes and only the drift remains. */
    const state = compositeMotionAt(
      charge,
      mass,
      vec3(0, 0, 0),
      vec3(2500, 0, 0),
      sample,
      3 * period,
    )
    expect(
      magnitude(subtract(state.position, scale(drift, 3 * period))) /
        magnitude(drift) /
        (3 * period),
    ).toBeLessThan(1e-9)
    expect(magnitude(subtract(state.velocity, vec3(2500, 0, 0))) / 2500).toBeLessThan(1e-9)
  })

  it('accelerates along z when B cannot balance an axial field', () => {
    /* B along z leaves E_z uncancelled: v×B is always perpendicular to B, so the
       axial direction is free-fall no matter how strong the field is. */
    const charge = 1e-3
    const mass = 1e-4
    const sample = sampleOf(vec3(100, 0, 250), vec3(0, 0, 0.3), vec3(0, 0, -9.8))
    const axial = (charge * 250) / mass - 9.8
    const dt = 2e-3

    const state = compositeMotionAt(charge, mass, vec3(0, 0, 5), vec3(50, 20, 10), sample, dt)
    expect(state.velocity.z).toBeCloseTo(10 + axial * dt, 9)
    expect(state.position.z).toBeCloseTo(5 + 10 * dt + 0.5 * axial * dt * dt, 12)
  })
})

describe('compositeMotionAt degenerate and structural properties', () => {
  it('takes the uniform-acceleration branch without dividing by zero when B = 0', () => {
    const charge = 3e-6
    const mass = 6e-9
    const sample = sampleOf(vec3(400, -200, 0), undefined, vec3(0, -9.8, 0))
    expect(driftVelocity(charge, mass, sample)).toBeUndefined()

    const dt = 5e-4
    const state = compositeMotionAt(charge, mass, vec3(0, 0, 0), vec3(100, 0, 0), sample, dt)
    const expectedAx = (charge * 400) / mass
    const expectedAy = (charge * -200) / mass - 9.8

    expect(Number.isFinite(state.position.x)).toBe(true)
    expect(Number.isFinite(state.velocity.y)).toBe(true)
    expect(state.acceleration.x).toBeCloseTo(expectedAx, 6)
    expect(state.acceleration.y).toBeCloseTo(expectedAy, 6)
    expect(state.position.x).toBeCloseTo(100 * dt + 0.5 * expectedAx * dt * dt, 12)
    expect(state.position.y).toBeCloseTo(0.5 * expectedAy * dt * dt, 12)
  })

  it('is free-fall for a neutral particle even inside a strong field', () => {
    const sample = sampleOf(vec3(5000, 0, 0), vec3(0, 0, 3), vec3(0, -9.8, 0))
    const state = compositeMotionAt(0, 1e-3, vec3(0, 10, 0), vec3(2, 0, 0), sample, 0.5)
    expect(state.position.x).toBeCloseTo(1, 12)
    expect(state.position.y).toBeCloseTo(10 - 0.5 * 9.8 * 0.25, 12)
    expect(state.acceleration.y).toBeCloseTo(-9.8, 12)
  })

  it('returns the initial state for dt = 0 on both branches', () => {
    const crossed = sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5), vec3(0, -9.8, 0))
    const electric = sampleOf(vec3(0, 1000, 0))
    for (const sample of [crossed, electric]) {
      const state = compositeMotionAt(1e-6, 1e-9, vec3(1, 2, 3), vec3(4, 5, 6), sample, 0)
      expect(magnitude(subtract(state.position, vec3(1, 2, 3)))).toBe(0)
      expect(magnitude(subtract(state.velocity, vec3(4, 5, 6)))).toBe(0)
    }
  })

  it('composes: two phases of dt equal one phase of 2dt', () => {
    /* The closed form must be a true flow, or an engine that restarts it at a
       region boundary would silently disagree with one that did not. */
    const charge = 2.5e-3
    const mass = 4e-4
    const sample = sampleOf(vec3(250, -80, 0), vec3(0, 0, 0.6), vec3(0, -9.8, 0))
    const dt = 3e-3

    const first = compositeMotionAt(charge, mass, vec3(0, 0, 0), vec3(120, -75, 0), sample, dt)
    const chained = compositeMotionAt(charge, mass, first.position, first.velocity, sample, dt)
    const direct = compositeMotionAt(charge, mass, vec3(0, 0, 0), vec3(120, -75, 0), sample, 2 * dt)

    expect(magnitude(subtract(chained.position, direct.position))).toBeLessThan(1e-12)
    expect(magnitude(subtract(chained.velocity, direct.velocity))).toBeLessThan(1e-9)
  })

  it('is time-reversible, which a stepped solution would not be', () => {
    const charge = 2.5e-3
    const mass = 4e-4
    const sample = sampleOf(vec3(250, -80, 0), vec3(0, 0, 0.6), vec3(0, -9.8, 0))
    const forward = compositeMotionAt(charge, mass, vec3(0, 0, 0), vec3(120, -75, 0), sample, 4e-3)
    const back = compositeMotionAt(charge, mass, forward.position, forward.velocity, sample, -4e-3)
    expect(magnitude(subtract(back.position, vec3(0, 0, 0)))).toBeLessThan(1e-12)
    expect(magnitude(subtract(back.velocity, vec3(120, -75, 0)))).toBeLessThan(1e-9)
  })

  it('refuses a non-finite dt and a non-positive mass', () => {
    const sample = sampleOf(vec3(250, 0, 0), vec3(0, 0, 0.6))
    expect(
      thrownCode(() =>
        compositeMotionAt(1e-3, 1e-4, vec3(0, 0, 0), vec3(1, 0, 0), sample, Number.NaN),
      ),
    ).toBe('COMPOSITE_INVALID_TIME')
    expect(
      thrownCode(() => compositeMotionAt(1e-3, -1e-4, vec3(0, 0, 0), vec3(1, 0, 0), sample, 1e-3)),
    ).toBe('COMPOSITE_INVALID_MASS')
  })
})

/* --------------------------------------------------------------- energetics -- */

describe('work and energy', () => {
  /**
   * With uniform fields the electric and gravitational forces are constant
   * vectors, so their work is `F·Δr` on ANY path — and the magnetic force does
   * none. That makes the energy balance exact rather than approximate, which is a
   * far sharper test of the trajectory than a tolerance on position.
   */
  it('accounts for kinetic energy change with qE·Δr + mg·Δr alone', () => {
    const cases = [
      {
        charge: 2.5e-3,
        mass: 4e-4,
        sample: sampleOf(vec3(250, -80, 0), vec3(0, 0, 0.6), vec3(0, -9.8, 0)),
        velocity0: vec3(120, -75, 0),
        dt: 5e-3,
      },
      {
        charge: -1.5e-3,
        mass: 3e-4,
        sample: sampleOf(vec3(0, 300, 0), vec3(0, 0, 0.4), vec3(0, -9.8, 0)),
        velocity0: vec3(-200, 60, 0),
        dt: 9e-3,
      },
      {
        charge: 3e-6,
        mass: 6e-9,
        sample: sampleOf(vec3(400, -200, 0), undefined, vec3(0, -9.8, 0)),
        velocity0: vec3(100, 0, 0),
        dt: 4e-4,
      },
    ]

    for (const { charge, mass, sample, velocity0, dt } of cases) {
      const position0 = vec3(0, 0, 0)
      const state = compositeMotionAt(charge, mass, position0, velocity0, sample, dt)
      const displacement = subtract(state.position, position0)

      const constantForce = add(scale(sample.electricField, charge), scale(sample.gravity, mass))
      const work =
        constantForce.x * displacement.x +
        constantForce.y * displacement.y +
        constantForce.z * displacement.z

      const kineticChange =
        0.5 * mass * magnitude(state.velocity) ** 2 - 0.5 * mass * magnitude(velocity0) ** 2

      expect(Math.abs(work - kineticChange) / Math.max(Math.abs(work), 1e-30)).toBeLessThan(1e-9)
    }
  })
})

/* --------------------------------------------------- analytic vs numerical -- */

describe('the closed form against a numerical integrator', () => {
  const RK4_STEPS = 40_000

  const cases = [
    {
      name: 'pure magnetic field',
      charge: 2e-3,
      mass: 4e-4,
      sample: sampleOf(undefined, vec3(0, 0, 0.5)),
      position0: vec3(0, 0, 0),
      velocity0: vec3(300, 0, 0),
    },
    {
      name: 'crossed E and B, injected off the selector speed',
      charge: 1e-6,
      mass: 1e-9,
      sample: sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5)),
      position0: vec3(0, 0, 0),
      velocity0: vec3(2500, 0, 0),
    },
    {
      name: 'E, B and g together',
      charge: 2.5e-3,
      mass: 4e-4,
      sample: sampleOf(vec3(250, -80, 0), vec3(0, 0, 0.6), vec3(0, -9.8, 0)),
      position0: vec3(0.05, -0.02, 0),
      velocity0: vec3(120, -75, 0),
    },
    {
      name: 'negative charge with E, B and g',
      charge: -1.5e-3,
      mass: 3e-4,
      sample: sampleOf(vec3(0, 300, 0), vec3(0, 0, 0.4), vec3(0, -9.8, 0)),
      position0: vec3(0, 0, 0),
      velocity0: vec3(-200, 60, 0),
    },
    {
      name: 'axial E and g on top of an in-plane gyration',
      charge: 1e-3,
      mass: 1e-4,
      sample: sampleOf(vec3(100, 0, 250), vec3(0, 0, 0.3), vec3(0, 0, -9.8)),
      position0: vec3(0, 0, 0.5),
      velocity0: vec3(50, 20, 10),
    },
  ]

  it.each(cases)('agrees with RK4 at t = 1.37 T for $name', (testCase) => {
    const { charge, mass, sample, position0, velocity0 } = testCase
    const period = cyclotronPeriod(charge, mass, sample) as number
    expect(period).toBeGreaterThan(0)
    const duration = 1.37 * period

    const analytic = compositeMotionAt(charge, mass, position0, velocity0, sample, duration)
    const numeric = rungeKutta4(charge, mass, position0, velocity0, sample, duration, RK4_STEPS)

    /* Normalised against the trajectory's own scale — the loop radius and the
       drift excursion — so a case whose path happens to pass near the origin does
       not report a meaningless relative error. */
    const drift = driftVelocity(charge, mass, sample) ?? vec3(0, 0, 0)
    const radius = gyroRadius(charge, mass, velocity0, sample) ?? 0
    const lengthScale = Math.max(radius, magnitude(drift) * duration)
    const speedScale = Math.max(magnitude(velocity0), magnitude(drift))

    const positionError = magnitude(subtract(analytic.position, numeric.position)) / lengthScale
    const velocityError = magnitude(subtract(analytic.velocity, numeric.velocity)) / speedScale

    expect(positionError).toBeLessThan(1e-6)
    expect(velocityError).toBeLessThan(1e-6)
  })

  it('reports the measured agreement, so a regression in either side is visible', () => {
    const charge = 2.5e-3
    const mass = 4e-4
    const sample = sampleOf(vec3(250, -80, 0), vec3(0, 0, 0.6), vec3(0, -9.8, 0))
    const velocity0 = vec3(120, -75, 0)
    const period = cyclotronPeriod(charge, mass, sample) as number
    const duration = 1.37 * period

    const analytic = compositeMotionAt(charge, mass, vec3(0, 0, 0), velocity0, sample, duration)
    const numeric = rungeKutta4(charge, mass, vec3(0, 0, 0), velocity0, sample, duration, RK4_STEPS)

    const drift = driftVelocity(charge, mass, sample) as Vector3
    const radius = gyroRadius(charge, mass, velocity0, sample) as number
    const lengthScale = Math.max(radius, magnitude(drift) * duration)
    const error = magnitude(subtract(analytic.position, numeric.position)) / lengthScale

    /* Machine-precision agreement, not merely "within tolerance": the closed form
       and a 40k-step RK4 of the same law should differ only by RK4's own
       truncation error. Loosening this bound means one of the two changed. */
    expect(error).toBeLessThan(1e-11)
  })
})
