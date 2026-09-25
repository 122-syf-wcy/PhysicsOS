/**
 * The ideal transformer: two coils on one core, and nothing else.
 *
 * Self-contained physics, kept apart from the engine class the way every other
 * slice keeps its closed forms apart. One magnetic flux threads both windings,
 * so each turn of each coil sees the same dΦ/dt — and every ratio below is a
 * consequence of that single fact rather than an independent rule:
 *
 *   U = N·dΦ/dt  →  U₁/U₂ = N₁/N₂
 *   U₁I₁ = U₂I₂  →  I₁/I₂ = N₂/N₁
 *
 * The turns ratio is the whole machine. It steps a voltage UP by stepping the
 * current DOWN, and the product — the power — does not move at all.
 */

export const TRANSFORMER_RELATIVE_TOLERANCE = 1e-9

/** Secondary voltage: U₂ = U₁·N₂/N₁ (V). */
export const secondaryVoltage = (
  primaryVoltage: number,
  primaryTurns: number,
  secondaryTurns: number,
): number => (primaryVoltage * secondaryTurns) / primaryTurns

/** Secondary current: I₂ = I₁·N₁/N₂ (A). */
export const secondaryCurrent = (
  primaryCurrent: number,
  primaryTurns: number,
  secondaryTurns: number,
): number => (primaryCurrent * primaryTurns) / secondaryTurns

/** Power through the primary: P = U₁I₁ (W). An ideal transformer passes it all. */
export const throughPower = (voltage: number, current: number): number => voltage * current

/** What the transformer reads at its current windings. */
export interface TransformerReading {
  readonly primaryVoltage: number
  readonly primaryCurrent: number
  readonly primaryTurns: number
  readonly secondaryTurns: number
  /** Turns ratio N₁/N₂. */
  readonly turnsRatio: number
  readonly secondaryVoltage: number
  readonly secondaryCurrent: number
  /** Power in (W) — and, because the machine is ideal, power out too. */
  readonly primaryPower: number
  readonly secondaryPower: number
  /** True when this rig steps the voltage UP (N₂ > N₁). */
  readonly stepsUp: boolean
}

export const transformerReadingOf = (
  primaryVoltage: number,
  primaryCurrent: number,
  primaryTurns: number,
  secondaryTurns: number,
): TransformerReading => {
  const secondaryV = secondaryVoltage(primaryVoltage, primaryTurns, secondaryTurns)
  const secondaryA = secondaryCurrent(primaryCurrent, primaryTurns, secondaryTurns)
  return {
    primaryVoltage,
    primaryCurrent,
    primaryTurns,
    secondaryTurns,
    turnsRatio: primaryTurns / secondaryTurns,
    secondaryVoltage: secondaryV,
    secondaryCurrent: secondaryA,
    primaryPower: throughPower(primaryVoltage, primaryCurrent),
    secondaryPower: throughPower(secondaryV, secondaryA),
    stepsUp: secondaryTurns > primaryTurns,
  }
}
