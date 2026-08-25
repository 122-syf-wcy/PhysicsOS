import { describe, expect, it } from 'vitest'
import { toCanonicalVector } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import {
  createElectricScene,
  createParallelPlateScene,
  createPointChargeScene,
} from '@physicsos/physics-scene'

import {
  createElectricRegionSimulationRequest,
  electricRegionEngine,
  resolveParallelPlateModel,
} from '../src/index.ts'

/* Helper: build a standard simulation request for a scene. */
const simRequest = (scene: ReturnType<typeof createParallelPlateScene>) =>
  createElectricRegionSimulationRequest(scene, 'sim-test', 'trace-test')

/* Helper: a scene where the particle enters from the left and exits the right. */
const passingScene = () =>
  createParallelPlateScene({
    charge: -1.6e-19,
    mass: 9.11e-31,
    position: vec3(-0.08, 0, 0),
    velocity: vec3(3e7, 0, 0),
    electricFieldStrength: 2000,
    electricFieldDirection: 'down',
    plateSeparation: 0.04,
    plateLength: 0.12,
    duration: 8e-9,
  })

/* Helper: a scene where the particle hits the top plate. */
const hitPlateScene = () =>
  createParallelPlateScene({
    charge: 1.6e-19,
    mass: 9.11e-31,
    position: vec3(-0.08, 0, 0),
    velocity: vec3(3e7, 0, 0),
    electricFieldStrength: 10000,
    electricFieldDirection: 'up',
    plateSeparation: 0.02,
    plateLength: 0.12,
    duration: 8e-9,
  })

describe('ElectricRegionEngine', () => {
  it('produces an EnterField event when the particle enters the field region', () => {
    const scene = passingScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    const types = result.events.map((e) => e.type)
    expect(types).toContain('EnterField')
  })

  it('produces an ExitField event when the particle exits the field region', () => {
    const scene = passingScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    const types = result.events.map((e) => e.type)
    expect(types).toContain('ExitField')
  })

  it('produces a HitPlate event when the particle deflects to a plate boundary', () => {
    const scene = hitPlateScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    const types = result.events.map((e) => e.type)
    expect(types).toContain('HitPlate')
  })

  it('has zero acceleration when the particle is outside the field region', () => {
    const scene = passingScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    // The first state (t=0) is before field entry since the particle starts at x=-0.08.
    const firstState = result.states[0]
    expect(firstState).toBeDefined()
    const accel = firstState!.objects[0]!.acceleration
    expect(accel).toBeDefined()
    const a = toCanonicalVector(accel!).vectorSI
    expect(a.x).toBe(0)
    expect(a.y).toBe(0)
    expect(a.z).toBe(0)
  })

  it('matches the analytical deflection formula y = 0.5 * a * (L/vx)² to 1e-6 tolerance', () => {
    // Use simple SI values for an exact check.
    // q = 1 C, m = 1 kg, E = 1 V/m (up), vx = 1 m/s, L = 2 m → t_inside = 2 s
    // a = qE/m = 1 m/s² (up), y_exit = 0.5 * 1 * 2² = 2 m
    const scene = createParallelPlateScene({
      charge: 1,
      mass: 1,
      position: vec3(-2, 0, 0), // starts 1 m before the left edge (x = -1)
      velocity: vec3(1, 0, 0),
      electricFieldStrength: 1,
      electricFieldDirection: 'up',
      plateSeparation: 10, // large enough that the particle does not hit
      plateLength: 2,
      duration: 10,
    })
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    // Find the deflection derived quantity.
    const deflectionDq = result.derivedQuantities.find((d) => d.key === 'deflection')
    expect(deflectionDq).toBeDefined()
    const deflection = deflectionDq!.value
    if (!('value' in deflection)) throw new Error('Expected scalar deflection')
    // y_exit = 0.5 * (qE/m) * (L/vx)² = 0.5 * 1 * (2/1)² = 2
    expect(deflection.value).toBeCloseTo(2, 6)
  })

  it('produces derived quantities with expected keys', () => {
    const scene = passingScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    const keys = new Set(result.derivedQuantities.map((d) => d.key))
    expect(keys.has('electric_field_magnitude')).toBe(true)
    expect(keys.has('electric_force_magnitude')).toBe(true)
    expect(keys.has('acceleration_magnitude')).toBe(true)
    expect(keys.has('displacement_vector')).toBe(true)
    expect(keys.has('speed')).toBe(true)
    expect(keys.has('kinetic_energy')).toBe(true)
    expect(keys.has('work_by_electric_field')).toBe(true)
    expect(keys.has('electric_potential_energy_change')).toBe(true)
    // For a passing-through scenario, exit_velocity and deflection should exist.
    expect(keys.has('exit_velocity')).toBe(true)
    expect(keys.has('deflection')).toBe(true)
  })

  it('is mutually exclusive: rejects unbounded uniform-field scenes', () => {
    const unbounded = createElectricScene()
    const support = electricRegionEngine.canHandle(unbounded)
    expect(support.supported).toBe(false)
  })

  it('is mutually exclusive: rejects point-charge scenes', () => {
    const pointCharge = createPointChargeScene({
      charges: [{ id: 'charge-1', charge: 1e-6, position: vec3(0, 0, 0) }],
    })
    const support = electricRegionEngine.canHandle(pointCharge)
    expect(support.supported).toBe(false)
  })

  it('accepts a parallel-plate scene as supported', () => {
    const scene = passingScene()
    const support = electricRegionEngine.canHandle(scene)
    expect(support.supported).toBe(true)
    if (support.supported) {
      expect(support.modelId).toBe('charged_particle_bounded_uniform_electric_field')
      expect(support.domain).toBe('electric')
    }
  })

  it('passes verification for a valid parallel-plate scene', () => {
    const scene = passingScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    expect(result.verification.status).toBe('passed')
  })

  it('throws on stale simulation request (scene revision mismatch)', () => {
    const scene = passingScene()
    const request = simRequest(scene)
    request.sceneRevision += 1
    expect(() => electricRegionEngine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
  })

  it('resolves the model with correct geometry', () => {
    const scene = passingScene()
    const model = resolveParallelPlateModel(scene)
    expect(model.plateLength).toBe(0.12)
    expect(model.plateSeparation).toBe(0.04)
    expect(model.xLeft).toBe(-0.06)
    expect(model.xRight).toBe(0.06)
    expect(model.yTop).toBe(0.02)
    expect(model.yBottom).toBe(-0.02)
    expect(model.charge).toBe(-1.6e-19)
    expect(model.mass).toBeCloseTo(9.11e-31)
  })

  it('produces acceleration qE/m inside the field region', () => {
    const scene = passingScene()
    const model = resolveParallelPlateModel(scene)
    // E = 2000 V/m down → E_y = -2000
    // q = -1.6e-19, m = 9.11e-31
    // a_y = q*E_y / m = (-1.6e-19 * -2000) / 9.11e-31
    const expectedAY = (-1.6e-19 * -2000) / 9.11e-31
    expect(model.acceleration.y).toBeCloseTo(expectedAY, 4)
    // x-acceleration should be zero (field is along y only).
    expect(Math.abs(model.acceleration.x)).toBe(0)
  })

  it('has deterministic event IDs', () => {
    const scene = passingScene()
    const result1 = electricRegionEngine.simulate(scene, simRequest(scene))
    const result2 = electricRegionEngine.simulate(scene, simRequest(scene))
    const ids1 = result1.events.map((e) => e.eventId)
    const ids2 = result2.events.map((e) => e.eventId)
    expect(ids1).toEqual(ids2)
  })

  it('stateAt returns consistent state at t=0', () => {
    const scene = passingScene()
    const state = electricRegionEngine.stateAtSeconds(scene, 0)
    const pos = toCanonicalVector(state.objects[0]!.position!).vectorSI
    expect(pos.x).toBeCloseTo(-0.08)
    expect(pos.y).toBe(0)
  })

  it('HitPlate scene produces no ExitField event', () => {
    const scene = hitPlateScene()
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    const types = result.events.map((e) => e.type)
    expect(types).toContain('HitPlate')
    expect(types).not.toContain('ExitField')
  })
})

/* ------------------------------------------------ boundary conditions -- */

/* A particle that never crosses the region must stay in the "before" phase for
   the whole run: no field force, no transition events, and a passing
   verification. Regression for the bug where such particles were modelled as
   inside the field from t=0. */
describe('ElectricRegionEngine boundary conditions', () => {
  it('never applies the field to a particle starting right of the region moving away', () => {
    const scene = createParallelPlateScene({
      charge: 1.6e-19,
      mass: 9.11e-31,
      position: vec3(0.1, 0, 0), // right of xRight = 0.06
      velocity: vec3(3e7, 0, 0), // moving further right
      electricFieldStrength: 10000,
      electricFieldDirection: 'up',
      plateSeparation: 0.04,
      plateLength: 0.12,
      duration: 8e-9,
    })
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    expect(result.events).toHaveLength(0)
    expect(result.verification.status).toBe('passed')
    for (const state of result.states) {
      const accel = toCanonicalVector(state.objects[0]!.acceleration!).vectorSI
      expect(accel.x).toBe(0)
      expect(accel.y).toBe(0)
    }
  })

  it('never applies the field to a particle starting left of the region moving away', () => {
    const scene = createParallelPlateScene({
      charge: 1.6e-19,
      mass: 9.11e-31,
      position: vec3(-0.1, 0, 0), // left of xLeft = -0.06
      velocity: vec3(-3e7, 0, 0), // moving further left
      electricFieldStrength: 10000,
      electricFieldDirection: 'up',
      plateSeparation: 0.04,
      plateLength: 0.12,
      duration: 8e-9,
    })
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    expect(result.events).toHaveLength(0)
    expect(result.verification.status).toBe('passed')
    for (const state of result.states) {
      const accel = toCanonicalVector(state.objects[0]!.acceleration!).vectorSI
      expect(accel.x).toBe(0)
      expect(accel.y).toBe(0)
    }
  })

  it('applies the field to a particle entering from the right', () => {
    const scene = createParallelPlateScene({
      charge: 1.6e-19,
      mass: 9.11e-31,
      position: vec3(0.1, 0, 0), // right of xRight = 0.06
      velocity: vec3(-3e7, 0, 0), // moving left, so it crosses xRight into the region
      electricFieldStrength: 10000,
      electricFieldDirection: 'up',
      plateSeparation: 0.04,
      plateLength: 0.12,
      duration: 8e-9,
    })
    const result = electricRegionEngine.simulate(scene, simRequest(scene))
    expect(result.events.map((e) => e.type)).toContain('EnterField')
    expect(result.verification.status).toBe('passed')
    const accelStates = result.states
      .map((state) => toCanonicalVector(state.objects[0]!.acceleration!).vectorSI)
      .filter((a) => Math.abs(a.y) > 0)
    expect(accelStates.length).toBeGreaterThan(0)
  })

  it('counts only the remaining distance when the particle starts inside the region', () => {
    const scene = createParallelPlateScene({
      charge: 1.6e-19,
      mass: 9.11e-31,
      position: vec3(0, 0, 0), // inside [xLeft, xRight]
      velocity: vec3(3e7, 0, 0),
      electricFieldStrength: 0, // no deflection, pure x motion
      electricFieldDirection: 'up',
      plateSeparation: 0.04,
      plateLength: 0.12, // xLeft = -0.06, xRight = 0.06
      duration: 8e-9,
    })
    // x(t) = 3e7 * t; the region ends at 0.06, so the particle exits at t = 2e-9.
    const justAfterExit = electricRegionEngine.stateAtSeconds(scene, 2.5e-9)
    const pos = toCanonicalVector(justAfterExit.objects[0]!.position!).vectorSI
    expect(pos.x).toBeCloseTo(3e7 * 2.5e-9, 6)
    const accel = toCanonicalVector(justAfterExit.objects[0]!.acceleration!).vectorSI
    expect(accel.y).toBe(0)
  })
})
