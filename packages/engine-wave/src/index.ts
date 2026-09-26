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
  LONGITUDINAL_WAVE_MODEL,
  REFLECTION_REFRACTION_WAVE_MODEL,
  DIFFRACTION_WAVE_MODEL,
  DOPPLER_WAVE_MODEL,
  TRAVELLING_WAVE_MODEL,
  WAVE_ENGINE_ID,
  WAVE_ENGINE_VERSION,
  WAVE_INTERFERENCE_MODEL,
  WAVE_PROFILE_SAMPLES,
  WaveEngine,
  createWaveSimulationRequest,
  profileSampleCountOf,
  resolveWave,
  waveAntinodeId,
  waveBoundaryId,
  waveDopplerObserverId,
  waveDopplerSourceId,
  waveEngine,
  waveIncidentRayId,
  waveMarkerId,
  waveMinimumId,
  waveNodeId,
  waveParticleId,
  wavePointId,
  waveProfileId,
  waveReflectedRayId,
  waveRefractedRayId,
  waveScreenId,
  waveSlitId,
  waveSourceId,
} from './wave-engine.ts'
export {
  antinodePositionsOf,
  diffractionMinimumAngle,
  dopplerObservedFrequency,
  dopplerObservedWavelength,
  interferenceDisplacementAt,
  interferenceVerdictOf,
  longitudinalDisplacementAt,
  longitudinalParticleVelocityAt,
  longitudinalPressureStateAt,
  longitudinalStrainAt,
  nodePositionsOf,
  pathDifferenceOf,
  reflectionRefractionReadingOf,
  resolveWaveModel,
  resultantAmplitudeOf,
  singleSlitIntensityRatio,
  standingDisplacement,
  travellingDisplacement,
  travellingTransverseVelocity,
  type InterferenceVerdict,
  type LongitudinalPressureState,
  type ReflectionRefractionReading,
  type ResolvedWaveModel,
  type WaveSubModel,
} from './wave-model.ts'
