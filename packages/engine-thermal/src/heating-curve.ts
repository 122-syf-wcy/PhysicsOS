import type { ResolvedThermalModel } from './thermal-model.ts'

/**
 * Closed-form constant-power heating curve.
 *
 * The heater delivers the same joules every second, so each segment of the
 * curve is a straight line whose slope is P/(mc): steeper for the phase with
 * the smaller specific heat. Between them a crystal sits at its melting point
 * for exactly mL/P seconds while every incoming joule goes into breaking the
 * lattice instead of raising the temperature. That flat stretch is the whole
 * lesson, and it is exact algebra — no integration anywhere.
 */

/** Which segment of the heating curve the sample is in. */
export type ThermalPhase = 'solid' | 'melting' | 'liquid'

export interface HeatingTiming {
  /** Time to bring the solid up to its melting point (s). */
  readonly warmUpTime: number
  /** Duration of the melting plateau mL/P (s); zero for an amorphous sample. */
  readonly meltingDuration: number
  /** Instant melting finishes (s); equals warmUpTime when there is no plateau. */
  readonly meltingEndTime: number
  /**
   * End of the run (s). One warm-up length of liquid heating after melting, so
   * both sloped segments are visible on either side of the plateau.
   */
  readonly totalTime: number
}

export interface ThermalState {
  /** Sample temperature (K). */
  readonly temperature: number
  /** Heat absorbed since t = 0 (J). */
  readonly heatAbsorbed: number
  /** Fraction of the sample that has melted, 0…1. */
  readonly meltedFraction: number
  readonly phase: ThermalPhase
}

export const heatingTimingOf = (model: ResolvedThermalModel): HeatingTiming => {
  const warmUpTime =
    (model.mass * model.solidSpecificHeat * (model.meltingPoint - model.initialTemperature)) /
    model.heaterPower
  const meltingDuration = (model.mass * model.latentHeat) / model.heaterPower
  const meltingEndTime = warmUpTime + meltingDuration
  return {
    warmUpTime,
    meltingDuration,
    meltingEndTime,
    totalTime: meltingEndTime + warmUpTime,
  }
}

/**
 * Sample state at time t ≥ 0. Past the end of the run the heater is switched
 * off and the state holds, so the reading is the end of the experiment rather
 * than an extrapolation beyond it.
 */
export const thermalStateAt = (model: ResolvedThermalModel, time: number): ThermalState => {
  const { warmUpTime, meltingDuration, meltingEndTime, totalTime } = heatingTimingOf(model)
  const clamped = Math.min(Math.max(0, time), totalTime)
  const heatAbsorbed = model.heaterPower * clamped

  if (clamped < warmUpTime) {
    return {
      temperature:
        model.initialTemperature +
        heatAbsorbed / (model.mass * model.solidSpecificHeat),
      heatAbsorbed,
      meltedFraction: 0,
      phase: 'solid',
    }
  }

  /* An amorphous sample has no plateau: it softens through the same point and
     just changes slope, so the melting branch is skipped entirely. */
  if (model.crystalline && clamped < meltingEndTime) {
    return {
      temperature: model.meltingPoint,
      heatAbsorbed,
      meltedFraction: (clamped - warmUpTime) / meltingDuration,
      phase: 'melting',
    }
  }

  return {
    temperature:
      model.meltingPoint +
      (model.heaterPower * (clamped - meltingEndTime)) /
        (model.mass * model.liquidSpecificHeat),
    heatAbsorbed,
    meltedFraction: 1,
    phase: 'liquid',
  }
}

/**
 * Heat accounted for the other way round — summed segment by segment out of
 * Q = cmΔT and Q = mL rather than read off the heater as P·t. Agreeing with
 * {@link thermalStateAt} is a real cross-check of the solution, since the two
 * routes only meet if every segment length is right.
 */
export const heatFromSegments = (model: ResolvedThermalModel, time: number): number => {
  const { warmUpTime, meltingEndTime, totalTime } = heatingTimingOf(model)
  const clamped = Math.min(Math.max(0, time), totalTime)
  const state = thermalStateAt(model, clamped)

  const solidHeat =
    model.mass *
    model.solidSpecificHeat *
    (Math.min(state.temperature, model.meltingPoint) - model.initialTemperature)
  if (clamped <= warmUpTime) return solidHeat

  const meltHeat = model.mass * model.latentHeat * state.meltedFraction
  if (model.crystalline && clamped <= meltingEndTime) return solidHeat + meltHeat

  const liquidHeat =
    model.mass * model.liquidSpecificHeat * (state.temperature - model.meltingPoint)
  return solidHeat + meltHeat + liquidHeat
}
