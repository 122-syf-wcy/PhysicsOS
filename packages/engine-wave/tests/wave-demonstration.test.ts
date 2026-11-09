import { describe, expect, it } from 'vitest'
import { createDiffractionScene, createStandingWaveScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { WaveEngine, createWaveSimulationRequest } from '../src/index.ts'

const engine = new WaveEngine()
const frame = (scene: ReturnType<typeof createStandingWaveScene>, time: number) =>
  engine.stateAt(scene, quantity(time, 's', 'time'))
const samples = (state: ReturnType<typeof frame>, kind: string) =>
  state.objects.filter(object => object.id.includes(`.${kind}.`))
const scalar = (object: ReturnType<typeof frame>['objects'][number], key: string) => {
  const value = object.values?.[key]
  return value !== undefined && 'value' in value ? value.value : undefined
}

describe('standing-wave formation from finite boundary drives', () => {
  const scene = createStandingWaveScene({ amplitude: 4, stringLength: 2, harmonic: 2, waveSpeed: 2 })

  it('starts flat and leaves the unvisited middle at rest before the fronts meet', () => {
    const initial = samples(frame(scene, 0), 'formation-sum')
    expect(initial.length).toBeGreaterThan(20)
    expect(initial.every(object => object.position?.vector.y === 0)).toBe(true)
    const early = samples(frame(scene, 0.25), 'formation-sum')
    expect(early.some(object => Math.abs(object.position?.vector.y ?? 0) > 0.001)).toBe(true)
    expect(early.filter(object => object.position!.vector.x > 0.5 && object.position!.vector.x < 1.5)
      .every(object => object.position!.vector.y === 0)).toBe(true)
  })

  it.each([1, 2, 3, 4, 7, 8])('adds both incident waves and becomes harmonic %s after one transit', harmonic => {
    const scene = createStandingWaveScene({ amplitude: 4, stringLength: 2, harmonic, waveSpeed: 2 })
    for (const time of [0.4, 0.65, 1, 1.125, 1.25, 1.4]) {
      const state = frame(scene, time)
      const left = samples(state, 'formation-left'), right = samples(state, 'formation-right')
      const sum = samples(state, 'formation-sum'), steady = samples(state, 'profile')
      expect(sum.length).toBeGreaterThan(20)
      sum.forEach((object, i) => {
        expect(object.position!.vector.y).toBeCloseTo(left[i]!.position!.vector.y + right[i]!.position!.vector.y, 12)
        if (time >= 1) expect(object.position!.vector.y).toBeCloseTo(steady[i]!.position!.vector.y, 12)
      })
      if (time >= 1) {
        expect(sum[0]!.position!.vector.y).toBeCloseTo(0, 12)
        expect(sum.at(-1)!.position!.vector.y).toBeCloseTo(0, 12)
      }
    }
    // During the starting pulse the two endpoints are drivers, not fixed nodes.
    expect(Math.abs(samples(frame(scene, 0.125 / harmonic), 'formation-sum')[0]!.position!.vector.y)).toBeGreaterThan(0.001)
  })
})

describe('single-slit screen and wavefront data', () => {
  it('samples fronts over the entire visible path even at high frequency', () => {
    const scene = createDiffractionScene({ frequency: 50, waveSpeed: 1, slitWidth: 1 })
    const state = frame(scene, 1.5)
    const outgoing = samples(state, 'diffraction-front')
    expect(outgoing.length).toBeGreaterThan(0)
    expect(Math.max(...outgoing.map(object => object.position!.vector.x))).toBeGreaterThan(0.5)
    const groups = new Set(state.objects.filter(object => object.id.includes('.diffraction-'))
      .map(object => object.id.slice(0, object.id.lastIndexOf('.'))))
    expect(groups.size).toBeLessThanOrEqual(16)
  })

  it('keeps the first dark fringe as well as the selected higher order', () => {
    const scene = createDiffractionScene({ wavelength: 0.2, slitWidth: 1, screenDistance: 2, order: 2 })
    const state = frame(scene, 0)
    const first = state.objects.find(object => object.id.endsWith('.minimum.1'))
    const selected = state.objects.find(object => object.id.endsWith('.minimum.2'))
    expect(first).toBeDefined()
    expect(selected).toBeDefined()
    expect(first!.position!.vector.y).toBeCloseTo(0.4082482904638631, 12)
    expect(selected!.position!.vector.y).toBeCloseTo(0.8728715609439696, 12)
  })

  it('emits a symmetric nonnegative intensity pattern that lights only after propagation', () => {
    const scene = createDiffractionScene()
    const dark = samples(frame(scene, 0), 'intensity')
    const lit = samples(frame(scene, 20), 'intensity')
    expect(lit.length).toBeGreaterThan(40)
    expect(dark.every(object => scalar(object, 'illumination') === 0)).toBe(true)
    const ratios = lit.map(object => scalar(object, 'intensity_ratio')!)
    expect(ratios[Math.floor(ratios.length / 2)]).toBeCloseTo(1, 12)
    expect(ratios.every(value => value >= 0 && value <= 1)).toBe(true)
    ratios.forEach((value, i) => expect(value).toBeCloseTo(ratios[ratios.length - 1 - i]!, 12))
    expect(ratios.some(value => value > 0 && value < 0.04)).toBe(true)
    expect(lit.every(object => scalar(object, 'illumination') === 1)).toBe(true)
    expect(samples(frame(scene, 1.5), 'diffraction-front').length).toBeGreaterThan(10)
  })

  it.each([1, 1.5])('keeps valid intensities without inventing a finite first minimum when λ/a=%s', wavelength => {
    const scene = createDiffractionScene({ wavelength, slitWidth: 1 })
    const result = engine.simulate(scene, createWaveSimulationRequest(scene, 'diffraction-no-min', 'trace-no-min'))
    expect(result.verification.status).toBe('passed')
    const state = frame(scene, 2)
    expect(state.objects.some(object => object.id.includes('.minimum.'))).toBe(false)
    expect(samples(state, 'intensity').length).toBeGreaterThan(40)
  })
})
