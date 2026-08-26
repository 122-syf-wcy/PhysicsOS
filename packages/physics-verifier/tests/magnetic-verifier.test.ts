import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TOLERANCE,
  derivedScalar,
  isQuantityVector,
  isScalarQuantity,
  quantityVector,
  withinTolerance,
  type SimulationRequest,
  type SimulationResult,
} from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import { defaultCoordinateSystem, type PhysicsScene } from '@physicsos/physics-scene'
import { asSceneId, asSimulationId, asTraceId } from '@physicsos/shared'
import { quantity } from '@physicsos/physics-units'

import { MagneticEngine } from '../../engine-magnetic/src/magnetic-engine.ts'
import { verifyMagneticScene } from '../src/index.ts'

const createScene = (): PhysicsScene => ({
  schemaVersion: 'physics-scene/1.0',
  id: asSceneId('verifier-scene'),
  revision: 3,
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
      mass: quantity(1e-27, 'kg', 'mass'),
      charge: quantity(1.6e-19, 'C', 'electric_charge'),
      position: quantityVector(vec3(0.002, -0.001, 0), 'm', 'length'),
      velocity: quantityVector(vec3(2e5, 1e5, 0), 'm/s', 'velocity'),
    },
  ],
  fields: [
    {
      id: 'field-1',
      type: 'uniform_magnetic',
      magneticFluxDensity: quantityVector(vec3(0, 0, 0.5), 'T', 'magnetic_flux_density'),
    },
  ],
  forces: [],
  regions: [],
  boundaries: [],
  constraints: [],
  circuits: [],
  opticalBenches: [],
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

const run = (scene: PhysicsScene): SimulationResult =>
  new MagneticEngine().simulate(scene, createRequest(scene))

describe('MagneticPhysicsVerifier', () => {
  it('accepts a real MagneticEngine result and annotates every check with comparison details', () => {
    const scene = createScene()
    const result = run(scene)
    const verification = verifyMagneticScene(scene, result)

    expect(verification.status).toBe('passed')
    expect(verification.checks.length).toBeGreaterThan(0)
    for (const check of verification.checks) {
      expect(check.details).toEqual(
        expect.objectContaining({
          expected: expect.anything(),
          actual: expect.anything(),
          tolerance: expect.objectContaining({
            relative: expect.any(Number),
            absolute: expect.any(Number),
            angular: expect.any(Number),
          }),
        }),
      )
    }
  })

  it('fails when a derived radius is changed without re-running the engine', () => {
    const scene = createScene()
    const result = run(scene)
    const broken = structuredClone(result)
    const radius = broken.derivedQuantities.find((entry) => entry.key === 'cyclotron_radius')
    if (radius === undefined || !isScalarQuantity(radius.value)) {
      throw new Error('Golden result did not contain a scalar radius.')
    }
    radius.value.value *= 1.1

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(verification.checks.find((check) => check.id === 'radius_consistency')?.passed).toBe(
      false,
    )
  })

  it('fails when a sampled state is changed, proving the verifier consumes result states', () => {
    const scene = createScene()
    const result = run(scene)
    const broken = structuredClone(result)
    const period = derivedScalar(broken.derivedQuantities, 'cyclotron_period').value
    const finalState = broken.states.find((state) => state.time.value === period)
    const finalObject = finalState?.objects[0]
    const finalPosition = finalObject?.position?.vector
    if (finalPosition === undefined)
      throw new Error('Golden result did not contain a final position.')
    finalPosition.x += 0.01

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'state_at_period_matches_initial')?.passed,
    ).toBe(false)
  })

  it('fails when an intermediate trajectory position leaves the verified orbit', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    const intermediate = broken.states[Math.floor(broken.states.length / 8)]?.objects[0]?.position
    if (intermediate === undefined)
      throw new Error('Golden result did not contain a trajectory position.')
    intermediate.vector.x += 0.01

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'trajectory_radius_consistency')?.passed,
    ).toBe(false)
  })

  it('fails when the orbit center or rotation direction is changed', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    const center = broken.derivedQuantities.find((entry) => entry.key === 'orbit_center')
    const direction = broken.derivedQuantities.find((entry) => entry.key === 'rotation_direction')
    if (center === undefined || !isQuantityVector(center.value)) {
      throw new Error('Golden result did not contain an orbit center.')
    }
    if (direction === undefined || !isScalarQuantity(direction.value)) {
      throw new Error('Golden result did not contain a rotation direction.')
    }
    center.value.vector.y += 0.01
    direction.value.value *= -1

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'orbit_center_consistency')?.passed,
    ).toBe(false)
    expect(
      verification.checks.find((check) => check.id === 'rotation_direction_consistency')?.passed,
    ).toBe(false)
  })

  it('rejects a regional magnetic field as outside the frozen model', () => {
    const scene = createScene()
    const field = scene.fields[0]
    if (field === undefined) throw new Error('Expected a magnetic field.')
    field.regionId = 'region-1'
    scene.regions.push({
      id: 'region-1',
      center: quantityVector(vec3(0, 0, 0), 'm', 'length'),
      shape: { type: 'unbounded' },
    })

    const result = run(createScene())
    const verification = verifyMagneticScene(scene, result)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'magnetic_model_preconditions')?.passed,
    ).toBe(false)
  })

  it('fails when one model assumption is removed from derived facts', () => {
    const scene = createScene()
    const result = run(scene)
    const broken = structuredClone(result)
    if (broken.derivedQuantities.length === 0) {
      throw new Error('Golden result did not contain derived facts.')
    }
    for (const derived of broken.derivedQuantities) {
      derived.assumptions = (derived.assumptions ?? []).filter(
        (assumption) => assumption !== 'ignore gravity',
      )
    }

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(verification.checks.find((check) => check.id === 'model_assumptions')?.passed).toBe(
      false,
    )
  })

  it('fails when the result revision no longer matches the scene revision', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    broken.sceneRevision += 1

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'result_scene_revision_match')?.passed,
    ).toBe(false)
  })

  it('fails when an engine-derived unit and dimension are changed', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    const period = broken.derivedQuantities.find((entry) => entry.key === 'cyclotron_period')
    if (period === undefined || !isScalarQuantity(period.value)) {
      throw new Error('Golden result did not contain a scalar period.')
    }
    period.value.unit = 'm'
    period.value.dimension = 'length'

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(verification.checks.find((check) => check.id === 'period_unit')?.passed).toBe(false)
  })

  it('fails the recursive finite check for a non-finite result number', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    broken.metadata.durationMs = Number.POSITIVE_INFINITY

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(verification.checks.find((check) => check.id === 'all_finite')?.passed).toBe(false)
  })

  it('uses one caller-provided PhysicsTolerance for comparisons and check evidence', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    const radius = broken.derivedQuantities.find((entry) => entry.key === 'cyclotron_radius')
    if (radius === undefined || !isScalarQuantity(radius.value)) {
      throw new Error('Golden result did not contain a scalar radius.')
    }
    radius.value.value *= 1.1
    const tolerance = {
      ...DEFAULT_TOLERANCE,
      relative: 0.2,
    }

    const verification = verifyMagneticScene(scene, broken, tolerance)
    const radiusCheck = verification.checks.find((check) => check.id === 'radius_consistency')
    expect(radiusCheck?.passed).toBe(true)
    expect(radiusCheck?.details?.tolerance).toEqual(tolerance)
  })

  it('fails when duplicate state force representations diverge', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    const period = derivedScalar(broken.derivedQuantities, 'cyclotron_period').value
    const state = broken.states.find((candidate) =>
      withinTolerance(candidate.time.value, period / 4),
    )
    const force = state?.objects[0]?.values?.lorentz_force
    if (force === undefined || !isQuantityVector(force)) {
      throw new Error('Golden result did not contain an object force vector.')
    }
    force.vector.x += 1

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'force_state_representations')?.passed,
    ).toBe(false)
  })

  it('fails when the derived Lorentz force direction is reversed', () => {
    const scene = createScene()
    const broken = structuredClone(run(scene))
    const force = broken.derivedQuantities.find((entry) => entry.key === 'lorentz_force_vector')
    if (force === undefined || !isQuantityVector(force.value)) {
      throw new Error('Golden result did not contain a derived force vector.')
    }
    force.value.vector.x *= -1
    force.value.vector.y *= -1
    force.value.vector.z *= -1

    const verification = verifyMagneticScene(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'lorentz_force_vector_consistency')?.passed,
    ).toBe(false)
  })
})
