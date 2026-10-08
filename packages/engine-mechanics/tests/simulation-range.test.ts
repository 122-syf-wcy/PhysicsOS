import { describe, expect, it } from 'vitest'
import { derivedScalar, derivedVector } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { MechanicsEngine, createMechanicsSimulationRequest } from '../src/index.ts'

describe('mechanics simulation windows', () => {
  const engine = new MechanicsEngine()
  it('reports final velocity at absolute time and displacement over the requested interval', () => {
    const scene = createMechanicsScene({
      model: 'uniformly_accelerated_motion',
      velocity: vec3(10, 0, 0),
      acceleration: vec3(2, 0, 0),
    })
    const request = createMechanicsSimulationRequest(scene, 'range', 'range')
    request.options = {
      startTime: { value: 1, unit: 's', dimension: 'time' },
      endTime: { value: 2, unit: 's', dimension: 'time' },
      outputSampleRate: 7,
    }
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(7)
    expect(result.states[0]!.time.value).toBe(1)
    expect(result.states.at(-1)!.objects[0]!.velocity!.vector.x).toBe(14)
    expect(derivedScalar(result.derivedQuantities, 'final_velocity').value).toBe(14)
    expect(derivedVector(result.derivedQuantities, 'displacement').vector.x).toBe(13)
    expect(result.verification.status).toBe('passed')
  })
  it('uses instantaneous oscillator velocity at the end of a nonzero window', () => {
    const scene = createMechanicsScene({ model: 'spring_oscillator' })
    const request = createMechanicsSimulationRequest(scene, 'oscillator-range', 'range')
    request.options = {
      startTime: { value: 0.1, unit: 's', dimension: 'time' },
      endTime: { value: 0.3, unit: 's', dimension: 'time' },
      outputSampleRate: 5,
    }
    const result = engine.simulate(scene, request)
    expect(derivedScalar(result.derivedQuantities, 'velocity_magnitude').value).toBeCloseTo(
      derivedScalar(result.states.at(-1)!.derived, 'velocity_magnitude').value,
      10,
    )
  })
  it.each([NaN, Infinity, -1])('rejects invalid start time %s', (start) => {
    const scene = createMechanicsScene({ model: 'uniform_linear_motion' })
    const request = createMechanicsSimulationRequest(scene, 'invalid-range', 'range')
    request.options.startTime = { value: start, unit: 's', dimension: 'time' }
    expect(() => engine.simulate(scene, request)).toThrow()
  })
})

it('does not announce ground impact before the requested projectile window reaches the ground', () => {
  const scene = createMechanicsScene({
    model: 'projectile_motion',
    position: vec3(0, 20, 0),
    velocity: vec3(10, 0, 0),
  })
  const request = createMechanicsSimulationRequest(scene, 'projectile-window', 'range')
  request.options = {
    startTime: { value: 0.1, unit: 's', dimension: 'time' },
    endTime: { value: 0.2, unit: 's', dimension: 'time' },
  }
  const result = new MechanicsEngine().simulate(scene, request)
  expect(result.verification.status).toBe('passed')
  expect(result.events.some((event) => event.type === 'GroundImpact')).toBe(false)
})
