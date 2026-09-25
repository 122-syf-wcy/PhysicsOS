/**
 * Induction Engine — electromagnetic induction (法拉第电磁感应).
 *
 * Three closed-form sub-models share this engine:
 *
 * - `bar_motion_emf`: a conducting rod of length L moves at velocity v through
 *   a uniform field B; the motional EMF is E = BLv (右手定则 gives direction).
 * - `flux_change_emf`: a coil of area S sits in a field B whose flux changes at
 *   a constant rate dΦ/dt; Faraday's law gives E = -dΦ/dt.
 * - `double_bar_rail`: two bars slide on parallel rails in a uniform field; the
 *   loop EMF is E = BL(v₁−v₂) and the magnetic coupling exchanges momentum
 *   between the bars (τ = R·m₁m₂/(B²L²(m₁+m₂)) decay, 动量守恒 when free).
 *
 * All carry a closed loop resistance R so the induced current I = E / R.
 */

export {
  BAR_MOTION_EMF_MODEL,
  DOUBLE_BAR_RAIL_MODEL,
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

export {
  resolveTransformerModel,
  type ResolvedTransformerModel,
} from './transformer-model.ts'
export {
  TRANSFORMER_RELATIVE_TOLERANCE,
  secondaryCurrent,
  secondaryVoltage,
  throughPower,
  transformerReadingOf,
  type TransformerReading,
} from './transformer.ts'
export {
  IDEAL_TRANSFORMER_MODEL,
  TRANSFORMER_ENGINE_ID,
  TRANSFORMER_ENGINE_VERSION,
  TransformerEngine,
  createTransformerSimulationRequest,
  resolveTransformer,
  transformerEngine,
} from './transformer-engine.ts'
