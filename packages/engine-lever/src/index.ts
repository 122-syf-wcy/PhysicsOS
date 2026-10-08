/**
 * Lever Engine — class-1 moment balance with genuine rotational dynamics.
 *
 * The engine resolves the scene's lever (two hangers on opposite sides of a
 * fulcrum) into canonical SI numbers, then:
 *
 *  - solves the statics in closed form — each weight is mg, each moment is F·l,
 *    and the beam is level exactly when F₁l₁ = F₂l₂ (`momentsOf`,
 *    `staticLeverState`); and
 *  - integrates the real rotation τ_net = I·α with I = Σmᵢlᵢ², viscous pivot
 *    damping and a stop at the moment-free vertical (`leverStateAt`,
 *    `leverAngularStateAt`).
 *
 * The rotation is NOT a display ramp: θ(t) and ω(t) come from the engine's
 * integrator at the fixed simulation cadence, so a renderer reads the solved
 * state instead of inventing an angle.
 */

export {
  resolveLeverModel,
  type ResolvedLeverHanger,
  type ResolvedLeverModel,
} from './lever-model.ts'
export {
  momentsOf,
  staticLeverState,
  type LeverMoments,
  type LeverStaticState,
} from './statics.ts'
export {
  LEVER_DAMPING_RATIO,
  LEVER_EQUILIBRIUM_ANGLE,
  LEVER_INTEGRATION_STEP,
  LEVER_MAX_ANGLE,
  LEVER_MAX_ANGULAR_SPEED,
  LEVER_MAX_RUN_SECONDS,
  LEVER_MODEL_KIND,
  LEVER_SETTLED_ANGULAR_SPEED,
  LEVER_SETTLED_TORQUE_FRACTION,
  integrateLeverAngular,
  leverPotentialEnergyAt,
  leverSettleSeconds,
  leverTorqueAt,
  resolveLeverRotationalModel,
  type LeverAngularState,
  type LeverRotationalModel,
  type LeverRotationalOptions,
} from './rotational-dynamics.ts'
export {
  leverAngularStateAt,
  leverRunDuration,
  leverStateAt,
  type LeverPhase,
  type LeverState,
} from './lever-state.ts'
export {
  LEVER_ENGINE_ID,
  LEVER_ENGINE_VERSION,
  MOMENT_BALANCE_MODEL,
  LeverEngine,
  createLeverSimulationRequest,
  leverEngine,
  resolveMomentBalance,
} from './lever-engine.ts'
