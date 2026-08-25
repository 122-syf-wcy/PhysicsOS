import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import {
  createCircuitScene,
  type CircuitComponentSpec,
  type CircuitObservableKey,
} from './circuit-scene.ts'

/**
 * Circuit experiment templates.
 *
 * Each factory authors a netlist plus a hand-laid schematic: components sit on
 * a rectangular loop (grid units, y up), and wires that turn a corner carry
 * explicit waypoints. The layout is presentation-only metadata — the engine
 * reads nothing but the netlist.
 *
 * Symbol geometry convention shared with the renderer: every symbol is 1.5
 * grid units long, so terminal endpoints sit 0.75 units from the centre along
 * the rotated local axis.
 */

interface TemplateBaseInput {
  readonly sceneId?: string
  readonly title?: string
  readonly description?: string
  readonly now?: IsoDateTime
  readonly observableVisibility?: Partial<Record<CircuitObservableKey, boolean>>
}

const point = (x: number, y: number) => ({ x, y })

/* -------------------------------------------------------------- series ---- */

export interface SeriesCircuitInput extends TemplateBaseInput {
  /** EMF in volts. */
  readonly voltage?: number
  readonly r1?: number
  readonly r2?: number
  readonly switchClosed?: boolean
}

/** Battery → switch → ammeter → R₁ → R₂ loop, voltmeter across R₂. */
export const createSeriesCircuitScene = (input: SeriesCircuitInput = {}): PhysicsScene => {
  const voltage = input.voltage ?? 6
  const r1 = input.r1 ?? 10
  const r2 = input.r2 ?? 20
  const components: CircuitComponentSpec[] = [
    {
      id: 'bat', type: 'voltage_source', name: 'E', voltage,
      terminals: { positive: 'n1', negative: 'n5' },
      layout: { x: 0, y: -3, rotation: 0 },
    },
    {
      id: 'sw', type: 'switch', name: 'S', state: (input.switchClosed ?? true) ? 'closed' : 'open',
      terminals: { a: 'n1', b: 'n2' },
      layout: { x: 5, y: 0, rotation: 90 },
    },
    {
      id: 'am', type: 'ammeter', name: 'A',
      terminals: { a: 'n2', b: 'n3' },
      layout: { x: 2.5, y: 3, rotation: 180 },
    },
    {
      id: 'r1', type: 'resistor', name: 'R₁', resistance: r1,
      terminals: { a: 'n3', b: 'n4' },
      layout: { x: -1, y: 3, rotation: 180 },
    },
    {
      id: 'r2', type: 'resistor', name: 'R₂', resistance: r2,
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -5, y: 0, rotation: 270 },
    },
    {
      id: 'vm', type: 'voltmeter', name: 'V',
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -3.1, y: 0, rotation: 270 },
    },
  ]
  return createCircuitScene({
    sceneId: input.sceneId ?? 'circuit-series',
    components,
    wires: {
      'conn-n1-0': [point(5, -3)],
      'conn-n2-0': [point(5, 3)],
      'conn-n4-0': [point(-5, 3)],
      'conn-n5-0': [point(-5, -3)],
    },
    title: input.title ?? '串联电路',
    description: input.description ?? '串联分压：电流处处相等，电压按电阻分配。',
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.observableVisibility === undefined
      ? {}
      : { observableVisibility: input.observableVisibility }),
  })
}

/* ------------------------------------------------------------ parallel ---- */

export interface ParallelCircuitInput extends TemplateBaseInput {
  readonly voltage?: number
  readonly r1?: number
  readonly r2?: number
  readonly switchClosed?: boolean
}

/** Battery → switch → main ammeter, then R₁ ∥ R₂ with a voltmeter across the pair. */
export const createParallelCircuitScene = (input: ParallelCircuitInput = {}): PhysicsScene => {
  const voltage = input.voltage ?? 6
  const r1 = input.r1 ?? 10
  const r2 = input.r2 ?? 15
  const components: CircuitComponentSpec[] = [
    {
      id: 'bat', type: 'voltage_source', name: 'E', voltage,
      terminals: { positive: 'n1', negative: 'n3' },
      layout: { x: 0, y: -3, rotation: 0 },
    },
    {
      id: 'sw', type: 'switch', name: 'S', state: (input.switchClosed ?? true) ? 'closed' : 'open',
      terminals: { a: 'n1', b: 'n2' },
      layout: { x: 5, y: 0, rotation: 90 },
    },
    {
      id: 'am', type: 'ammeter', name: 'A',
      terminals: { a: 'n2', b: 'n4' },
      layout: { x: 2.5, y: 3, rotation: 180 },
    },
    {
      id: 'vm', type: 'voltmeter', name: 'V',
      terminals: { a: 'n4', b: 'n3' },
      layout: { x: 0.5, y: 0, rotation: 270 },
    },
    {
      id: 'r1', type: 'resistor', name: 'R₁', resistance: r1,
      terminals: { a: 'n4', b: 'n3' },
      layout: { x: -1.5, y: 0, rotation: 270 },
    },
    {
      id: 'r2', type: 'resistor', name: 'R₂', resistance: r2,
      terminals: { a: 'n4', b: 'n3' },
      layout: { x: -3.5, y: 0, rotation: 270 },
    },
  ]
  return createCircuitScene({
    sceneId: input.sceneId ?? 'circuit-parallel',
    components,
    wires: {
      'conn-n1-0': [point(5, -3)],
      'conn-n2-0': [point(5, 3)],
      /* Top rail n4: ammeter → voltmeter tap → R₁ tap → R₂ tap. */
      'conn-n4-0': [point(0.5, 3)],
      'conn-n4-1': [point(0.5, 3), point(-1.5, 3)],
      'conn-n4-2': [point(-1.5, 3), point(-3.5, 3)],
      /* Bottom rail n3: battery − → voltmeter tap → R₁ tap → R₂ tap. */
      'conn-n3-0': [point(0.5, -3)],
      'conn-n3-1': [point(0.5, -3), point(-1.5, -3)],
      'conn-n3-2': [point(-1.5, -3), point(-3.5, -3)],
    },
    title: input.title ?? '并联电路',
    description: input.description ?? '并联分流：各支路电压相等，电流按电导分配。',
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.observableVisibility === undefined
      ? {}
      : { observableVisibility: input.observableVisibility }),
  })
}

/* --------------------------------------------------------------- mixed ---- */

export interface MixedCircuitInput extends TemplateBaseInput {
  readonly voltage?: number
  readonly r1?: number
  readonly r2?: number
  readonly r3?: number
  readonly switchClosed?: boolean
}

/** R₁ in series with (R₂ ∥ R₃); voltmeter across the parallel pair. */
export const createMixedCircuitScene = (input: MixedCircuitInput = {}): PhysicsScene => {
  const voltage = input.voltage ?? 6
  const r1 = input.r1 ?? 2
  const r2 = input.r2 ?? 6
  const r3 = input.r3 ?? 3
  const components: CircuitComponentSpec[] = [
    {
      id: 'bat', type: 'voltage_source', name: 'E', voltage,
      terminals: { positive: 'n1', negative: 'n5' },
      layout: { x: 0, y: -3, rotation: 0 },
    },
    {
      id: 'sw', type: 'switch', name: 'S', state: (input.switchClosed ?? true) ? 'closed' : 'open',
      terminals: { a: 'n1', b: 'n2' },
      layout: { x: 5, y: 0, rotation: 90 },
    },
    {
      id: 'am', type: 'ammeter', name: 'A',
      terminals: { a: 'n2', b: 'n3' },
      layout: { x: 3, y: 3, rotation: 180 },
    },
    {
      id: 'r1', type: 'resistor', name: 'R₁', resistance: r1,
      terminals: { a: 'n3', b: 'n4' },
      layout: { x: 0.5, y: 3, rotation: 180 },
    },
    {
      id: 'vm', type: 'voltmeter', name: 'V',
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -0.9, y: 0, rotation: 270 },
    },
    {
      id: 'r2', type: 'resistor', name: 'R₂', resistance: r2,
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -2.5, y: 0, rotation: 270 },
    },
    {
      id: 'r3', type: 'resistor', name: 'R₃', resistance: r3,
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -4.5, y: 0, rotation: 270 },
    },
  ]
  return createCircuitScene({
    sceneId: input.sceneId ?? 'circuit-mixed',
    components,
    wires: {
      'conn-n1-0': [point(5, -3)],
      'conn-n2-0': [point(5, 3)],
      'conn-n4-0': [point(-0.9, 3)],
      'conn-n4-1': [point(-0.9, 3), point(-2.5, 3)],
      'conn-n4-2': [point(-2.5, 3), point(-4.5, 3)],
      'conn-n5-0': [point(-0.9, -3)],
      'conn-n5-1': [point(-0.9, -3), point(-2.5, -3)],
      'conn-n5-2': [point(-2.5, -3), point(-4.5, -3)],
    },
    title: input.title ?? '混联电路',
    description: input.description ?? '串并混联：等效电阻逐级化简，干路电流按并联分流。',
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.observableVisibility === undefined
      ? {}
      : { observableVisibility: input.observableVisibility }),
  })
}

/* ------------------------------------------------------------ rheostat ---- */

export interface RheostatCircuitInput extends TemplateBaseInput {
  readonly voltage?: number
  /** Fixed (protection) resistance in ohms. */
  readonly fixedResistance?: number
  /** Rheostat full-scale resistance in ohms. */
  readonly totalResistance?: number
  /** Initial slider position, 0..1. Playback sweeps from here to 1. */
  readonly sliderPosition?: number
  readonly switchClosed?: boolean
}

/** Rheostat in series with a fixed resistor; voltmeter across the fixed resistor. */
export const createRheostatCircuitScene = (input: RheostatCircuitInput = {}): PhysicsScene => {
  const voltage = input.voltage ?? 6
  const fixed = input.fixedResistance ?? 10
  const total = input.totalResistance ?? 20
  const slider = input.sliderPosition ?? 0
  const components: CircuitComponentSpec[] = [
    {
      id: 'bat', type: 'voltage_source', name: 'E', voltage,
      terminals: { positive: 'n1', negative: 'n5' },
      layout: { x: 0, y: -3, rotation: 0 },
    },
    {
      id: 'sw', type: 'switch', name: 'S', state: (input.switchClosed ?? true) ? 'closed' : 'open',
      terminals: { a: 'n1', b: 'n2' },
      layout: { x: 5, y: 0, rotation: 90 },
    },
    {
      id: 'am', type: 'ammeter', name: 'A',
      terminals: { a: 'n2', b: 'n3' },
      layout: { x: 2.5, y: 3, rotation: 180 },
    },
    {
      id: 'rv', type: 'variable_resistor', name: 'R', totalResistance: total, sliderPosition: slider,
      terminals: { a: 'n3', b: 'n4' },
      layout: { x: -1, y: 3, rotation: 180 },
    },
    {
      id: 'r0', type: 'resistor', name: 'R₀', resistance: fixed,
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -5, y: 0, rotation: 270 },
    },
    {
      id: 'vm', type: 'voltmeter', name: 'V',
      terminals: { a: 'n4', b: 'n5' },
      layout: { x: -3.1, y: 0, rotation: 270 },
    },
  ]
  return createCircuitScene({
    sceneId: input.sceneId ?? 'circuit-rheostat',
    components,
    wires: {
      'conn-n1-0': [point(5, -3)],
      'conn-n2-0': [point(5, 3)],
      'conn-n4-0': [point(-5, 3)],
      'conn-n5-0': [point(-5, -3)],
    },
    title: input.title ?? '滑动变阻器调节电流',
    description: input.description ?? '滑片移动改变接入电阻，观察电流表与电压表读数的联动。',
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.observableVisibility === undefined
      ? {}
      : { observableVisibility: input.observableVisibility }),
  })
}

/* ----------------------------------------------------- EMF measurement ---- */

export interface EmfMeasurementInput extends TemplateBaseInput {
  /** EMF in volts. */
  readonly emf?: number
  /** Source internal resistance in ohms. */
  readonly internalResistance?: number
  /** Rheostat full-scale resistance in ohms. */
  readonly totalResistance?: number
  /** Initial slider position, 0..1. */
  readonly sliderPosition?: number
  readonly switchClosed?: boolean
}

/**
 * Classic EMF / internal-resistance measurement: rheostat load, ammeter in the
 * loop, voltmeter across the battery terminals (U = E − I·r).
 */
export const createEmfMeasurementScene = (input: EmfMeasurementInput = {}): PhysicsScene => {
  const emf = input.emf ?? 4.5
  const internal = input.internalResistance ?? 0.5
  const total = input.totalResistance ?? 20
  const slider = input.sliderPosition ?? 0.1
  const components: CircuitComponentSpec[] = [
    {
      id: 'bat', type: 'voltage_source', name: 'E', voltage: emf, internalResistance: internal,
      terminals: { positive: 'n1', negative: 'n4' },
      layout: { x: 0, y: -3, rotation: 0 },
    },
    {
      id: 'vm', type: 'voltmeter', name: 'V',
      terminals: { a: 'n1', b: 'n4' },
      layout: { x: 0, y: -1.4, rotation: 180 },
    },
    {
      id: 'sw', type: 'switch', name: 'S', state: (input.switchClosed ?? true) ? 'closed' : 'open',
      terminals: { a: 'n1', b: 'n2' },
      layout: { x: 5, y: 0, rotation: 90 },
    },
    {
      id: 'am', type: 'ammeter', name: 'A',
      terminals: { a: 'n2', b: 'n3' },
      layout: { x: 2.5, y: 3, rotation: 180 },
    },
    {
      id: 'rv', type: 'variable_resistor', name: 'R', totalResistance: total, sliderPosition: slider,
      terminals: { a: 'n3', b: 'n4' },
      layout: { x: -1.5, y: 3, rotation: 180 },
    },
  ]
  return createCircuitScene({
    sceneId: input.sceneId ?? 'circuit-emf',
    components,
    wires: {
      /* n1: battery + → voltmeter a (straight up), then voltmeter a → switch a
         retracing down to the + terminal and along the bottom rail. */
      'conn-n1-1': [point(0.75, -3), point(5, -3)],
      'conn-n2-0': [point(5, 3)],
      /* n4: battery − → voltmeter b (straight up), then voltmeter b → rheostat b
         retracing down and around the left side. */
      'conn-n4-1': [point(-0.75, -3), point(-5, -3), point(-5, 3)],
    },
    title: input.title ?? '测电源电动势与内阻',
    description: input.description ?? '移动滑片改变负载，U = E − I·r 的伏安关系直接可读。',
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.observableVisibility === undefined
      ? {}
      : { observableVisibility: input.observableVisibility }),
  })
}
