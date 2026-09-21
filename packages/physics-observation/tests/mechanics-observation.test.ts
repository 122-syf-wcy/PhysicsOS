import { describe, expect, it } from 'vitest'

import { toCanonicalVector } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import { createMechanicsScene } from '@physicsos/physics-scene'

import {
  createMechanicsSimulationRequest,
  MechanicsEngine,
} from '../../engine-mechanics/src/index.ts'
import { observeMechanicsScene } from '../src/index.ts'

const runProjectile = (velocity: ReturnType<typeof vec3>, height: number) => {
  const scene = createMechanicsScene({
    model: 'projectile_motion',
    position: vec3(0, height, 0),
    velocity,
    gravity: vec3(0, -9.8, 0),
    groundY: 0,
  })
  const engine = new MechanicsEngine()
  const simulation = engine.simulate(
    scene,
    createMechanicsSimulationRequest(scene, 'simulation-projectile', 'trace-projectile'),
  )
  return { scene, simulation }
}

const runUniform = (velocity: ReturnType<typeof vec3>, mass: number) => {
  const scene = createMechanicsScene({
    model: 'uniform_linear_motion',
    mass,
    position: vec3(0, 0, 0),
    velocity,
  })
  const engine = new MechanicsEngine()
  const simulation = engine.simulate(
    scene,
    createMechanicsSimulationRequest(scene, 'simulation-uniform', 'trace-uniform'),
  )
  return { scene, simulation }
}

const runNewton = (
  appliedForce: ReturnType<typeof vec3>,
  appliedForces: readonly ReturnType<typeof vec3>[],
) => {
  const scene = createMechanicsScene({
    model: 'newton_second_law',
    mass: 1,
    position: vec3(0, 0, 0),
    velocity: vec3(0, 0, 0),
    gravity: vec3(0, -9.8, 0),
    appliedForce,
    appliedForces,
  })
  const engine = new MechanicsEngine()
  const simulation = engine.simulate(
    scene,
    createMechanicsSimulationRequest(scene, 'simulation-newton', 'trace-newton'),
  )
  return { scene, simulation }
}

describe('observeMechanicsScene', () => {
  it('balances weight with a normal force for supported horizontal motion', () => {
    const { scene, simulation } = runUniform(vec3(4, 0, 0), 2)
    const observed = observeMechanicsScene({ scene, simulation })
    const normal = observed.observations.find(
      (entry) => entry.type === 'mechanics_force' && entry.label === 'normal',
    )
    if (normal?.type !== 'mechanics_force') throw new Error('Normal force is absent.')
    const vector = toCanonicalVector(normal.vector).vectorSI
    expect(vector.x).toBeCloseTo(0, 8)
    expect(vector.y).toBeCloseTo(19.6, 8)
  })

  it('reports no normal force for a projectile in free fall', () => {
    const { scene, simulation } = runProjectile(vec3(10, 0, 0), 20)
    const observed = observeMechanicsScene({ scene, simulation })
    const normal = observed.observations.find(
      (entry) => entry.type === 'mechanics_force' && entry.label === 'normal',
    )
    expect(normal).toBeUndefined()
  })

  it('keeps the horizontal-projectile apex at the launch point', () => {
    const { scene, simulation } = runProjectile(vec3(10, 0, 0), 20)
    const observed = observeMechanicsScene({ scene, simulation })
    const keyPoint = observed.observations.find((entry) => entry.type === 'projectile_key_point')
    if (keyPoint?.type !== 'projectile_key_point') throw new Error('Projectile key point is absent.')

    const launch = toCanonicalVector(keyPoint.launchPoint).vectorSI
    const apex = toCanonicalVector(keyPoint.apexPoint).vectorSI
    expect(apex.x).toBeCloseTo(launch.x, 8)
    expect(apex.y).toBeCloseTo(launch.y, 8)
  })

  it('selects the highest verified trajectory sample as the oblique-projectile apex', () => {
    const { scene, simulation } = runProjectile(vec3(12, 8, 0), 0)
    const observed = observeMechanicsScene({ scene, simulation })
    const keyPoint = observed.observations.find((entry) => entry.type === 'projectile_key_point')
    if (keyPoint?.type !== 'projectile_key_point') throw new Error('Projectile key point is absent.')

    const expected = simulation.states
      .map((state) => state.objects[0]?.position)
      .filter((position) => position !== undefined)
      .map((position) => toCanonicalVector(position).vectorSI)
      .reduce((highest, candidate) => candidate.y > highest.y ? candidate : highest)
    const apex = toCanonicalVector(keyPoint.apexPoint).vectorSI
    expect(apex.x).toBeCloseTo(expected.x, 8)
    expect(apex.y).toBeCloseTo(expected.y, 8)
  })

  it('publishes every declared applied force as its own observation', () => {
    const { scene, simulation } = runNewton(vec3(3, 0, 0), [vec3(0, 4, 0)])
    const observed = observeMechanicsScene({ scene, simulation })
    const applied = observed.observations.filter(
      (entry) => entry.type === 'mechanics_force' && entry.label === 'applied',
    )
    expect(applied.length).toBe(2)
    const vectors = applied.map((entry) => {
      if (entry.type !== 'mechanics_force') throw new Error('unreachable')
      return toCanonicalVector(entry.vector).vectorSI
    })
    expect(vectors[0]?.x).toBeCloseTo(3, 8)
    expect(vectors[0]?.y).toBeCloseTo(0, 8)
    expect(vectors[1]?.x).toBeCloseTo(0, 8)
    expect(vectors[1]?.y).toBeCloseTo(4, 8)
  })

  it('keeps a balanced concurrent-force body at rest with zero net force', () => {
    const side = 4 * Math.sqrt(3)
    const { scene, simulation } = runNewton(vec3(8, 0, 0), [vec3(-4, side, 0), vec3(-4, -side, 0)])
    const observed = observeMechanicsScene({ scene, simulation })
    const applied = observed.observations.filter(
      (entry) => entry.type === 'mechanics_force' && entry.label === 'applied',
    )
    expect(applied.length).toBe(3)
    const last = simulation.states[simulation.states.length - 1]
    const body = last?.objects[0]
    if (body?.position === undefined || body.velocity === undefined) {
      throw new Error('Equilibrium body state is absent.')
    }
    expect(toCanonicalVector(body.position).vectorSI.x).toBeCloseTo(0, 8)
    const speed = toCanonicalVector(body.velocity).vectorSI
    expect(Math.hypot(speed.x, speed.y)).toBeCloseTo(0, 8)
  })
})
