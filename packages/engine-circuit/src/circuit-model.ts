import { canonicalValue } from '@physicsos/physics-units'
import {
  circuitTerminalId,
  terminalKeysOf,
  type Circuit,
  type CircuitComponent,
  type PhysicsScene,
  type VariableResistor,
} from '@physicsos/physics-scene'
import { PhysicsOSError } from '@physicsos/shared'

/**
 * Numerical circuit model resolved from a PhysicsScene.
 *
 * Electrical nodes are the union-find classes of component terminals linked by
 * connections. Every terminal of every ENABLED component is an element even
 * when nothing connects to it (a dangling branch simply carries no current);
 * terminals of disabled components still act as solder points, so connections
 * through them keep conducting.
 */

/** Resistance floor for a rheostat at slider position 0 (ohms). */
export const MIN_SLIDER_RESISTANCE = 1e-6

/** Ideal-voltmeter internal resistance stand-in (ohms). */
export const IDEAL_VOLTMETER_RESISTANCE = 1e9

/** One resistive branch between two nodes. */
export interface ConductanceBranch {
  readonly kind: 'conductance'
  readonly componentId: string
  readonly nodeA: string
  readonly nodeB: string
  /** Ohms, already floored/defaulted. */
  readonly resistance: number
}

/**
 * One voltage-constrained branch (ideal source, closed switch, ideal ammeter)
 * whose current is an MNA unknown. The constraint reads
 * `V(nodePositive) − V(nodeNegative) = emf`.
 */
export interface SourceBranch {
  readonly kind: 'source'
  readonly componentId: string
  readonly nodePositive: string
  readonly nodeNegative: string
  /** Volts; zero for switches and ideal ammeters. */
  readonly emf: number
  /**
   * MNA solves the current flowing positive→negative INSIDE the branch. For a
   * discharging battery the physical current runs the other way, so readers
   * negate when this flag is set.
   */
  readonly role: 'battery' | 'short'
}

export type CircuitBranch = ConductanceBranch | SourceBranch

export interface ResolvedCircuitModel {
  readonly circuitId: string
  /** Enabled components, in scene order. */
  readonly components: readonly CircuitComponent[]
  /** Electrical node id per terminal id. */
  readonly nodeOfTerminal: ReadonlyMap<string, string>
  /** Distinct node ids, deterministic order. */
  readonly nodeIds: readonly string[]
  readonly branches: readonly CircuitBranch[]
  /** First voltage source, used for the run-level derived summary. */
  readonly primarySourceId: string | undefined
  readonly variableResistors: readonly VariableResistor[]
  /** Sweep window seconds; 0 means a static DC operating point. */
  readonly sweepDuration: number
}

class UnionFind {
  private readonly parent = new Map<string, string>()

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id)
  }

  find(id: string): string {
    const parent = this.parent.get(id)
    if (parent === undefined) {
      this.add(id)
      return id
    }
    if (parent === id) return id
    const root = this.find(parent)
    this.parent.set(id, root)
    return root
  }

  union(a: string, b: string): void {
    this.add(a)
    this.add(b)
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return
    /* Deterministic representative: the lexicographically smaller root. */
    if (rootA < rootB) this.parent.set(rootB, rootA)
    else this.parent.set(rootA, rootB)
  }
}

const isEnabled = (component: CircuitComponent): boolean => component.enabled !== false

/** Effective series resistance of a rheostat at a slider position. */
export const effectiveSliderResistance = (
  totalResistance: number,
  sliderPosition: number,
): number => Math.max(totalResistance * sliderPosition, MIN_SLIDER_RESISTANCE)

/**
 * Slider position at scene time `t` for the quasi-static sweep: the stored
 * position at t = 0, rising linearly to 1 at the sweep end. Static scenes
 * (sweepDuration = 0) hold the stored position.
 */
export const sliderPositionAt = (
  storedPosition: number,
  time: number,
  sweepDuration: number,
): number => {
  if (sweepDuration <= 0) return storedPosition
  const progress = Math.min(1, Math.max(0, time / sweepDuration))
  return storedPosition + (1 - storedPosition) * progress
}

/**
 * Resolve the scene's single circuit into nodes and branches at scene time `t`.
 * Throws when the scene has no circuit; physical preconditions live in the
 * engine's `canHandle`.
 */
export const resolveCircuitModel = (scene: PhysicsScene, time: number): ResolvedCircuitModel => {
  const circuit: Circuit | undefined = scene.circuits[0]
  if (circuit === undefined) {
    throw new PhysicsOSError('CIRCUIT_MISSING', 'The scene carries no circuit to model.')
  }

  const enabled = circuit.components.filter(isEnabled)
  const unionFind = new UnionFind()

  for (const component of enabled) {
    for (const key of terminalKeysOf(component)) {
      unionFind.add(circuitTerminalId(String(component.id), key))
    }
  }
  for (const connection of circuit.connections) {
    unionFind.union(
      circuitTerminalId(String(connection.from.componentId), connection.from.terminalKey),
      circuitTerminalId(String(connection.to.componentId), connection.to.terminalKey),
    )
  }

  const nodeOfTerminal = new Map<string, string>()
  const nodeIds: string[] = []
  for (const component of enabled) {
    for (const key of terminalKeysOf(component)) {
      const terminal = circuitTerminalId(String(component.id), key)
      const node = unionFind.find(terminal)
      nodeOfTerminal.set(terminal, node)
      if (!nodeIds.includes(node)) nodeIds.push(node)
    }
  }

  const sweepDuration =
    scene.timeline.endTime === undefined ? 0 : Math.max(0, canonicalValue(scene.timeline.endTime))

  const nodeOf = (componentId: string, key: string): string => {
    const node = nodeOfTerminal.get(circuitTerminalId(componentId, key))
    if (node === undefined) {
      throw new PhysicsOSError(
        'CIRCUIT_TERMINAL_MISSING',
        `Terminal "${circuitTerminalId(componentId, key)}" is not part of the node map.`,
      )
    }
    return node
  }

  const branches: CircuitBranch[] = []
  const variableResistors: VariableResistor[] = []
  let primarySourceId: string | undefined

  for (const component of enabled) {
    const componentId = String(component.id)
    switch (component.type) {
      case 'resistor': {
        branches.push({
          kind: 'conductance',
          componentId,
          nodeA: nodeOf(componentId, 'a'),
          nodeB: nodeOf(componentId, 'b'),
          resistance: canonicalValue(component.resistance),
        })
        break
      }
      case 'variable_resistor': {
        variableResistors.push(component)
        const position = sliderPositionAt(component.sliderPosition, time, sweepDuration)
        branches.push({
          kind: 'conductance',
          componentId,
          nodeA: nodeOf(componentId, 'a'),
          nodeB: nodeOf(componentId, 'b'),
          resistance: effectiveSliderResistance(
            canonicalValue(component.totalResistance),
            position,
          ),
        })
        break
      }
      case 'voltage_source': {
        primarySourceId ??= componentId
        const positive = nodeOf(componentId, 'positive')
        const negative = nodeOf(componentId, 'negative')
        const internal =
          component.internalResistance === undefined
            ? 0
            : canonicalValue(component.internalResistance)
        if (internal > 0) {
          /* Thevenin split: ideal EMF from the negative terminal up to a private
             internal node, then the internal resistance out to the positive
             terminal, so terminal potentials stay honest (U = E − I·r). */
          const internalNode = `${componentId}.__internal`
          branches.push({
            kind: 'source',
            componentId,
            nodePositive: internalNode,
            nodeNegative: negative,
            emf: canonicalValue(component.voltage),
            role: 'battery',
          })
          branches.push({
            kind: 'conductance',
            componentId: `${componentId}.__r`,
            nodeA: internalNode,
            nodeB: positive,
            resistance: internal,
          })
          if (!nodeIds.includes(internalNode)) nodeIds.push(internalNode)
        } else {
          branches.push({
            kind: 'source',
            componentId,
            nodePositive: positive,
            nodeNegative: negative,
            emf: canonicalValue(component.voltage),
            role: 'battery',
          })
        }
        break
      }
      case 'switch': {
        if (component.state === 'closed') {
          const nodeA = nodeOf(componentId, 'a')
          const nodeB = nodeOf(componentId, 'b')
          /* A closed switch collapsed onto one node is a self-loop whose current
             is undefined; it carries none, so no branch is stamped. */
          if (nodeA !== nodeB) {
            branches.push({
              kind: 'source',
              componentId,
              nodePositive: nodeA,
              nodeNegative: nodeB,
              emf: 0,
              role: 'short',
            })
          }
        }
        break
      }
      case 'ammeter': {
        const nodeA = nodeOf(componentId, 'a')
        const nodeB = nodeOf(componentId, 'b')
        const internal =
          component.internalResistance === undefined
            ? 0
            : canonicalValue(component.internalResistance)
        if (internal > 0) {
          branches.push({
            kind: 'conductance',
            componentId,
            nodeA,
            nodeB,
            resistance: internal,
          })
        } else if (nodeA !== nodeB) {
          branches.push({
            kind: 'source',
            componentId,
            nodePositive: nodeA,
            nodeNegative: nodeB,
            emf: 0,
            role: 'short',
          })
        }
        break
      }
      case 'voltmeter': {
        const internal =
          component.internalResistance === undefined ||
          canonicalValue(component.internalResistance) <= 0
            ? IDEAL_VOLTMETER_RESISTANCE
            : canonicalValue(component.internalResistance)
        branches.push({
          kind: 'conductance',
          componentId,
          nodeA: nodeOf(componentId, 'a'),
          nodeB: nodeOf(componentId, 'b'),
          resistance: internal,
        })
        break
      }
      case 'capacitor':
      case 'inductor':
        /* Rejected by canHandle; resolving anyway would silently mismodel DC
           transients, so this is a hard error rather than a skip. */
        throw new PhysicsOSError(
          'CIRCUIT_COMPONENT_UNSUPPORTED',
          `Component type "${component.type}" is not supported by the DC circuit engine.`,
        )
    }
  }

  return {
    circuitId: circuit.id,
    components: enabled,
    nodeOfTerminal,
    nodeIds,
    branches,
    primarySourceId,
    variableResistors,
    sweepDuration,
  }
}
