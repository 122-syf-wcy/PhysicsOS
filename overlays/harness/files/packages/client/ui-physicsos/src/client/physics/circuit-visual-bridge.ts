/**
 * Circuit → SceneVisualModel bridge.
 *
 * Projects a verified DC operating point onto the schematic layout stored in
 * `circuit.metadata.layout`. Every number shown on the canvas — meter readings,
 * per-component U/I/P — comes from the engine's solved operating point; this
 * module only places symbols, routes wires and formats strings. It never stamps
 * a branch or solves anything.
 *
 * Geometry convention shared with the scene templates: a symbol is 1.5 grid
 * units long, terminals sit ±{@link CIRCUIT_SYMBOL_HALF_LENGTH} from the centre
 * along the rotated local axis, `a`/`negative` at the tail and `b`/`positive`
 * at the head.
 */

import type {
  CircuitOperatingPoint,
  ComponentOperatingPoint,
} from '@physicsos/engine-circuit'
import { sliderPositionAt } from '@physicsos/engine-circuit'
import { canonicalValue } from '@physicsos/physics-units'
import {
  circuitLayoutOf,
  circuitOf,
  circuitTerminalPoint,
  terminalKeysOf,
  type Circuit,
  type CircuitComponent,
  type CircuitComponentPlacement,
  type CircuitTerminal,
  type ObservableDefinition,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ChargeFlowVisual,
  CircuitComponentVisual,
  CircuitJunctionVisual,
  CircuitSymbolKind,
  CircuitWireVisual,
  ObservableKey,
  ObservableVisibility,
  ScenePoint,
  SceneVisualModel,
} from './scene-visual-model.ts'

/** Currents below this read as "no current" (open branch, voltmeter leak). */
export const NO_CURRENT_AMPS = 1e-9

/** Display floor for formatted readouts: solver residue on near-ideal
    elements (a 0 Ω span, an ideal meter's leak) lands around 1e-7, still far
    below any bench reading. */
const READOUT_NOISE_FLOOR = 1e-6

/** Dissipation below this reads as "no heat" — the lamp halo stays off. */
const LAMP_MIN_WATTS = 1e-9

/** Currents below this never drift beads: meter leaks (~nA) and solve noise. */
const FLOW_MIN_AMPS = 1e-6

export const fmtQuantityValue = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  /* Below any pedagogically meaningful magnitude sits solver residue — an
     open circuit solves to ~1e-16 A and a 0 Ω rheostat drop to ~1e-7 V.
     Showing those as exponentials would claim precision the solve does not
     have, so the readout prints them as 0. */
  if (absolute < READOUT_NOISE_FLOOR) return '0'
  if (absolute < 1e-3 || absolute >= 1e5) return value.toExponential(2)
  return String(Number.parseFloat(value.toPrecision(digits)))
}

/** Scene observable definition → canvas toggle key. `graph` has no canvas layer. */
export const circuitObservableKeyOf = (
  definition: ObservableDefinition,
): ObservableKey | undefined => {
  if (definition.type === 'current') return 'current'
  if (definition.type === 'voltage') return 'voltage'
  if (definition.type === 'energy') return 'power'
  return undefined
}

const visibilityOf = (scene: PhysicsScene): ObservableVisibility => {
  const visible: Partial<Record<ObservableKey, boolean>> = {}
  for (const definition of scene.observableDefinitions) {
    const key = circuitObservableKeyOf(definition)
    if (key !== undefined) visible[key] = definition.visible
  }
  return visible
}

/**
 * Placement per component. Components a scene author left unplaced fall back
 * to a horizontal row, so an agent-built netlist without layout still renders
 * an honest (if plain) schematic instead of a blank canvas.
 */
const placementsOf = (
  circuit: Circuit,
): ReadonlyMap<string, CircuitComponentPlacement> => {
  const layout = circuitLayoutOf(circuit)
  const placements = new Map<string, CircuitComponentPlacement>()
  let fallbackIndex = 0
  for (const component of circuit.components) {
    const id = String(component.id)
    const placed = layout?.components[id]
    if (placed !== undefined) {
      placements.set(id, placed)
      continue
    }
    placements.set(id, { x: fallbackIndex * 2.5, y: 0, rotation: 0 })
    fallbackIndex += 1
  }
  return placements
}

const kindOf = (component: CircuitComponent): CircuitSymbolKind | undefined =>
  component.type === 'resistor' ||
  component.type === 'voltage_source' ||
  component.type === 'switch' ||
  component.type === 'ammeter' ||
  component.type === 'voltmeter' ||
  component.type === 'variable_resistor'
    ? component.type
    : undefined

const ratingOf = (component: CircuitComponent): number | undefined => {
  switch (component.type) {
    case 'resistor':
      return canonicalValue(component.resistance)
    case 'variable_resistor':
      return canonicalValue(component.totalResistance)
    case 'voltage_source':
      return canonicalValue(component.voltage)
    default:
      return undefined
  }
}

const nameplateOf = (component: CircuitComponent): string | undefined => {
  switch (component.type) {
    case 'resistor':
      return `${fmtQuantityValue(canonicalValue(component.resistance))} Ω`
    case 'variable_resistor':
      return `0~${fmtQuantityValue(canonicalValue(component.totalResistance))} Ω`
    case 'voltage_source': {
      const emf = `E=${fmtQuantityValue(canonicalValue(component.voltage))} V`
      const internal = component.internalResistance === undefined
        ? 0
        : canonicalValue(component.internalResistance)
      return internal > 0 ? `${emf} · r=${fmtQuantityValue(internal)} Ω` : emf
    }
    default:
      return undefined
  }
}

const componentVisualOf = (
  component: CircuitComponent,
  placement: CircuitComponentPlacement,
  operating: ComponentOperatingPoint | undefined,
  sweep: { time: number; duration: number },
  lampScale: number,
): CircuitComponentVisual | undefined => {
  const kind = kindOf(component)
  if (kind === undefined) return undefined
  const id = String(component.id)
  const label = component.name ?? id
  const nameplate = nameplateOf(component)
  const rating = ratingOf(component)
  const current = operating?.current ?? 0
  const voltage = operating?.voltage ?? 0
  const power = operating?.power ?? 0
  const conducting = Math.abs(current) > NO_CURRENT_AMPS

  const reading = kind === 'ammeter'
    ? `${fmtQuantityValue(current)} A`
    : kind === 'voltmeter'
      ? `${fmtQuantityValue(voltage)} V`
      : undefined

  /* Loads and the loop instruments carry a current annotation; the voltmeter's
     leak current and the source's internal flow stay off the canvas. */
  const showsCurrent = conducting &&
    (kind === 'resistor' || kind === 'variable_resistor' || kind === 'ammeter' || kind === 'switch')
  /* U/P annotations belong to the elements that drop voltage / convert power. */
  const showsVoltage = kind === 'resistor' || kind === 'variable_resistor' || kind === 'voltage_source'
  const showsPower = kind === 'resistor' || kind === 'variable_resistor'
  /* The dissipating loads double as lamps: the halo is their Joule heat,
     normalized by the brightest dissipation in the frame. No solved power —
     no glow. */
  const lamp = kind === 'resistor' || kind === 'variable_resistor'
  const glow = lamp && operating !== undefined && lampScale > 0 && Number.isFinite(power)
    ? Math.min(1, Math.max(0, Math.abs(power) / lampScale))
    : undefined

  return {
    id,
    kind,
    at: { x: placement.x, y: placement.y },
    rotation: placement.rotation ?? 0,
    label,
    ...(nameplate === undefined ? {} : { value: nameplate }),
    ...(rating === undefined ? {} : { ratingValue: rating }),
    ...(reading === undefined ? {} : { reading }),
    ...(showsVoltage ? { voltageText: `U=${fmtQuantityValue(voltage)} V` } : {}),
    ...(showsPower ? { powerText: `P=${fmtQuantityValue(power)} W` } : {}),
    ...(showsCurrent
      ? {
        currentText: `I=${fmtQuantityValue(Math.abs(current))} A`,
        currentDirection: current >= 0 ? 'forward' as const : 'reverse' as const,
      }
      : {}),
    ...(glow === undefined ? {} : { glow }),
    ...(component.type === 'switch' ? { closed: component.state === 'closed' } : {}),
    ...(component.type === 'variable_resistor'
      ? {
        sliderPosition: sliderPositionAt(component.sliderPosition, sweep.time, sweep.duration),
      }
      : {}),
  }
}

/**
 * Route every connection as a polyline: terminal → authored waypoints →
 * terminal. Without waypoints, endpoints that are not axis-aligned get one
 * orthogonal elbow so wires never cut diagonally through the schematic.
 */
const wiresOf = (
  circuit: Circuit,
  placements: ReadonlyMap<string, CircuitComponentPlacement>,
): readonly CircuitWireVisual[] => {
  const layout = circuitLayoutOf(circuit)
  const wires: CircuitWireVisual[] = []
  for (const connection of circuit.connections) {
    const fromPlacement = placements.get(String(connection.from.componentId))
    const toPlacement = placements.get(String(connection.to.componentId))
    if (fromPlacement === undefined || toPlacement === undefined) continue
    const from = circuitTerminalPoint(fromPlacement, connection.from.terminalKey)
    const to = circuitTerminalPoint(toPlacement, connection.to.terminalKey)
    const waypoints = layout?.wires?.[connection.id] ?? []
    const points: ScenePoint[] = waypoints.length > 0
      ? [from, ...waypoints, to]
      : Math.abs(from.x - to.x) > 1e-9 && Math.abs(from.y - to.y) > 1e-9
        ? [from, { x: to.x, y: from.y }, to]
        : [from, to]
    wires.push({ id: connection.id, points })
  }
  return wires
}

/**
 * Dots where ≥2 connections share one physical terminal (a T-joint).
 *
 * Each dot also reports whether it marks a real BRANCH POINT: connections chain
 * terminals into electrical nets, and a net splits the current only when ≥3
 * power-carrying terminals share it. A voltmeter tap on a series loop draws a
 * dot (three conductors do meet there on paper) but is measurement wiring, so
 * its net counts the meter's leads out — the teaching layer dispatches series
 * vs. parallel on the flag, never on the drawn dots.
 */
const junctionsOf = (
  circuit: Circuit,
  placements: ReadonlyMap<string, CircuitComponentPlacement>,
): readonly CircuitJunctionVisual[] => {
  const degree = new Map<string, number>()
  /* Union-find over terminal ids; connections merge terminals into nets. */
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const next = parent.get(id)
    if (next === undefined || next === id) return id
    const root = find(next)
    parent.set(id, root)
    return root
  }
  for (const connection of circuit.connections) {
    degree.set(connection.from.id, (degree.get(connection.from.id) ?? 0) + 1)
    degree.set(connection.to.id, (degree.get(connection.to.id) ?? 0) + 1)
    const fromRoot = find(connection.from.id)
    const toRoot = find(connection.to.id)
    if (fromRoot !== toRoot) parent.set(fromRoot, toRoot)
  }

  /* Power-carrying terminals per net: voltmeter leads are measurement wiring. */
  const powerTerminals = new Map<string, number>()
  for (const component of circuit.components) {
    if (component.type === 'voltmeter') continue
    for (const terminalKey of terminalKeysOf(component)) {
      const terminalId = `${String(component.id)}.${terminalKey}`
      if (!degree.has(terminalId)) continue
      const net = find(terminalId)
      powerTerminals.set(net, (powerTerminals.get(net) ?? 0) + 1)
    }
  }

  const junctions: CircuitJunctionVisual[] = []
  for (const component of circuit.components) {
    const placement = placements.get(String(component.id))
    if (placement === undefined) continue
    for (const terminalKey of terminalKeysOf(component)) {
      const terminalId = `${String(component.id)}.${terminalKey}`
      if ((degree.get(terminalId) ?? 0) < 2) continue
      const branch = (powerTerminals.get(find(terminalId)) ?? 0) >= 3
      junctions.push({
        id: `junction-${terminalId}`,
        at: circuitTerminalPoint(placement, terminalKey),
        ...(branch ? { branch: true } : {}),
      })
    }
  }
  return junctions
}

/**
 * Current LEAVING a component terminal into its wire, in amperes. The
 * operating point reads a→b for two-terminal parts (current enters `a`,
 * leaves `b`) and discharge-out-of-positive for the source, so the head
 * terminal (`b` / `positive`) always carries +I and the tail −I. A disabled
 * or unsolved component reports nothing.
 */
const terminalOutflow = (
  terminal: CircuitTerminal,
  components: ReadonlyMap<string, CircuitComponent>,
  operatingOf: ReadonlyMap<string, ComponentOperatingPoint>,
): number | undefined => {
  const component = components.get(String(terminal.componentId))
  const operating = operatingOf.get(String(terminal.componentId))
  if (component === undefined || operating === undefined) return undefined
  return terminal.terminalKey === 'b' || terminal.terminalKey === 'positive'
    ? operating.current
    : -operating.current
}

/**
 * One charge-drift run per wire whose current the operating point pins down.
 * A wire touching a degree-1 terminal carries that terminal's whole branch
 * current — series segments resolve at either end, tap chains resolve at the
 * end terminal they feed. A wire between two junction terminals splits its
 * net's current in a way per-component readouts do not divide, so it emits no
 * flow; a segment under the drift floor (voltmeter's nA leak, an open loop)
 * emits none either — the leak stays off the canvas like the annotations do.
 */
const chargeFlowsOf = (
  circuit: Circuit,
  wires: readonly CircuitWireVisual[],
  operatingOf: ReadonlyMap<string, ComponentOperatingPoint>,
): readonly ChargeFlowVisual[] => {
  const degree = new Map<string, number>()
  for (const connection of circuit.connections) {
    degree.set(connection.from.id, (degree.get(connection.from.id) ?? 0) + 1)
    degree.set(connection.to.id, (degree.get(connection.to.id) ?? 0) + 1)
  }
  const components = new Map(circuit.components.map(entry => [String(entry.id), entry]))
  const wireOf = new Map(wires.map(entry => [entry.id, entry]))

  const flows: ChargeFlowVisual[] = []
  for (const connection of circuit.connections) {
    const wire = wireOf.get(connection.id)
    if (wire === undefined) continue
    let current: number | undefined
    if ((degree.get(connection.from.id) ?? 0) === 1) {
      current = terminalOutflow(connection.from, components, operatingOf)
    }
    if (current === undefined && (degree.get(connection.to.id) ?? 0) === 1) {
      const outflow = terminalOutflow(connection.to, components, operatingOf)
      if (outflow !== undefined) current = -outflow
    }
    if (current === undefined || !Number.isFinite(current) || Math.abs(current) <= FLOW_MIN_AMPS) {
      continue
    }
    flows.push({ id: `flow-${connection.id}`, path: wire.points, current })
  }
  return flows
}

export interface CircuitVisualInput {
  readonly scene: PhysicsScene
  /** Solved operating point at the frame being drawn. */
  readonly point: CircuitOperatingPoint
  /** Scene time in seconds; positions the rheostat slider on a sweep. */
  readonly time: number
  /**
   * Pinned viewport. While a component is being dragged the layout's bounding
   * box tracks the pointer — fitting it every move would zoom the canvas under
   * the student's hand. The caller pins the pre-drag frame and the bridge draws
   * the displaced schematic inside it.
   */
  readonly frame?: {
    readonly origin: ScenePoint
    readonly extent: { readonly width: number; readonly height: number }
  }
}

/** Build the one visual frame the circuit renderer consumes. */
export const circuitSceneVisualAt = (
  { scene, point, time, frame }: CircuitVisualInput,
): SceneVisualModel => {
  const circuit = circuitOf(scene)
  if (circuit === undefined) return emptyVisualModel('circuit')

  const placements = placementsOf(circuit)
  const operatingOf = new Map(point.components.map(entry => [entry.componentId, entry]))
  const sweep = { time, duration: point.model.sweepDuration }

  /* The brightest dissipation across the loads is the lamp halo's full
     scale; below the noise floor nothing glows (open loop, dead run). */
  const maxLoadPower = Math.max(
    0,
    ...point.components
      .filter(entry => entry.type === 'resistor' || entry.type === 'variable_resistor')
      .map(entry => Math.abs(entry.power)),
  )
  const lampScale = maxLoadPower > LAMP_MIN_WATTS ? maxLoadPower : 0

  const components: CircuitComponentVisual[] = []
  for (const component of circuit.components) {
    const placement = placements.get(String(component.id))
    if (placement === undefined) continue
    const visual = componentVisualOf(
      component,
      placement,
      operatingOf.get(String(component.id)),
      sweep,
      lampScale,
    )
    if (visual !== undefined) components.push(visual)
  }
  const wires = wiresOf(circuit, placements)
  const junctions = junctionsOf(circuit, placements)
  const chargeFlows = chargeFlowsOf(circuit, wires, operatingOf)

  /* Frame the schematic: bounding box of symbols, terminals and wire bends,
     padded so the perpendicular text rows never clip at the canvas edge. */
  const xs: number[] = []
  const ys: number[] = []
  for (const component of components) {
    xs.push(component.at.x - 1, component.at.x + 1)
    ys.push(component.at.y - 1, component.at.y + 1)
  }
  for (const wire of wires) {
    for (const point_ of wire.points) {
      xs.push(point_.x)
      ys.push(point_.y)
    }
  }
  if (xs.length === 0) {
    xs.push(0)
    ys.push(0)
  }
  const pad = 1.7
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad

  /* Power, labelled by WHICH power. A bare "P" beside U invited the reading
     P = U·I, but E·I is the source's total power — they differ by the internal
     dissipation whenever r > 0. Each line is the engine's own number (or the
     product of the two engine readouts printed directly above it), so the
     balance reads straight off the canvas. */
  const readout = [
    `E = ${fmtQuantityValue(point.emf)} V`,
    `I = ${fmtQuantityValue(point.mainCurrent)} A`,
    `U = ${fmtQuantityValue(point.terminalVoltage)} V`,
    `P总 = E·I = ${fmtQuantityValue(point.emf * point.mainCurrent)} W`,
    `P外 = U·I = ${fmtQuantityValue(point.terminalVoltage * point.mainCurrent)} W`,
    `P内 = I²r = ${fmtQuantityValue(point.internalPower)} W`,
  ]

  return emptyVisualModel('circuit', {
    extent: frame?.extent ?? { width: maxX - minX, height: maxY - minY },
    origin: frame?.origin ?? { x: minX, y: minY },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: '' },
    circuitComponents: components,
    circuitWires: wires,
    circuitJunctions: junctions,
    chargeFlows,
    overlay: { readout, scale: { label: '1', length: 1 } },
    visible: visibilityOf(scene),
  })
}
