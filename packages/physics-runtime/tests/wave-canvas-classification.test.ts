import { describe, expect, it } from 'vitest'
import { WaveEngine, createWaveSimulationRequest } from '@physicsos/engine-wave'
import { createDiffractionScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'

import { ENGINE_CAPABILITIES } from '../src/index.ts'

describe('wave canvas engine classification remains truthful', () => {
  it('retains the declared 65 diffraction history samples and budgets them without confusing live display geometry with a static plan', () => {
    const scene = createDiffractionScene({ wavelength: 0.2, frequency: 5, slitWidth: 1, screenDistance: 2 })
    const request = { ...createWaveSimulationRequest(scene, 'diffraction-prepared', 'diffraction-prepared'),
      options: { startTime: quantity(0, 's', 'time'), endTime: quantity(4, 's', 'time'), outputSampleRate: 65 } }
    const engine = new WaveEngine()
    const capability = ENGINE_CAPABILITIES.find(item => item.engineId === engine.engineId)
    expect(capability?.supportsQuestion('wave', 'wave_diffraction')).toBe(true)
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan.kind).toBe('analytic')
    expect(plan.storageSampleCountBound).toBe(65)
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(65)
    expect(result.states[0]!.time.value).toBe(0)
    expect(result.states.at(-1)!.time.value).toBe(4)
    // main deliberately computes display samples only for its live state.
    const before = engine.stateAt(scene, quantity(0, 's', 'time'))
    const arrived = engine.stateAt(scene, quantity(3.5, 's', 'time'))
    const intensities = arrived.objects.filter(object => object.id.includes('.intensity.'))
    const dark = before.objects.filter(object => object.id.includes('.intensity.'))
    expect(intensities).toHaveLength(129)
    expect(dark).toHaveLength(129)
    expect(dark.every(object =>
      object.values?.illumination !== undefined && 'value' in object.values.illumination && object.values.illumination.value === 0)).toBe(true)
    expect(intensities.some(object => object.values?.illumination !== undefined &&
      'value' in object.values.illumination && object.values.illumination.value === 1)).toBe(true)
    expect(arrived.objects.some(object => object.id.includes('.diffraction-front.'))).toBe(true)
  })

})
