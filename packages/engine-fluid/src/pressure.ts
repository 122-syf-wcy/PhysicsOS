import type { ResolvedPressureModel } from './pressure-model.ts'

/**
 * Closed-form pressure solutions, one per sub-model, each paired with a
 * second route to the same number.
 *
 * Pressure is a single multiplication in every sub-model, so the risk this
 * module guards against is not an unsolvable equation but a slipped factor or
 * an inverted ratio — the exact errors that produce a confident wrong reading.
 * Every solver therefore ships with a derivation that reaches the same quantity
 * through a different structure: a numerical gradient integration for the
 * hydrostatic column, a surface integration for the hemisphere pull, and the
 * inverse-area relationship re-derived from each contact face.
 */

/**
 * Slabs used to rebuild a hydrostatic column by integrating dp/dh = ρg. For a
 * uniform liquid the sum is exact in exact arithmetic, so this samples enough
 * that the floating-point accumulation stays far inside the tolerance.
 */
const HYDROSTATIC_SLABS = 512

/**
 * Panels used for the hemisphere surface integral. Simpson's rule on
 * sinθ·cosθ converges to machine precision well before this, so the check
 * compares against the closed form rather than against its own discretization.
 */
const HEMISPHERE_PANELS = 2048

/** Relative tolerance for the closed-form cross-checks. */
export const PRESSURE_RELATIVE_TOLERANCE = 1e-9

export interface SolidPressureReading {
  /** Perpendicular force on the contact face (N). */
  readonly force: number
  /** Loaded contact area (m²). */
  readonly area: number
  /** Pressure under the loaded face (Pa). */
  readonly pressure: number
  /** The other contact face (m²); absent when the bench did not author one. */
  readonly comparisonArea: number | undefined
  /** Pressure under the other face (Pa); absent with the area. */
  readonly comparisonPressure: number | undefined
}

export interface LiquidPressureReading {
  /** Density of the probed liquid (kg/m³). */
  readonly liquidDensity: number
  /** Probe depth below the surface (m). */
  readonly depth: number
  /** Gauge pressure at the probe (Pa). */
  readonly pressure: number
  /** Second probe depth in the same liquid (m); absent when not authored. */
  readonly comparisonDepth: number | undefined
  /** Gauge pressure at the second depth (Pa); absent with the depth. */
  readonly comparisonDepthPressure: number | undefined
  /** A second liquid probed at `depth` (kg/m³); absent when not authored. */
  readonly comparisonLiquidDensity: number | undefined
  /** Gauge pressure in the second liquid at the same depth (Pa). */
  readonly comparisonLiquidPressure: number | undefined
}

export interface AtmosphericPressureReading {
  /** Atmospheric pressure both instruments read (Pa). */
  readonly atmosphericPressure: number
  /** Height of the barometer column in equilibrium (m). */
  readonly columnHeight: number
  /** Axial pull needed to separate the hemisphere pair (N). */
  readonly hemisphereForce: number
}

/** p = F/S. A zero force is a real rig — it reads zero pressure. */
export const solidPressureOf = (
  model: ResolvedPressureModel & { type: 'solid' },
): SolidPressureReading => {
  const pressure = model.force / model.area
  return {
    force: model.force,
    area: model.area,
    pressure,
    comparisonArea: model.comparisonArea,
    comparisonPressure:
      model.comparisonArea === undefined ? undefined : model.force / model.comparisonArea,
  }
}

/** p = ρgh, measured from the surface down. */
export const liquidPressureOf = (
  model: ResolvedPressureModel & { type: 'liquid' },
): LiquidPressureReading => {
  const at = (density: number, depth: number) => density * model.gravity * depth
  return {
    liquidDensity: model.liquidDensity,
    depth: model.depth,
    pressure: at(model.liquidDensity, model.depth),
    comparisonDepth: model.comparisonDepth,
    comparisonDepthPressure:
      model.comparisonDepth === undefined
        ? undefined
        : at(model.liquidDensity, model.comparisonDepth),
    comparisonLiquidDensity: model.comparisonLiquidDensity,
    comparisonLiquidPressure:
      model.comparisonLiquidDensity === undefined
        ? undefined
        : at(model.comparisonLiquidDensity, model.depth),
  }
}

/**
 * h = p₀/(ρ·g) for the barometer, F = p₀·πr² for the hemispheres. Both read the
 * one pressure the bench states, so the two instruments agreeing is a property
 * of the model rather than a second measurement.
 */
export const atmosphericPressureOf = (
  model: ResolvedPressureModel & { type: 'atmospheric' },
): AtmosphericPressureReading => ({
  atmosphericPressure: model.atmosphericPressure,
  columnHeight: model.atmosphericPressure / (model.barometerFluidDensity * model.gravity),
  hemisphereForce: model.atmosphericPressure * Math.PI * model.hemisphereRadius ** 2,
})

/** The reading for whichever sub-model the bench carries. */
export const pressureReadingOf = (
  model: ResolvedPressureModel,
): SolidPressureReading | LiquidPressureReading | AtmosphericPressureReading => {
  if (model.type === 'solid') return solidPressureOf(model)
  if (model.type === 'liquid') return liquidPressureOf(model)
  return atmosphericPressureOf(model)
}

/* ------------------------------------------------------- second routes -- */

/**
 * p = ρgh re-derived by integrating the hydrostatic gradient dp/dh = ρg from the
 * surface down to the probe. The closed form multiplies; this accumulates, so a
 * missing g, a missing density or a factor of two cannot satisfy both.
 */
export const hydrostaticPressureByIntegration = (
  density: number,
  gravity: number,
  depth: number,
  slabs: number = HYDROSTATIC_SLABS,
): number => {
  const step = depth / slabs
  let total = 0
  for (let index = 0; index < slabs; index += 1) total += density * gravity * step
  return total
}

/**
 * F = p₀·πr² re-derived by integrating the pressure over the hemisphere's curved
 * surface. Each ring at polar angle θ carries p·dA normally, whose axial
 * component is p·cosθ·dA with dA = 2πr²·sinθ dθ; the integral collapses to
 * p₀·πr², which is the projected-area result the closed form assumes. Simpson's
 * rule keeps the discretization error orders of magnitude below the tolerance.
 */
export const hemisphereForceBySurfaceIntegral = (
  pressure: number,
  radius: number,
  panels: number = HEMISPHERE_PANELS,
): number => {
  const end = Math.PI / 2
  const step = end / panels
  const integrand = (theta: number) => Math.sin(theta) * Math.cos(theta)
  let total = integrand(0) + integrand(end)
  for (let index = 1; index < panels; index += 1) {
    total += (index % 2 === 0 ? 2 : 4) * integrand(index * step)
  }
  return pressure * 2 * Math.PI * radius ** 2 * ((step / 3) * total)
}
