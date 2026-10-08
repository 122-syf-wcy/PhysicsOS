import { describe, expect, it } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import {
  MechanicsEngine,
  createMechanicsSimulationRequest,
} from '../../engine-mechanics/src/index.ts'
import { observeModernPhysicsScene } from '../../engine-modern/src/index.ts'
import {
  observeMagneticScene,
  observeMechanicsScene,
  observeElectricScene,
  observeOpticsScene,
  observeCompositeScene,
  observeCircuitScene,
  observeInductionScene,
  observeWaveScene,
} from '../src/index.ts'

const observers = {
  magnetic: observeMagneticScene,
  mechanics: observeMechanicsScene,
  electric: observeElectricScene,
  optics: observeOpticsScene,
  composite: observeCompositeScene,
  circuit: observeCircuitScene,
  induction: observeInductionScene,
  wave: observeWaveScene,
  modern: observeModernPhysicsScene,
}

describe.each(Object.entries(observers))('%s observation verification boundary', (_, observe) => {
  const scene = createMechanicsScene({ model: 'uniform_linear_motion' })
  const simulation = new MechanicsEngine().simulate(
    scene,
    createMechanicsSimulationRequest(scene, 'guard', 'guard'),
  )
  it('refuses failed results before reading domain values', () => {
    const failed = {
      ...simulation,
      verification: { ...simulation.verification, status: 'failed' as const },
    }
    expect(() => observe({ scene, simulation: failed })).toThrowError(
      expect.objectContaining({ code: 'OBSERVATION_UNVERIFIED_SIMULATION' }),
    )
  })
  it('refuses stale scene revisions', () => {
    expect(() =>
      observe({ scene: { ...scene, revision: scene.revision + 1 }, simulation }),
    ).toThrowError(expect.objectContaining({ code: 'OBSERVATION_SCENE_REVISION_MISMATCH' }))
  })
})
