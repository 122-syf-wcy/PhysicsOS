/**
 * Lever Engine — class-1 moment balance.
 *
 * The engine resolves the scene's lever (two hangers on opposite sides of a
 * fulcrum) into canonical SI numbers, then solves the statics in closed form:
 * each weight is mg, each moment is F·l, and the beam is level exactly when
 * F₁l₁ = F₂l₂. An unbalanced beam tips to a small display angle toward the
 * larger moment — junior statics, not a rigid-body integrator.
 */

export {
  resolveLeverModel,
  type ResolvedLeverHanger,
  type ResolvedLeverModel,
} from './lever-model.ts'
export {
  HOLD_DURATION,
  MAX_TILT_RADIANS,
  TIP_DURATION,
  leverRunDuration,
  leverStateAt,
  momentsOf,
  type LeverMoments,
  type LeverPhase,
  type LeverState,
} from './statics.ts'
export {
  LEVER_ENGINE_ID,
  LEVER_ENGINE_VERSION,
  MOMENT_BALANCE_MODEL,
  LeverEngine,
  createLeverSimulationRequest,
  leverEngine,
  resolveMomentBalance,
} from './lever-engine.ts'
