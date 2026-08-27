import type { ResolvedFluidModel } from './fluid-model.ts'

/**
 * Closed-form buoyancy kinematics for the spring-scale rig.
 *
 * The block descends at a steady rate, so the submerged height grows linearly
 * until either the block is fully under (a sinker) or buoyancy has grown to
 * match its weight (a floater). Past that point nothing changes no matter how
 * much further the hook is lowered — the whole timeline is exact algebra, and
 * that flat tail is the fact the experiment exists to show.
 */

/** Which stage of the descent the block is in. */
export type ImmersionPhase = 'dry' | 'entering' | 'submerged' | 'floating'

export interface FluidEquilibrium {
  /** Weight of the block G = mg (N). */
  readonly weight: number
  /** True when buoyancy matches the weight before the block is fully under. */
  readonly floats: boolean
  /**
   * Submerged height once the descent stops (m). Equals the block height for a
   * sinker; for a floater it is the height at which ρ_liquid·g·A·s = mg.
   */
  readonly settledSubmergedHeight: number
  /** Deepest the bottom face reaches (m); the tank stops the run there. */
  readonly maxDepth: number
  /** Time at which the descent stops (s). */
  readonly settleTime: number
}

export interface ImmersionState {
  /** Depth of the block's bottom face below the surface (m). */
  readonly depth: number
  /** Submerged height of the block (m); ≤ the block height. */
  readonly submergedHeight: number
  /** Displaced liquid volume (m³). */
  readonly displacedVolume: number
  /** Buoyant force (N). */
  readonly buoyantForce: number
  /** Spring-scale reading F = G − F_buoy (N), never negative. */
  readonly scaleReading: number
  readonly phase: ImmersionPhase
}

export const equilibriumOf = (model: ResolvedFluidModel): FluidEquilibrium => {
  const weight = model.blockMass * model.gravity
  const floats = model.blockDensity < model.liquidDensity
  /* Floating equilibrium: ρ_liquid·A·s = m, i.e. s/h = ρ_block/ρ_liquid. For a
     sinker that ratio is ≥ 1, so the block simply goes all the way under. */
  const settledSubmergedHeight = floats
    ? (model.blockHeight * model.blockDensity) / model.liquidDensity
    : model.blockHeight
  /* A sinker keeps going after it is covered — one extra block-height of clear
     water is enough to show the reading does not budge. A floater cannot be
     pushed past its equilibrium by a slack string. */
  const maxDepth = floats ? settledSubmergedHeight : 2 * model.blockHeight
  return {
    weight,
    floats,
    settledSubmergedHeight,
    maxDepth,
    settleTime: maxDepth / model.lowerRate,
  }
}

/**
 * Immersion state at time t ≥ 0. Past the settle time the block has stopped
 * moving and the state is a steady reading, not an extrapolation beyond the
 * experiment.
 */
export const immersionStateAt = (model: ResolvedFluidModel, time: number): ImmersionState => {
  const { weight, floats, settledSubmergedHeight, maxDepth } = equilibriumOf(model)
  const depth = Math.min(Math.max(0, time) * model.lowerRate, maxDepth)
  const submergedHeight = Math.min(depth, settledSubmergedHeight)
  const displacedVolume = model.crossSection * submergedHeight
  const buoyantForce = model.liquidDensity * model.gravity * displacedVolume
  const phase: ImmersionPhase =
    submergedHeight <= 0
      ? 'dry'
      : submergedHeight < settledSubmergedHeight
        ? 'entering'
        : floats
          ? 'floating'
          : 'submerged'
  return {
    depth,
    submergedHeight,
    displacedVolume,
    buoyantForce,
    scaleReading: Math.max(weight - buoyantForce, 0),
    phase,
  }
}

/**
 * Buoyancy derived the other way round — from the pressure difference across
 * the block's top and bottom faces, F = (p_bottom − p_top)·A. Archimedes is a
 * consequence of that difference rather than a separate law, so agreeing with
 * {@link immersionStateAt} is a real cross-check of the solution, not a
 * restatement of the same formula.
 */
export const buoyancyFromPressure = (model: ResolvedFluidModel, depth: number): number => {
  const bottomDepth = Math.max(0, depth)
  const topDepth = Math.max(0, depth - model.blockHeight)
  const pressureDifference =
    model.liquidDensity * model.gravity * (bottomDepth - topDepth)
  return pressureDifference * model.crossSection
}
