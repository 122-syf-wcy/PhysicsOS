/**
 * Free-build circuit authoring model.
 *
 * The scene format is already a netlist: every component names the net each of
 * its terminals attaches to, and the DC engine solves whatever topology comes
 * out. So building a circuit by hand needs no new solver and no new scene
 * commands — it needs a draft the student can edit, and a pure projection from
 * that draft onto `createCircuitScene`.
 *
 * Everything here is a pure function over an immutable draft. The UI owns the
 * history stack; this module owns what an edit means.
 *
 * Terminal geometry, rendering and solving are deliberately absent: the draft
 * is a netlist, and the existing scene → runtime → canvas chain does the rest.
 */

import { canonicalValue } from '@physicsos/physics-units'
import {
  circuitLayoutOf,
  circuitOf,
  createCircuitScene,
  type Circuit,
  type CircuitComponent,
  type CircuitComponentSpec,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import type { ScenePoint } from './scene-visual-model.ts'

/** Component kinds the palette offers — exactly what the DC engine models. */
export type BuilderComponentType = CircuitComponentSpec['type']

/** Whether a scene's component kind is one the bench can build. */
const isBuilderType = (type: CircuitComponent['type']): type is BuilderComponentType =>
  (BUILDER_COMPONENT_TYPES as readonly string[]).includes(type)

/** Terminal keys per kind; sources name their polarity instead of a/b. */
export const terminalKeysOf = (type: BuilderComponentType): readonly string[] =>
  type === 'voltage_source' ? ['positive', 'negative'] : ['a', 'b']

/** Component kinds the engine can actually solve, in palette order. */
export const BUILDER_COMPONENT_TYPES: readonly BuilderComponentType[] = [
  'voltage_source',
  'switch',
  'resistor',
  'variable_resistor',
  'ammeter',
  'voltmeter',
]

/** Grid step the schematic snaps to, in scene units. */
export const BUILDER_GRID = 0.5

/** Scene id every free build shares, so the bench resumes as one space. */
export const FREE_BUILD_SCENE_ID = 'circuit-free-build'

/** A net number, allocated monotonically so a deleted net is never reused. */
export type NetId = number

/** Points at one terminal of one drafted component. */
export interface TerminalRef {
  readonly componentId: string
  readonly terminalKey: string
}

/** Parameters a component carries; which ones apply depends on its type. */
export interface BuilderParams {
  /** Ohms — `resistor`. */
  readonly resistance?: number
  /** Volts (EMF) — `voltage_source`. */
  readonly voltage?: number
  /** Ohms — `voltage_source`, `ammeter`, `voltmeter`; omitted means ideal. */
  readonly internalResistance?: number
  /** `switch`. */
  readonly state?: 'open' | 'closed'
  /** Ohms at slider position 1 — `variable_resistor`. */
  readonly totalResistance?: number
  /** 0..1 — `variable_resistor`. */
  readonly sliderPosition?: number
}

/** One drafted component: its nets, its parameters, where it sits. */
export interface BuilderComponent {
  readonly id: string
  readonly type: BuilderComponentType
  /** Net per terminal key; terminals sharing a net are wired together. */
  readonly nets: Readonly<Record<string, NetId>>
  readonly placement: {
    readonly x: number
    readonly y: number
    readonly rotation: 0 | 90 | 180 | 270
  }
  readonly params: BuilderParams
}

/** The whole assembly, before it is projected onto a scene. */
export interface CircuitDraft {
  readonly components: readonly BuilderComponent[]
  readonly title: string
  readonly description: string
  /** Next net number to hand out. */
  readonly nextNet: NetId
}

/* ------------------------------------------------------------- defaults -- */

const DEFAULT_PARAMS: Readonly<Record<BuilderComponentType, BuilderParams>> = {
  voltage_source: { voltage: 6, internalResistance: 0 },
  switch: { state: 'closed' },
  resistor: { resistance: 10 },
  variable_resistor: { totalResistance: 20, sliderPosition: 0.5 },
  ammeter: { internalResistance: 0 },
  voltmeter: {},
}

/** The single voltage source the engine requires, kept identifiable. */
const SOURCE_ID = 'bat'

/**
 * Id prefix per kind. The physics tutor addresses parts by name
 * (`physics-agent.ts` aliases `bat`/`am`/`vm`/`sw`/`rv`/`r0…`), so a built
 * circuit uses the same vocabulary instead of opaque generated ids.
 */
const ID_PREFIX: Readonly<Record<BuilderComponentType, string>> = {
  voltage_source: 'bat',
  switch: 'sw',
  ammeter: 'am',
  voltmeter: 'vm',
  variable_resistor: 'rv',
  resistor: 'r',
}

const isTaken = (draft: CircuitDraft, id: string): boolean =>
  draft.components.some(component => component.id === id)

/** Next free id for a kind, following the tutor's naming convention. */
const nextId = (draft: CircuitDraft, type: BuilderComponentType): string => {
  const prefix = ID_PREFIX[type]
  /* Resistors are numbered from r0 so the tutor's /^r\d*$/ alias keeps matching. */
  for (let index = 0; ; index += 1) {
    const candidate =
      type === 'resistor' ? `r${index}` : index === 0 ? prefix : `${prefix}${index + 1}`
    if (!isTaken(draft, candidate)) return candidate
  }
}

/** Snap a free placement onto the schematic grid. */
export const snapToGrid = (point: ScenePoint): { x: number; y: number } => ({
  x: Math.round(point.x / BUILDER_GRID) * BUILDER_GRID,
  y: Math.round(point.y / BUILDER_GRID) * BUILDER_GRID,
})

/* --------------------------------------------------------------- palette -- */

/**
 * One item on the parts shelf: an engine component kind plus the rating the
 * bench hands you.
 *
 * The engine models exactly six DC element kinds, so "more equipment" is more
 * *rated items* rather than more physics — a 1.5 V cell and a 12 V supply are
 * the same element at different nameplate values, which is also how a real
 * school kit is organised. Which photographed part a shelf item draws is decided
 * by `spriteIdFor` from the same numbers, so the shelf and the canvas agree.
 */
export interface BuilderPartSpec {
  /** Stable key for tests and locale lookup. */
  readonly id: string
  readonly type: BuilderComponentType
  readonly params: BuilderParams
}

/** The shelf, grouped in the order a student builds: source, control, load, meters. */
export const BUILDER_PARTS: readonly BuilderPartSpec[] = [
  { id: 'battery-1.5', type: 'voltage_source', params: { voltage: 1.5, internalResistance: 0 } },
  { id: 'battery-6', type: 'voltage_source', params: { voltage: 6, internalResistance: 0 } },
  { id: 'supply-12', type: 'voltage_source', params: { voltage: 12, internalResistance: 0 } },
  { id: 'switch', type: 'switch', params: { state: 'closed' } },
  { id: 'resistor-5', type: 'resistor', params: { resistance: 5 } },
  { id: 'resistor-10', type: 'resistor', params: { resistance: 10 } },
  { id: 'resistor-20', type: 'resistor', params: { resistance: 20 } },
  { id: 'resistor-50', type: 'resistor', params: { resistance: 50 } },
  { id: 'rheostat-20', type: 'variable_resistor', params: { totalResistance: 20, sliderPosition: 0.5 } },
  { id: 'rheostat-50', type: 'variable_resistor', params: { totalResistance: 50, sliderPosition: 0.5 } },
  { id: 'ammeter', type: 'ammeter', params: { internalResistance: 0 } },
  { id: 'voltmeter', type: 'voltmeter', params: {} },
]

/** Place a catalogued part. The rating travels with the item, not the kind. */
export const addPart = (
  draft: CircuitDraft,
  part: BuilderPartSpec,
  at: ScenePoint = { x: 0, y: 0 },
): { draft: CircuitDraft; componentId: string } =>
  addComponent(draft, part.type, at, part.params)

/* --------------------------------------------------------------- edits -- */

/** An empty bench: valid to render, but nothing to solve. */
export const emptyDraft = (): CircuitDraft => ({
  components: [],
  title: '自由搭建电路',
  description: '自己选器材、自己接线。',
  nextNet: 1,
})

/**
 * Allocate a fresh net per terminal. A component starts unwired: its terminals
 * sit on nets of their own, so placing a part never silently shorts it to a
 * neighbour.
 */
const wireNetsFor = (
  type: BuilderComponentType,
  nextNet: NetId,
): { nets: Record<string, NetId>; nextNet: NetId } => {
  const nets: Record<string, NetId> = {}
  let cursor = nextNet
  for (const key of terminalKeysOf(type)) {
    nets[key] = cursor
    cursor += 1
  }
  return { nets, nextNet: cursor }
}

/** Place a new component at a point. Returns the draft and the id it took. */
export const addComponent = (
  draft: CircuitDraft,
  type: BuilderComponentType,
  at: ScenePoint = { x: 0, y: 0 },
  params?: BuilderParams,
): { draft: CircuitDraft; componentId: string } => {
  const id = nextId(draft, type)
  const { nets, nextNet } = wireNetsFor(type, draft.nextNet)
  const component: BuilderComponent = {
    id,
    type,
    nets,
    placement: { ...snapToGrid(at), rotation: 0 },
    params: params ?? DEFAULT_PARAMS[type],
  }
  return {
    draft: { ...draft, components: [...draft.components, component], nextNet },
    componentId: id,
  }
}

/** Drop a component. Its nets die with it; survivors keep theirs. */
export const removeComponent = (draft: CircuitDraft, id: string): CircuitDraft => ({
  ...draft,
  components: draft.components.filter(component => component.id !== id),
})

const update = (
  draft: CircuitDraft,
  id: string,
  change: (component: BuilderComponent) => BuilderComponent,
): CircuitDraft => ({
  ...draft,
  components: draft.components.map(component =>
    component.id === id ? change(component) : component,
  ),
})

/** Move a component to a snapped point. */
export const moveComponent = (draft: CircuitDraft, id: string, at: ScenePoint): CircuitDraft =>
  update(draft, id, component => ({
    ...component,
    placement: { ...component.placement, ...snapToGrid(at) },
  }))

/** Turn a component a quarter turn clockwise. */
export const rotateComponent = (draft: CircuitDraft, id: string): CircuitDraft =>
  update(draft, id, (component) => {
    const next = ((component.placement.rotation + 90) % 360) as 0 | 90 | 180 | 270
    return { ...component, placement: { ...component.placement, rotation: next } }
  })

/** Merge in new parameter values. */
export const setParams = (draft: CircuitDraft, id: string, params: BuilderParams): CircuitDraft =>
  update(draft, id, component => ({ ...component, params: { ...component.params, ...params } }))

const netOf = (draft: CircuitDraft, ref: TerminalRef): NetId | undefined =>
  draft.components.find(component => component.id === ref.componentId)?.nets[ref.terminalKey]

/** Every terminal sitting on a net, so a merge can rename them all. */
const terminalsOn = (draft: CircuitDraft, net: NetId): TerminalRef[] =>
  draft.components.flatMap(component =>
    Object.entries(component.nets)
      .filter(([, value]) => value === net)
      .map(([terminalKey]) => ({ componentId: component.id, terminalKey })),
  )

/**
 * Wire two terminals together by putting them on one net.
 *
 * Merging (rather than storing a wire object) is what the scene format wants:
 * a connection is nothing but two terminals naming the same net, so joining two
 * nets joins every terminal that was already on either of them — which is what
 * a student expects when they clip a lead onto a node that already has wires.
 */
export const connectTerminals = (
  draft: CircuitDraft,
  from: TerminalRef,
  to: TerminalRef,
): CircuitDraft => {
  if (from.componentId === to.componentId && from.terminalKey === to.terminalKey) return draft
  const fromNet = netOf(draft, from)
  const toNet = netOf(draft, to)
  if (fromNet === undefined || toNet === undefined || fromNet === toNet) return draft

  return {
    ...draft,
    components: draft.components.map((component) => {
      const nets = Object.fromEntries(
        Object.entries(component.nets).map(([key, value]) => [
          key,
          value === toNet ? fromNet : value,
        ]),
      )
      return { ...component, nets }
    }),
  }
}

/**
 * Take one terminal off its net and give it a net of its own.
 *
 * A lone terminal has nothing to share, so this is a no-op — there is no wire
 * to cut, and splitting it would only churn the draft.
 */
export const disconnectTerminal = (draft: CircuitDraft, ref: TerminalRef): CircuitDraft => {
  const net = netOf(draft, ref)
  if (net === undefined || terminalsOn(draft, net).length < 2) return draft
  const fresh = draft.nextNet
  return {
    ...draft,
    nextNet: fresh + 1,
    components: draft.components.map(component =>
      component.id === ref.componentId
        ? { ...component, nets: { ...component.nets, [ref.terminalKey]: fresh } }
        : component,
    ),
  }
}

/* ------------------------------------------------------------ projection -- */

/**
 * Project the draft onto a scene.
 *
 * No wire waypoints are emitted: the renderer routes each connection as an
 * orthogonal elbow between its two terminal endpoints, and junction dots come
 * from the net topology, so electrical meaning survives an untidy route.
 */
export const draftToScene = (
  draft: CircuitDraft,
  options: { readonly sceneId?: string; readonly revision?: number } = {},
): PhysicsScene => {
  const components = draft.components.map((component): CircuitComponentSpec => {
    const terminals = Object.fromEntries(
      terminalKeysOf(component.type).map(key => [key, `n${String(component.nets[key] ?? 0)}`]),
    )
    const base = {
      id: component.id,
      layout: {
        x: component.placement.x,
        y: component.placement.y,
        rotation: component.placement.rotation,
      },
      terminals,
    }
    switch (component.type) {
      case 'voltage_source':
        return {
          ...base,
          type: 'voltage_source',
          voltage: component.params.voltage ?? 6,
          ...(component.params.internalResistance === undefined
            ? {}
            : { internalResistance: component.params.internalResistance }),
          terminals: terminals as { positive: string; negative: string },
        }
      case 'switch':
        return {
          ...base,
          type: 'switch',
          state: component.params.state ?? 'closed',
          terminals: terminals as { a: string; b: string },
        }
      case 'resistor':
        return {
          ...base,
          type: 'resistor',
          resistance: component.params.resistance ?? 10,
          terminals: terminals as { a: string; b: string },
        }
      case 'variable_resistor':
        return {
          ...base,
          type: 'variable_resistor',
          totalResistance: component.params.totalResistance ?? 20,
          sliderPosition: component.params.sliderPosition ?? 0.5,
          terminals: terminals as { a: string; b: string },
        }
      case 'ammeter':
        return {
          ...base,
          type: 'ammeter',
          ...(component.params.internalResistance === undefined
            ? {}
            : { internalResistance: component.params.internalResistance }),
          terminals: terminals as { a: string; b: string },
        }
      case 'voltmeter':
        return {
          ...base,
          type: 'voltmeter',
          ...(component.params.internalResistance === undefined
            ? {}
            : { internalResistance: component.params.internalResistance }),
          terminals: terminals as { a: string; b: string },
        }
    }
  })

  return createCircuitScene({
    sceneId: options.sceneId ?? FREE_BUILD_SCENE_ID,
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    components,
    title: draft.title,
    description: draft.description,
  })
}

/* -------------------------------------------------------------- history -- */

/** Undo stack over drafts. The UI holds one of these next to the live draft. */
export interface DraftHistory {
  readonly past: readonly CircuitDraft[]
  readonly present: CircuitDraft
  readonly future: readonly CircuitDraft[]
}

const HISTORY_LIMIT = 50

export const beginHistory = (draft: CircuitDraft): DraftHistory => ({
  past: [],
  present: draft,
  future: [],
})

/** Record an edit. A no-op edit (same object) does not consume a history slot. */
export const commit = (history: DraftHistory, next: CircuitDraft): DraftHistory => {
  if (next === history.present) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  }
}

export const canUndo = (history: DraftHistory): boolean => history.past.length > 0
export const canRedo = (history: DraftHistory): boolean => history.future.length > 0

export const undo = (history: DraftHistory): DraftHistory => {
  const previous = history.past[history.past.length - 1]
  if (previous === undefined) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export const redo = (history: DraftHistory): DraftHistory => {
  const [next, ...rest] = history.future
  if (next === undefined) return history
  return { past: [...history.past, history.present], present: next, future: rest }
}

/* --------------------------------------------------------------- inverse -- */

/**
 * Read a draft back out of a solved scene.
 *
 * The scene is the single source of truth: the student's own gestures, the
 * inspector's parameter edits and the AI tutor's commands all land there, so
 * deriving the draft on demand keeps the bench from holding a second copy that
 * can drift. Nets are recovered by joining the terminals each connection
 * bridges; net numbers are handed out in a stable order so repeated reads of
 * an unchanged scene produce an identical draft.
 */
export const draftFromScene = (scene: PhysicsScene): CircuitDraft => {
  const circuit = circuitOf(scene)
  if (circuit === undefined) return emptyDraft()

  const parent = new Map<string, string>()
  const key = (componentId: string, terminalKey: string): string => `${componentId} ${terminalKey}`
  const find = (node: string): string => {
    let root = node
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string
    }
    return root
  }
  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }

  const components: BuilderComponent[] = []
  for (const component of circuit.components) {
    const type = component.type
    /* Capacitors and inductors are outside what the palette builds and outside
       what the DC engine solves, so a scene carrying one is not a draft. */
    if (!isBuilderType(type)) return emptyDraft()
    const terminals = terminalKeysOf(type)
    for (const terminalKey of terminals)
      parent.set(key(String(component.id), terminalKey), key(String(component.id), terminalKey))
    components.push({
      id: String(component.id),
      type,
      nets: Object.fromEntries(terminals.map(terminalKey => [terminalKey, 0])),
      placement: placementOf(circuit, String(component.id)),
      params: paramsOf(component),
    })
  }
  for (const connection of circuit.connections) {
    union(
      key(String(connection.from.componentId), connection.from.terminalKey),
      key(String(connection.to.componentId), connection.to.terminalKey),
    )
  }

  /* Number the nets in component-then-terminal order: deterministic, and
     independent of how the scene happened to order its connections. */
  const netOf = new Map<string, NetId>()
  let cursor = 1
  const numbered = components.map((component) => {
    const nets: Record<string, NetId> = {}
    for (const terminalKey of terminalKeysOf(component.type)) {
      const root = find(key(component.id, terminalKey))
      const existing = netOf.get(root)
      const net = existing ?? cursor
      if (existing === undefined) {
        netOf.set(root, cursor)
        cursor += 1
      }
      nets[terminalKey] = net
    }
    return { ...component, nets }
  })

  return {
    components: numbered,
    title: scene.metadata.title ?? '自由搭建电路',
    description: scene.metadata.description ?? '自己选器材、自己接线。',
    nextNet: cursor,
  }
}

const placementOf = (circuit: Circuit, componentId: string): BuilderComponent['placement'] => {
  const layout = circuitLayoutOf(circuit)?.components[componentId]
  return {
    x: layout?.x ?? 0,
    y: layout?.y ?? 0,
    rotation: layout?.rotation ?? 0,
  }
}

const paramsOf = (component: CircuitComponent): BuilderParams => {
  switch (component.type) {
    case 'resistor':
      return { resistance: canonicalValue(component.resistance) }
    case 'voltage_source':
      return {
        voltage: canonicalValue(component.voltage),
        ...(component.internalResistance === undefined
          ? {}
          : { internalResistance: canonicalValue(component.internalResistance) }),
      }
    case 'switch':
      return { state: component.state }
    case 'variable_resistor':
      return {
        totalResistance: canonicalValue(component.totalResistance),
        sliderPosition: component.sliderPosition,
      }
    case 'ammeter':
    case 'voltmeter':
      return component.internalResistance === undefined
        ? {}
        : { internalResistance: canonicalValue(component.internalResistance) }
    default:
      return {}
  }
}

/* -------------------------------------------------------------- starter -- */

/**
 * The bench a student lands on: the smallest circuit that solves.
 *
 * Opening on a blank grid would greet them with "无唯一解" before they have
 * done anything, so the starter is a real loop with a real reading they can
 * immediately change, take apart, and rebuild.
 */
export const starterDraft = (): CircuitDraft => {
  const components: BuilderComponent[] = [
    {
      id: SOURCE_ID,
      type: 'voltage_source',
      nets: { positive: 1, negative: 4 },
      placement: { x: 0, y: -3, rotation: 0 },
      params: { voltage: 6, internalResistance: 0 },
    },
    {
      id: 'sw',
      type: 'switch',
      nets: { a: 1, b: 2 },
      placement: { x: 5, y: 0, rotation: 90 },
      params: { state: 'closed' },
    },
    {
      id: 'r0',
      type: 'resistor',
      nets: { a: 2, b: 4 },
      placement: { x: -5, y: 0, rotation: 270 },
      params: { resistance: 10 },
    },
  ]
  return {
    components,
    title: '自由搭建电路',
    description: '从电源出发，自己接线组成回路。',
    nextNet: 5,
  }
}
