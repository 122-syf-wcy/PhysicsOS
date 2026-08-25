import { describe, expect, it } from 'vitest'
import { derivedScalar, isScalarQuantity } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
import { asComponentId } from '@physicsos/shared'
import {
  createCircuitScene,
  createEmfMeasurementScene,
  createMixedCircuitScene,
  createParallelCircuitScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import {
  CIRCUIT_ENGINE_ID,
  DC_CIRCUIT_MODEL,
  circuitEngine,
  createCircuitSimulationRequest,
  effectiveSliderResistance,
  resolveCircuitOperatingPoint,
  sliderPositionAt,
} from '../src/index.ts'

const simRequest = (scene: PhysicsScene) =>
  createCircuitSimulationRequest(scene, 'sim-test', 'trace-test')

const scalarOf = (value: unknown): number => {
  if (typeof value !== 'object' || value === null || !isScalarQuantity(value as never)) {
    throw new Error('Expected a scalar quantity.')
  }
  return (value as { value: number }).value
}

const componentPoint = (scene: PhysicsScene, componentId: string, time = 0) => {
  const point = resolveCircuitOperatingPoint(scene, time)
  const component = point.components.find((entry) => entry.componentId === componentId)
  if (component === undefined) throw new Error(`Component "${componentId}" is absent.`)
  return component
}

const measurementValue = (scene: PhysicsScene, componentId: string): number => {
  const result = circuitEngine.simulate(scene, simRequest(scene))
  const measurement = result.measurements.find((entry) => entry.targetId === componentId)
  if (measurement === undefined) throw new Error(`Measurement for "${componentId}" is absent.`)
  return scalarOf(measurement.value)
}

describe('CircuitEngine golden cases', () => {
  it('series circuit: I = E / (R₁ + R₂), voltmeter reads I·R₂', () => {
    const scene = createSeriesCircuitScene({ voltage: 6, r1: 10, r2: 20 })
    expect(measurementValue(scene, 'am')).toBeCloseTo(0.2, 6)
    expect(measurementValue(scene, 'vm')).toBeCloseTo(4, 6)
  })

  it('parallel circuit: branch currents split by conductance', () => {
    const scene = createParallelCircuitScene({ voltage: 6, r1: 10, r2: 15 })
    expect(measurementValue(scene, 'am')).toBeCloseTo(1, 6)
    expect(measurementValue(scene, 'vm')).toBeCloseTo(6, 6)
    expect(componentPoint(scene, 'r1').current).toBeCloseTo(0.6, 6)
    expect(componentPoint(scene, 'r2').current).toBeCloseTo(0.4, 6)
  })

  it('mixed circuit: R₁ in series with R₂ ∥ R₃', () => {
    const scene = createMixedCircuitScene({ voltage: 6, r1: 2, r2: 6, r3: 3 })
    /* R₂ ∥ R₃ = 2 Ω → total 4 Ω → I = 1.5 A, parallel-pair voltage 3 V. */
    expect(measurementValue(scene, 'am')).toBeCloseTo(1.5, 6)
    expect(measurementValue(scene, 'vm')).toBeCloseTo(3, 6)
    expect(componentPoint(scene, 'r2').current).toBeCloseTo(0.5, 6)
    expect(componentPoint(scene, 'r3').current).toBeCloseTo(1, 6)
  })

  it('open switch: no current anywhere, terminal voltage stays at the EMF', () => {
    const scene = createSeriesCircuitScene({ voltage: 6, r1: 10, r2: 20, switchClosed: false })
    expect(measurementValue(scene, 'am')).toBeCloseTo(0, 9)
    expect(measurementValue(scene, 'vm')).toBeCloseTo(0, 9)
    const state = circuitEngine.stateAtSeconds(scene, 0)
    expect(scalarOf(derivedScalar(state.derived, 'main_current'))).toBeCloseTo(0, 9)
    expect(scalarOf(derivedScalar(state.derived, 'terminal_voltage'))).toBeCloseTo(6, 9)
  })

  it('EMF measurement: U = E − I·r at both sweep ends', () => {
    const scene = createEmfMeasurementScene({
      emf: 4.5,
      internalResistance: 0.5,
      totalResistance: 20,
      sliderPosition: 0.1,
    })
    /* t = 0 → slider 0.1 → R = 2 Ω → I = 4.5 / 2.5 = 1.8 A, U = 4.5 − 0.9 = 3.6 V. */
    const start = componentPoint(scene, 'bat', 0)
    expect(start.current).toBeCloseTo(1.8, 5)
    expect(start.voltage).toBeCloseTo(3.6, 5)
    /* Sweep end → slider 1 → R = 20 Ω → I = 4.5 / 20.5, U = E − I·r. */
    const end = componentPoint(scene, 'bat', 8)
    expect(end.current).toBeCloseTo(4.5 / 20.5, 5)
    expect(end.voltage).toBeCloseTo(4.5 - (4.5 / 20.5) * 0.5, 5)
    /* Simulate reports the sweep-end meter readings. */
    expect(measurementValue(scene, 'am')).toBeCloseTo(4.5 / 20.5, 5)
    expect(measurementValue(scene, 'vm')).toBeCloseTo(4.5 - (4.5 / 20.5) * 0.5, 4)
  })

  it('rheostat sweep: stateAt re-solves the operating point along the slider', () => {
    const scene = createRheostatCircuitScene({
      voltage: 6,
      fixedResistance: 10,
      totalResistance: 20,
      sliderPosition: 0,
    })
    const start = circuitEngine.stateAtSeconds(scene, 0)
    expect(scalarOf(derivedScalar(start.derived, 'main_current'))).toBeCloseTo(0.6, 5)
    const end = circuitEngine.stateAtSeconds(scene, 8)
    expect(scalarOf(derivedScalar(end.derived, 'main_current'))).toBeCloseTo(0.2, 6)
    expect(scalarOf(derivedScalar(end.derived, 'slider_resistance:rv'))).toBeCloseTo(20, 6)
  })

  it('power derivations satisfy P_总 = P_外 + P_内', () => {
    const scene = createEmfMeasurementScene({ emf: 4.5, internalResistance: 0.5 })
    const state = circuitEngine.stateAtSeconds(scene, 0)
    const total = scalarOf(derivedScalar(state.derived, 'total_power'))
    const external = scalarOf(derivedScalar(state.derived, 'external_power'))
    const internal = scalarOf(derivedScalar(state.derived, 'internal_power'))
    expect(total).toBeCloseTo(external + internal, 6)
  })
})

describe('CircuitEngine.simulate', () => {
  it('samples one state for a static circuit and a full sweep for a rheostat scene', () => {
    const staticScene = createSeriesCircuitScene()
    expect(circuitEngine.simulate(staticScene, simRequest(staticScene)).states).toHaveLength(1)
    const sweepScene = createRheostatCircuitScene()
    expect(
      circuitEngine.simulate(sweepScene, simRequest(sweepScene)).states.length,
    ).toBeGreaterThan(100)
  })

  it('passes conservation and meter checks in verification', () => {
    const scene = createEmfMeasurementScene()
    const result = circuitEngine.simulate(scene, simRequest(scene))
    expect(result.verification.status).toBe('passed')
    const ids = new Set(result.verification.checks.map((entry) => entry.id))
    expect(ids.has('kcl_current_conservation')).toBe(true)
    expect(ids.has('power_balance')).toBe(true)
    expect(ids.has('terminal_voltage_law:bat')).toBe(true)
    expect(ids.has('ideal_meters_non_intrusive')).toBe(true)
    for (const check of result.verification.checks) {
      expect(check.passed, check.id).toBe(true)
    }
  })

  it('rejects a request built for a different scene revision', () => {
    const scene = createSeriesCircuitScene()
    const other = createSeriesCircuitScene({ sceneId: 'circuit-other' })
    expect(() => circuitEngine.simulate(scene, simRequest(other))).toThrowError(
      /SimulationRequest must reference/,
    )
  })

  it('rejects a negative simulation time', () => {
    const scene = createSeriesCircuitScene()
    expect(() => circuitEngine.stateAtSeconds(scene, -1)).toThrowError(/finite and non-negative/)
  })
})

describe('CircuitEngine.canHandle', () => {
  it('accepts every circuit template', () => {
    const scenes = [
      createSeriesCircuitScene(),
      createParallelCircuitScene(),
      createMixedCircuitScene(),
      createRheostatCircuitScene(),
      createEmfMeasurementScene(),
    ]
    for (const scene of scenes) {
      const support = circuitEngine.canHandle(scene)
      expect(support.supported, scene.id).toBe(true)
      if (support.supported) expect(support.modelId).toBe(DC_CIRCUIT_MODEL)
    }
  })

  it('rejects a scene without a circuit', () => {
    const scene: PhysicsScene = { ...createSeriesCircuitScene(), circuits: [] }
    const support = circuitEngine.canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.map((entry) => entry.condition)).toContain('single_circuit')
      expect(support.modelId).toBe(CIRCUIT_ENGINE_ID)
    }
  })

  it('rejects a circuit with two voltage sources', () => {
    const scene = createCircuitScene({
      components: [
        {
          id: 'bat1',
          type: 'voltage_source',
          voltage: 6,
          terminals: { positive: 'n1', negative: 'n2' },
        },
        {
          id: 'bat2',
          type: 'voltage_source',
          voltage: 3,
          terminals: { positive: 'n1', negative: 'n2' },
        },
        { id: 'r1', type: 'resistor', resistance: 10, terminals: { a: 'n1', b: 'n2' } },
      ],
    })
    const support = circuitEngine.canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.map((entry) => entry.condition)).toContain(
        'single_voltage_source',
      )
    }
  })

  it('rejects reactive components (capacitor)', () => {
    const base = createSeriesCircuitScene()
    const circuit = base.circuits[0]!
    const scene: PhysicsScene = {
      ...base,
      circuits: [
        {
          ...circuit,
          components: [
            ...circuit.components,
            {
              id: asComponentId('cap'),
              type: 'capacitor',
              capacitance: quantity(1e-6, 'F', 'capacitance'),
            },
          ],
        },
      ],
    }
    const support = circuitEngine.canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.map((entry) => entry.condition)).toContain(
        'dc_components_only',
      )
    }
  })

  it('rejects an ideal source shorted onto a single node as unsolvable', () => {
    const scene = createCircuitScene({
      components: [
        {
          id: 'bat',
          type: 'voltage_source',
          voltage: 6,
          terminals: { positive: 'n1', negative: 'n1' },
        },
      ],
    })
    const support = circuitEngine.canHandle(scene)
    expect(support.supported).toBe(false)
    if (!support.supported) {
      expect(support.failedConditions.map((entry) => entry.condition)).toContain('dc_solvable')
    }
  })
})

describe('slider helpers', () => {
  it('sweeps linearly from the stored position to 1', () => {
    expect(sliderPositionAt(0.25, 0, 8)).toBeCloseTo(0.25, 12)
    expect(sliderPositionAt(0.25, 4, 8)).toBeCloseTo(0.625, 12)
    expect(sliderPositionAt(0.25, 8, 8)).toBeCloseTo(1, 12)
    expect(sliderPositionAt(0.25, 99, 8)).toBeCloseTo(1, 12)
    expect(sliderPositionAt(0.25, 4, 0)).toBeCloseTo(0.25, 12)
  })

  it('floors the effective rheostat resistance', () => {
    expect(effectiveSliderResistance(20, 0.5)).toBeCloseTo(10, 12)
    expect(effectiveSliderResistance(20, 0)).toBeCloseTo(1e-6, 12)
  })
})
