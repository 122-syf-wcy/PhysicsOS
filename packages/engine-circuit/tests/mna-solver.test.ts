import { describe, expect, it } from 'vitest'
import { createCircuitScene, createSeriesCircuitScene } from '@physicsos/physics-scene'

import { resolveCircuitModel, solveCircuit } from '../src/index.ts'

describe('resolveCircuitModel', () => {
  it('collapses connected terminals into shared electrical nodes', () => {
    const scene = createSeriesCircuitScene()
    const model = resolveCircuitModel(scene, 0)
    /* Loop of 5 series elements + voltmeter tap: five nets in the netlist. */
    expect(model.nodeIds).toHaveLength(5)
    expect(model.nodeOfTerminal.get('r2.a')).toBe(model.nodeOfTerminal.get('vm.a'))
    expect(model.nodeOfTerminal.get('r2.b')).toBe(model.nodeOfTerminal.get('vm.b'))
  })

  it('splits a source with internal resistance into an EMF plus a resistor branch', () => {
    const scene = createCircuitScene({
      components: [
        {
          id: 'bat',
          type: 'voltage_source',
          voltage: 12,
          internalResistance: 1,
          terminals: { positive: 'p', negative: 'n' },
        },
        { id: 'load', type: 'resistor', resistance: 5, terminals: { a: 'p', b: 'n' } },
      ],
    })
    const model = resolveCircuitModel(scene, 0)
    const kinds = model.branches.map((branch) => `${branch.kind}:${branch.componentId}`)
    expect(kinds).toContain('source:bat')
    expect(kinds).toContain('conductance:bat.__r')
    expect(kinds).toContain('conductance:load')
  })

  it('stamps no branch for an open switch', () => {
    const scene = createSeriesCircuitScene({ switchClosed: false })
    const model = resolveCircuitModel(scene, 0)
    expect(model.branches.some((branch) => branch.componentId === 'sw')).toBe(false)
  })
})

describe('solveCircuit', () => {
  it('solves the internal-resistance divider exactly: I = E / (R + r)', () => {
    const scene = createCircuitScene({
      components: [
        {
          id: 'bat',
          type: 'voltage_source',
          voltage: 12,
          internalResistance: 1,
          terminals: { positive: 'p', negative: 'n' },
        },
        { id: 'load', type: 'resistor', resistance: 5, terminals: { a: 'p', b: 'n' } },
      ],
    })
    const model = resolveCircuitModel(scene, 0)
    const solution = solveCircuit(model)
    /* Load current flows a→b, i.e. p→n outside the source: +2 A. */
    expect(solution.branchCurrents.get('load')).toBeCloseTo(2, 9)
    /* The MNA source unknown flows positive→negative inside the source. */
    expect(solution.branchCurrents.get('bat')).toBeCloseTo(-2, 9)
    expect(solution.kclResidual).toBeLessThan(1e-9)
    expect(solution.totalSourcePower).toBeCloseTo(24, 9)
    expect(solution.totalDissipatedPower).toBeCloseTo(24, 9)
  })

  it('keeps islands independently grounded when a switch opens the loop', () => {
    const scene = createSeriesCircuitScene({ switchClosed: false })
    const model = resolveCircuitModel(scene, 0)
    const solution = solveCircuit(model)
    for (const current of solution.branchCurrents.values()) {
      expect(Math.abs(current)).toBeLessThan(1e-9)
    }
    expect(solution.totalSourcePower).toBeCloseTo(0, 9)
  })

  it('reports energy balance for every template-sized network', () => {
    const scene = createSeriesCircuitScene({ voltage: 9, r1: 30, r2: 60 })
    const solution = solveCircuit(resolveCircuitModel(scene, 0))
    expect(solution.totalSourcePower).toBeCloseTo(solution.totalDissipatedPower, 9)
  })
})
