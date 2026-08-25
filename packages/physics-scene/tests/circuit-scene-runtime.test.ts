import { describe, expect, it } from 'vitest'
import { quantity } from '@physicsos/physics-units'

import {
  CIRCUIT_SWEEP_DURATION_SECONDS,
  SceneRuntime,
  circuitLayoutOf,
  circuitOf,
  createCircuitScene,
  createRheostatCircuitScene,
  createSceneCommand,
  createSeriesCircuitScene,
  isCircuitScene,
  validateScene,
  type PhysicsScene,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '../src/index.ts'

const execute = <T extends SceneCommandType>(
  runtime: SceneRuntime,
  type: T,
  payload: SceneCommandPayloadMap[T],
) => {
  const scene = runtime.getScene()
  return runtime.execute(
    createSceneCommand({
      commandId: `cmd-${type}-${scene.revision}`,
      sceneId: String(scene.id),
      expectedRevision: scene.revision,
      type,
      payload,
      traceId: `trace-${type}`,
    }),
  )
}

describe('createCircuitScene', () => {
  it('derives nodes and connections from netlist terminal names', () => {
    const scene = createSeriesCircuitScene()
    const circuit = circuitOf(scene)
    expect(circuit).toBeDefined()
    expect(circuit!.nodes.map((node) => node.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    /* Net n4 joins r1.b, r2.a and vm.a → two chained connections. */
    const n4 = circuit!.connections.filter((connection) => connection.id.startsWith('conn-n4'))
    expect(n4).toHaveLength(2)
    expect(isCircuitScene(scene)).toBe(true)
    expect(validateScene(scene).status).toBe('passed')
  })

  it('keeps the timeline static without a rheostat and sweeping with one', () => {
    const staticScene = createSeriesCircuitScene()
    expect(staticScene.timeline.endTime?.value).toBe(0)
    const sweepScene = createRheostatCircuitScene()
    expect(sweepScene.timeline.endTime?.value).toBe(CIRCUIT_SWEEP_DURATION_SECONDS)
  })

  it('stores the schematic layout as presentation metadata', () => {
    const scene = createSeriesCircuitScene()
    const layout = circuitLayoutOf(circuitOf(scene)!)
    expect(layout).toBeDefined()
    expect(layout!.components['bat']).toEqual({ x: 0, y: -3, rotation: 0 })
    expect(layout!.wires?.['conn-n1-0']).toEqual([{ x: 5, y: -3 }])
  })

  it('rejects a connection referencing a missing component in validation', () => {
    const base = createSeriesCircuitScene()
    const circuit = circuitOf(base)!
    const broken: PhysicsScene = {
      ...base,
      circuits: [
        {
          ...circuit,
          components: circuit.components.filter((component) => String(component.id) !== 'vm'),
        },
      ],
    }
    expect(validateScene(broken).status).toBe('failed')
  })
})

describe('circuit scene commands', () => {
  it('toggles a switch and records SwitchStateChanged', () => {
    const runtime = new SceneRuntime(createSeriesCircuitScene())
    const result = execute(runtime, 'SetSwitchState', {
      circuitId: 'circuit-1',
      componentId: 'sw',
      state: 'open',
    })
    expect(result.ok).toBe(true)
    const component = circuitOf(runtime.getScene())!.components.find(
      (entry) => String(entry.id) === 'sw',
    )
    expect(component?.type).toBe('switch')
    if (component?.type !== 'switch') throw new Error('Expected a switch.')
    expect(component.state).toBe('open')
    expect(runtime.getEvents()[0]?.type).toBe('SwitchStateChanged')
  })

  it('moves the rheostat slider and rejects out-of-range positions atomically', () => {
    const runtime = new SceneRuntime(createRheostatCircuitScene({ sliderPosition: 0.5 }))
    const ok = execute(runtime, 'SetSliderPosition', {
      circuitId: 'circuit-1',
      componentId: 'rv',
      position: 0.25,
    })
    expect(ok.ok).toBe(true)
    const before = runtime.getScene()
    const bad = execute(runtime, 'SetSliderPosition', {
      circuitId: 'circuit-1',
      componentId: 'rv',
      position: 1.5,
    })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('Expected command rejection.')
    expect(bad.error.code).toBe('INVALID_SLIDER_POSITION')
    expect(runtime.getScene()).toEqual(before)
  })

  it('updates resistor and rheostat resistances through one command', () => {
    const runtime = new SceneRuntime(createRheostatCircuitScene())
    const fixed = execute(runtime, 'SetComponentResistance', {
      circuitId: 'circuit-1',
      componentId: 'r0',
      resistance: quantity(15, 'Ω', 'resistance'),
    })
    expect(fixed.ok).toBe(true)
    const total = execute(runtime, 'SetComponentResistance', {
      circuitId: 'circuit-1',
      componentId: 'rv',
      resistance: quantity(50, 'Ω', 'resistance'),
    })
    expect(total.ok).toBe(true)
    const circuit = circuitOf(runtime.getScene())!
    const r0 = circuit.components.find((entry) => String(entry.id) === 'r0')
    const rv = circuit.components.find((entry) => String(entry.id) === 'rv')
    if (r0?.type !== 'resistor' || rv?.type !== 'variable_resistor') {
      throw new Error('Expected resistor and variable resistor.')
    }
    expect(r0.resistance.value).toBe(15)
    expect(rv.totalResistance.value).toBe(50)
  })

  it('rejects resistance edits on non-resistive components', () => {
    const runtime = new SceneRuntime(createSeriesCircuitScene())
    const result = execute(runtime, 'SetComponentResistance', {
      circuitId: 'circuit-1',
      componentId: 'sw',
      resistance: quantity(10, 'Ω', 'resistance'),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected command rejection.')
    expect(result.error.code).toBe('COMPONENT_NOT_RESISTIVE')
  })

  it('edits source EMF and internal resistance with validation', () => {
    const runtime = new SceneRuntime(createSeriesCircuitScene())
    const voltage = execute(runtime, 'SetSourceVoltage', {
      circuitId: 'circuit-1',
      componentId: 'bat',
      voltage: quantity(9, 'V', 'electric_potential'),
    })
    expect(voltage.ok).toBe(true)
    const internal = execute(runtime, 'SetSourceInternalResistance', {
      circuitId: 'circuit-1',
      componentId: 'bat',
      internalResistance: quantity(0.5, 'Ω', 'resistance'),
    })
    expect(internal.ok).toBe(true)
    const source = circuitOf(runtime.getScene())!.components.find(
      (entry) => String(entry.id) === 'bat',
    )
    if (source?.type !== 'voltage_source') throw new Error('Expected a voltage source.')
    expect(source.voltage.value).toBe(9)
    expect(source.internalResistance?.value).toBe(0.5)

    const negative = execute(runtime, 'SetSourceVoltage', {
      circuitId: 'circuit-1',
      componentId: 'bat',
      voltage: quantity(-1, 'V', 'electric_potential'),
    })
    expect(negative.ok).toBe(false)
    if (negative.ok) throw new Error('Expected command rejection.')
    expect(negative.error.code).toBe('INVALID_SOURCE_VOLTAGE')

    const wrongTarget = execute(runtime, 'SetSourceVoltage', {
      circuitId: 'circuit-1',
      componentId: 'r1',
      voltage: quantity(3, 'V', 'electric_potential'),
    })
    expect(wrongTarget.ok).toBe(false)
    if (wrongTarget.ok) throw new Error('Expected command rejection.')
    expect(wrongTarget.error.code).toBe('COMPONENT_NOT_VOLTAGE_SOURCE')
  })

  it('reports missing circuits and components as not-found errors', () => {
    const runtime = new SceneRuntime(createSeriesCircuitScene())
    const missingComponent = execute(runtime, 'SetSwitchState', {
      circuitId: 'circuit-1',
      componentId: 'ghost',
      state: 'open',
    })
    expect(missingComponent.ok).toBe(false)
    if (missingComponent.ok) throw new Error('Expected command rejection.')
    expect(missingComponent.error.code).toBe('CIRCUIT_COMPONENT_NOT_FOUND')

    const missingCircuit = execute(runtime, 'SetSwitchState', {
      circuitId: 'circuit-ghost',
      componentId: 'sw',
      state: 'open',
    })
    expect(missingCircuit.ok).toBe(false)
    if (missingCircuit.ok) throw new Error('Expected command rejection.')
    expect(missingCircuit.error.code).toBe('CIRCUIT_NOT_FOUND')
  })

  it('rejects duplicate component ids across circuits in scene creation', () => {
    const scene = createCircuitScene({
      components: [
        {
          id: 'dup',
          type: 'voltage_source',
          voltage: 6,
          terminals: { positive: 'n1', negative: 'n2' },
        },
        { id: 'dup', type: 'resistor', resistance: 10, terminals: { a: 'n1', b: 'n2' } },
      ],
    })
    expect(validateScene(scene).status).toBe('failed')
  })
})
