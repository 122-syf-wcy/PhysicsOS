import { parsePhysicsScene } from '@physicsos/physics-scene'
import { copyJsonObject, freezeData } from '@physicsos/physics-workbench/json'
import type { BuilderComponent, BuilderComponentType, BuilderParams, CircuitDraft } from './circuit-builder.ts'
import { BUILDER_COMPONENT_TYPES, terminalKeysOf } from './circuit-builder.ts'
import type { WorkbenchHistory, WorkbenchHistoryEntry } from './workbench-instance-runtime.ts'

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every(key => allowed.includes(key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const netId = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value > 0
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const paramsOf = (value: unknown, type: BuilderComponentType): BuilderParams | undefined => {
  if (!record(value) || !keys(value, ['resistance', 'voltage', 'internalResistance', 'state', 'totalResistance', 'sliderPosition'])) return undefined
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'state') { if (entry !== 'open' && entry !== 'closed') return undefined }
    else if (!finite(entry)) return undefined
  }
  const resistance = value.resistance
  const voltage = value.voltage
  const internalResistance = value.internalResistance
  const state = value.state
  const totalResistance = value.totalResistance
  const sliderPosition = value.sliderPosition
  if (resistance !== undefined && (!finite(resistance) || resistance <= 0)) return undefined
  if (voltage !== undefined && !finite(voltage)) return undefined
  if (internalResistance !== undefined && (!finite(internalResistance) || internalResistance < 0)) return undefined
  if (totalResistance !== undefined && (!finite(totalResistance) || totalResistance <= 0)) return undefined
  if (sliderPosition !== undefined && (!finite(sliderPosition) || sliderPosition < 0 || sliderPosition > 1)) return undefined
  const allowed: Record<BuilderComponentType, readonly string[]> = {
    resistor: ['resistance'], voltage_source: ['voltage', 'internalResistance'],
    switch: ['state'], variable_resistor: ['totalResistance', 'sliderPosition'],
    ammeter: ['internalResistance'], voltmeter: ['internalResistance'],
  }
  if (!keys(value, allowed[type])) return undefined
  return {
    ...(resistance === undefined ? {} : { resistance: resistance as number }),
    ...(voltage === undefined ? {} : { voltage: voltage as number }),
    ...(internalResistance === undefined ? {} : { internalResistance: internalResistance as number }),
    ...(state === undefined ? {} : { state: state as 'open' | 'closed' }),
    ...(totalResistance === undefined ? {} : { totalResistance: totalResistance as number }),
    ...(sliderPosition === undefined ? {} : { sliderPosition: sliderPosition as number }),
  }
}

/** Structural authoring validation; a disconnected draft is valid but need not solve. */
export const parseCircuitDraft = (input: unknown): CircuitDraft | undefined => {
  if (!record(input) || !keys(input, ['components', 'title', 'description', 'nextNet']) ||
    !Array.isArray(input.components) || typeof input.title !== 'string' || typeof input.description !== 'string' || !netId(input.nextNet)) return undefined
  const components: BuilderComponent[] = []
  const ids = new Set<string>()
  for (const value of input.components) {
    if (!record(value) || !keys(value, ['id', 'type', 'nets', 'placement', 'params']) || !text(value.id) || ids.has(value.id) ||
      typeof value.type !== 'string' || !(BUILDER_COMPONENT_TYPES as readonly string[]).includes(value.type) ||
      !record(value.nets) || !record(value.placement) || !keys(value.placement, ['x', 'y', 'rotation'])) return undefined
    const type = value.type as BuilderComponentType
    const terminalKeys = terminalKeysOf(type)
    const inputNets = value.nets
    if (!keys(inputNets, terminalKeys) || Object.keys(inputNets).length !== terminalKeys.length ||
      !terminalKeys.every(key => netId(inputNets[key]))) return undefined
    const { x, y, rotation } = value.placement
    if (!finite(x) || !finite(y) || (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)) return undefined
    const params = paramsOf(value.params, type)
    if (params === undefined) return undefined
    const nets: Record<string, number> = {}
    for (const key of terminalKeys) {
      const net = inputNets[key]
      if (!netId(net) || net >= input.nextNet) return undefined
      nets[key] = net
    }
    ids.add(value.id)
    components.push({ id: value.id, type, nets, placement: { x, y, rotation }, params })
  }
  const draft: CircuitDraft = { components, title: input.title, description: input.description, nextNet: input.nextNet }
  try { copyJsonObject(draft) } catch { return undefined }
  return freezeData(draft)
}

/** Revisions inside historical scenes are evidence; the owner rebases facts on replay. */
export const parseWorkbenchHistory = (input: unknown): WorkbenchHistory | undefined => {
  if (!record(input) || !keys(input, ['past', 'future']) || !Array.isArray(input.past) || !Array.isArray(input.future)) return undefined
  const ids = new Set<string>()
  const parseEntries = (entries: readonly unknown[]): WorkbenchHistoryEntry[] | undefined => {
    const parsed: WorkbenchHistoryEntry[] = []
    for (const value of entries) {
      if (!record(value) || !keys(value, ['id', 'label', 'before', 'after', 'beforeDraft', 'afterDraft']) ||
        !text(value.id) || !text(value.label) || ids.has(value.id)) return undefined
      const before = parsePhysicsScene(value.before)
      const after = parsePhysicsScene(value.after)
      if (!before.ok || !after.ok) return undefined
      const beforeDraft = value.beforeDraft === undefined ? undefined : parseCircuitDraft(value.beforeDraft)
      const afterDraft = value.afterDraft === undefined ? undefined : parseCircuitDraft(value.afterDraft)
      if ((value.beforeDraft !== undefined && beforeDraft === undefined) || (value.afterDraft !== undefined && afterDraft === undefined)) return undefined
      ids.add(value.id)
      parsed.push({
        id: value.id, label: value.label, before: before.value, after: after.value,
        ...(beforeDraft === undefined ? {} : { beforeDraft }),
        ...(afterDraft === undefined ? {} : { afterDraft }),
      })
    }
    return parsed
  }
  const past = parseEntries(input.past)
  const future = parseEntries(input.future)
  return past === undefined || future === undefined ? undefined : freezeData({ past, future })
}
