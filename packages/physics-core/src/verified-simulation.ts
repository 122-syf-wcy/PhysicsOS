import { PhysicsOSError } from '@physicsos/shared'
import type { SimulationResult } from './simulation.ts'

/** Shared trust boundary for every observation consumer, independent of domain. */
export const assertVerifiedSimulation = (
  scene: { readonly id: string; readonly revision: number },
  simulation: SimulationResult,
): void => {
  if (scene.id !== simulation.sceneId || scene.revision !== simulation.sceneRevision) {
    throw new PhysicsOSError(
      'OBSERVATION_SCENE_REVISION_MISMATCH',
      'Observation input must reference the same scene revision as the simulation.',
      {
        details: {
          sceneId: scene.id,
          simulationSceneId: simulation.sceneId,
          sceneRevision: scene.revision,
          simulationSceneRevision: simulation.sceneRevision,
        },
      },
    )
  }
  if (simulation.verification.status === 'failed') {
    throw new PhysicsOSError(
      'OBSERVATION_UNVERIFIED_SIMULATION',
      'Observations require a simulation that passed verification.',
    )
  }
}
