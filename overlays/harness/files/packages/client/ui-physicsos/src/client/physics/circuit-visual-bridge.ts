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
  type ObservableDefinition,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { emptyVisualModel } from './scene-visual-model.ts'
import type {
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

export const fmtQuantityValue = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  /* Below any pedagogically meaningful magnitude sits Gaussian-elimination
     noise (an open circuit solves to ~1e-16 A, not exactly 0); showing it as
     an exponential would claim precision the solve does not have. */
  if (absolute < NO_CURRENT_AMPS) return '0'
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
): CircuitComponentVisual | undefined => {
  const kind = kindOf(component)
  if (kind === undefined) return undefined
  const id = String(component.id)
  const label = component.name ?? id
  const nameplate = nameplateOf(component)
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

  return {
    id,
    kind,
    at: { x: placement.x, y: placement.y },
    rotation: placement.rotation ?? 0,
    label,
    ...(nameplate === undefined ? {} : { value: nameplate }),
    ...(reading === undefined ? {} : { reading }),
    ...(showsVoltage ? { voltageText: `U=${fmtQuantityValue(voltage)} V` } : {}),
    ...(showsPower ? { powerText: `P=${fmtQuantityValue(power)} W` } : {}),
    ...(showsCurrent
      ? {
        currentText: `I=${fmtQuantityValue(Math.abs(current))} A`,
        currentDirection: current >= 0 ? 'forward' as const : 'reverse' as const,
      }
      : {}),
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

/** Dots where ≥2 connections share one physical terminal (a T-joint). */
const junctionsOf = (
  circuit: Circuit,
  placements: ReadonlyMap<string, CircuitComponentPlacement>,
): readonly CircuitJunctionVisual[] => {
  const degree = new Map<string, number>()
  for (const connection of circuit.connections) {
    degree.set(connection.from.id, (degree.get(connection.from.id) ?? 0) + 1)
    degree.set(connection.to.id, (degree.get(connection.to.id) ?? 0) + 1)
  }
  const junctions: CircuitJunctionVisual[] = []
  for (const component of circuit.components) {
    const placement = placements.get(String(component.id))
    if (placement === undefined) continue
    for (const terminalKey of terminalKeysOf(component)) {
      const terminalId = `${String(component.id)}.${terminalKey}`
      if ((degree.get(terminalId) ?? 0) < 2) continue
      junctions.push({
        id: `junction-${terminalId}`,
        at: circuitTerminalPoint(placement, terminalKey),
      })
    }
  }
  return junctions
}

export interface CircuitVisualInput {
  readonly scene: PhysicsScene
  /** Solved operating point at the frame being drawn. */
  readonly point: CircuitOperatingPoint
  /** Scene time in seconds; positions the rheostat slider on a sweep. */
  readonly time: number
}

/** Build the one visual frame the circuit renderer consumes. */
export const circuitSceneVisualAt = (
  { scene, point, time }: CircuitVisualInput,
): SceneVisualModel => {
  const circuit = circuitOf(scene)
  if (circuit === undefined) return emptyVisualModel('circuit')

  const placements = placementsOf(circuit)
  const operatingOf = new Map(point.components.map(entry => [entry.componentId, entry]))
  const sweep = { time, duration: point.model.sweepDuration }

  const components: CircuitComponentVisual[] = []
  for (const component of circuit.components) {
    const placement = placements.get(String(component.id))
    if (placement === undefined) continue
    const visual = componentVisualOf(
      component,
      placement,
      operatingOf.get(String(component.id)),
      sweep,
    )
    if (visual !== undefined) components.push(visual)
  }
  const wires = wiresOf(circuit, placements)
  const junctions = junctionsOf(circuit, placements)

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
  const pad = 2.4
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad

  const readout = [
    `E = ${fmtQuantityValue(point.emf)} V`,
    `I = ${fmtQuantityValue(point.mainCurrent)} A`,
    `U = ${fmtQuantityValue(point.terminalVoltage)} V`,
    `P = ${fmtQuantityValue(point.emf * point.mainCurrent)} W`,
  ]

  return emptyVisualModel('circuit', {
    extent: { width: maxX - minX, height: maxY - minY },
    origin: { x: minX, y: minY },
    grid: { minor: 1, major: 5 },
    axes: { x: '', y: '' },
    circuitComponents: components,
    circuitWires: wires,
    circuitJunctions: junctions,
    overlay: { readout, scale: { label: '1', length: 1 } },
    visible: visibilityOf(scene),
  })
}
