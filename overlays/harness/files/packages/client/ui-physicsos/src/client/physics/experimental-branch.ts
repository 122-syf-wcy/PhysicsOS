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
 * `SetComponentPlacement` is absent for the same reason: where a part sits on the
 * schematic is dressing, not physics — the solver reads the netlist, not the layout.
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
  /* Pressure facts: every one of them is a stated condition of the rig the
     question asked about — the force and the two contact areas, the liquid's
     density and the two depths, the atmospheric pressure both instruments read
     together with the barometer's filling and the hemisphere pair it acts on. */
  'SetPressureForce',
  'SetPressureContactArea',
  'SetPressureComparisonArea',
  'SetPressureLiquidDensity',
  'SetPressureProbeDepth',
  'SetPressureComparisonDepth',
  'SetPressureComparisonLiquidDensity',
  'SetPressureAtmospheric',
  'SetPressureBarometerFluidDensity',
  'SetPressureHemisphereRadius',
  /* Current-magnetic facts: the conductor's current and where the field is
     probed, and the coil's turn count and length. Every one of them decides the
     field a question asked about — and the current's SIGN is one of them, since
     reversing it reverses the field the answer quotes. */
  'SetCurrent',
  'SetProbeDistance',
  'SetComparisonProbeDistance',
  'SetSolenoidTurns',
  'SetSolenoidComparisonTurns',
  'SetSolenoidLength',
  /* Electromagnet facts: which core is threaded through the coil and how big the
     pole face is. Both decide the pull a question asked about, and the pull goes
     as μ_r², so swapping the core changes the answer enormously. */
  'SetCorePermeability',
  'SetComparisonCorePermeability',
  'SetCoreArea',
  /* Motor facts: the stator field, the rotor's geometry and the angle it is
     turned to. The angle is a stated condition like any other — the torque a
     question asked about is n·B·I·A·cosθ at THAT angle. */
  'SetRotorField',
  'SetRotorSideLength',
  'SetRotorCoilWidth',
  'SetRotorAngle',
  /* Mechanical-energy facts: the cart's mass, where it is released, the slope's
     angle and its surface. Every one of them decides the ledger a question
     stated — including the friction, which decides how much becomes heat. */
  'SetEnergyMass',
  'SetReleaseHeight',
  'SetRampAngle',
  'SetRampFriction',
  /* Light facts: the object's height, where it stands and where the screen is.
     All three decide the image a question stated. */
  'SetObjectHeight',
  'SetObjectDistance',
  'SetScreenDistance',
  /* Refraction facts: the two indices and the angle of incidence decide whether
     anything refracts at all, so all three are stated conditions. */
  'SetIncidentIndex',
  'SetRefractedIndex',
  'SetIncidentAngle',
  /* Transformer facts: the driven voltage and current and the two turn counts.
     The turns ratio IS the machine, so editing either winding changes what the
     answer to a question about it would be. */
  'SetTransformerVoltage',
  /* Thermometer facts: how the instrument is BUILT and what it is dipped in.
     The bulb, the bore and the filling decide the scale the glass is ruled in. */
  'SetThermometerTemperature',
  /* Noise facts: how loud the source is, how far the listener stands and what
     the barrier takes out — the three terms of the level a question stated. */
  'SetNoiseSourceLevel',
  'SetListenerDistance',
  'SetBarrierAttenuation',
  'SetThermometerBore',
  'SetFillingLiquid',
  'SetThermometerBulb',
  'SetTransformerCurrent',
  'SetPrimaryTurns',
  'SetSecondaryTurns',
  /* Thermal facts: heater power and sample mass decide the heating curve. */
  'SetHeaterPower',
  'SetSampleMass',
  /* Lever facts: hanger mass and arm length decide the moments. */
  'SetHangerMass',
  'SetHangerArm',
  /* Induction facts: the field, the loop resistance and the rod's motion (or
     the flux rate) decide the EMF a question stated. The double-bar rig adds
     masses, per-bar velocity and the external force as stated facts. */
  'SetInductionFieldStrength',
  'SetInductionLoopResistance',
  'SetInductionBarVelocity',
  'SetInductionBarLength',
  'SetInductionFluxRate',
  'SetInductionBarMasses',
  'SetInductionBarVelocityOne',
  'SetInductionExternalForce',
  /* Wave facts: amplitude, frequency, the medium's speed and the rig geometry
     decide the profile, the interference verdict and the harmonic a question
     stated. */
  'SetWaveAmplitude',
  'SetWaveFrequency',
  'SetWaveSpeed',
  'SetWavePathDifference',
  'SetWaveStringLength',
  'SetWaveHarmonic',
])

/**
 * The experimental branch helper `isFactCommand`.
 * @returns true when fact command holds.
 * @param type - the part type.
 */
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
 * @returns true when requires experimental fork for fact holds.
 * @param scene - the physics scene.
 */
export const requiresExperimentalForkForFact = (scene: PhysicsScene): boolean =>
  scene.metadata.sourceQuestionId !== undefined && !isExperimentalBranch(scene)

/**
 * Whether this command must fork before it is applied.
 * @returns true when requires experimental fork holds.
 * @param type - the part type.
 * @param scene - the physics scene.
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

/**
 * The experimental branch helper `branchBadgeOf`.
 * @returns the branch badge.
 * @param scene - the physics scene.
 */
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
