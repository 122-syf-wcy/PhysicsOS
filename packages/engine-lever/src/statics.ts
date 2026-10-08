import type { ResolvedLeverModel } from './lever-model.ts'

/**
 * Closed-form class-1 lever statics — the time-independent balance condition.
 *
 * Each hanger's weight is G = mg and its moment is M = F·l. The beam is in
 * equilibrium exactly when the two moments match, F₁l₁ = F₂l₂ — the textbook
 * condition, verifiable on its own and independent of any motion.
 *
 * This module deliberately carries NO rotation and no clock. Statics answers
 * "does it balance, and which side carries the larger moment?"; it cannot say
 * what angle an unbalanced beam reaches, only that it is not in equilibrium.
 * The real rotation is solved by `rotational-dynamics.ts` via τ = I·α. (An
 * earlier version faked the rotation here as a linear display ramp; that is
 * gone — a display ramp must not impersonate dynamics.)
 */

export interface LeverMoments {
  /** Left weight G₁ = m₁g (N). */
  readonly leftWeight: number
  /** Right weight G₂ = m₂g (N). */
  readonly rightWeight: number
  /** Left moment M₁ = G₁·l₁ (N·m). */
  readonly leftMoment: number
  /** Right moment M₂ = G₂·l₂ (N·m). */
  readonly rightMoment: number
  /** M₁ − M₂; positive means the left side goes down. */
  readonly netMoment: number
  /** True when |M₁ − M₂| is negligible against the larger moment. */
  readonly balanced: boolean
}

/** The pure balance condition — the statics-only view of the apparatus. */
export interface LeverStaticState {
  readonly moments: LeverMoments
  /** Explicit kind so a consumer can say "静态平衡" truthfully. */
  readonly modelKind: 'static_equilibrium'
  /**
   * A balanced beam is level (0). An unbalanced one has NO static angle: the
   * honest statics answer is "not in equilibrium, so it rotates", which is the
   * dynamic path, not a fabricated tilt.
   */
  readonly tilt: number
}

const RELATIVE_TOLERANCE = 1e-9

export const momentsOf = (model: ResolvedLeverModel): LeverMoments => {
  const leftWeight = model.left.mass * model.gravity
  const rightWeight = model.right.mass * model.gravity
  const leftMoment = leftWeight * model.left.armLength
  const rightMoment = rightWeight * model.right.armLength
  const netMoment = leftMoment - rightMoment
  const scale = Math.max(leftMoment, rightMoment, 1e-12)
  return {
    leftWeight,
    rightWeight,
    leftMoment,
    rightMoment,
    netMoment,
    balanced: Math.abs(netMoment) <= RELATIVE_TOLERANCE * scale,
  }
}

/**
 * The static path: moments plus the balance verdict, with no motion. A
 * teacher/learner who only wants F₁l₁ = F₂l₂ reads this; a renderer that shows
 * the beam reads `leverStateAt` in `lever-state.ts` for the solved rotation.
 */
export const staticLeverState = (model: ResolvedLeverModel): LeverStaticState => {
  const moments = momentsOf(model)
  return { moments, modelKind: 'static_equilibrium', tilt: 0 }
}
