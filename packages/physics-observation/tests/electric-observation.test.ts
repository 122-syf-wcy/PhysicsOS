import { describe, expect, it } from 'vitest'
import { ElectricEngine, createElectricSimulationRequest } from '@physicsos/engine-electric'
import { createElectricScene } from '@physicsos/physics-scene'

import { observeElectricScene } from '../src/index.ts'

describe('Electric observations', () => {
  it('projects verified engine facts without replacing the simulation', () => {
    const scene = createElectricScene({ duration: 2 })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(
      scene,
      createElectricSimulationRequest(scene, 'sim-observation', 'trace-observation'),
    )
    const state = engine.stateAtSeconds(scene, 1)
    const observed = observeElectricScene({ scene, simulation, state })

    expect(observed.sceneRevision).toBe(scene.revision)
    expect(observed.observations.map((entry) => entry.type)).toEqual([
      'electric_field',
      'electric_force',
      'electric_velocity',
      'electric_trajectory',
      'electric_energy',
    ])
    const trajectory = observed.observations.find((entry) => entry.type === 'electric_trajectory')
    expect(trajectory?.points).toHaveLength(simulation.states.length)
  })

  it('rejects a simulation from a different revision', () => {
    const scene = createElectricScene({ duration: 1 })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(
      scene,
      createElectricSimulationRequest(scene, 'sim-mismatch', 'trace-mismatch'),
    )
    simulation.sceneRevision += 1
    expect(() => observeElectricScene({ scene, simulation })).toThrow(/same scene revision/)
  })
})
