import type { ResolvedLeverModel } from './lever-model.ts'

/**
 * Closed-form class-1 lever statics.
 *
 * Each hanger's weight is mg and its moment is F·l. The beam is balanced when
 * the two moments match; otherwise it tips toward the larger moment, to a
 * small display angle so the student can see which side went down. There is
 * no moment of inertia and no angular acceleration — junior statics, not a
 * rigid-body integrator.
 */

/** Display tip when the moments do not match; 18° is readable without falling off the canvas. */
export const MAX_TILT_RADIANS = (18 * Math.PI) / 180

/** Time over which an unbalanced beam tips to MAX_TILT_RADIANS. */
export const TIP_DURATION = 0.6

/** Hold after the tip so the clock has a short, honest window. */
export const HOLD_DURATION = 0.6

export const leverRunDuration = (): number => TIP_DURATION + HOLD_DURATION

export type LeverPhase = 'balanced' | 'settling' | 'tipped'

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

export interface LeverState {
  readonly moments: LeverMoments
  /** Beam rotation from horizontal, positive = CCW = left down (rad). */
  readonly tilt: number
  readonly phase: LeverPhase
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
 * Beam state at time t ≥ 0. A balanced lever stays level. An unbalanced one
 * tips linearly to ±MAX_TILT_RADIANS over TIP_DURATION and then holds — the
 * hold is the reading, not an extrapolation past the experiment.
 */
export const leverStateAt = (model: ResolvedLeverModel, time: number): LeverState => {
  const moments = momentsOf(model)
  if (moments.balanced) {
    return { moments, tilt: 0, phase: 'balanced' }
  }
  const sign = moments.netMoment > 0 ? 1 : -1
  const progress = Math.min(Math.max(0, time) / TIP_DURATION, 1)
  const tilt = sign * MAX_TILT_RADIANS * progress
  return {
    moments,
    tilt,
    phase: progress >= 1 ? 'tipped' : 'settling',
  }
}
