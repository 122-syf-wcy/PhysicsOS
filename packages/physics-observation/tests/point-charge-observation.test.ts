import { describe, expect, it } from 'vitest'
import { vec3 } from '@physicsos/physics-math'
import {
  createElectricScene,
  createPointChargeScene,
  type ProbeParticleInput,
} from '@physicsos/physics-scene'
import { ElectricEngine, createElectricSimulationRequest } from '@physicsos/engine-electric'

import { observeElectricScene } from '../src/electric-observation.ts'

const probeAt = (position: { x: number; y: number; z: number }): ProbeParticleInput => ({
  id: 'probe-1',
  charge: 1e-9,
  mass: 1,
  position,
})

const observe = (charges: Parameters<typeof createPointChargeScene>[0]['charges'], probe?: ProbeParticleInput) => {
  const scene = createPointChargeScene({
    sceneId: 'obs-test',
    charges,
    ...(probe === undefined ? {} : { probe }),
    now: '2026-08-21T00:00:00.000Z',
  })
  const engine = new ElectricEngine()
  const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim', 'trace'))
  const state = simulation.states[0]
  if (state === undefined) throw new Error('No state.')
  return observeElectricScene({ scene, simulation, state })
}

describe('point-charge observation', () => {
  it('reports the field and force at the probe', () => {
    const { observations } = observe(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const types = observations.map((o) => o.type)
    expect(types).toContain('electric_field')
    expect(types).toContain('electric_force')
    const field = observations.find((o) => o.type === 'electric_field')
    expect(field && 'magnitude' in field && field.magnitude.value).toBeGreaterThan(0)
  })

  it('reports the field at the declared sample point with no probe', () => {
    const { observations } = observe([{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }])
    const field = observations.find((o) => o.type === 'electric_field')
    expect(field).toBeDefined()
    expect(field && 'magnitude' in field && field.magnitude.value).toBeGreaterThan(0)
  })

  it('reports the charge sign as a physics fact for a positive source', () => {
    const { observations } = observe(
      [{ id: 'q1', charge: 5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const signs = observations.filter((o) => o.type === 'charge_sign')
    expect(signs).toHaveLength(1)
    expect(signs[0] && 'sign' in signs[0] && signs[0].sign).toBe('positive')
    expect(signs[0] && 'targetId' in signs[0] && signs[0].targetId).toBe('q1')
  })

  it('reports the charge sign for a negative source', () => {
    const { observations } = observe(
      [{ id: 'q1', charge: -5e-6, position: vec3(0, 0, 0) }],
      probeAt(vec3(0.2, 0, 0)),
    )
    const sign = observations.find((o) => o.type === 'charge_sign')
    expect(sign && 'sign' in sign && sign.sign).toBe('negative')
  })

  it('reports one charge_sign per source in a superposition scene', () => {
    const { observations } = observe(
      [
        { id: 'q1', charge: 5e-6, position: vec3(-0.1, 0, 0) },
        { id: 'q2', charge: -5e-6, position: vec3(0.1, 0, 0) },
      ],
      probeAt(vec3(0, 0.2, 0)),
    )
    const signs = observations.filter((o) => o.type === 'charge_sign')
    expect(signs).toHaveLength(2)
    expect(signs.map((s) => 'sign' in s ? s.sign : '').sort()).toEqual(['negative', 'positive'])
  })

  it('does not regress the uniform-field observation path', () => {
    const scene = createElectricScene({ duration: 1, now: '2026-08-19T00:00:00.000Z' })
    const engine = new ElectricEngine()
    const simulation = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-u', 'trace-u'))
    const state = simulation.states[0]
    if (state === undefined) throw new Error('No state.')
    const { observations } = observeElectricScene({ scene, simulation, state })
    expect(observations.length).toBeGreaterThan(0)
  })
})
