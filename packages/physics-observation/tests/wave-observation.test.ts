import { describe, expect, it } from 'vitest'

import { createWaveSimulationRequest, waveEngine } from '@physicsos/engine-wave'
import {
  createStandingWaveScene,
  createTravellingWaveScene,
  createWaveInterferenceScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'

import {
  isWaveformObservation,
  isWaveNodesObservation,
  isWaveSpeedObservation,
  isWaveSuperpositionObservation,
  observeWaveScene,
} from '../src/index.ts'

const simulate = (scene: PhysicsScene) =>
  waveEngine.simulate(scene, createWaveSimulationRequest(scene, 'sim-wave-obs', 'trace-wave-obs'))

const observe = (scene: PhysicsScene, time?: number) => {
  const simulation = simulate(scene)
  const state = time === undefined ? undefined : waveEngine.stateAt(scene, quantity(time, 's', 'time'))
  return observeWaveScene({ scene, simulation, ...(state === undefined ? {} : { state }) })
}

describe('Wave Observation · travelling wave', () => {
  it('publishes the sampled profile in rope order plus the marked particle', () => {
    const { observations, sceneRevision } = observe(createTravellingWaveScene(), 0)
    expect(sceneRevision).toBe(0)
    const waveform = observations.find(isWaveformObservation)
    expect(waveform).toBeDefined()
    if (waveform === undefined) return
    expect(waveform.points).toHaveLength(49)
    expect(waveform.points[0]?.x).toBe(0)
    expect(waveform.points.at(-1)?.x).toBeCloseTo(1.2, 12)
    for (let index = 1; index < waveform.points.length; index += 1) {
      expect(waveform.points[index]!.x).toBeGreaterThan(waveform.points[index - 1]!.x)
    }
    /* x = 0.3 m = 3λ/4 → y = −A = −0.05 m */
    expect(waveform.points[12]?.y).toBeCloseTo(-0.05, 12)
    expect(waveform.marker?.position.x).toBeCloseTo(0.3, 12)
    expect(waveform.marker?.transverseVelocity.dimension).toBe('velocity')
  })

  it('reads v = λf, T = 1/f from the derived set rather than recomputing', () => {
    const speed = observe(createTravellingWaveScene()).observations.find(isWaveSpeedObservation)
    expect(speed).toBeDefined()
    if (speed === undefined) return
    expect(speed.speed.value).toBeCloseTo(2, 12)
    expect(speed.speed.unit).toBe('m/s')
    expect(speed.wavelength.value).toBeCloseTo(0.4, 12)
    expect(speed.frequency.value).toBeCloseTo(5, 12)
    expect(speed.period.value).toBeCloseTo(0.2, 12)
  })

  it('emits no superposition or node observations on the rope rig', () => {
    const { observations } = observe(createTravellingWaveScene())
    expect(observations.some(isWaveSuperpositionObservation)).toBe(false)
    expect(observations.some(isWaveNodesObservation)).toBe(false)
    expect(observations.map((entry) => entry.type)).toEqual(['waveform', 'wave_speed'])
  })

  it('hides the waveform when its observable is switched off', () => {
    const scene = createTravellingWaveScene()
    scene.observableDefinitions = scene.observableDefinitions.map((definition) =>
      String(definition.id).endsWith('waveform') ? { ...definition, visible: false } : definition,
    )
    const { observations } = observe(scene)
    expect(observations.some(isWaveformObservation)).toBe(false)
    expect(observations.some(isWaveSpeedObservation)).toBe(true)
  })
})

describe('Wave Observation · interference', () => {
  it('carries the engine verdict, Δ, Δ/λ, A_P and the rig geometry', () => {
    const superposition = observe(createWaveInterferenceScene(), 0).observations.find(
      isWaveSuperpositionObservation,
    )
    expect(superposition).toBeDefined()
    if (superposition === undefined) return
    expect(superposition.verdict).toBe('constructive')
    expect(superposition.pathDifference.value).toBeCloseTo(0.4, 12)
    expect(superposition.pathDifferenceRatio).toBeCloseTo(2, 12)
    expect(superposition.resultantAmplitude.value).toBeCloseTo(0.06, 12)
    expect(superposition.sources[0].x).toBeCloseTo(-0.4, 12)
    expect(superposition.sources[1].x).toBeCloseTo(0.4, 12)
    expect(Math.hypot(superposition.point.x + 0.4, superposition.point.y)).toBeCloseTo(1.0, 9)
    expect(superposition.targetId).toBe('wave-bench-1.point')
  })

  it('reports destructive with zero displacement when Δ = λ/2', () => {
    const superposition = observe(createWaveInterferenceScene({ pathTwo: 1.1 }), 0.037).observations.find(
      isWaveSuperpositionObservation,
    )
    expect(superposition?.verdict).toBe('destructive')
    expect(superposition?.resultantAmplitude.value).toBeCloseTo(0, 12)
    expect(Math.abs(superposition?.displacement.value ?? 1)).toBeLessThan(1e-12)
  })
})

describe('Wave Observation · standing wave', () => {
  it('lists the nodes at m·L/n and the antinodes with their current displacement', () => {
    const nodes = observe(createStandingWaveScene(), 0).observations.find(isWaveNodesObservation)
    expect(nodes).toBeDefined()
    if (nodes === undefined) return
    expect(nodes.nodes).toEqual([0, 0.5, 1])
    expect(nodes.antinodes.map((entry) => entry.x)).toEqual([0.25, 0.75])
    expect(nodes.antinodes[0]?.y).toBeCloseTo(0.04, 12)
    expect(nodes.antinodes[1]?.y).toBeCloseTo(-0.04, 12)
  })

  it('keeps the profile and the node list as two separate geometry observations', () => {
    const { observations } = observe(createStandingWaveScene())
    const waveform = observations.find(isWaveformObservation)
    expect(waveform?.marker).toBeUndefined()
    expect(waveform?.points).toHaveLength(49)
    expect(observations.map((entry) => entry.type)).toEqual(['waveform', 'wave_speed', 'wave_nodes'])
  })
})

describe('Wave Observation · guards', () => {
  it('rejects a simulation from another scene revision', () => {
    const scene = createTravellingWaveScene()
    const simulation = simulate(scene)
    const edited = { ...scene, revision: 3 }
    expect(() => observeWaveScene({ scene: edited, simulation })).toThrow(/same scene revision/)
  })

  it('rejects a scene without a wave bench', () => {
    const scene = createTravellingWaveScene()
    const simulation = simulate(scene)
    const stripped = { ...scene, waveBenches: [] }
    expect(() => observeWaveScene({ scene: stripped, simulation })).toThrow(/exactly one wave bench/)
  })
})
