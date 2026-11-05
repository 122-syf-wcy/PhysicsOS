import { describe, expect, it } from 'vitest'
import { derivedScalar, derivedVector } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { MechanicsEngine, createMechanicsSimulationRequest } from '../src/index.ts'

function simulate(angle: number, speed: number, friction: number, times: number[]) {
  const radians = angle * Math.PI / 180
  const scene = createMechanicsScene({ model: 'inclined_plane', mass: 0.1,
    position: vec3(0, 0, 0), gravity: vec3(0, -10, 0), inclineAngle: angle,
    velocity: vec3(speed * Math.cos(radians), -speed * Math.sin(radians), 0),
    frictionCoefficient: friction })
  const request = createMechanicsSimulationRequest(scene, 'sliding', 'sliding')
  request.options = { startTime: { value: times[0]!, unit: 's', dimension: 'time' },
    endTime: { value: times.at(-1)!, unit: 's', dimension: 'time' }, outputSampleRate: times.length }
  return new MechanicsEngine().simulate(scene, request)
}

describe('sliding friction on a plane', () => {
  it('decelerates a moving horizontal block, stops at 1.125 m and stays there', () => {
    const result = simulate(0, 3, 0.4, [0, 0.5, 1, 1.5, 2])
    const first = result.states[0]!, middle = result.states[1]!, last = result.states.at(-1)!
    expect(first.objects[0]!.acceleration!.vector.x).toBeCloseTo(-4)
    expect(derivedScalar(first.derived, 'friction_force').value).toBeCloseTo(0.4)
    expect(derivedScalar(first.derived, 'incline_acceleration').value).toBeCloseTo(-4)
    expect(middle.objects[0]!.position!.vector.x).toBeCloseTo(1)
    expect(middle.objects[0]!.velocity!.vector.x).toBeCloseTo(1)
    expect(last.objects[0]!.position!.vector.x).toBeCloseTo(1.125)
    expect(last.objects[0]!.velocity!.vector.x).toBe(0)
    expect(last.objects[0]!.acceleration!.vector.x).toBe(0)
    expect(derivedScalar(last.derived, 'friction_force').value).toBe(0)
    expect(derivedVector(last.derived, 'net_force').vector.x).toBe(0)
  })

  it('opposes uphill motion, then accelerates down a steep plane after turning', () => {
    const result = simulate(30, -3, 0.1, [0, 1, 2])
    const first = result.states[0]!, last = result.states.at(-1)!
    expect(first.objects[0]!.acceleration!.vector.x).toBeCloseTo(5.0801270189, 7)
    expect(derivedScalar(first.derived, 'friction_force').value).toBeCloseTo(0.0866025404, 7)
    expect(last.objects[0]!.velocity!.vector.x).toBeGreaterThan(0)
    expect(last.objects[0]!.acceleration!.vector.x).toBeCloseTo(3.5801270189, 7)
    expect(last.objects[0]!.position!.vector.x).toBeCloseTo(3.30219777053, 7)
    expect(last.objects[0]!.velocity!.vector.x).toBeCloseTo(5.32930713301, 7)
  })

  it('retains static balance for a resting shallow-plane block', () => {
    const result = simulate(0.001, 0, 0.4, [0, 1, 2])
    expect(result.states.at(-1)!.objects[0]!.velocity!.vector.x).toBe(0)
    expect(derivedScalar(result.states[0]!.derived, 'friction_force').value).toBeCloseTo(0.00001745329252, 12)
  })

  it.each([
    { speed: 3, acceleration: -2.20274923538, stopPosition: 2.04290162844 },
    { speed: -3, acceleration: 5.67571278872, stopPosition: -0.79285195843 },
  ])('stops and sticks on a shallow slope from initial speed $speed', ({ speed, acceleration, stopPosition }) => {
    const result = simulate(10, speed, 0.4, [0, 1, 2])
    const first = result.states[0]!, last = result.states.at(-1)!
    expect(derivedScalar(first.derived, 'incline_acceleration').value).toBeCloseTo(acceleration, 8)
    expect(last.objects[0]!.position!.vector.x / Math.cos(Math.PI / 18)).toBeCloseTo(stopPosition, 8)
    expect(last.objects[0]!.velocity!.vector.x).toBe(0)
    expect(last.objects[0]!.acceleration!.vector.x).toBe(0)
    expect(derivedScalar(last.derived, 'friction_force').value).toBeCloseTo(0.17364817767, 8)
    expect(derivedVector(last.derived, 'friction_vector').vector.x).toBeCloseTo(-0.17101007166, 8)
  })

  it('keeps a block at rest at the static-friction threshold', () => {
    const result = simulate(45, 0, 1, [0, 1, 2])
    expect(result.states.at(-1)!.objects[0]!.position!.vector.x).toBeCloseTo(0, 12)
    expect(result.states.at(-1)!.objects[0]!.velocity!.vector.x).toBeCloseTo(0, 12)
  })
})
