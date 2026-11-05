import { describe, expect, it } from 'vitest'
import { createMechanicsSimulationRequest, MechanicsEngine } from '../../engine-mechanics/src/index.ts'
import { vec3 } from '@physicsos/physics-math'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { verifyMechanicsSimulation } from '../src/index.ts'

const run = (angle: number, speed: number, friction: number, start = 0) => {
  const radians = angle * Math.PI / 180
  const scene = createMechanicsScene({ model: 'inclined_plane', mass: 0.1,
    position: vec3(0, 0, 0), velocity: vec3(speed * Math.cos(radians), -speed * Math.sin(radians), 0),
    gravity: vec3(0, -10, 0), inclineAngle: angle, frictionCoefficient: friction })
  const request = createMechanicsSimulationRequest(scene, 'incline-verification', 'incline-verification')
  request.options = { startTime: { value: start, unit: 's', dimension: 'time' },
    endTime: { value: 2, unit: 's', dimension: 'time' }, outputSampleRate: 5 }
  return { scene, result: new MechanicsEngine().simulate(scene, request) }
}

describe('independent piecewise incline verification', () => {
  it.each([
    [0, 3, 0.4, 1.125, 0],
    [10, 3, 0.4, 2.0429016284391808, 0],
    [10, -3, 0.4, -0.7928519584262347, 0],
    [30, -3, 0.1, 3.813049543464073, 6.153753815669603],
  ])('accepts motion with angle %s, speed %s and friction %s', (angle, speed, friction, endPosition, endSpeed) => {
    const { scene, result } = run(angle, speed, friction)
    const final = result.states.at(-1)!.objects[0]!
    const cosine = Math.cos(angle * Math.PI / 180)
    expect(final.position!.vector.x / cosine).toBeCloseTo(endPosition, 8)
    expect(final.velocity!.vector.x / cosine).toBeCloseTo(endSpeed, 8)
    expect(verifyMechanicsSimulation(scene, result).status).toBe('passed')
  })

  it('accepts a window that starts after the uphill turning point', () => {
    const { scene, result } = run(30, -3, 0.1, 1)
    expect(verifyMechanicsSimulation(scene, result).status).toBe('passed')
  })

  it('accepts a sample at the uphill turning instant', () => {
    const { scene } = run(80, -3, 0.4)
    const request = createMechanicsSimulationRequest(scene, 'turning-instant', 'turning-instant')
    request.options = { startTime: { value: 0.2845578901247371, unit: 's', dimension: 'time' },
      endTime: { value: 0.2845578901247371, unit: 's', dimension: 'time' }, outputSampleRate: 1 }
    const result = new MechanicsEngine().simulate(scene, request)
    expect(verifyMechanicsSimulation(scene, result).status).toBe('passed')
  })

  it('rejects corrupted position after stopping', () => {
    const { scene, result } = run(0, 3, 0.4)
    result.states.at(-1)!.objects[0]!.position!.vector.x += 1
    const verified = verifyMechanicsSimulation(scene, result)
    expect(verified.checks.find(check => check.id === 'mechanics_kinematic_consistency')?.passed).toBe(false)
  })

  it('rejects forged acceleration after stopping', () => {
    const { scene, result } = run(0, 3, 0.4)
    result.states.at(-1)!.objects[0]!.acceleration!.vector.x = -4
    const verified = verifyMechanicsSimulation(scene, result)
    expect(verified.checks.find(check => check.id === 'mechanics_prescribed_acceleration')?.passed).toBe(false)
  })

  it.each(['friction_vector', 'friction_force', 'incline_acceleration', 'normal_force'])('rejects a forged frame %s', key => {
    const { scene, result } = run(30, -3, 0.1)
    const quantity = result.states[0]!.derived.find(entry => entry.key === key)!.value
    if ('vector' in quantity) quantity.vector.x *= -1
    else quantity.value += 1
    const verified = verifyMechanicsSimulation(scene, result)
    expect(verified.checks.find(check => check.id === 'mechanics_derived_consistency')?.passed).toBe(false)
  })

  it.each(['acceleration', 'net_force', 'friction_vector', 'friction_force', 'incline_acceleration', 'velocity_magnitude'])('rejects a forged summary %s', key => {
    const { scene, result } = run(30, -3, 0.1)
    const quantity = result.derivedQuantities.find(entry => entry.key === key)!.value
    if ('vector' in quantity) quantity.vector.x += 1
    else quantity.value += 1
    const verified = verifyMechanicsSimulation(scene, result)
    expect(verified.checks.find(check => check.id === 'mechanics_summary_consistency')?.passed).toBe(false)
  })

  it('rejects omitted friction evidence in frames or the summary', () => {
    const { scene, result } = run(30, -3, 0.1)
    result.states[0]!.derived = result.states[0]!.derived.filter(entry => entry.key !== 'friction_vector')
    result.derivedQuantities = result.derivedQuantities.filter(entry => entry.key !== 'friction_force')
    const verified = verifyMechanicsSimulation(scene, result)
    expect(verified.checks.find(check => check.id === 'mechanics_derived_consistency')?.passed).toBe(false)
    expect(verified.checks.find(check => check.id === 'mechanics_summary_consistency')?.passed).toBe(false)
  })
})
