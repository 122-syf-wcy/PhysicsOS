import { describe, expect, it } from 'vitest'
import { EnergyEngine, createEnergySimulationRequest } from '@physicsos/engine-mechanics'
import { isScalarQuantity } from '@physicsos/physics-core'
import { createRampFrictionScene } from '@physicsos/physics-scene'
import { canonicalValue } from '@physicsos/physics-units'
import { createEnergyWorkspaceRuntime } from '../src/client/physics/energy-workspace-runtime.ts'

const scene = () => createRampFrictionScene({ mass: 2, releaseHeight: 100, inclineAngle: 30, frictionCoefficient: 0 })

describe('deployed moving energy compatibility with canvas capture', () => {
  it('budgets every requested motion sample and retains the physical descent endpoint', () => {
    const input = scene()
    const engine = new EnergyEngine()
    const request = createEnergySimulationRequest(input, 'energy-canvas-motion', 'energy-canvas-motion-trace')
    request.options = { outputSampleRate: 7 }
    const plan = engine.prepareSimulationPlan(input, request)
    const result = engine.simulate(input, request)
    expect(plan.kind).toBe('analytic')
    expect(plan.storageSampleCountBound).toBe(7)
    expect(result.states).toHaveLength(7)
    expect(plan.endTime).toBeCloseTo(Math.sqrt(4 / 4.9), 10)
    expect(result.states[6]?.time.value).toBe(plan.endTime)
    const potential = result.states[6]?.derived.find(value => value.key === 'current_potential_energy')?.value
    const kinetic = result.states[6]?.derived.find(value => value.key === 'current_kinetic_energy')?.value
    if (potential === undefined || kinetic === undefined || !isScalarQuantity(potential) || !isScalarQuantity(kinetic)) {
      throw new Error('The actual endpoint energy quantities are missing.')
    }
    expect(potential.unit).toBe('J')
    expect(kinetic.unit).toBe('J')
    expect(potential.value).toBeCloseTo(0, 10)
    expect(kinetic.value).toBeCloseTo(19.6, 10)
  })

  it('captures the actual paused energy motion cursor and state without replacing the endpoint ledger', () => {
    const runtime = createEnergyWorkspaceRuntime(scene())
    runtime.setRate(2)
    runtime.seek(0.4)
    const captured = runtime.captureRaw()
    expect(captured.clock).toMatchObject({ time: 0.4, running: false, rate: 2 })
    expect(captured.cursor.kind).toBe('time')
    if (captured.cursor.kind !== 'time') throw new Error('Moving energy needs its real time cursor.')
    expect(canonicalValue(captured.cursor.time)).toBe(0.4)
    expect(captured.state?.time.value).toBe(0.4)
    expect(captured.result?.states).toHaveLength(65)
    const ledger = captured.analysis?.find(value => value.axes.some(axis => axis.identity === 'mechanical-energy-ledger'))
    expect(ledger?.rows[0]?.values.potentialAtRelease).toBeCloseTo(19.6, 10)
    expect(ledger?.rows[0]?.values.kineticAtBottom).toBeCloseTo(19.6, 10)
    expect(captured.state?.objects[0]?.position?.vector.y).toBeCloseTo(0.804, 10)
  })
})
