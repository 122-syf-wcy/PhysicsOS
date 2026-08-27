/**
 * Experimental-branch policy, shared by every domain runtime.
 *
 * A question's conditions are stated facts. The Lab therefore forks the scene the
 * first time the student changes a PHYSICAL FACT, and never for looking: playback,
 * seeking, observable toggles and highlights leave the original alone.
 *
 * The policy lives here rather than in each adapter so "what counts as changing
 * the physics" has exactly one definition.
 */

import {
  forkExperimentalScene,
  isExperimentalBranch,
  type PhysicsScene,
  type SceneCommandType,
} from '@physicsos/physics-scene'

/**
 * Commands that change a physical fact.
 *
 * `SetObservableEnabled` is deliberately absent: showing or hiding a layer changes
 * what the student is looking at, not what is true, so it must not fork a question
 * scene — and it still advances the scene's own revision as an auditable event.
 */
const FACT_COMMANDS: ReadonlySet<SceneCommandType> = new Set<SceneCommandType>([
  'SetParticleCharge',
  'SetParticleMass',
  'SetParticleVelocity',
  'SetMagneticFieldStrength',
  'SetMagneticFieldDirection',
  'SetElectricFieldStrength',
  'SetElectricFieldDirection',
  'SetBodyMass',
  'SetBodyPosition',
  'SetBodyVelocity',
  'SetGravityAcceleration',
  'SetInclineAngle',
  'SetFrictionCoefficient',
  'SetAppliedForce',
  'SetGroundLevel',
  /* Circuit facts: netlist values and apparatus states alike change what is
     physically true of the circuit a question stated. */
  'SetComponentResistance',
  'SetSourceVoltage',
  'SetSourceInternalResistance',
  'SetSwitchState',
  'SetSliderPosition',
  /* Optics facts: where the pieces stand and the lens's focal length decide
     the image a question stated. */
  'SetOpticalObjectPosition',
  'SetOpticalObjectHeight',
  'SetLensFocalLength',
  'SetMirrorFocalLength',
  'SetOpticalScreenPosition',
  /* Acoustics facts: the wall's position and the medium's sound speed decide
     the echo a question stated. */
  'SetAcousticReflectorPosition',
  'SetAcousticSoundSpeed',
  /* Fluid facts: the liquid and the block are the weighing-method apparatus. */
  'SetLiquidDensity',
  'SetBlockMass',
  /* Thermal facts: heater power and sample mass decide the heating curve. */
  'SetHeaterPower',
  'SetSampleMass',
  /* Lever facts: hanger mass and arm length decide the moments. */
  'SetHangerMass',
  'SetHangerArm',
])

export const isFactCommand = (type: SceneCommandType): boolean => FACT_COMMANDS.has(type)

/**
 * Whether changing a physical fact on this scene must fork first.
 *
 * Only a scene that came from a question needs protecting, and only once: after the
 * first fork the student is already working in their own world.
 *
 * Split out from {@link requiresExperimentalFork} because not every physical fact
 * has a SceneCommand of its own — parallel-plate geometry (gap height, plate
 * length) is rewritten on the scene directly, and it must obey exactly the same
 * fork policy as a fact that does have a command.
 */
export const requiresExperimentalForkForFact = (scene: PhysicsScene): boolean =>
  scene.metadata.sourceQuestionId !== undefined && !isExperimentalBranch(scene)

/**
 * Whether this command must fork before it is applied.
 */
export const requiresExperimentalFork = (
  scene: PhysicsScene,
  type: SceneCommandType,
): boolean => isFactCommand(type) && requiresExperimentalForkForFact(scene)

/** Branch label parts for the toolbar; `undefined` when the scene is an original. */
export interface BranchBadge {
  readonly originSceneId: string
  readonly originQuestionId: string | undefined
  readonly parentRevision: number
}

export const branchBadgeOf = (scene: PhysicsScene): BranchBadge | undefined => {
  /* `branchType` is the literal 'experimental' — only experimental branches may
     carry lineage at all — so presence of lineage IS the badge condition. */
  const lineage = scene.metadata.lineage
  if (lineage === undefined) return undefined
  return {
    originSceneId: String(lineage.originSceneId),
    originQuestionId: lineage.originQuestionId === undefined ? undefined : String(lineage.originQuestionId),
    parentRevision: lineage.parentRevision,
  }
}

export { forkExperimentalScene, isExperimentalBranch }
