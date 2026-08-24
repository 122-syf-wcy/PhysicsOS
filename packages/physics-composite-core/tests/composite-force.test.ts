import { describe, expect, it } from 'vitest'

import { dot, magnitude, subtract, vec3, type Vector3 } from '@physicsos/physics-math'
import type { PhysicsOSError } from '@physicsos/shared'
import type { FieldSample } from '@physicsos/physics-scene'

import {
  compositeForce,
  cyclotronAngularVelocity,
  cyclotronPeriod,
  driftVelocity,
  gyroRadius,
  selectorSpeed,
} from '../src/index.ts'

/**
 * A field sample built by hand rather than by sampling a scene: this layer is
 * pure maths, so the tests must be able to pose a field combination that no
 * scene factory happens to produce.
 */
const sampleOf = (
  electricField: Vector3 = vec3(0, 0, 0),
  magneticFluxDensity: Vector3 = vec3(0, 0, 0),
  gravity: Vector3 = vec3(0, 0, 0),
): FieldSample => ({ electricField, magneticFluxDensity, gravity, regionIds: [] })

/**
 * The thrown `PhysicsOSError` code, not its message. Downstream layers branch on
 * the code, so that is the half of the contract worth pinning.
 */
const thrownCode = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return (error as PhysicsOSError).code
  }
  throw new Error('expected the call to throw, but it returned')
}

describe('compositeForce', () => {
  it('gives qE alone when only an electric field acts', () => {
    const force = compositeForce(2e-6, 1e-3, vec3(500, 0, 0), sampleOf(vec3(1000, 0, 0)))
    expect(force.electricForce.x).toBeCloseTo(2e-3, 15)
    expect(force.magneticForce).toEqual({ x: 0, y: 0, z: 0 })
    expect(force.gravityForce).toEqual({ x: 0, y: 0, z: 0 })
    expect(force.totalForce.x).toBeCloseTo(2e-3, 15)
  })

  it('gives qv×B with the right-handed sign: +x through +z pushes -y', () => {
    const force = compositeForce(1, 1, vec3(3, 0, 0), sampleOf(undefined, vec3(0, 0, 2)))
    /* cross(UNIT_X, UNIT_Z) = -UNIT_Y, so a positive charge is deflected -y. */
    expect(force.magneticForce.x).toBe(0)
    expect(force.magneticForce.y).toBeCloseTo(-6, 15)
    expect(force.magneticForce.z).toBe(0)
  })

  it('reverses the magnetic force with the sign of the charge', () => {
    const positive = compositeForce(1, 1, vec3(3, 0, 0), sampleOf(undefined, vec3(0, 0, 2)))
    const negative = compositeForce(-1, 1, vec3(3, 0, 0), sampleOf(undefined, vec3(0, 0, 2)))
    expect(negative.magneticForce.y).toBeCloseTo(-positive.magneticForce.y, 15)
  })

  it('gives mg, using the sampled g and never a 9.8 fallback', () => {
    const declared = compositeForce(
      0,
      2,
      vec3(0, 0, 0),
      sampleOf(undefined, undefined, vec3(0, -9.8, 0)),
    )
    expect(declared.gravityForce.y).toBeCloseTo(-19.6, 15)

    /* The scene layer reports g = 0 for a question posed with gravity neglected;
       injecting 9.8 here would break the very balance the question is about. */
    const neglected = compositeForce(0, 2, vec3(0, 0, 0), sampleOf())
    expect(neglected.gravityForce).toEqual({ x: 0, y: 0, z: 0 })
    expect(neglected.totalForce).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('sums the three contributions into the resultant', () => {
    const sample = sampleOf(vec3(100, 200, 0), vec3(0, 0, 0.4), vec3(0, -9.8, 0))
    const force = compositeForce(3e-3, 5e-4, vec3(50, -20, 0), sample)
    expect(force.totalForce.x).toBeCloseTo(
      force.electricForce.x + force.magneticForce.x + force.gravityForce.x,
      15,
    )
    expect(force.totalForce.y).toBeCloseTo(
      force.electricForce.y + force.magneticForce.y + force.gravityForce.y,
      15,
    )
  })

  it('never lets the magnetic force do work', () => {
    const sample = sampleOf(vec3(120, -45, 0), vec3(0, 0, 0.35), vec3(0, -9.8, 0))
    for (const velocity of [vec3(200, 0, 0), vec3(-30, 90, 0), vec3(17, -260, 0)]) {
      const force = compositeForce(4e-3, 2e-4, velocity, sample)
      const power = dot(force.magneticForce, velocity)
      /* Scaled against |F||v| so the zero is a real orthogonality, not small numbers. */
      const scale = magnitude(force.magneticForce) * magnitude(velocity)
      expect(Math.abs(power) / scale).toBeLessThan(1e-9)
    }
  })
})

describe('driftVelocity', () => {
  it('balances the net force exactly, with all three fields present', () => {
    const sample = sampleOf(vec3(250, -80, 0), vec3(0, 0, 0.6), vec3(0, -9.8, 0))
    const charge = 2.5e-3
    const mass = 4e-4
    const drift = driftVelocity(charge, mass, sample)
    expect(drift).toBeDefined()

    const residual = compositeForce(charge, mass, drift as Vector3, sample).totalForce
    const reference = magnitude(compositeForce(charge, mass, vec3(0, 0, 0), sample).totalForce)
    expect(magnitude(residual) / reference).toBeLessThan(1e-12)
  })

  it('has no z component: v×B with B along z can never cancel an axial force', () => {
    const drift = driftVelocity(1e-3, 1e-4, sampleOf(vec3(0, 0, 500), vec3(0, 0, 0.2)))
    expect((drift as Vector3).z).toBe(0)
  })

  it('reduces to the selector speed E/B when gravity is neglected', () => {
    const sample = sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5))
    const drift = driftVelocity(1e-6, 1e-9, sample)
    expect(magnitude(drift as Vector3)).toBeCloseTo(2000, 9)
    expect((drift as Vector3).x).toBeCloseTo(2000, 9)
  })

  it('is undefined without a magnetic field, rather than dividing by zero', () => {
    expect(driftVelocity(1e-3, 1e-4, sampleOf(vec3(100, 0, 0)))).toBeUndefined()
  })

  it('is undefined for a neutral particle even in a strong field', () => {
    /* No charge means no velocity-dependent term, so no velocity balances anything. */
    expect(driftVelocity(0, 1e-4, sampleOf(vec3(100, 0, 0), vec3(0, 0, 5)))).toBeUndefined()
  })

  it('refuses an off-axis magnetic field instead of projecting it onto z', () => {
    expect(
      thrownCode(() => driftVelocity(1e-3, 1e-4, sampleOf(vec3(100, 0, 0), vec3(0.3, 0, 0.5)))),
    ).toBe('COMPOSITE_FIELD_OFF_AXIS')
  })

  it('refuses a non-positive mass', () => {
    expect(
      thrownCode(() => driftVelocity(1e-3, 0, sampleOf(vec3(100, 0, 0), vec3(0, 0, 0.5)))),
    ).toBe('COMPOSITE_INVALID_MASS')
  })
})

describe('cyclotronAngularVelocity', () => {
  it('is ω = qBz/m and carries the sign of the charge', () => {
    const sample = sampleOf(undefined, vec3(0, 0, 0.4))
    expect(cyclotronAngularVelocity(2e-3, 5e-4, sample)).toBeCloseTo((2e-3 * 0.4) / 5e-4, 12)
    expect(cyclotronAngularVelocity(-2e-3, 5e-4, sample)).toBeCloseTo(-(2e-3 * 0.4) / 5e-4, 12)
  })

  it('flips with the field direction as well as with the charge', () => {
    const up = cyclotronAngularVelocity(1e-3, 1e-4, sampleOf(undefined, vec3(0, 0, 0.4)))
    const down = cyclotronAngularVelocity(1e-3, 1e-4, sampleOf(undefined, vec3(0, 0, -0.4)))
    expect(down).toBeCloseTo(-up, 12)
  })

  it('is zero without a field, so gyration helpers have something to test', () => {
    expect(cyclotronAngularVelocity(1e-3, 1e-4, sampleOf())).toBe(0)
    expect(cyclotronPeriod(1e-3, 1e-4, sampleOf())).toBeUndefined()
  })
})

describe('cyclotronPeriod', () => {
  it('is T = 2πm/|qB| and does not depend on speed', () => {
    const sample = sampleOf(undefined, vec3(0, 0, 0.25))
    expect(cyclotronPeriod(1.6e-19, 9.11e-31, sample)).toBeCloseTo(
      (2 * Math.PI * 9.11e-31) / (1.6e-19 * 0.25),
      18,
    )
  })

  it('is the same for both charge signs', () => {
    const sample = sampleOf(undefined, vec3(0, 0, 0.25))
    expect(cyclotronPeriod(-2e-3, 1e-4, sample)).toBeCloseTo(
      cyclotronPeriod(2e-3, 1e-4, sample) as number,
      15,
    )
  })
})

describe('gyroRadius', () => {
  it('is r = mv/(qB) when only a magnetic field acts', () => {
    const sample = sampleOf(undefined, vec3(0, 0, 0.5))
    const charge = 2e-3
    const mass = 4e-4
    const speed = 300
    expect(gyroRadius(charge, mass, vec3(speed, 0, 0), sample)).toBeCloseTo(
      (mass * speed) / (charge * 0.5),
      9,
    )
  })

  it('measures the loop of the cycloid, not a circle the particle never travels', () => {
    /* Injected at exactly the drift velocity there is no loop at all. */
    const sample = sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5))
    const drift = driftVelocity(1e-6, 1e-9, sample) as Vector3
    expect(gyroRadius(1e-6, 1e-9, drift, sample)).toBeCloseTo(0, 9)

    /* Off the drift velocity the radius comes from the difference, not from |v|. */
    const velocity = vec3(drift.x + 500, 0, 0)
    const omega = cyclotronAngularVelocity(1e-6, 1e-9, sample)
    expect(gyroRadius(1e-6, 1e-9, velocity, sample)).toBeCloseTo(500 / Math.abs(omega), 9)
    expect(gyroRadius(1e-6, 1e-9, velocity, sample)).not.toBeCloseTo(
      magnitude(velocity) / Math.abs(omega),
      6,
    )
  })

  it('is undefined without gyration', () => {
    expect(gyroRadius(1e-3, 1e-4, vec3(100, 0, 0), sampleOf(vec3(50, 0, 0)))).toBeUndefined()
  })
})

describe('selectorSpeed', () => {
  it('is |E|/|B| for crossed fields', () => {
    expect(selectorSpeed(sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5)))).toBeCloseTo(2000, 9)
    expect(selectorSpeed(sampleOf(vec3(600, 0, 0), vec3(0, 0, 0.02)))).toBeCloseTo(30_000, 9)
  })

  it('agrees with the drift speed whenever gravity is neglected', () => {
    const sample = sampleOf(vec3(-450, 120, 0), vec3(0, 0, 0.3))
    const drift = driftVelocity(3e-6, 2e-9, sample) as Vector3
    expect(selectorSpeed(sample)).toBeCloseTo(magnitude(drift), 9)
  })

  it('is undefined when E has a component along B, because no speed balances it', () => {
    /* qv×B is always perpendicular to B, so E∥ survives at every velocity. */
    expect(selectorSpeed(sampleOf(vec3(0, 1000, 200), vec3(0, 0, 0.5)))).toBeUndefined()
  })

  it('is undefined without a magnetic field to select with', () => {
    expect(selectorSpeed(sampleOf(vec3(0, 1000, 0)))).toBeUndefined()
  })

  it('ignores gravity by construction, unlike the drift velocity', () => {
    const withGravity = sampleOf(vec3(0, 1000, 0), vec3(0, 0, 0.5), vec3(0, -9.8, 0))
    expect(selectorSpeed(withGravity)).toBeCloseTo(2000, 9)
    /* The general answer shifts by mg/(qB) — 19.6 m/s for this mass-to-charge
       ratio — which is why the two are separate exports. */
    const drift = driftVelocity(1e-6, 1e-6, withGravity) as Vector3
    expect(magnitude(subtract(drift, vec3(2000, 0, 0)))).toBeCloseTo(19.6, 6)
  })
})
