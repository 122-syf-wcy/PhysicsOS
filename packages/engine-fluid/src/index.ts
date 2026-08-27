/**
 * Fluid Engine — Archimedes buoyancy on a spring-scale rig.
 *
 * The engine resolves the scene's tank (one block, one liquid, one lowering
 * rate) into canonical SI numbers, then solves the descent in closed form: the
 * submerged height grows linearly until the block is either fully covered or
 * floating, and the scale reads whatever weight buoyancy has not taken. The
 * measurement the lab teaches — F_浮 = G − F_示 — is cross-checked against the
 * pressure difference across the block's faces, and the flat tail that proves
 * buoyancy does not depend on depth is verified at two different depths.
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
