import type { ResolvedThermalModel, ResolvedThermalSample } from './thermal-model.ts'

/**
 * Closed-form constant-power heating curve.
 *
 * The heater delivers the same joules every second, so each segment of the
 * curve is a straight line whose slope is P/(mc): steeper for the phase with
 * the smaller specific heat. Between them a crystal sits at its melting point
 * for exactly mL/P seconds while every incoming joule goes into breaking the
 * lattice instead of raising the temperature. That flat stretch is the whole
 * lesson, and it is exact algebra — no integration anywhere.
 *
 * A sample that already starts molten skips the solid and plateau entirely:
 * T(t) = T₀ + P·t/(mc_液). That is how a liquid-versus-liquid comparison run
 * is stated, and it is the same algebra as the last segment of a melting run.
 */

/** Which segment of the heating curve the sample is in. */
export type ThermalPhase = 'solid' | 'melting' | 'liquid'

export interface HeatingTiming {
  /** Time to bring the solid up to its melting point (s); 0 if already liquid. */
  readonly warmUpTime: number
  /** Duration of the melting plateau mL/P (s); zero for an amorphous sample. */
  readonly meltingDuration: number
  /** Instant melting finishes (s); equals warmUpTime when there is no plateau. */
  readonly meltingEndTime: number
  /**
   * End of the run (s). For a melting run, one warm-up length of liquid heating
   * after melting (or an explicit `runDuration` when the bench states one).
   * For an already-liquid run the bench must state the duration.
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

export const sampleTimingOf = (
  sample: ResolvedThermalSample,
  heaterPower: number,
  runDuration: number | undefined,
): HeatingTiming => {
  if (sample.startsMolten) {
    return {
      warmUpTime: 0,
      meltingDuration: 0,
      meltingEndTime: 0,
      totalTime: runDuration ?? 0,
    }
  }
  const warmUpTime =
    (sample.mass * sample.solidSpecificHeat * (sample.meltingPoint - sample.initialTemperature)) /
    heaterPower
  const meltingDuration = (sample.mass * sample.latentHeat) / heaterPower
  const meltingEndTime = warmUpTime + meltingDuration
  return {
    warmUpTime,
    meltingDuration,
    meltingEndTime,
    totalTime: runDuration ?? meltingEndTime + warmUpTime,
  }
}

export const heatingTimingOf = (model: ResolvedThermalModel): HeatingTiming =>
  sampleTimingOf(model, model.heaterPower, model.runDuration)

/**
 * Sample state at time t ≥ 0. Past the end of the run the heater is switched
 * off and the state holds, so the reading is the end of the experiment rather
 * than an extrapolation beyond it.
 */
export const sampleStateAt = (
  sample: ResolvedThermalSample,
  heaterPower: number,
  time: number,
  runDuration: number | undefined,
): ThermalState => {
  const { warmUpTime, meltingDuration, meltingEndTime, totalTime } = sampleTimingOf(
    sample,
    heaterPower,
    runDuration,
  )
  const clamped = Math.min(Math.max(0, time), totalTime)
  const heatAbsorbed = heaterPower * clamped

  if (sample.startsMolten) {
    return {
      temperature:
        sample.initialTemperature + heatAbsorbed / (sample.mass * sample.liquidSpecificHeat),
      heatAbsorbed,
      meltedFraction: 1,
      phase: 'liquid',
    }
  }

  if (clamped < warmUpTime) {
    return {
      temperature:
        sample.initialTemperature +
        heatAbsorbed / (sample.mass * sample.solidSpecificHeat),
      heatAbsorbed,
      meltedFraction: 0,
      phase: 'solid',
    }
  }

  /* An amorphous sample has no plateau: it softens through the same point and
     just changes slope, so the melting branch is skipped entirely. */
  if (sample.crystalline && clamped < meltingEndTime) {
    return {
      temperature: sample.meltingPoint,
      heatAbsorbed,
      meltedFraction: (clamped - warmUpTime) / meltingDuration,
      phase: 'melting',
    }
  }

  return {
    temperature:
      sample.meltingPoint +
      (heaterPower * (clamped - meltingEndTime)) /
        (sample.mass * sample.liquidSpecificHeat),
    heatAbsorbed,
    meltedFraction: 1,
    phase: 'liquid',
  }
}

export const thermalStateAt = (model: ResolvedThermalModel, time: number): ThermalState =>
  sampleStateAt(model, model.heaterPower, time, model.runDuration)

/**
 * Heat accounted for the other way round — summed segment by segment out of
 * Q = cmΔT and Q = mL rather than read off the heater as P·t. Agreeing with
 * {@link sampleStateAt} is a real cross-check of the solution, since the two
 * routes only meet if every segment length is right.
 */
export const sampleHeatFromSegments = (
  sample: ResolvedThermalSample,
  heaterPower: number,
  time: number,
  runDuration: number | undefined,
): number => {
  const { warmUpTime, meltingEndTime, totalTime } = sampleTimingOf(
    sample,
    heaterPower,
    runDuration,
  )
  const clamped = Math.min(Math.max(0, time), totalTime)
  const state = sampleStateAt(sample, heaterPower, clamped, runDuration)

  if (sample.startsMolten) {
    return sample.mass * sample.liquidSpecificHeat * (state.temperature - sample.initialTemperature)
  }

  const solidHeat =
    sample.mass *
    sample.solidSpecificHeat *
    (Math.min(state.temperature, sample.meltingPoint) - sample.initialTemperature)
  if (clamped <= warmUpTime) return solidHeat

  const meltHeat = sample.mass * sample.latentHeat * state.meltedFraction
  if (sample.crystalline && clamped <= meltingEndTime) return solidHeat + meltHeat

  const liquidHeat =
    sample.mass * sample.liquidSpecificHeat * (state.temperature - sample.meltingPoint)
  return solidHeat + meltHeat + liquidHeat
}

export const heatFromSegments = (model: ResolvedThermalModel, time: number): number =>
  sampleHeatFromSegments(model, model.heaterPower, time, model.runDuration)
