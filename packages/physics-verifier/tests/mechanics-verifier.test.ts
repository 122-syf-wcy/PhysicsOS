import { describe, expect, it } from 'vitest'

import { createMechanicsSimulationRequest, MechanicsEngine } from '../../engine-mechanics/src/index.ts'
import { vec3 } from '@physicsos/physics-math'
import { createMechanicsScene } from '@physicsos/physics-scene'

import {
  verifyKinematicConsistency,
  verifyMechanicsScene,
  verifyMechanicsSimulation,
} from '../src/index.ts'

const createScene = () =>
  createMechanicsScene({
    sceneId: 'mechanics-verifier-scene',
    model: 'uniformly_accelerated_motion',
    mass: 2,
    position: vec3(1, 2, 0),
    velocity: vec3(3, 0, 0),
    acceleration: vec3(2, 0, 0),
    now: '2026-08-19T00:00:00.000Z',
  })

describe('mechanics verifier', () => {
  it('accepts a real mechanics scene and its engine result', () => {
    const scene = createScene()
    const result = new MechanicsEngine().simulate(
      scene,
      createMechanicsSimulationRequest(scene, 'mechanics-verifier-simulation', 'mechanics-verifier-trace'),
    )

    expect(verifyMechanicsScene(scene).status).toBe('passed')
    const verification = verifyMechanicsSimulation(scene, result)
    expect(verification.status).toBe('passed')
    expect(
      verification.checks.find((check) => check.id === 'mechanics_result_body_states')?.passed,
    ).toBe(true)
  })

  it('rejects a result from a different scene revision', () => {
    const scene = createScene()
    const result = new MechanicsEngine().simulate(
      scene,
      createMechanicsSimulationRequest(scene, 'mechanics-verifier-simulation', 'mechanics-verifier-trace'),
    )
    const broken = structuredClone(result)
    broken.sceneRevision += 1

    const verification = verifyMechanicsSimulation(scene, broken)
    expect(verification.status).toBe('failed')
    expect(
      verification.checks.find((check) => check.id === 'mechanics_result_scene_revision')?.passed,
    ).toBe(false)
  })

  it('checks position as well as velocity in the kinematic identity', () => {
    const valid = verifyKinematicConsistency(
      vec3(3, 0, 0),
      vec3(2, 0, 0),
      2,
      vec3(7, 0, 0),
      vec3(11, 2, 0),
      vec3(1, 2, 0),
    )
    const invalidPosition = verifyKinematicConsistency(
      vec3(3, 0, 0),
      vec3(2, 0, 0),
      2,
      vec3(7, 0, 0),
      vec3(12, 2, 0),
      vec3(1, 2, 0),
    )

    expect(valid.passed).toBe(true)
    expect(invalidPosition.passed).toBe(false)
  })
})
