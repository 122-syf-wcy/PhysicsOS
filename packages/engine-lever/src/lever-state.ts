import type { ResolvedLeverModel } from './lever-model.ts'
import {
  LEVER_MAX_RUN_SECONDS,
  LEVER_MODEL_KIND,
  integrateLeverAngular,
  leverSettleSeconds,
  resolveLeverRotationalModel,
  type LeverAngularState,
  type LeverRotationalModel,
} from './rotational-dynamics.ts'
import { momentsOf, type LeverMoments } from './statics.ts'

/**
 * The lever's time-dependent state: the statics moments plus the SOLVED
 * rotation read out of the engine. Every value a renderer draws comes from
 * here — there is no view-side ramp and no display-only angle.
 */

/** Coarse phase for labelling. Honest for a dynamic beam: it is either
 * balanced (never moves), still rotating, or has come to rest tipped. */
export type LeverPhase = 'balanced' | 'settling' | 'tipped'

export interface LeverState {
  readonly moments: LeverMoments
  /** θ(t) — beam rotation from horizontal, positive = CCW = left down (rad). */
  readonly tilt: number
  /** ω(t) (rad/s). */
  readonly angularVelocity: number
  /** α(t) (rad/s²). */
  readonly angularAcceleration: number
  /** τ_net(θ) = netMoment·cos θ (N·m). */
  readonly netTorque: number
  /** I = Σmᵢlᵢ² (kg·m²). */
  readonly momentOfInertia: number
  /** ½Iω² (J). */
  readonly rotationalKineticEnergy: number
  readonly phase: LeverPhase
  /** The engine's model kind, so a consumer can label the motion truthfully. */
  readonly modelKind: typeof LEVER_MODEL_KIND
  /** True once the beam has reached equilibrium. */
  readonly settled: boolean
}

const phaseOf = (model: LeverRotationalModel, angular: LeverAngularState): LeverPhase => {
  if (model.balanced) return 'balanced'
  return angular.settled ? 'tipped' : 'settling'
}

/**
 * The solved angular state θ(t), ω(t), α(t) at any simulation time — the
 * accessor a renderer reads instead of inventing an angle.
 */
export const leverAngularStateAt = (
  model: ResolvedLeverModel,
  time: number,
): LeverAngularState => integrateLeverAngular(resolveLeverRotationalModel(model), time)

/**
 * The lever's full state at time t: statics moments and the rotational dynamics.
 * A balanced lever stays level; an unbalanced one swings to the moment-free
 * vertical and, because the run stops at equilibrium, reports that settled pose
 * for every later time.
 */
export const leverStateAt = (model: ResolvedLeverModel, time: number): LeverState => {
  const rotational = resolveLeverRotationalModel(model)
  const angular = integrateLeverAngular(rotational, time)
  return {
    moments: momentsOf(model),
    tilt: angular.angle,
    angularVelocity: angular.angularVelocity,
    angularAcceleration: angular.angularAcceleration,
    netTorque: angular.netTorque,
    momentOfInertia: rotational.momentOfInertia,
    rotationalKineticEnergy:
      0.5 * rotational.momentOfInertia * angular.angularVelocity ** 2,
    phase: phaseOf(rotational, angular),
    modelKind: LEVER_MODEL_KIND,
    settled: angular.settled,
  }
}

/**
 * The simulation horizon. With the model it is the solved settle time (the
 * beam is at rest by then, so a timeline is exactly as long as the physics);
 * with no model it falls back to the bound, `LEVER_MAX_RUN_SECONDS`. A caller
 * that wants the honest horizon passes the model.
 */
export const leverRunDuration = (model?: ResolvedLeverModel): number =>
  model === undefined
    ? LEVER_MAX_RUN_SECONDS
    : leverSettleSeconds(resolveLeverRotationalModel(model))
