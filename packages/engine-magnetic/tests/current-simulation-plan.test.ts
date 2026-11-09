import { describe, expect, it, vi } from 'vitest'
import { assertSimulationPlan, derivedScalar } from '@physicsos/physics-core'
import { createElectromagnetScene, createMotorScene, createSolenoidFieldScene, createStraightWireFieldScene } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { CurrentFieldEngine, createCurrentSimulationRequest } from '../src/index.ts'

const scenes = [
  ['wire', createStraightWireFieldScene],
  ['solenoid', createSolenoidFieldScene],
  ['electromagnet', createElectromagnetScene],
  ['motor', createMotorScene],
] as const

describe('current-field engine-owned simulation plan', () => {
  for (const [name, create] of scenes) {
    it(`${name} shares the static execution window and one-state bound with simulate`, () => {
      const engine = new CurrentFieldEngine()
      const scene = create()
      const request = createCurrentSimulationRequest(scene, `plan-${name}`, `trace-${name}`)
      const before = JSON.stringify(request)
      const simulate = vi.spyOn(engine, 'simulate')
      const stateAt = vi.spyOn(engine, 'stateAt')
      const plan = engine.prepareSimulationPlan(scene, request)
      assertSimulationPlan(plan)
      expect(plan).toMatchObject({
        kind: 'static', startTime: 0, endTime: 0,
        engineId: engine.engineId, engineVersion: engine.engineVersion,
        sceneId: scene.id, sceneRevision: scene.revision, simulationId: request.simulationId,
        storageSampleCountBound: 1, numericalIterationCountBound: 0,
      })
      expect(simulate).not.toHaveBeenCalled()
      expect(stateAt).not.toHaveBeenCalled()
      expect(JSON.stringify(request)).toBe(before)
      const result = engine.simulate(scene, request)
      expect(result.states).toHaveLength(plan.storageSampleCountBound)
      expect(result.states[0]?.time.value).toBe(plan.startTime)
      expect(result.derivedQuantities.length).toBeGreaterThan(0)
      expect(result.verification.status).not.toBe('failed')
    })
  }

  it('accepts a very long sparse static request without treating sample count as hertz', () => {
    const engine = new CurrentFieldEngine()
    const scene = createStraightWireFieldScene()
    const request = createCurrentSimulationRequest(scene, 'sparse', 'trace')
    request.options = { startTime: quantity(2, 'ms', 'time'), endTime: quantity(1e9, 's', 'time'), outputSampleRate: 2 }
    const plan = engine.prepareSimulationPlan(scene, request)
    expect(plan.startTime).toBeCloseTo(0.002, 12)
    expect(plan.endTime).toBe(1e9)
    expect(plan.storageSampleCountBound).toBe(1)
    expect(plan.numericalIterationCountBound).toBe(0)
    const result = engine.simulate(scene, request)
    expect(result.states).toHaveLength(1)
    expect(derivedScalar(result.derivedQuantities, 'magnetic_flux_density').value).toBeCloseTo(4e-5, 10)
  })

  it('shares identity and range rejection with the actual engine', () => {
    const engine = new CurrentFieldEngine()
    const scene = createStraightWireFieldScene()
    const wrongRevision = createCurrentSimulationRequest(scene, 'invalid', 'trace')
    wrongRevision.sceneRevision += 1
    expect(() => engine.prepareSimulationPlan(scene, wrongRevision)).toThrow()
    expect(() => engine.simulate(scene, wrongRevision)).toThrow()
    const invalidRange = createCurrentSimulationRequest(scene, 'range', 'trace')
    invalidRange.options = { startTime: quantity(2, 's', 'time'), endTime: quantity(1, 's', 'time') }
    expect(() => engine.prepareSimulationPlan(scene, invalidRange)).toThrow()
    expect(() => engine.simulate(scene, invalidRange)).toThrow()
  })
})
