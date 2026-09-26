import { describe, expect, it } from 'vitest'
import { derivedScalar } from '@physicsos/physics-core'
import {
  createDiffractionScene,
  createDopplerScene,
  createLongitudinalWaveScene,
  createReflectionRefractionScene,
} from '@physicsos/physics-scene'

import {
  DIFFRACTION_WAVE_MODEL,
  DOPPLER_WAVE_MODEL,
  WaveEngine,
  createWaveSimulationRequest,
  diffractionMinimumAngle,
  dopplerObservedFrequency,
  longitudinalPressureStateAt,
  reflectionRefractionReadingOf,
  resolveWaveModel,
  singleSlitIntensityRatio,
} from '../src/index.ts'

const simulate = (scene: ReturnType<typeof createLongitudinalWaveScene>) =>
  new WaveEngine().simulate(
    scene,
    createWaveSimulationRequest(scene, 'sim-wave-expansion', 'trace-wave-expansion'),
  )

describe('longitudinal wave model', () => {
  const scene = createLongitudinalWaveScene({
    amplitude: 2,
    wavelength: 0.5,
    frequency: 4,
    mediumLength: 1.5,
  })

  it('resolves ξ(x,t) = A sin(2π(x/λ − ft)) with v = λf', () => {
    const model = resolveWaveModel(scene)
    expect(model.subModel).toBe('longitudinal_wave')
    expect(model.subModel === 'longitudinal_wave' && model.waveSpeed).toBeCloseTo(2, 12)
  })

  it('marks compression where ∂ξ/∂x < 0 and rarefaction where it is positive', () => {
    const model = resolveWaveModel(scene)
    if (model.subModel !== 'longitudinal_wave') throw new Error('wrong model')
    /* ξ = A sin(2πx/λ), so strain ∝ cos(2πx/λ): x = 0 is rarefaction and
       x = λ/2 is compression. */
    expect(longitudinalPressureStateAt(model, 0, 0)).toBe('rarefaction')
    expect(longitudinalPressureStateAt(model, model.wavelength / 2, 0)).toBe('compression')
  })

  it('moves particles parallel to propagation and passes the engine checks', () => {
    const result = simulate(scene)
    expect(result.verification.status).toBe('passed')
    expect(derivedScalar(result.derivedQuantities, 'wave_speed').value).toBeCloseTo(2, 12)
    expect(
      result.verification.checks.find((entry) => entry.id === 'longitudinal_particle_motion')
        ?.passed,
    ).toBe(true)
  })
})

describe('wave reflection and refraction model', () => {
  it('applies reflection equality and Snell’s wave-speed law', () => {
    const scene = createReflectionRefractionScene({
      amplitude: 1,
      frequency: 2,
      incidentSpeed: 4,
      transmittedSpeed: 2,
      incidentAngle: 30,
    })
    const model = resolveWaveModel(scene)
    expect(model.subModel).toBe('reflection_refraction')
    const reading = reflectionRefractionReadingOf(model)
    expect(reading.reflectionAngle).toBeCloseTo(30, 12)
    expect(reading.refractedAngle).toBeCloseTo(
      (Math.asin((2 / 4) * Math.sin((30 * Math.PI) / 180)) * 180) / Math.PI,
      12,
    )
    expect(reading.totalInternalReflection).toBe(false)
  })

  it('reports total internal reflection as an absent refracted branch', () => {
    const scene = createReflectionRefractionScene({
      amplitude: 1,
      frequency: 2,
      incidentSpeed: 2,
      transmittedSpeed: 4,
      incidentAngle: 45,
    })
    const reading = reflectionRefractionReadingOf(resolveWaveModel(scene))
    expect(reading.criticalAngle).toBeCloseTo(30, 12)
    expect(reading.totalInternalReflection).toBe(true)
    expect(reading.refractedAngle).toBeUndefined()
  })

  it('verifies both boundary laws and the transmitted speed', () => {
    const scene = createReflectionRefractionScene({
      amplitude: 1,
      frequency: 2,
      incidentSpeed: 4,
      transmittedSpeed: 2,
      incidentAngle: 30,
    })
    const result = simulate(scene)
    expect(result.verification.status).toBe('passed')
    expect(
      result.verification.checks.find((entry) => entry.id === 'reflection_angle_equality')?.passed,
    ).toBe(true)
    expect(
      result.verification.checks.find((entry) => entry.id === 'snells_law_wave_speed')?.passed,
    ).toBe(true)
  })
})

describe('single-slit diffraction model', () => {
  it('places the first minimum at sinθ = λ/a and the central width at 2Lλ/a', () => {
    const scene = createDiffractionScene({
      amplitude: 1,
      wavelength: 0.5,
      frequency: 2,
      slitWidth: 1,
      screenDistance: 2,
    })
    const model = resolveWaveModel(scene)
    expect(model.subModel).toBe(DIFFRACTION_WAVE_MODEL)
    expect(singleSlitIntensityRatio(model, 0)).toBeCloseTo(1, 12)
    expect(singleSlitIntensityRatio(model, diffractionMinimumAngle(model, 1))).toBeCloseTo(0, 12)
    if (model.subModel !== DIFFRACTION_WAVE_MODEL) throw new Error('wrong model')
    expect(model.centralMaximumWidth).toBeCloseTo(2, 12)
  })

  it('verifies the minimum condition and central maximum width', () => {
    const result = simulate(
      createDiffractionScene({
        amplitude: 1,
        wavelength: 0.5,
        frequency: 2,
        slitWidth: 1,
        screenDistance: 2,
      }),
    )
    expect(result.verification.status).toBe('passed')
    expect(
      result.verification.checks.find((entry) => entry.id === 'diffraction_minimum_condition')
        ?.passed,
    ).toBe(true)
    expect(
      result.verification.checks.find((entry) => entry.id === 'central_maximum_width')?.passed,
    ).toBe(true)
  })
})

describe('Doppler model', () => {
  it('raises frequency for an approaching source and lowers it for a receding source', () => {
    const approaching = resolveWaveModel(
      createDopplerScene({
        amplitude: 1,
        sourceFrequency: 500,
        waveSpeed: 340,
        sourceSpeed: 34,
        observerSpeed: 0,
        sourceDirection: 'approaching',
        observerDirection: 'stationary',
      }),
    )
    const receding = resolveWaveModel(
      createDopplerScene({
        amplitude: 1,
        sourceFrequency: 500,
        waveSpeed: 340,
        sourceSpeed: 34,
        observerSpeed: 0,
        sourceDirection: 'receding',
        observerDirection: 'stationary',
      }),
    )
    expect(dopplerObservedFrequency(approaching)).toBeCloseTo(500 * (340 / 306), 12)
    expect(dopplerObservedFrequency(receding)).toBeCloseTo(500 * (340 / 374), 12)
    expect(dopplerObservedFrequency(approaching)).toBeGreaterThan(500)
    expect(dopplerObservedFrequency(receding)).toBeLessThan(500)
  })

  it('verifies the frequency law and observed wavelength', () => {
    const scene = createDopplerScene({
      amplitude: 1,
      sourceFrequency: 500,
      waveSpeed: 340,
      sourceSpeed: 34,
      observerSpeed: 17,
      sourceDirection: 'approaching',
      observerDirection: 'approaching',
    })
    const model = resolveWaveModel(scene)
    expect(model.subModel).toBe(DOPPLER_WAVE_MODEL)
    const result = simulate(scene)
    expect(result.verification.status).toBe('passed')
    expect(
      result.verification.checks.find((entry) => entry.id === 'doppler_frequency_relation')?.passed,
    ).toBe(true)
    expect(
      result.verification.checks.find((entry) => entry.id === 'doppler_observed_wavelength')
        ?.passed,
    ).toBe(true)
  })

  it('returns UNSUPPORTED_MODEL when the source reaches the wave speed', () => {
    const scene = createDopplerScene({
      amplitude: 1,
      sourceFrequency: 500,
      waveSpeed: 340,
      sourceSpeed: 340,
      observerSpeed: 0,
      sourceDirection: 'approaching',
      observerDirection: 'stationary',
    })
    const support = new WaveEngine().canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) expect(support.reason).toBe('unsupported_model')
  })
})
