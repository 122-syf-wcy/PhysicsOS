/**
 * Fluid Engine — fluid statics: Archimedes buoyancy on a spring-scale rig, and
 * pressure on the three junior rigs that measure it.
 *
 * Buoyancy resolves the scene's tank (one block, one liquid, one lowering rate)
 * into canonical SI numbers, then solves the descent in closed form: the
 * submerged height grows linearly until the block is either fully covered or
 * floating, and the scale reads whatever weight buoyancy has not taken. The
 * measurement the lab teaches — F_浮 = G − F_示 — is cross-checked against the
 * pressure difference across the block's faces, and the flat tail that proves
 * buoyancy does not depend on depth is verified at two different depths.
 *
 * Pressure covers the bench beside it: a solid contact face (p = F/S), a probe
 * under a liquid surface (p = ρgh), and the atmosphere on a barometer and a
 * Magdeburg hemisphere pair (p₀). Each sub-model is checked against a second
 * derivation — the hydrostatic gradient, the hemisphere's surface integral —
 * so a slipped factor cannot produce a confident wrong reading.
 */

export {
  resolveFluidModel,
  type ResolvedFluidModel,
} from './fluid-model.ts'
export {
  buoyancyFromPressure,
  equilibriumOf,
  immersionStateAt,
  type FluidEquilibrium,
  type ImmersionPhase,
  type ImmersionState,
} from './buoyancy.ts'
export {
  BUOYANCY_MODEL,
  FLUID_ENGINE_ID,
  FLUID_ENGINE_VERSION,
  FluidEngine,
  createFluidSimulationRequest,
  fluidEngine,
  resolveBuoyancy,
} from './fluid-engine.ts'
export {
  resolvePressureModel,
  type ResolvedPressureModel,
} from './pressure-model.ts'
export {
  PRESSURE_RELATIVE_TOLERANCE,
  atmosphericPressureOf,
  hemisphereForceBySurfaceIntegral,
  hydrostaticPressureByIntegration,
  liquidPressureOf,
  pressureReadingOf,
  solidPressureOf,
  type AtmosphericPressureReading,
  type LiquidPressureReading,
  type SolidPressureReading,
} from './pressure.ts'
export {
  ATMOSPHERIC_PRESSURE_MODEL,
  LIQUID_PRESSURE_MODEL,
  PRESSURE_ENGINE_ID,
  PRESSURE_ENGINE_VERSION,
  PressureEngine,
  SOLID_PRESSURE_MODEL,
  createPressureSimulationRequest,
  pressureEngine,
  resolvePressure,
} from './pressure-engine.ts'
