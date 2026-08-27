/**
 * Thermal Engine — constant-power heating curve.
 *
 * The engine resolves the scene's heating bench (one sample, one steady heater)
 * into canonical SI numbers, then solves the whole run in closed form: a
 * straight climb at P/(mc_固), a plateau of exactly mL/P at the melting point
 * while the crystal breaks up, and a second climb at P/(mc_液). The heat the
 * heater delivered is cross-checked against the heat the segments absorbed, and
 * the plateau — the fact that a crystal keeps absorbing without getting hotter
 * — is verified across its whole length rather than at its ends.
 */

export {
  resolveThermalModel,
  type ResolvedThermalModel,
} from './thermal-model.ts'
export {
  heatFromSegments,
  heatingTimingOf,
  thermalStateAt,
  type HeatingTiming,
  type ThermalPhase,
  type ThermalState,
} from './heating-curve.ts'
export {
  HEATING_CURVE_MODEL,
  THERMAL_ENGINE_ID,
  THERMAL_ENGINE_VERSION,
  ThermalEngine,
  createThermalSimulationRequest,
  resolveHeatingCurve,
  thermalEngine,
} from './thermal-engine.ts'
