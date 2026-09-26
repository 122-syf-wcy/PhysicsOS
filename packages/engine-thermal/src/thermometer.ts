/**
 * The liquid-in-glass thermometer: expansion drives a column, and two fixed
 * points turn that column into a scale.
 *
 * Self-contained physics, kept apart from the engine class the way every other
 * slice keeps its closed forms apart. The whole instrument is one relation —
 * a liquid expands by β per kelvin, and a capillary of known bore turns that
 * volume into a length:
 *
 *   ΔV = V₀·β·ΔT          (thermal expansion)
 *   Δh = ΔV / A           (the bore turns volume into height)
 *   ⇒ Δh = (V₀·β/A)·ΔT    (a STRAIGHT line — which is why the scale is uniform)
 *
 * The bracketed constant is the instrument's sensitivity, and everything a
 * student reads off the glass follows from it.
 */

export const THERMOMETER_RELATIVE_TOLERANCE = 1e-9

/** Cross-section of a round bore of the given diameter (m²). */
export const boreArea = (diameter: number): number => Math.PI * (diameter / 2) ** 2

/** Volume the liquid gains over a temperature rise: ΔV = V₀·β·ΔT (m³). */
export const expansionVolume = (
  bulbVolume: number,
  expansionCoefficient: number,
  temperatureRise: number,
): number => bulbVolume * expansionCoefficient * temperatureRise

/**
 * How far the column climbs per kelvin: k = V₀·β/A (m/K).
 *
 * This single number IS the thermometer. It is also why the scale can be ruled
 * evenly: the rise is linear in temperature, so equal temperature steps are
 * equal distances up the glass.
 */
export const scaleFactor = (
  bulbVolume: number,
  boreAreaSquareMetres: number,
  expansionCoefficient: number,
): number => (bulbVolume * expansionCoefficient) / boreAreaSquareMetres

/** Column length at a temperature, measured from the lower fixed point (m). */
export const columnLengthAt = (
  icePointLength: number,
  scale: number,
  temperature: number,
): number => icePointLength + scale * temperature

/** What the thermometer reads. */
export interface ThermometerReading {
  readonly bulbVolume: number
  readonly boreArea: number
  readonly boreDiameter: number
  readonly expansionCoefficient: number
  /** The temperature the bulb is sitting in (°C). */
  readonly temperature: number
  /** m per K — the instrument's sensitivity. */
  readonly scale: number
  /** Column length at the lower fixed point (m). */
  readonly icePoint: number
  /** Column length at the upper fixed point (m). */
  readonly steamPoint: number
  /** Column length at the temperature being read (m). */
  readonly column: number
  /** Distance between the two fixed points (m) — the whole 0…100 span. */
  readonly span: number
  /**
   * Degrees per metre of column: 1/k. Its reciprocal in millimetres is the
   * 分度值 the glass is ruled in when one division is one millimetre.
   */
  readonly degreesPerMetre: number
}

export const thermometerReadingOf = (
  bulbVolume: number,
  boreDiameter: number,
  expansionCoefficient: number,
  temperature: number,
  icePointLength: number,
): ThermometerReading => {
  const area = boreArea(boreDiameter)
  const scale = scaleFactor(bulbVolume, area, expansionCoefficient)
  return {
    bulbVolume,
    boreArea: area,
    boreDiameter,
    expansionCoefficient,
    temperature,
    scale,
    icePoint: icePointLength,
    steamPoint: columnLengthAt(icePointLength, scale, 100),
    column: columnLengthAt(icePointLength, scale, temperature),
    span: scale * 100,
    degreesPerMetre: 1 / scale,
  }
}
