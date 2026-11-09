import { describe, expect, it } from 'vitest'
import { asSceneId, asSimulationId } from '@physicsos/shared'
import { assertSimulationPlan, simulationTimeRange, type SimulationPlan } from '../src/index.ts'
import { quantity, type Quantity } from '@physicsos/physics-units'

const plan = (): SimulationPlan => ({
  schemaVersion: 'simulation-plan/1.0',
  engineId: 'engine-test', engineVersion: '1.0.0',
  sceneId: asSceneId('scene-test'), sceneRevision: 2, simulationId: asSimulationId('simulation-test'),
  kind: 'analytic', startTime: 2, endTime: 1e9,
  storageSampleCountBound: 2, numericalIterationCountBound: 0,
})

describe('engine-owned simulation plan contract', () => {
  it('accepts sparse long analytic ranges without conflating sample count with rate', () => {
    const value = Object.freeze(plan())
    expect(() => assertSimulationPlan(value)).not.toThrow()
    expect(value.endTime).toBe(1e9)
    expect(value.storageSampleCountBound).toBe(2)
    expect(value.numericalIterationCountBound).toBe(0)
  })

  it('carries a proven numerical default horizon without declaring its endpoint exact', () => {
    const bounded: SimulationPlan = {
      ...plan(), kind: 'iterative', endTime: 4, endTimeExact: false,
      metadata: { defaultHorizon: 'settlement occurs no later than the solver cap', numericalIterationAccounting: 'ODE substeps plus bounded contact loops' },
      numericalIterationCountBound: 960,
    }
    expect(() => assertSimulationPlan(bounded)).not.toThrow()
    expect(bounded.endTimeExact).toBe(false)
  })

  it('validates hydrated time dimensions before interpreting canonical values as seconds', () => {
    const length = quantity(1, 'm', 'length') as unknown as Quantity<'time'>
    expect(() => simulationTimeRange({ startTime: length })).toThrow()
    expect(() => simulationTimeRange({ endTime: length })).toThrow()
    expect(simulationTimeRange({ startTime: quantity(250, 'ms', 'time'), endTime: quantity(2, 'min', 'time') })).toEqual({ startTime: 0.25, endTime: 120 })
    expect(simulationTimeRange({})).toEqual({ startTime: 0, endTime: 0 })
    expect(simulationTimeRange({}, 10)).toEqual({ startTime: 0, endTime: 10 })
  })

  it.each([
    { startTime: -1 }, { startTime: Number.NaN }, { endTime: Number.POSITIVE_INFINITY }, { endTime: 1 },
    { storageSampleCountBound: -1 }, { storageSampleCountBound: 2.5 },
    { numericalIterationCountBound: -1 }, { numericalIterationCountBound: 0.5 },
    { sceneRevision: -1 }, { sceneRevision: 0.5 }, { engineId: '' }, { engineVersion: '' },
  ])('rejects invalid execution bounds %j', overrides => {
    expect(() => assertSimulationPlan({ ...plan(), ...overrides })).toThrow()
  })
})
