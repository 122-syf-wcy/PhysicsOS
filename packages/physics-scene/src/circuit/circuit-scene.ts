import { quantity } from '@physicsos/physics-units'
import { asComponentId, asObservableId, asSceneId, type IsoDateTime } from '@physicsos/shared'

import { defaultCoordinateSystem } from '../scene-validation.ts'
import type {
  Circuit,
  CircuitComponent,
  CircuitConnection,
  CircuitNode,
  PhysicsScene,
  VariableResistor,
} from '../scene.ts'

/**
 * Duration of the quasi-static rheostat sweep in seconds.
 *
 * A DC circuit has no time evolution of its own, so "playing" a circuit scene
 * only makes sense when something changes over the run. When the circuit has a
 * variable resistor the timeline maps to a smooth slider sweep from the stored
 * position up to 100%; without one the timeline collapses to a zero-length run
 * (a static reading).
 */
export const CIRCUIT_SWEEP_DURATION_SECONDS = 8

/** Terminal keys used by every two-terminal component except sources. */
export const TWO_TERMINAL_KEYS = ['a', 'b'] as const
/** Terminal keys used by voltage sources. */
export const SOURCE_TERMINAL_KEYS = ['positive', 'negative'] as const

export type CircuitObservableKey = 'current' | 'voltage' | 'power' | 'graph'

/** Placement of one schematic symbol on the abstract grid (y axis up). */
export interface CircuitComponentPlacement {
  readonly x: number
  readonly y: number
  /**
   * Symbol rotation in degrees. The local axis points from terminal `a`
   * (respectively `negative`) towards terminal `b` (respectively `positive`)
   * at rotation 0, i.e. left-to-right.
   */
  readonly rotation?: 0 | 90 | 180 | 270
}

/** Presentation-only schematic layout stored in `circuit.metadata.layout`. */
export interface CircuitLayout {
  /** Placement per component id. */
  readonly components: Readonly<Record<string, CircuitComponentPlacement>>
  /**
   * Optional intermediate waypoints per connection id, in grid units. Without
   * waypoints a renderer falls back to an orthogonal L-route between the two
   * terminal endpoints.
   */
  readonly wires?: Readonly<Record<string, readonly { x: number; y: number }[]>>
}

interface TwoTerminalNets {
  readonly a: string
  readonly b: string
}

interface SourceTerminalNets {
  readonly positive: string
  readonly negative: string
}

interface ComponentSpecBase {
  readonly id: string
  readonly name?: string
  readonly layout?: CircuitComponentPlacement
}

/** Netlist-style authoring input: each terminal names the net it attaches to. */
export type CircuitComponentSpec =
  | (ComponentSpecBase & {
      readonly type: 'resistor'
      /** Ohms. */
      readonly resistance: number
      readonly terminals: TwoTerminalNets
    })
  | (ComponentSpecBase & {
      readonly type: 'voltage_source'
      /** Volts (EMF). */
      readonly voltage: number
      /** Ohms; omitted means an ideal source. */
      readonly internalResistance?: number
      readonly terminals: SourceTerminalNets
    })
  | (ComponentSpecBase & {
      readonly type: 'switch'
      readonly state: 'open' | 'closed'
      readonly terminals: TwoTerminalNets
    })
  | (ComponentSpecBase & {
      readonly type: 'ammeter'
      /** Ohms; omitted means an ideal (zero-resistance) ammeter. */
      readonly internalResistance?: number
      readonly terminals: TwoTerminalNets
    })
  | (ComponentSpecBase & {
      readonly type: 'voltmeter'
      /** Ohms; omitted means an ideal (infinite-resistance) voltmeter. */
      readonly internalResistance?: number
      readonly terminals: TwoTerminalNets
    })
  | (ComponentSpecBase & {
      readonly type: 'variable_resistor'
      /** Ohms at slider position 1. */
      readonly totalResistance: number
      /** 0..1. */
      readonly sliderPosition: number
      readonly terminals: TwoTerminalNets
    })

export interface CircuitSceneInput {
  readonly sceneId?: string
  readonly revision?: number
  readonly circuitId?: string
  readonly components: readonly CircuitComponentSpec[]
  /** Extra wire waypoints per connection id (see `CircuitLayout.wires`). */
  readonly wires?: Readonly<Record<string, readonly { x: number; y: number }[]>>
  readonly observableVisibility?: Partial<Record<CircuitObservableKey, boolean>>
  readonly now?: IsoDateTime
  readonly title?: string
  readonly description?: string
}

const terminalNetsOf = (spec: CircuitComponentSpec): readonly (readonly [string, string])[] =>
  spec.type === 'voltage_source'
    ? [
        ['positive', spec.terminals.positive],
        ['negative', spec.terminals.negative],
      ]
    : [
        ['a', spec.terminals.a],
        ['b', spec.terminals.b],
      ]

/** Deterministic id shared by every connection touching the same terminal. */
export const circuitTerminalId = (componentId: string, terminalKey: string): string =>
  `${componentId}.${terminalKey}`

const toComponent = (spec: CircuitComponentSpec): CircuitComponent => {
  const base = {
    id: asComponentId(spec.id),
    ...(spec.name === undefined ? {} : { name: spec.name }),
  }
  switch (spec.type) {
    case 'resistor':
      return {
        ...base,
        type: 'resistor',
        resistance: quantity(spec.resistance, 'Ω', 'resistance'),
      }
    case 'voltage_source':
      return {
        ...base,
        type: 'voltage_source',
        voltage: quantity(spec.voltage, 'V', 'electric_potential'),
        ...(spec.internalResistance === undefined
          ? {}
          : { internalResistance: quantity(spec.internalResistance, 'Ω', 'resistance') }),
      }
    case 'switch':
      return { ...base, type: 'switch', state: spec.state }
    case 'ammeter':
      return {
        ...base,
        type: 'ammeter',
        ...(spec.internalResistance === undefined
          ? {}
          : { internalResistance: quantity(spec.internalResistance, 'Ω', 'resistance') }),
      }
    case 'voltmeter':
      return {
        ...base,
        type: 'voltmeter',
        ...(spec.internalResistance === undefined
          ? {}
          : { internalResistance: quantity(spec.internalResistance, 'Ω', 'resistance') }),
      }
    case 'variable_resistor':
      return {
        ...base,
        type: 'variable_resistor',
        totalResistance: quantity(spec.totalResistance, 'Ω', 'resistance'),
        sliderPosition: spec.sliderPosition,
      }
  }
}

/**
 * Build nodes and connections from netlist specs. Terminals that share a net
 * are chained pairwise in authoring order, so union-find over the connections
 * reconstructs exactly the authored nets.
 */
const buildTopology = (
  specs: readonly CircuitComponentSpec[],
): { nodes: CircuitNode[]; connections: CircuitConnection[] } => {
  const netTerminals = new Map<string, { componentId: string; terminalKey: string }[]>()
  for (const spec of specs) {
    for (const [terminalKey, net] of terminalNetsOf(spec)) {
      const list = netTerminals.get(net) ?? []
      list.push({ componentId: spec.id, terminalKey })
      netTerminals.set(net, list)
    }
  }

  const nodes: CircuitNode[] = []
  const connections: CircuitConnection[] = []
  for (const [net, terminals] of netTerminals) {
    nodes.push({ id: net, label: net })
    for (let index = 0; index + 1 < terminals.length; index += 1) {
      const from = terminals[index]
      const to = terminals[index + 1]
      if (from === undefined || to === undefined) continue
      connections.push({
        id: `conn-${net}-${index}`,
        from: {
          id: circuitTerminalId(from.componentId, from.terminalKey),
          componentId: asComponentId(from.componentId),
          terminalKey: from.terminalKey,
        },
        to: {
          id: circuitTerminalId(to.componentId, to.terminalKey),
          componentId: asComponentId(to.componentId),
          terminalKey: to.terminalKey,
        },
      })
    }
  }
  return { nodes, connections }
}

const buildLayout = (input: CircuitSceneInput): CircuitLayout | undefined => {
  const placements: Record<string, CircuitComponentPlacement> = {}
  let hasPlacement = false
  for (const spec of input.components) {
    if (spec.layout === undefined) continue
    placements[spec.id] = spec.layout
    hasPlacement = true
  }
  if (!hasPlacement && input.wires === undefined) return undefined
  return {
    components: placements,
    ...(input.wires === undefined ? {} : { wires: input.wires }),
  }
}

const observableId = (key: CircuitObservableKey) => asObservableId(`observable-circuit-${key}`)

const firstIdOfType = (
  components: readonly CircuitComponentSpec[],
  type: CircuitComponentSpec['type'],
): string | undefined => components.find((entry) => entry.type === type)?.id

/**
 * Create a single-circuit DC scene from a netlist description.
 *
 * The factory derives nodes and connections from the per-terminal net names,
 * stores the optional schematic layout in `circuit.metadata.layout`, and sets
 * the timeline to the rheostat sweep window when a variable resistor exists
 * (zero-length otherwise).
 */
export const createCircuitScene = (input: CircuitSceneInput): PhysicsScene => {
  const now = input.now ?? new Date().toISOString()
  const sceneId = input.sceneId ?? 'circuit-runtime-scene'
  const circuitId = input.circuitId ?? 'circuit-1'
  const visibility = input.observableVisibility ?? {}

  const { nodes, connections } = buildTopology(input.components)
  const layout = buildLayout(input)
  const hasVariableResistor = input.components.some((entry) => entry.type === 'variable_resistor')
  const duration = hasVariableResistor ? CIRCUIT_SWEEP_DURATION_SECONDS : 0

  const circuit: Circuit = {
    id: circuitId,
    type: 'circuit',
    nodes,
    components: input.components.map(toComponent),
    connections,
    ...(layout === undefined ? {} : { metadata: { layout } }),
  }

  const ammeterId = firstIdOfType(input.components, 'ammeter')
  const voltmeterId = firstIdOfType(input.components, 'voltmeter')
  const sourceId = firstIdOfType(input.components, 'voltage_source')

  return {
    schemaVersion: 'physics-scene/1.0',
    id: asSceneId(sceneId),
    revision: input.revision ?? 0,
    dimension: '2d',
    coordinateSystem: defaultCoordinateSystem(),
    timeline: {
      currentTime: quantity(0, 's', 'time'),
      startTime: quantity(0, 's', 'time'),
      endTime: quantity(duration, 's', 'time'),
      state: 'idle',
      playbackRate: 1,
      ...(hasVariableResistor ? { simulationTimeStep: quantity(1 / 60, 's', 'time') } : {}),
    },
    bodies: [],
    particles: [],
    fields: [],
    forces: [],
    regions: [],
    boundaries: [],
    constraints: [],
    circuits: [circuit],
    opticalBenches: [],
    acousticBenches: [],
    fluidTanks: [],
    thermalBenches: [],
    leverBenches: [],
    measurementDefinitions: [],
    observableDefinitions: [
      {
        id: observableId('current'),
        type: 'current',
        targetId: ammeterId ?? circuitId,
        visible: visibility.current ?? true,
      },
      {
        id: observableId('voltage'),
        type: 'voltage',
        targetId: voltmeterId ?? sourceId ?? circuitId,
        visible: visibility.voltage ?? true,
      },
      {
        id: observableId('power'),
        type: 'energy',
        targetId: sourceId ?? circuitId,
        visible: visibility.power ?? true,
      },
      {
        id: observableId('graph'),
        type: 'graph',
        targetId: circuitId,
        visible: visibility.graph ?? hasVariableResistor,
      },
    ],
    annotations: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      title: input.title ?? '直流动态电路',
      description: input.description ?? 'Circuit Engine · 直流稳态电路（MNA 求解）',
    },
  }
}

/* ------------------------------------------------------------ accessors -- */

/**
 * Half the schematic symbol length in grid units. Terminal endpoints sit this
 * far from the symbol centre along the rotated local axis; template wire
 * waypoints and the renderer share this single constant.
 */
export const CIRCUIT_SYMBOL_HALF_LENGTH = 0.75

/** Unit vector of the symbol's local axis for a placement rotation. */
export const circuitRotationVector = (
  rotation: CircuitComponentPlacement['rotation'],
): { x: number; y: number } => {
  switch (rotation ?? 0) {
    case 0:
      return { x: 1, y: 0 }
    case 90:
      return { x: 0, y: 1 }
    case 180:
      return { x: -1, y: 0 }
    case 270:
      return { x: 0, y: -1 }
  }
}

/**
 * Grid position of a component terminal. `a`/`negative` sits at the axis tail,
 * `b`/`positive` at the head.
 */
export const circuitTerminalPoint = (
  placement: CircuitComponentPlacement,
  terminalKey: string,
): { x: number; y: number } => {
  const direction = circuitRotationVector(placement.rotation)
  const sign = terminalKey === 'a' || terminalKey === 'negative' ? -1 : 1
  return {
    x: placement.x + sign * CIRCUIT_SYMBOL_HALF_LENGTH * direction.x,
    y: placement.y + sign * CIRCUIT_SYMBOL_HALF_LENGTH * direction.y,
  }
}

/** The single circuit of a circuit scene, if present. */
export const circuitOf = (scene: PhysicsScene): Circuit | undefined => scene.circuits[0]

/** True when the scene is a pure single-circuit scene (no motion objects). */
export const isCircuitScene = (scene: PhysicsScene): boolean =>
  scene.circuits.length === 1 &&
  scene.particles.length === 0 &&
  scene.bodies.length === 0 &&
  scene.fields.length === 0 &&
  (scene.opticalBenches ?? []).length === 0 &&
  (scene.acousticBenches ?? []).length === 0 &&
  (scene.fluidTanks ?? []).length === 0 &&
  (scene.thermalBenches ?? []).length === 0 &&
  (scene.leverBenches ?? []).length === 0

const isPlacement = (value: unknown): value is CircuitComponentPlacement => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { x?: unknown; y?: unknown }
  return typeof candidate.x === 'number' && typeof candidate.y === 'number'
}

/** Typed reader for the presentation layout stored in circuit metadata. */
export const circuitLayoutOf = (circuit: Circuit): CircuitLayout | undefined => {
  const layout = circuit.metadata?.['layout']
  if (typeof layout !== 'object' || layout === null) return undefined
  const candidate = layout as { components?: unknown; wires?: unknown }
  if (typeof candidate.components !== 'object' || candidate.components === null) return undefined
  for (const placement of Object.values(candidate.components)) {
    if (!isPlacement(placement)) return undefined
  }
  return layout as CircuitLayout
}

/** Squared-distance under which two schematic points count as identical. */
const POINT_EPSILON = 1e-6

const samePoint = (
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): boolean => Math.abs(a.x - b.x) < POINT_EPSILON && Math.abs(a.y - b.y) < POINT_EPSILON

/**
 * Re-route one wire after an endpoint moved, treating it like a physical wire:
 * the bends nearest the UNMOVED terminal keep their shape, and only the run
 * that reaches the moved terminal stretches. The stretch lands on the old
 * spine line — a wire that left its part horizontally keeps leaving
 * horizontally — so the loop stays rectilinear instead of collapsing into a
 * diagonal-looking slash across the schematic.
 *
 * `oldFrom`/`oldTo` are the terminal points before the move; `newFrom`/`newTo`
 * after. `fromMoved`/`toMoved` say which end's component moved (both is the
 * degenerate self-loop case — drop the shape and take the plain elbow).
 */
const rerouteWire = (input: {
  readonly oldFrom: { readonly x: number; readonly y: number }
  readonly oldTo: { readonly x: number; readonly y: number }
  readonly newFrom: { readonly x: number; readonly y: number }
  readonly newTo: { readonly x: number; readonly y: number }
  readonly waypoints: readonly { x: number; y: number }[]
  readonly fromMoved: boolean
  readonly toMoved: boolean
}): { x: number; y: number }[] => {
  const { oldFrom, oldTo, newFrom, newTo, waypoints, fromMoved, toMoved } = input
  if (fromMoved === toMoved) return []
  /* The old route may have skipped explicit waypoints entirely — infer the
     habit from the straight run so the elbow still follows the old line. */
  if (waypoints.length === 0) {
    const horizontal = Math.abs(oldFrom.y - oldTo.y) < POINT_EPSILON
    const vertical = Math.abs(oldFrom.x - oldTo.x) < POINT_EPSILON
    if (!horizontal && !vertical) return []
    /* Keep the unmoved end's approach line: a wire that ran vertically keeps
       running vertically (V-first elbow); horizontal likewise (the default
       H-first elbow needs no stored waypoint). */
    return vertical ? [{ x: newFrom.x, y: newTo.y }] : []
  }
  const head = waypoints[0]
  const tail = waypoints[waypoints.length - 1]
  if (head === undefined || tail === undefined) return []
  if (fromMoved) {
    /* Old first run oldFrom→head: horizontal means the wire hugged the line
       y=head.y, vertical means the column x=head.x. Bridge the new terminal
       onto that same spine, then keep every surviving bend. */
    const horizontal = Math.abs(oldFrom.y - head.y) < POINT_EPSILON
    const bridge = horizontal ? { x: newFrom.x, y: head.y } : { x: head.x, y: newFrom.y }
    if (samePoint(newFrom, head) || samePoint(bridge, newFrom) || samePoint(bridge, head)) {
      return [...waypoints]
    }
    return [bridge, ...waypoints]
  }
  const horizontal = Math.abs(tail.y - oldTo.y) < POINT_EPSILON
  const bridge = horizontal ? { x: newTo.x, y: tail.y } : { x: tail.x, y: newTo.y }
  if (samePoint(newTo, tail) || samePoint(bridge, newTo) || samePoint(bridge, tail)) {
    return [...waypoints]
  }
  return [...waypoints, bridge]
}

/**
 * Write one component's schematic placement into `circuit.metadata.layout`.
 *
 * Wires touching the moved component re-derive their waypoints via
 * {@link rerouteWire}: the unmoved side keeps its bends, the moved side
 * stretches onto the old spine line. An omitted rotation keeps the previous
 * one. Presentation only: the solver reads the netlist, never the layout.
 */
export const circuitLayoutPlace = (
  circuit: Circuit,
  componentId: string,
  placement: { readonly x: number; readonly y: number; readonly rotation?: 0 | 90 | 180 | 270 },
): void => {
  const existing = circuitLayoutOf(circuit)
  const previous = existing?.components[componentId]
  const rotation = placement.rotation ?? previous?.rotation
  const next: CircuitComponentPlacement = {
    x: placement.x,
    y: placement.y,
    ...(rotation === undefined ? {} : { rotation }),
  }
  const components: Record<string, CircuitComponentPlacement> = {
    ...(existing?.components ?? {}),
    [componentId]: next,
  }
  const wires: Record<string, readonly { x: number; y: number }[]> = {
    ...(existing?.wires ?? {}),
  }
  for (const connection of circuit.connections) {
    const fromMoved = String(connection.from.componentId) === componentId
    const toMoved = String(connection.to.componentId) === componentId
    if (!fromMoved && !toMoved) continue
    const fromPlacement = existing?.components[String(connection.from.componentId)]
    const toPlacement = existing?.components[String(connection.to.componentId)]
    if (fromPlacement === undefined || toPlacement === undefined) continue
    const oldFrom = circuitTerminalPoint(fromPlacement, connection.from.terminalKey)
    const oldTo = circuitTerminalPoint(toPlacement, connection.to.terminalKey)
    const derived = rerouteWire({
      oldFrom,
      oldTo,
      newFrom: fromMoved ? circuitTerminalPoint(next, connection.from.terminalKey) : oldFrom,
      newTo: toMoved ? circuitTerminalPoint(next, connection.to.terminalKey) : oldTo,
      waypoints: existing?.wires?.[connection.id] ?? [],
      fromMoved,
      toMoved,
    })
    if (derived.length === 0) delete wires[connection.id]
    else wires[connection.id] = derived
  }
  circuit.metadata = {
    ...(circuit.metadata ?? {}),
    layout: {
      components,
      ...(Object.keys(wires).length === 0 ? {} : { wires }),
    } satisfies CircuitLayout,
  }
}

/** Terminal keys a component exposes, by contract. */
export const terminalKeysOf = (component: CircuitComponent): readonly string[] =>
  component.type === 'voltage_source' ? SOURCE_TERMINAL_KEYS : TWO_TERMINAL_KEYS

/** Find a component inside a circuit by id. */
export const circuitComponentOf = (
  circuit: Circuit,
  componentId: string,
): CircuitComponent | undefined =>
  circuit.components.find((entry) => String(entry.id) === componentId)

/** All variable resistors of a circuit, in authoring order. */
export const variableResistorsOf = (circuit: Circuit): VariableResistor[] =>
  circuit.components.filter(
    (entry): entry is VariableResistor => entry.type === 'variable_resistor',
  )
