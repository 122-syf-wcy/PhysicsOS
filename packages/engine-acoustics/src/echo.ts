import type { ResolvedAcousticModel } from './acoustics-model.ts'

/**
 * Closed-form echo kinematics.
 *
 * The pulse is a point disturbance travelling at the medium's sound speed:
 * out along +x until it meets the wall at t = d/v, back along −x until it
 * reaches the source again at t = 2d/v. Both legs are uniform motion, so the
 * whole timeline is exact algebra — no integration, no approximation beyond
 * the ray-acoustics idealisation itself.
 */

/** Which leg of the round trip the pulse is on at a given time. */
export type EchoPhase = 'outbound' | 'return' | 'received'

export interface EchoTiming {
  /** One-way travel time d/v (s). */
  readonly oneWayTime: number
  /** Round-trip echo delay 2d/v (s). */
  readonly roundTripTime: number
}

export interface PulseState {
  /** Signed axis position of the pulse (m). */
  readonly x: number
  /** Distance the pulse has travelled so far (m), ≤ 2d. */
  readonly travelled: number
  readonly phase: EchoPhase
}

export const echoTimingOf = (model: ResolvedAcousticModel): EchoTiming => {
  const oneWayTime = model.wallDistance / model.soundSpeed
  return { oneWayTime, roundTripTime: 2 * oneWayTime }
}

/**
 * Pulse state at time t ≥ 0. Past the round trip the pulse has been received
 * and stays parked at the source — the state is a reading, not an
 * extrapolation beyond the experiment.
 */
export const pulseStateAt = (model: ResolvedAcousticModel, time: number): PulseState => {
  const { oneWayTime, roundTripTime } = echoTimingOf(model)
  if (time >= roundTripTime) {
    return { x: model.sourceX, travelled: 2 * model.wallDistance, phase: 'received' }
  }
  const travelled = model.soundSpeed * Math.max(0, time)
  if (time <= oneWayTime) {
    return { x: model.sourceX + travelled, travelled, phase: 'outbound' }
  }
  /* Return leg: fold the distance back off the wall. */
  return {
    x: model.reflectorX - (travelled - model.wallDistance),
    travelled,
    phase: 'return',
  }
}
