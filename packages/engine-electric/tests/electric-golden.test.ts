import { describe, expect, it } from 'vitest'
import { toCanonicalVector } from '@physicsos/physics-core'
import { vec3 } from '@physicsos/physics-math'
import { createElectricScene, createMagneticScene } from '@physicsos/physics-scene'
import { verifyElectricSimulation } from '@physicsos/physics-verifier'

import {
  COULOMB_CONSTANT,
  ElectricEngine,
  coulombForce,
  createElectricSimulationRequest,
  evaluateUniformElectricState,
  pointChargeElectricField,
  pointChargePotential,
  resolveUniformElectricModel,
  superposeElectricFields,
} from '../src/index.ts'

describe('Electric Engine golden cases', () => {
  it('solves a positive charge in a uniform electric field', () => {
    const scene = createElectricScene({
      charge: 2,
      mass: 4,
      position: vec3(0, 0, 0),
      velocity: vec3(1, 0, 0),
      electricFieldStrength: 6,
      electricFieldDirection: 'up',
      duration: 2,
      now: '2026-08-19T00:00:00.000Z',
    })
    const engine = new ElectricEngine()
    const result = engine.simulate(scene, createElectricSimulationRequest(scene, 'sim-uniform', 'trace-uniform'))
    const finalState = result.states.at(-1)
    const position = finalState?.objects[0]?.position
    const velocity = finalState?.objects[0]?.velocity

    expect(result.verification.status).toBe('passed')
    expect(position && toCanonicalVector(position).vectorSI).toEqual(vec3(2, 6, 0))
    expect(velocity && toCanonicalVector(velocity).vectorSI).toEqual(vec3(1, 6, 0))
  })

  it('accelerates a negative charge opposite to the field direction', () => {
    const scene = createElectricScene({
      charge: -2,
      mass: 2,
      position: vec3(0, 0, 0),
      velocity: vec3(0, 0, 0),
      electricFieldStrength: 3,
      electricFieldDirection: 'right',
      duration: 1,
    })
    const state = new ElectricEngine().stateAtSeconds(scene, 1)
    const acceleration = toCanonicalVector(state.objects[0]!.acceleration!).vectorSI
    const position = toCanonicalVector(state.objects[0]!.position!).vectorSI
    expect(acceleration.x).toBeCloseTo(-3)
    expect(acceleration.y).toBeCloseTo(0)
    expect(acceleration.z).toBeCloseTo(0)
    expect(position.x).toBeCloseTo(-1.5)
    expect(position.y).toBeCloseTo(0)
    expect(position.z).toBeCloseTo(0)
  })

  it('reuses a resolved model for continuous UI state evaluation', () => {
    const scene = createElectricScene({ duration: 2 })
    const engine = new ElectricEngine()
    const expected = engine.stateAtSeconds(scene, 0.375)
    const actual = evaluateUniformElectricState(resolveUniformElectricModel(scene), 0.375)

    expect(actual).toEqual(expected)
    expect(() => evaluateUniformElectricState(resolveUniformElectricModel(scene), -1))
      .toThrow(/finite and non-negative/)
  })

  it('computes the two-point-charge field, force and potential', () => {
    const field = pointChargeElectricField(2e-6, vec3(0, 0, 0), vec3(3, 0, 0))
    expect(field.x).toBeCloseTo((COULOMB_CONSTANT * 2e-6) / 9, 8)
    expect(field.y).toBe(0)
    expect(pointChargePotential(2e-6, vec3(0, 0, 0), vec3(3, 0, 0)))
      .toBeCloseTo((COULOMB_CONSTANT * 2e-6) / 3, 8)
    expect(coulombForce(2e-6, -3e-6, vec3(0, 0, 0), vec3(3, 0, 0)).x).toBeLessThan(0)
  })

  it('superposes multiple point-charge field vectors', () => {
    const left = pointChargeElectricField(1e-6, vec3(-1, 0, 0), vec3(0, 0, 0))
    const right = pointChargeElectricField(1e-6, vec3(1, 0, 0), vec3(0, 0, 0))
    expect(superposeElectricFields([left, right])).toEqual(vec3(0, 0, 0))
  })

  it('rejects point-charge singularities', () => {
    expect(() => pointChargeElectricField(1, vec3(0, 0, 0), vec3(0, 0, 0)))
      .toThrow(/undefined at the source position/)
  })

  it('rejects unsupported magnetic scenes and stale simulation requests', () => {
    const engine = new ElectricEngine()
    expect(engine.canHandle(createMagneticScene()).supported).toBe(false)

    const scene = createElectricScene()
    const request = createElectricSimulationRequest(scene, 'sim-stale', 'trace-stale')
    request.sceneRevision += 1
    expect(() => engine.simulate(scene, request)).toThrow(/exact PhysicsScene revision/)
  })

  it('detects a tampered electric-force state', () => {
    const scene = createElectricScene({ duration: 1 })
    const engine = new ElectricEngine()
    const result = engine.simulate(
      scene,
      createElectricSimulationRequest(scene, 'sim-tampered', 'trace-tampered'),
    )
    const force = result.states[0]?.derived.find((entry) => entry.key === 'electric_force_vector')
    if (force === undefined || !('vector' in force.value)) throw new Error('Expected force vector.')
    force.value.vector.x += 1
    expect(verifyElectricSimulation(scene, result).status).toBe('failed')
  })
})
