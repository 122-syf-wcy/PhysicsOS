import { derivedScalar, type SimulationResult } from '@physicsos/physics-core'
import { PhysicsOSError } from '@physicsos/shared'
import type { ObservableDefinition, PhysicsScene } from '@physicsos/physics-scene'
import { validateQuantity, type Quantity } from '@physicsos/physics-units'

export interface ModernObservationBase {
  readonly observableId: ObservableDefinition['id']
  readonly targetId: string
  readonly type: string
}

export interface PhotonEnergyObservation extends ModernObservationBase {
  readonly type: 'photon_energy'
  readonly value: Quantity<'energy'>
}

export interface PhotocurrentObservation extends ModernObservationBase {
  readonly type: 'photocurrent'
  readonly value: Quantity<'electric_current'>
}

export interface StoppingPotentialObservation extends ModernObservationBase {
  readonly type: 'stopping_potential'
  readonly value: Quantity<'electric_potential'>
}

export type ModernPhysicsObservation =
  PhotonEnergyObservation | PhotocurrentObservation | StoppingPotentialObservation

export interface ModernObservationRuntimeState {
  readonly sceneRevision: number
  readonly observations: readonly ModernPhysicsObservation[]
}

export interface ModernObservationInput {
  readonly scene: PhysicsScene
  readonly simulation: SimulationResult
}

export const observeModernPhysicsScene = (
  input: ModernObservationInput,
): ModernObservationRuntimeState => {
  const { scene, simulation } = input
  if (scene.id !== simulation.sceneId || scene.revision !== simulation.sceneRevision) {
    throw new PhysicsOSError(
      'OBSERVATION_SCENE_REVISION_MISMATCH',
      'Modern-physics observation requires the same scene revision as the simulation.',
    )
  }
  if (simulation.verification.status === 'failed') {
    throw new PhysicsOSError(
      'OBSERVATION_UNVERIFIED_SIMULATION',
      'Modern-physics observations require a verified simulation.',
    )
  }

  const observations: ModernPhysicsObservation[] = []
  for (const definition of scene.observableDefinitions.filter((entry) => entry.visible)) {
    const targetId = definition.targetId
    if (targetId === undefined || targetId !== scene.modernPhysicsBenches?.[0]?.id) continue
    if (definition.type === 'energy') {
      observations.push({
        observableId: definition.id,
        targetId,
        type: 'photon_energy',
        value: validateQuantity(
          derivedScalar(simulation.derivedQuantities, 'photon_energy'),
          'energy',
        ),
      })
    } else if (definition.type === 'current') {
      observations.push({
        observableId: definition.id,
        targetId,
        type: 'photocurrent',
        value: validateQuantity(
          derivedScalar(simulation.derivedQuantities, 'photocurrent'),
          'electric_current',
        ),
      })
    } else if (definition.type === 'voltage') {
      observations.push({
        observableId: definition.id,
        targetId,
        type: 'stopping_potential',
        value: validateQuantity(
          derivedScalar(simulation.derivedQuantities, 'stopping_potential'),
          'electric_potential',
        ),
      })
    }
  }
  return { sceneRevision: scene.revision, observations }
}
