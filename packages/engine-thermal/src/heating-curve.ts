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
/**
 * Which part of the curve the sample is on.
 *
 * `boiling` is a phase of its own because its plateau is the one the 水的沸腾
 * experiment is ABOUT: the temperature stops rising at 100 °C while the water
 * boils, exactly as it stopped at 0 °C while the ice melted.
 */
export type ThermalPhase = 'solid' | 'melting' | 'liquid' | 'boiling'

export interface HeatingTiming {
  /** Time to bring the solid up to its melting point (s); 0 if already liquid. */
  readonly warmUpTime: number
  /** Duration of the melting plateau mL/P (s); zero for an amorphous sample. */
  readonly meltingDuration: number
  /** Instant melting finishes (s); equals warmUpTime when there is no plateau. */
  readonly meltingEndTime: number
  /** When the liquid reaches its boiling point; absent on a bench that never boils. */
  readonly boilingStartTime: number | undefined
  /** How long the boiling plateau lasts (s); absent on a bench that never boils. */
  readonly boilingDuration: number | undefined
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
    const boiling = boilingTimingOf(sample, heaterPower, 0)
    /* The same cap as the melting branch below: a liquid that boils away ends
       the run at the end of its plateau whether or not the bench named a longer
       duration. */
    const plateauEnd =
      boiling.boilingStartTime === undefined
        ? undefined
        : boiling.boilingStartTime + (boiling.boilingDuration ?? 0)
    return {
      warmUpTime: 0,
      meltingDuration: 0,
      meltingEndTime: 0,
      ...boiling,
      totalTime:
        plateauEnd === undefined
          ? (runDuration ?? 0)
          : runDuration === undefined
            ? plateauEnd
            : Math.min(runDuration, plateauEnd),
    }
  }
  const warmUpTime =
    (sample.mass * sample.solidSpecificHeat * (sample.meltingPoint - sample.initialTemperature)) /
    heaterPower
  const meltingDuration = (sample.mass * sample.latentHeat) / heaterPower
  const meltingEndTime = warmUpTime + meltingDuration
  const boiling = boilingTimingOf(sample, heaterPower, meltingEndTime)
  return {
    warmUpTime,
    meltingDuration,
    meltingEndTime,
    ...boiling,
    /* The curve ends where the PHYSICS does. Without a stated run that is the
       end of the boiling plateau (or of the warming after the melt); with one,
       it is the sooner of the two — a run that outlasted the water would have
       nothing left to model, since this rig has no gas phase to warm, and the
       heat balance would then compare P·t against a sample that stopped
       absorbing. */
    totalTime: (() => {
      if (boiling.boilingStartTime === undefined) return runDuration ?? meltingEndTime + warmUpTime
      const plateauEnd = boiling.boilingStartTime + (boiling.boilingDuration ?? 0)
      return runDuration === undefined ? plateauEnd : Math.min(runDuration, plateauEnd)
    })(),
  }
}

/**
 * When boiling starts and how long its plateau lasts.
 *
 * The liquid has to warm from the melting point to the boiling point first —
 * c_liquid·m·ΔT/P seconds of it — and then the plateau is m·L_vap/P. Both are
 * `undefined` on a bench that never boils, which is how the rest of the engine
 * knows to leave the two-phase curve alone.
 */
const boilingTimingOf = (
  sample: ResolvedThermalSample,
  heaterPower: number,
  meltingEndTime: number,
): Pick<HeatingTiming, 'boilingStartTime' | 'boilingDuration'> => {
  if (sample.boilingPoint === undefined || sample.vaporizationHeat === undefined) {
    return { boilingStartTime: undefined, boilingDuration: undefined }
  }
  /* The liquid warms from where it actually IS: a sample that started molten is
     already past its melting point, and timing its boil from the melting point
     would credit it with warming it never had to do. */
  const liquidFrom = sample.startsMolten ? sample.initialTemperature : sample.meltingPoint
  const warmToBoil =
    (sample.mass * sample.liquidSpecificHeat * (sample.boilingPoint - liquidFrom)) / heaterPower
  return {
    boilingStartTime: meltingEndTime + warmToBoil,
    boilingDuration: (sample.mass * sample.vaporizationHeat) / heaterPower,
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
  const { warmUpTime, meltingDuration, meltingEndTime, boilingStartTime, totalTime } =
    sampleTimingOf(sample, heaterPower, runDuration)
  const clamped = Math.min(Math.max(0, time), totalTime)
  const heatAbsorbed = heaterPower * clamped

  if (sample.startsMolten) {
    if (boilingStartTime !== undefined && clamped >= boilingStartTime) {
      return {
        temperature: sample.boilingPoint ?? sample.meltingPoint,
        heatAbsorbed,
        meltedFraction: 1,
        phase: 'boiling',
      }
    }
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

  /* The second plateau: at the boiling point the temperature stops again while
     the liquid turns to vapour. The heater is still delivering P — the heat is
     going into the phase change, not into a temperature rise, which is the
     whole reading the 水的沸腾 experiment takes. */
  if (boilingStartTime !== undefined && clamped >= boilingStartTime) {
    return {
      temperature: sample.boilingPoint ?? sample.meltingPoint,
      heatAbsorbed,
      meltedFraction: 1,
      phase: 'boiling',
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
  const { warmUpTime, meltingEndTime, boilingStartTime, boilingDuration, totalTime } =
    sampleTimingOf(sample, heaterPower, runDuration)
  const clamped = Math.min(Math.max(0, time), totalTime)
  const state = sampleStateAt(sample, heaterPower, clamped, runDuration)

  /* The vapour a boiling sample has made so far, clamped at 1: past the end of
     the plateau the water is gone, and this two-phase model has no gas to warm
     — so the fraction stops rather than overshooting the latent heat. */
  const vaporized =
    boilingStartTime === undefined || boilingDuration === undefined || clamped < boilingStartTime
      ? 0
      : Math.min(1, (clamped - boilingStartTime) / boilingDuration)
  const vaporHeat = sample.mass * (sample.vaporizationHeat ?? 0) * vaporized

  if (sample.startsMolten) {
    const liquidHeat =
      sample.mass * sample.liquidSpecificHeat * (state.temperature - sample.initialTemperature)
    return liquidHeat + vaporHeat
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
  return solidHeat + meltHeat + liquidHeat + vaporHeat
}

export const heatFromSegments = (model: ResolvedThermalModel, time: number): number =>
  sampleHeatFromSegments(model, model.heaterPower, time, model.runDuration)
