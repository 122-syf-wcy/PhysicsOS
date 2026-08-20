import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TOLERANCE,
  derivedScalar,
  derivedVector,
  quantityVector,
  withinTolerance,
  type ObjectState,
  type QuantityVector,
  type SimulationRequest,
  type SimulationResult,
} from '@physicsos/physics-core'
import { dot, magnitude, vec3, type Vector3 } from '@physicsos/physics-math'
import { defaultCoordinateSystem, type PhysicsScene } from '@physicsos/physics-scene'
import { asSceneId, asSimulationId, asTraceId } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import { MAGNETIC_MODEL_ASSUMPTIONS, MagneticEngine } from '../src/magnetic-engine.ts'

const ELECTRON_CHARGE = -1.6e-19
const ELECTRON_MASS = 9.11e-31

interface SceneOptions {
  readonly charge?: number
  readonly mass?: number
  readonly position?: Vector3
  readonly velocity?: Vector3
  readonly magneticField?: Vector3
}

const createScene = (options: SceneOptions = {}): PhysicsScene => ({
  schemaVersion: 'physics-scene/1.0',
  id: asSceneId('magnetic-golden-scene'),
  revision: 0,
  dimension: '2d',
  coordinateSystem: defaultCoordinateSystem(),
  timeline: {
    currentTime: quantity(0, 's', 'time'),
    startTime: quantity(0, 's', 'time'),
    state: 'idle',
    playbackRate: 1,
  },
  bodies: [],
  particles: [
    {
      id: 'particle-1',
      type: 'particle',
      mass: quantity(options.mass ?? ELECTRON_MASS, 'kg', 'mass'),
      charge: quantity(options.charge ?? ELECTRON_CHARGE, 'C', 'electric_charge'),
      position: quantityVector(options.position ?? vec3(0, 0, 0), 'm', 'length'),
      velocity: quantityVector(options.velocity ?? vec3(1e6, 0, 0), 'm/s', 'velocity'),
    },
  ],
  fields: [
    {
      id: 'field-1',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(
        options.magneticField ?? vec3(0, 0, 0.5),
        'T',
        'magnetic_flux_density',
      ),
    },
  ],
  forces: [],
  regions: [],
  boundaries: [],
  constraints: [],
  circuits: [],
  measurementDefinitions: [],
  observableDefinitions: [],
  annotations: [],
  metadata: {
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  },
})

const createRequest = (scene: PhysicsScene): SimulationRequest => ({
  schemaVersion: 'simulation-request/1.0',
  simulationId: asSimulationId(`simulation-${scene.revision}`),
  sceneId: scene.id,
  sceneRevision: scene.revision,
  options: {},
  trace: { traceId: asTraceId(`trace-${scene.revision}`) },
})

const run = (engine: MagneticEngine, scene: PhysicsScene): SimulationResult =>
  engine.simulate(scene, createRequest(scene))

const objectAt = (result: SimulationResult, time: number): ObjectState => {
  const state = result.states.find((candidate) => withinTolerance(candidate.time.value, time))
  const object = state?.objects[0]
  if (object === undefined) throw new Error(`Missing particle state at t=${String(time)}.`)
  return object
}

const requireVector = (value: QuantityVector | undefined, label: string): Vector3 => {
  if (value === undefined) throw new Error(`Missing ${label}.`)
  return value.vector
}

describe('Magnetic Golden Tests', () => {
  const engine = new MagneticEngine()

  describe('frozen model boundary', () => {
    it('1. accepts one charged particle with v perpendicular to a uniform B field', () => {
      expect(engine.canHandle(createScene()).supported).toBe(true)
    })

    it('2. rejects a scene without a particle', () => {
      const scene = createScene()
      scene.particles = []
      expect(engine.canHandle(scene).supported).toBe(false)
    })

    it('3. rejects a neutral particle', () => {
      expect(engine.canHandle(createScene({ charge: 0 })).supported).toBe(false)
    })

    it('4. rejects a zero magnetic field', () => {
      expect(engine.canHandle(createScene({ magneticField: vec3(0, 0, 0) })).supported).toBe(false)
    })

    it('5. rejects velocity with a component parallel to B', () => {
      expect(engine.canHandle(createScene({ velocity: vec3(1e6, 0, 1) })).supported).toBe(false)
    })

    it('6. rejects additional non-magnetic fields and regional magnetic fields', () => {
      const scene = createScene()
      scene.fields.push({
        id: 'electric-field',
        type: 'uniform_electric',
        fieldStrength: quantityVector(vec3(1, 0, 0), 'V/m', 'electric_field'),
      })
      expect(engine.canHandle(scene).supported).toBe(false)

      const regional = createScene()
      const field = regional.fields[0]
      if (field === undefined) throw new Error('Expected a magnetic field.')
      field.regionId = 'region-1'
      regional.regions.push({
        id: 'region-1',
        center: quantityVector(vec3(0, 0, 0), 'm', 'length'),
        shape: { type: 'unbounded' },
      })
      expect(engine.canHandle(regional).supported).toBe(false)
    })
  })

  describe('analytical facts', () => {
    it('7. computes r = mv / |q|B', () => {
      const result = run(engine, createScene())
      const expected = (ELECTRON_MASS * 1e6) / (Math.abs(ELECTRON_CHARGE) * 0.5)
      expect(derivedScalar(result.derivedQuantities, 'cyclotron_radius').value).toBeCloseTo(
        expected,
        12,
      )
    })

    it('8. computes T = 2πm / |q|B', () => {
      const result = run(engine, createScene())
      const expected = (2 * Math.PI * ELECTRON_MASS) / (Math.abs(ELECTRON_CHARGE) * 0.5)
      expect(derivedScalar(result.derivedQuantities, 'cyclotron_period').value).toBeCloseTo(
        expected,
        12,
      )
    })

    it('9. computes ω = |q|B / m', () => {
      const result = run(engine, createScene())
      const expected = (Math.abs(ELECTRON_CHARGE) * 0.5) / ELECTRON_MASS
      expect(derivedScalar(result.derivedQuantities, 'angular_velocity').value).toBeCloseTo(
        expected,
        12,
      )
    })

    it('10. computes |F| = |q|vB', () => {
      const result = run(engine, createScene())
      const expected = Math.abs(ELECTRON_CHARGE) * 1e6 * 0.5
      expect(derivedScalar(result.derivedQuantities, 'lorentz_force_magnitude').value).toBeCloseTo(
        expected,
        12,
      )
    })

    it('11. carries all approved model assumptions in SimulationResult facts', () => {
      const result = run(engine, createScene())
      const assumptions = new Set(
        result.derivedQuantities.flatMap((entry) => entry.assumptions ?? []),
      )
      expect([...MAGNETIC_MODEL_ASSUMPTIONS].every((entry) => assumptions.has(entry))).toBe(true)
    })
  })

  describe('trajectory facts', () => {
    it('12. samples t = 0, T/4, T/2, 3T/4 and T', () => {
      const result = run(engine, createScene())
      const period = derivedScalar(result.derivedQuantities, 'cyclotron_period').value
      const expected = [0, period / 4, period / 2, (3 * period) / 4, period]
      expect(result.states.length).toBeGreaterThanOrEqual(65)
      expect(
        expected.every((time) =>
          result.states.some((state) => withinTolerance(state.time.value, time)),
        ),
      ).toBe(true)
    })

    it('13. stateAt(0) equals the initial state', () => {
      const scene = createScene({ position: vec3(0.002, -0.001, 0) })
      const state = engine.stateAt(scene, quantity(0, 's', 'time'))
      expect(state.objects[0]?.position?.vector).toEqual(vec3(0.002, -0.001, 0))
      expect(state.objects[0]?.velocity?.vector).toEqual(vec3(1e6, 0, 0))
    })

    it('14. returns to the initial position and velocity after one period', () => {
      const scene = createScene({ position: vec3(0.002, -0.001, 0) })
      const result = run(engine, scene)
      const period = derivedScalar(result.derivedQuantities, 'cyclotron_period').value
      const initial = objectAt(result, 0)
      const final = objectAt(result, period)
      const initialPosition = requireVector(initial.position, 'initial position')
      const finalPosition = requireVector(final.position, 'final position')
      const initialVelocity = requireVector(initial.velocity, 'initial velocity')
      const finalVelocity = requireVector(final.velocity, 'final velocity')
      expect(vectorsWithinTolerance(finalPosition, initialPosition)).toBe(true)
      expect(vectorsWithinTolerance(finalVelocity, initialVelocity)).toBe(true)
    })

    it('15. conserves speed at every verification sample', () => {
      const result = run(engine, createScene({ velocity: vec3(3e5, 4e5, 0) }))
      const speeds = result.states.map((state) =>
        magnitude(requireVector(state.objects[0]?.velocity, 'sample velocity')),
      )
      expect(speeds.every((speed) => withinTolerance(speed, speeds[0] ?? Number.NaN))).toBe(true)
    })

    it('16. keeps Lorentz force perpendicular to velocity', () => {
      const result = run(engine, createScene())
      for (const state of result.states) {
        const velocity = requireVector(state.objects[0]?.velocity, 'sample velocity')
        const force = derivedVector(state.derived, 'lorentz_force_vector').vector
        expect(
          Math.abs(dot(force, velocity)) / (magnitude(force) * magnitude(velocity)),
        ).toBeLessThanOrEqual(DEFAULT_TOLERANCE.angular)
      }
    })
  })

  describe('metamorphic runtime relationships', () => {
    it('17. B 0.50 → 1.00 halves r/T and doubles ω/F without changing speed', () => {
      const before = run(engine, createScene({ magneticField: vec3(0, 0, 0.5) }))
      const after = run(engine, createScene({ magneticField: vec3(0, 0, 1) }))
      expect(scalar(after, 'cyclotron_radius')).toBeCloseTo(
        scalar(before, 'cyclotron_radius') / 2,
        12,
      )
      expect(scalar(after, 'cyclotron_period')).toBeCloseTo(
        scalar(before, 'cyclotron_period') / 2,
        12,
      )
      expect(scalar(after, 'angular_velocity')).toBeCloseTo(
        scalar(before, 'angular_velocity') * 2,
        12,
      )
      expect(scalar(after, 'lorentz_force_magnitude')).toBeCloseTo(
        scalar(before, 'lorentz_force_magnitude') * 2,
        12,
      )
      expect(speedAtZero(after)).toBe(speedAtZero(before))
    })

    it('18. charge sign reversal preserves r/T and reverses force and rotation', () => {
      const negative = run(engine, createScene({ charge: -Math.abs(ELECTRON_CHARGE) }))
      const positive = run(engine, createScene({ charge: Math.abs(ELECTRON_CHARGE) }))
      expect(scalar(positive, 'cyclotron_radius')).toBeCloseTo(
        scalar(negative, 'cyclotron_radius'),
        12,
      )
      expect(scalar(positive, 'cyclotron_period')).toBeCloseTo(
        scalar(negative, 'cyclotron_period'),
        12,
      )
      expect(scalar(positive, 'rotation_direction')).toBe(-scalar(negative, 'rotation_direction'))
      expect(
        vectorsWithinTolerance(forceAtZero(positive), negateVector(forceAtZero(negative))),
      ).toBe(true)
    })

    it('19. B direction reversal preserves radius and reverses force and rotation', () => {
      const outward = run(engine, createScene({ magneticField: vec3(0, 0, 0.5) }))
      const inward = run(engine, createScene({ magneticField: vec3(0, 0, -0.5) }))
      expect(scalar(inward, 'cyclotron_radius')).toBeCloseTo(
        scalar(outward, 'cyclotron_radius'),
        12,
      )
      expect(scalar(inward, 'rotation_direction')).toBe(-scalar(outward, 'rotation_direction'))
      expect(vectorsWithinTolerance(forceAtZero(inward), negateVector(forceAtZero(outward)))).toBe(
        true,
      )
    })
  })
})

const scalar = (result: SimulationResult, key: string): number =>
  derivedScalar(result.derivedQuantities, key).value

const speedAtZero = (result: SimulationResult): number =>
  magnitude(requireVector(objectAt(result, 0).velocity, 'initial velocity'))

const forceAtZero = (result: SimulationResult): Vector3 =>
  derivedVector(result.derivedQuantities, 'lorentz_force_vector').vector

const subtractVectors = (left: Vector3, right: Vector3): Vector3 =>
  vec3(left.x - right.x, left.y - right.y, left.z - right.z)

const negateVector = (vector: Vector3): Vector3 => vec3(-vector.x, -vector.y, -vector.z)

const vectorsWithinTolerance = (actual: Vector3, expected: Vector3): boolean => {
  const error = magnitude(subtractVectors(actual, expected))
  const reference = Math.max(magnitude(actual), magnitude(expected))
  return error <= DEFAULT_TOLERANCE.absolute || error <= DEFAULT_TOLERANCE.relative * reference
}
