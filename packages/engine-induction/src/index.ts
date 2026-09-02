/**
 * Induction Engine — electromagnetic induction (法拉第电磁感应).
 *
 * Two closed-form sub-models share this engine:
 *
 * - `bar_motion_emf`: a conducting rod of length L moves at velocity v through
 *   a uniform field B; the motional EMF is E = BLv (右手定则 gives direction).
 * - `flux_change_emf`: a coil of area S sits in a field B whose flux changes at
 *   a constant rate dΦ/dt; Faraday's law gives E = -dΦ/dt.
 *
 * Both carry a closed loop resistance R so the induced current I = E / R.
 */

export {
  BAR_MOTION_EMF_MODEL,
  FLUX_CHANGE_EMF_MODEL,
  INDUCTION_ENGINE_ID,
  INDUCTION_ENGINE_VERSION,
  InductionEngine,
  createInductionSimulationRequest,
  inductionEngine,
  resolveInductionEmf,
} from './induction-engine.ts'
export {
  resolveInductionModel,
  type InductionSubModel,
  type ResolvedInductionModel,
} from './induction-model.ts'
