import { describe, expect, it } from 'vitest'
import { add, cross, dot, magnitude, scale, vec3, type Vector3 } from '@physicsos/physics-math'
import { quantity } from '@physicsos/physics-units'
import { quantityVector, toCanonicalVector } from '@physicsos/physics-core'
import {
  createElectricScene,
  createMagneticScene,
  createParallelPlateScene,
  createPointChargeScene,
  defaultCoordinateSystem,
  isCompositeFieldScene,
  sampleFieldsAt,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { compositeForce, driftVelocity, cyclotronPeriod } from '@physicsos/physics-composite-core'

import {
  CompositeEngine,
  compositeEngine,
  createCompositeSimulationRequest,
  decomposePhases,
  resolveCompositeModel,
} from '../src/index.ts'

/* ------------------------------------------------------------------ scenes -- */

const PROTON = { charge: 1.6e-19, mass: 1.67e-27 }

interface CompositeInput {
  readonly charge?: number
  readonly mass?: number
  readonly position?: Vector3
  readonly velocity?: Vector3
  readonly electricField?: Vector3
  readonly magneticFluxDensity?: Vector3
  readonly gravity?: Vector3
  /** Bind E and B to a rectangle instead of letting them act globally. */
  readonly region?: { width: number; height: number; center?: Vector3 }
  readonly duration?: number
  readonly revision?: number
}

/* Scenes are assembled here rather than through a factory: the composite scene
   factories are a separate work item, and the engine only ever reads fields,
   regions and the particle — so a hand-built scene exercises the same surface. */
const compositeScene = (input: CompositeInput = {}): PhysicsScene => {
  const regionId = input.region === undefined ? undefined : 'region-1'
  const fields: PhysicsScene['fields'] = []
  if (input.electricField !== undefined) {
    fields.push({
      id: 'electric-1',
      type: 'uniform_electric',
      fieldStrength: quantityVector(input.electricField, 'V/m', 'electric_field'),
      ...(regionId === undefined ? {} : { regionId }),
    })
  }
  if (input.magneticFluxDensity !== undefined) {
    fields.push({
      id: 'magnetic-1',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(input.magneticFluxDensity, 'T', 'magnetic_flux_density'),
      ...(regionId === undefined ? {} : { regionId }),
    })
  }
  if (input.gravity !== undefined) {
    fields.push({
      id: 'gravity-1',
      type: 'uniform_gravity',
      acceleration: quantityVector(input.gravity, 'm/s^2', 'acceleration'),
    })
  }
  const now = '2026-08-23T00:00:00.000Z' as PhysicsScene['metadata']['createdAt']
  return {
    schemaVersion: 'physics-scene/1.0',
    id: 'composite-test-scene' as PhysicsScene['id'],
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(input.duration ?? 1e-6, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
      simulationTimeStep: quantity(1 / 240, 's', 'time'),
    },
    bodies: [],
    particles: [
      {
        id: 'particle-1',
        type: 'particle',
        mass: quantity(input.mass ?? PROTON.mass, 'kg', 'mass'),
        charge: quantity(input.charge ?? PROTON.charge, 'C', 'electric_charge'),
        position: quantityVector(input.position ?? vec3(0, 0, 0), 'm', 'length'),
        velocity: quantityVector(input.velocity ?? vec3(1e5, 0, 0), 'm/s', 'velocity'),
      },
    ],
    fields,
    forces: [],
    regions:
      input.region === undefined
        ? []
        : [
            {
              id: 'region-1',
              shape: {
                type: 'rectangle',
                width: quantity(input.region.width, 'm', 'length'),
                height: quantity(input.region.height, 'm', 'length'),
              },
              center: quantityVector(input.region.center ?? vec3(0, 0, 0), 'm', 'length'),
            },
          ],
    boundaries: [],
    constraints: [],
    circuits: [],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    measurementDefinitions: [],
    observableDefinitions: [],
    annotations: [],
    metadata: { createdAt: now, updatedAt: now, title: 'composite test scene' },
  }
}

const simulate = (scene: PhysicsScene) =>
  compositeEngine.simulate(scene, createCompositeSimulationRequest(scene, 'sim-1', 'trace-1'))

const positionAt = (result: ReturnType<typeof simulate>, index: number): Vector3 =>
  toCanonicalVector(result.states[index]!.objects[0]!.position!).vectorSI

const velocityAt = (result: ReturnType<typeof simulate>, index: number): Vector3 =>
  toCanonicalVector(result.states[index]!.objects[0]!.velocity!).vectorSI

const derived = (result: ReturnType<typeof simulate>, key: string) => {
  const entry = result.derivedQuantities.find((candidate) => candidate.key === key)
  if (entry === undefined) throw new Error(`missing derived quantity ${key}`)
  return entry.value
}

const scalarOf = (result: ReturnType<typeof simulate>, key: string): number => {
  const value = derived(result, key)
  if ('vector' in value) throw new Error(`${key} is a vector`)
  return value.value
}

/* ------------------------------------------------------- velocity selector -- */

/* E down + B INTO the page (-z) + positive charge along +x makes the electric and
   magnetic forces oppose, which is the only geometry where they can cancel. With B
   out of the page they would add, and no speed would pass. */
const SELECTOR_E = 1e4
const SELECTOR_B = 0.1
const SELECTOR_SPEED = SELECTOR_E / SELECTOR_B

const selectorScene = (speed = SELECTOR_SPEED) =>
  compositeScene({
    velocity: vec3(speed, 0, 0),
    electricField: vec3(0, -SELECTOR_E, 0),
    magneticFluxDensity: vec3(0, 0, -SELECTOR_B),
    duration: 1e-7,
  })

describe('velocity selector', () => {
  it('passes a particle at v = E/B along a straight line', () => {
    const scene = selectorScene()
    const result = simulate(scene)
    const last = result.states.length - 1
    const travelled = positionAt(result, last)
    /* Straight along x, no deflection in y. */
    expect(travelled.y).toBeCloseTo(0, 12)
    expect(travelled.x).toBeCloseTo(SELECTOR_SPEED * 1e-7, 9)
    expect(magnitude(velocityAt(result, last))).toBeCloseTo(SELECTOR_SPEED, 3)
  })

  it('reports zero net force at the selected speed', () => {
    const result = simulate(selectorScene())
    expect(scalarOf(result, 'net_force_magnitude')).toBeLessThan(1e-28)
    expect(scalarOf(result, 'selected_velocity')).toBeCloseTo(SELECTOR_SPEED, 6)
  })

  it('deflects a particle that is off the selected speed', () => {
    const result = simulate(selectorScene(SELECTOR_SPEED * 1.5))
    const last = result.states.length - 1
    expect(Math.abs(positionAt(result, last).y)).toBeGreaterThan(0)
    expect(scalarOf(result, 'net_force_magnitude')).toBeGreaterThan(0)
  })

  it('cannot balance when B points out of the page instead', () => {
    const scene = compositeScene({
      velocity: vec3(SELECTOR_SPEED, 0, 0),
      electricField: vec3(0, -SELECTOR_E, 0),
      magneticFluxDensity: vec3(0, 0, SELECTOR_B),
      duration: 1e-7,
    })
    const sample = sampleFieldsAt(scene, vec3(0, 0, 0))
    const force = compositeForce(PROTON.charge, PROTON.mass, vec3(SELECTOR_SPEED, 0, 0), sample)
    /* Both forces point the same way, so the magnitudes add rather than cancel. */
    expect(Math.sign(force.electricForce.y)).toBe(Math.sign(force.magneticForce.y))
    expect(magnitude(force.totalForce)).toBeGreaterThan(1e-30)
  })

  it('selects the same speed regardless of charge and mass', () => {
    const light = simulate(selectorScene())
    const heavy = simulate(
      compositeScene({
        charge: PROTON.charge * 2,
        mass: PROTON.mass * 4,
        velocity: vec3(SELECTOR_SPEED, 0, 0),
        electricField: vec3(0, -SELECTOR_E, 0),
        magneticFluxDensity: vec3(0, 0, -SELECTOR_B),
        duration: 1e-7,
      }),
    )
    expect(scalarOf(light, 'selected_velocity')).toBeCloseTo(scalarOf(heavy, 'selected_velocity'), 6)
    /* Both pass straight through. */
    expect(positionAt(heavy, heavy.states.length - 1).y).toBeCloseTo(0, 12)
  })
})

/* ------------------------------------------------------------ pure magnetic -- */

describe('magnetic deflection', () => {
  it('follows r = mv/(qB) when only B acts', () => {
    const speed = 1e5
    const B = 0.05
    const scene = compositeScene({
      velocity: vec3(speed, 0, 0),
      magneticFluxDensity: vec3(0, 0, -B),
      gravity: vec3(0, 0, 0),
      duration: 1e-6,
    })
    const result = simulate(scene)
    const expectedRadius = (PROTON.mass * speed) / (PROTON.charge * B)
    expect(scalarOf(result, 'gyro_radius')).toBeCloseTo(expectedRadius, 6)
  })

  it('conserves speed under a magnetic field alone', () => {
    const scene = compositeScene({
      velocity: vec3(1e5, 5e4, 0),
      magneticFluxDensity: vec3(0, 0, -0.05),
      gravity: vec3(0, 0, 0),
      duration: 1e-6,
    })
    const result = simulate(scene)
    const initial = magnitude(velocityAt(result, 0))
    for (let i = 1; i < result.states.length; i += 1) {
      expect(magnitude(velocityAt(result, i))).toBeCloseTo(initial, 3)
    }
    expect(
      result.verification.checks.find((c) => c.id === 'speed_conserved_in_pure_magnetic')?.passed,
    ).toBe(true)
  })

  it('gives a period set by q/m and B, not by speed', () => {
    const B = 0.05
    const slow = compositeScene({
      velocity: vec3(1e4, 0, 0),
      magneticFluxDensity: vec3(0, 0, -B),
      gravity: vec3(0, 0, 0),
    })
    const fast = compositeScene({
      velocity: vec3(1e6, 0, 0),
      magneticFluxDensity: vec3(0, 0, -B),
      gravity: vec3(0, 0, 0),
    })
    expect(scalarOf(simulate(slow), 'cyclotron_period')).toBeCloseTo(
      scalarOf(simulate(fast), 'cyclotron_period'),
      12,
    )
    const expected = (2 * Math.PI * PROTON.mass) / (PROTON.charge * B)
    expect(scalarOf(simulate(slow), 'cyclotron_period')).toBeCloseTo(expected, 12)
  })
})

/* ---------------------------------------------------------- three forces -- */

describe('composite of all three forces', () => {
  it('reports the net force as the exact sum of its parts', () => {
    const scene = compositeScene({
      velocity: vec3(1e5, 2e4, 0),
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
      gravity: vec3(0, -9.8, 0),
    })
    const result = simulate(scene)
    const electric = derived(result, 'electric_force_vector')
    const magnetic = derived(result, 'magnetic_force_vector')
    const gravity = derived(result, 'gravity_force_vector')
    const net = derived(result, 'net_force_vector')
    if (!('vector' in electric) || !('vector' in magnetic) || !('vector' in gravity) || !('vector' in net)) {
      throw new Error('force derived quantities must be vectors')
    }
    const summed = add(add(electric.vector, magnetic.vector), gravity.vector)
    expect(magnitude(summed) === 0 ? 0 : magnitude({ x: summed.x - net.vector.x, y: summed.y - net.vector.y, z: summed.z - net.vector.z }) / magnitude(summed)).toBeLessThan(1e-12)
    expect(
      result.verification.checks.find((c) => c.id === 'composite_force_superposition')?.passed,
    ).toBe(true)
  })

  it('never lets the magnetic force do work', () => {
    const scene = compositeScene({
      velocity: vec3(1e5, 2e4, 0),
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
      gravity: vec3(0, -9.8, 0),
    })
    const result = simulate(scene)
    for (let i = 0; i < result.states.length; i += 1) {
      const velocity = velocityAt(result, i)
      const sample = sampleFieldsAt(scene, positionAt(result, i))
      const force = compositeForce(PROTON.charge, PROTON.mass, velocity, sample)
      const denominator = magnitude(force.magneticForce) * magnitude(velocity)
      if (denominator === 0) continue
      expect(Math.abs(dot(force.magneticForce, velocity)) / denominator).toBeLessThan(1e-12)
    }
    expect(
      result.verification.checks.find((c) => c.id === 'magnetic_force_does_no_work')?.passed,
    ).toBe(true)
  })

  it('matches an RK4 integration of the full force law', () => {
    const charge = PROTON.charge
    const mass = PROTON.mass
    const E = vec3(1e3, 0, 0)
    const B = vec3(0, 0, -0.02)
    const g = vec3(0, -9.8, 0)
    const v0 = vec3(1e5, 2e4, 0)
    const scene = compositeScene({
      velocity: v0,
      electricField: E,
      magneticFluxDensity: B,
      gravity: g,
    })
    const sample = sampleFieldsAt(scene, vec3(0, 0, 0))
    const period = cyclotronPeriod(charge, mass, sample)!
    const tEnd = period * 1.37

    /* Plain-arithmetic RK4, sharing no code with the closed form it checks. */
    const accel = (v: Vector3) =>
      add(add(scale(E, charge / mass), scale(cross(v, B), charge / mass)), g)
    let v = { ...v0 }
    const steps = 40000
    const dt = tEnd / steps
    for (let i = 0; i < steps; i += 1) {
      const k1 = accel(v)
      const k2 = accel(add(v, scale(k1, dt / 2)))
      const k3 = accel(add(v, scale(k2, dt / 2)))
      const k4 = accel(add(v, scale(k3, dt)))
      v = add(v, scale(add(add(k1, scale(k2, 2)), add(scale(k3, 2), k4)), dt / 6))
    }

    const state = compositeEngine.stateAtSeconds(scene, tEnd)
    const analytic = toCanonicalVector(state.objects[0]!.velocity!).vectorSI
    const error = magnitude({ x: v.x - analytic.x, y: v.y - analytic.y, z: 0 }) / magnitude(v)
    expect(error).toBeLessThan(1e-6)
  })

  it('degrades to uniform acceleration when B is absent', () => {
    const scene = compositeScene({
      velocity: vec3(0, 0, 0),
      electricField: vec3(1e3, 0, 0),
      gravity: vec3(0, -9.8, 0),
      duration: 1e-9,
    })
    const result = simulate(scene)
    const last = result.states.length - 1
    const t = 1e-9
    const a = add(scale(vec3(1e3, 0, 0), PROTON.charge / PROTON.mass), vec3(0, -9.8, 0))
    const travelled = positionAt(result, last)
    expect(travelled.x).toBeCloseTo(0.5 * a.x * t * t, 12)
    expect(Number.isFinite(travelled.x)).toBe(true)
    /* No magnetic field means no drift velocity and no gyration radius. */
    expect(result.derivedQuantities.some((d) => d.key === 'drift_velocity')).toBe(false)
    expect(result.derivedQuantities.some((d) => d.key === 'gyro_radius')).toBe(false)
  })

  it('conserves energy against the work done by E and g', () => {
    const result = simulate(
      compositeScene({
        velocity: vec3(1e5, 2e4, 0),
        electricField: vec3(1e3, 0, 0),
        magneticFluxDensity: vec3(0, 0, -0.02),
        gravity: vec3(0, -9.8, 0),
      }),
    )
    expect(result.verification.checks.find((c) => c.id === 'energy_consistency')?.passed).toBe(true)
  })
})

/* -------------------------------------------------------- region crossing -- */

describe('region crossing', () => {
  /* A selector region 0.2 m wide with the particle starting 0.15 m to its left:
     field-free flight, then the selector, then field-free flight again. */
  const stagedScene = () =>
    compositeScene({
      position: vec3(-0.15, 0, 0),
      velocity: vec3(SELECTOR_SPEED, 0, 0),
      electricField: vec3(0, -SELECTOR_E, 0),
      magneticFluxDensity: vec3(0, 0, -SELECTOR_B),
      region: { width: 0.2, height: 0.1 },
      duration: 4e-6,
    })

  it('splits the run into field-free and in-field phases', () => {
    const scene = stagedScene()
    const model = resolveCompositeModel(scene)
    const { phases } = decomposePhases(scene, model, 4e-6)
    expect(phases.length).toBeGreaterThanOrEqual(3)
    /* First phase sees no field, the second sees both. */
    expect(magnitude(phases[0]!.sample.electricField)).toBe(0)
    expect(magnitude(phases[1]!.sample.electricField)).toBeGreaterThan(0)
    expect(magnitude(phases[1]!.sample.magneticFluxDensity)).toBeGreaterThan(0)
  })

  it('emits enter and exit events for the region', () => {
    const result = simulate(stagedScene())
    const types = result.events.map((event) => event.type)
    expect(types).toContain('EnterRegion')
    expect(types).toContain('ExitRegion')
  })

  it('emits deterministic event ids', () => {
    const scene = stagedScene()
    const first = simulate(scene).events.map((e) => String(e.eventId))
    const second = simulate(scene).events.map((e) => String(e.eventId))
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
  })

  it('crosses the boundary at the geometrically correct time', () => {
    const scene = stagedScene()
    const model = resolveCompositeModel(scene)
    const { phases } = decomposePhases(scene, model, 4e-6)
    /* Region spans x ∈ [-0.1, 0.1]; entry is 0.05 m away at the selected speed. */
    expect(phases[0]!.endTime).toBeCloseTo(0.05 / SELECTOR_SPEED, 9)
  })
})

/* ------------------------------------------------------------- exclusivity -- */

describe('canHandle exclusivity', () => {
  it('accepts a composite scene', () => {
    const support = compositeEngine.canHandle(
      compositeScene({
        electricField: vec3(1e3, 0, 0),
        magneticFluxDensity: vec3(0, 0, -0.02),
      }),
    )
    expect(support.supported).toBe(true)
    if (support.supported) expect(support.domain).toBe('composite')
  })

  it('rejects every single-field scene', () => {
    for (const scene of [
      createElectricScene(),
      createMagneticScene(),
      createParallelPlateScene(),
      createPointChargeScene({ charges: [{ id: 'c1', charge: 1e-6, position: vec3(0, 0, 0) }] }),
    ]) {
      expect(isCompositeFieldScene(scene)).toBe(false)
      expect(compositeEngine.canHandle(scene).supported).toBe(false)
    }
  })

  it('rejects a region shape it cannot sample', () => {
    const base = compositeScene({
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
      region: { width: 0.2, height: 0.1 },
    })
    const circle: PhysicsScene = {
      ...base,
      regions: [
        {
          id: 'region-1',
          shape: { type: 'circle', radius: quantity(0.1, 'm', 'length') },
          center: base.regions[0]!.center,
        },
      ],
    }
    const support = compositeEngine.canHandle(circle)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.some((c) => c.condition === 'sampleable_regions')).toBe(true)
    }
  })

  it('rejects a scene with rigid bodies or explicit forces', () => {
    const base = compositeScene({
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
    })
    expect(compositeEngine.canHandle({ ...base, bodies: [{} as never] }).supported).toBe(false)
    expect(compositeEngine.canHandle({ ...base, forces: [{} as never] }).supported).toBe(false)
  })
})

/* ----------------------------------------------------------------- guards -- */

describe('engine guards', () => {
  it('refuses a stale simulation request', () => {
    const scene = compositeScene({
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
    })
    const request = createCompositeSimulationRequest(scene, 'sim-1', 'trace-1')
    request.sceneRevision += 1
    expect(() => compositeEngine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
  })

  it('refuses a negative time', () => {
    const scene = compositeScene({
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
    })
    expect(() => compositeEngine.stateAtSeconds(scene, -1)).toThrow(/finite and non-negative/)
  })

  it('names itself consistently', () => {
    const engine = new CompositeEngine()
    expect(engine.engineId).toBe('engine-composite')
    expect(engine.domain).toBe('composite')
    const result = simulate(
      compositeScene({ electricField: vec3(1e3, 0, 0), magneticFluxDensity: vec3(0, 0, -0.02) }),
    )
    expect(result.metadata.engineId).toBe('engine-composite')
    expect(result.metadata.deterministic).toBe(true)
  })

  it('passes verification for a well-formed composite scene', () => {
    const result = simulate(
      compositeScene({
        velocity: vec3(1e5, 2e4, 0),
        electricField: vec3(1e3, 0, 0),
        magneticFluxDensity: vec3(0, 0, -0.02),
        gravity: vec3(0, -9.8, 0),
      }),
    )
    expect(result.verification.status).not.toBe('failed')
  })

  it('publishes a drift velocity that zeroes the net force', () => {
    const scene = compositeScene({
      electricField: vec3(1e3, 0, 0),
      magneticFluxDensity: vec3(0, 0, -0.02),
      gravity: vec3(0, -9.8, 0),
    })
    const sample = sampleFieldsAt(scene, vec3(0, 0, 0))
    const drift = driftVelocity(PROTON.charge, PROTON.mass, sample)!
    const force = compositeForce(PROTON.charge, PROTON.mass, drift, sample)
    expect(magnitude(force.totalForce)).toBeLessThan(1e-30)
  })
})
