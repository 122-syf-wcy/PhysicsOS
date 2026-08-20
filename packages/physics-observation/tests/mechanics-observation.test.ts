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

describe('observeMechanicsScene', () => {
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
})
