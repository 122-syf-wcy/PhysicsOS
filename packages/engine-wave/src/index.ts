/**
 * Wave Engine — mechanical waves (机械波).
 *
 * Three closed-form sub-models share this engine:
 *
 * - `travelling_wave`: one sinusoidal wave along a rope,
 *   y(x, t) = A·sin(2π(x/λ − f·t)), v = λf, T = 1/f, and a marked particle
 *   that oscillates in place.
 * - `wave_interference`: two coherent equal-amplitude sources; the path
 *   difference Δ = |r₂ − r₁| decides 加强 (Δ = nλ) or 减弱 (Δ = (n + ½)λ) with
 *   resultant amplitude |2A·cos(πΔ/λ)|.
 * - `standing_wave`: a string clamped at both ends in its n-th harmonic,
 *   L = n·λ/2, f_n = n·v/(2L), nodes at m·L/n.
 */

export {
  STANDING_WAVE_MODEL,
  TRAVELLING_WAVE_MODEL,
  WAVE_ENGINE_ID,
  WAVE_ENGINE_VERSION,
  WAVE_INTERFERENCE_MODEL,
  WAVE_PROFILE_SAMPLES,
  WaveEngine,
  createWaveSimulationRequest,
  resolveWave,
  waveAntinodeId,
  waveEngine,
  waveMarkerId,
  waveNodeId,
  wavePointId,
  waveProfileId,
  waveSourceId,
} from './wave-engine.ts'
export {
  antinodePositionsOf,
  interferenceDisplacementAt,
  interferenceVerdictOf,
  nodePositionsOf,
  pathDifferenceOf,
  resolveWaveModel,
  resultantAmplitudeOf,
  standingDisplacement,
  travellingDisplacement,
  travellingTransverseVelocity,
  type InterferenceVerdict,
  type ResolvedWaveModel,
  type WaveSubModel,
} from './wave-model.ts'
