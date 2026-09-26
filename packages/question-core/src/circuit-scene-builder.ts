/**
 * Circuit scene builder: IR → PhysicsScene.
 *
 * Maps the parsed circuit question to one of the circuit template factories
 * (series / parallel / mixed / rheostat / emf-measurement). It performs NO
 * physics: no current is computed, no resistance is summed. The circuit engine
 * solves the scene this produces (MNA), and the verifier judges what the
 * engine produced.
 *
 * The builder picks the factory on `ir.circuitTopology` and an EMF+internal
 * pair (the 测电动势与内阻 apparatus). The IR's resistances, EMF and internal
 * resistance are passed straight through as the template inputs.
 */

import {
  createCircuitScene,
  createEmfMeasurementScene,
  createMixedCircuitScene,
  createParallelCircuitScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
  type CircuitComponentSpec,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface CircuitSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((entry) => entry.key === key)?.value

/**
 * Build a circuit PhysicsScene from a question IR.
 *
 * Returns a scene the CircuitEngine accepts (exactly one voltage source, no
 * reactive components). The EMF defaults to 6 V and the resistances to 10 Ω
 * when the IR omits them — the validator rejects an IR with no source and no
 * resistance, so a scene reaching here always carries at least one of each.
 */
export function buildCircuitSceneFromIR(
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): CircuitSceneBuildResult {
  const emf = knownValue(ir, 'emf') ?? 6
  const internal = knownValue(ir, 'internal_resistance')
  const r1 = knownValue(ir, 'resistance_1') ?? ir.circuitResistances?.[0] ?? 10
  const r2 = knownValue(ir, 'resistance_2') ?? ir.circuitResistances?.[1] ?? 20
  const rheostatTotal = ir.rheostatTotalResistance ?? 20
  const slider = ir.rheostatSliderPosition ?? 0.5

  const title = '试题场景：直流电路'
  const description =
    options.questionId === undefined
      ? '由 Circuit Question IR 生成'
      : `由试题 ${options.questionId} 的 Circuit Question IR 生成`
  const now = options.now
  const sceneId = options.sceneId

  /* The EMF-and-internal-resistance measurement question is its own apparatus:
     a rheostat load with a voltmeter across the battery, swept to read off
     U = E − I·r. It is matched on the rheostat topology combined with an
     internal-resistance known — a plain series circuit with an internal
     resistance (E, r, R in one loop) is NOT the measurement apparatus, it
     uses the series factory. */
  const isEmfMeasurement = internal !== undefined && ir.circuitTopology === 'rheostat'
  if (isEmfMeasurement) {
    const scene = createEmfMeasurementScene({
      emf,
      internalResistance: internal,
      totalResistance: rheostatTotal,
      sliderPosition: slider,
      ...(sceneId === undefined ? {} : { sceneId }),
      title,
      description,
      ...(now === undefined ? {} : { now }),
    })
    return {
      scene,
      irToSceneMapping: { battery: 'bat', rheostat: 'rv', voltmeter: 'vm', ammeter: 'am' },
    }
  }

  const topology = ir.circuitTopology ?? 'series'
  if (topology === 'rheostat') {
    const scene = createRheostatCircuitScene({
      voltage: emf,
      fixedResistance: r1,
      totalResistance: rheostatTotal,
      sliderPosition: slider,
      ...(sceneId === undefined ? {} : { sceneId }),
      title,
      description,
      ...(now === undefined ? {} : { now }),
    })
    return {
      scene,
      irToSceneMapping: {
        battery: 'bat',
        rheostat: 'rv',
        fixed_resistor: 'r0',
        voltmeter: 'vm',
        ammeter: 'am',
      },
    }
  }

  if (topology === 'parallel') {
    const scene = createParallelCircuitScene({
      voltage: emf,
      r1,
      r2,
      ...(sceneId === undefined ? {} : { sceneId }),
      title,
      description,
      ...(now === undefined ? {} : { now }),
    })
    return {
      scene,
      irToSceneMapping: {
        battery: 'bat',
        resistor_1: 'r1',
        resistor_2: 'r2',
        voltmeter: 'vm',
        ammeter: 'am',
      },
    }
  }

  if (topology === 'mixed') {
    const r3 = knownValue(ir, 'resistance_3') ?? ir.circuitResistances?.[2] ?? r2
    const scene = createMixedCircuitScene({
      voltage: emf,
      r1,
      r2,
      r3,
      ...(sceneId === undefined ? {} : { sceneId }),
      title,
      description,
      ...(now === undefined ? {} : { now }),
    })
    return {
      scene,
      irToSceneMapping: {
        battery: 'bat',
        resistor_1: 'r1',
        resistor_2: 'r2',
        resistor_3: 'r3',
        voltmeter: 'vm',
        ammeter: 'am',
      },
    }
  }

  /* Default: series. When the question carries an internal resistance, the
     series template factory does not model it, so build a single-loop netlist
     directly: an internal-resistance source plus the external resistors. */
  if (topology === 'series' && internal !== undefined) {
    const components: CircuitComponentSpec[] = [
      {
        id: 'bat',
        type: 'voltage_source',
        name: 'E',
        voltage: emf,
        internalResistance: internal,
        terminals: { positive: 'n1', negative: 'n4' },
        layout: { x: 0, y: -3, rotation: 0 },
      },
      {
        id: 'sw',
        type: 'switch',
        name: 'S',
        state: 'closed',
        terminals: { a: 'n1', b: 'n2' },
        layout: { x: 5, y: 0, rotation: 90 },
      },
      ...(ir.hasAmmeter
        ? [
            {
              id: 'am',
              type: 'ammeter' as const,
              name: 'A',
              terminals: { a: 'n2' as const, b: 'n3' as const },
              layout: { x: 2.5, y: 3, rotation: 180 as const },
            },
          ]
        : [
            {
              id: 'wire-am',
              type: 'switch' as const,
              name: '',
              state: 'closed' as const,
              terminals: { a: 'n2' as const, b: 'n3' as const },
              layout: { x: 2.5, y: 3, rotation: 180 as const },
            },
          ]),
    ]
    const resistors: CircuitComponentSpec[] = []
    const rValues = ir.circuitResistances ?? [r1]
    for (const [index, r] of rValues.entries()) {
      const netFrom = index === 0 ? 'n3' : 'n4'
      const netTo = 'n4'
      resistors.push({
        id: `r${index + 1}`,
        type: 'resistor',
        name: `R${index + 1}`,
        resistance: r,
        terminals: { a: netFrom, b: netTo },
        layout: {
          x: index === 0 ? -1 : -3,
          y: index === 0 ? 3 : 0,
          rotation: index === 0 ? 180 : 270,
        },
      })
    }
    components.push(...resistors)
    if (ir.hasVoltmeter) {
      components.push({
        id: 'vm',
        type: 'voltmeter',
        name: 'V',
        terminals: { a: 'n3', b: 'n4' },
        layout: { x: -3.1, y: 0, rotation: 270 },
      })
    }
    const scene = createCircuitScene({
      ...(sceneId === undefined ? {} : { sceneId }),
      components,
      observableVisibility: { current: true, voltage: true, power: true, graph: false },
      title,
      description,
      ...(now === undefined ? {} : { now }),
    })
    return {
      scene,
      irToSceneMapping: { battery: 'bat', resistor_1: 'r1', voltmeter: 'vm', ammeter: 'am' },
    }
  }

  /* Default: series, no internal resistance — use the template factory. */
  const scene = createSeriesCircuitScene({
    voltage: emf,
    r1,
    r2,
    ...(sceneId === undefined ? {} : { sceneId }),
    title,
    description,
    ...(now === undefined ? {} : { now }),
  })
  return {
    scene,
    irToSceneMapping: {
      battery: 'bat',
      resistor_1: 'r1',
      resistor_2: 'r2',
      voltmeter: 'vm',
      ammeter: 'am',
    },
  }
}
