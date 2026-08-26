/**
 * Acoustics Engine — echo ranging on a single-axis range.
 *
 * The engine resolves the scene's acoustic bench (one sound source, one
 * reflecting wall, one medium sound speed) into canonical SI numbers, then
 * solves the round trip with closed-form uniform motion: out at v until the
 * wall at t = d/v, back at v until the source at t = 2d/v. The measurement
 * the lab teaches — d = v·t/2 — is verified against the geometric distance,
 * and both legs are checked for uniform propagation and symmetry.
 */

export {
  resolveAcousticModel,
  type ResolvedAcousticModel,
} from './acoustics-model.ts'
export {
  echoTimingOf,
  pulseStateAt,
  type EchoPhase,
  type EchoTiming,
  type PulseState,
} from './echo.ts'
export {
  ACOUSTICS_ENGINE_ID,
  ACOUSTICS_ENGINE_VERSION,
  ECHO_RANGING_MODEL,
  AcousticsEngine,
  acousticsEngine,
  createAcousticsSimulationRequest,
  resolveEchoRanging,
} from './acoustics-engine.ts'
