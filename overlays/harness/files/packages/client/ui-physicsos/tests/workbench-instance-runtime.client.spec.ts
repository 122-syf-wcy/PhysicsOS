import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  derivedScalar,
  derivedVector,
  isScalarQuantity,
  type DerivedQuantity,
  type QuantityVector,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { resolveMechanicsModel, resolveEnergyModel, MechanicsEngine } from '@physicsos/engine-mechanics'
import { resolveWaveModel } from '@physicsos/engine-wave'
import {
  fieldSamplePointOf,
  sourceChargesOf,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { canonicalValue, findUnit, type Quantity } from '@physicsos/physics-units'
import { asQuestionId } from '@physicsos/shared'
import { createSceneObject, parseObject } from '@physicsos/physics-workbench/codec'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import type {
  CapturedResult,
  DatasetObject,
  DatasetRow,
  InstanceSource,
  JsonObject,
  MetricComponent,
  ObjectRef,
  SnapshotObject,
} from '@physicsos/physics-workbench/types'

import {
  createExperimentSceneRef,
  EXPERIMENT_TEMPLATE_GROUPS,
  EXPERIMENT_TEMPLATES,
  findExperimentTemplate,
  SELECTABLE_TEMPLATE_COUNT,
  type ExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import {
  draftFromScene,
  snapToGrid,
  type BuilderComponent,
  type CircuitDraft,
} from '../src/client/physics/circuit-builder.ts'
import {
  createWorkbenchInstanceRuntime,
  type CreateWorkbenchInstanceOptions,
  type WorkbenchClockScheduler,
  type WorkbenchCommittedState,
  type WorkbenchInstanceRuntime,
} from '../src/client/physics/workbench-instance-runtime.ts'
import type { QuantityParameter } from '../src/client/physics/scene-visual-model.ts'
import { readNotebook } from '../src/client/experiments/experiment-notebook.ts'

const CAPTURED_AT = '2026-11-08T00:00:00.000Z'
const COULOMB = 8.9875517923e9
const MU0 = 4 * Math.PI * 1e-7
const H = 6.62607015e-34
const C = 2.99792458e8
const E_CHARGE = 1.602176634e-19
const domains = [
  'mechanics', 'electric', 'magnetic', 'circuit', 'composite', 'optics',
  'acoustics', 'fluid', 'thermal', 'induction', 'wave', 'modern',
] as const
const templates = EXPERIMENT_TEMPLATES.filter(template => template.comingSoon !== true)
const owners = new Set<WorkbenchInstanceRuntime>()

// No browser clock, fake timers, process-global mocks, or wall-clock waits are needed.
class DeterministicScheduler implements WorkbenchClockScheduler {
  private milliseconds = 0
  private serial = 0
  private readonly callbacks = new Map<number, (now: number) => void>()
  readonly cancelledCallbacks: ((now: number) => void)[] = []
  requests = 0
  cancellations = 0

  now(): number { return this.milliseconds }
  request(callback: (now: number) => void): number {
    const handle = ++this.serial
    this.requests += 1
    this.callbacks.set(handle, callback)
    return handle
  }
  cancel(handle: unknown): void {
    if (typeof handle !== 'number') throw new Error('The injected scheduler received an invalid handle')
    const callback = this.callbacks.get(handle)
    if (callback !== undefined) this.cancelledCallbacks.push(callback)
    this.callbacks.delete(handle)
    this.cancellations += 1
  }
  get pending(): number { return this.callbacks.size }
  elapse(milliseconds: number): void { this.milliseconds += milliseconds }
  tick(milliseconds = 0): void {
    this.elapse(milliseconds)
    const ready = [...this.callbacks.entries()]
    for (const [handle] of ready) this.callbacks.delete(handle)
    for (const [, callback] of ready) callback(this.milliseconds)
  }
  deliverCancelled(): void {
    for (const callback of this.cancelledCallbacks.splice(0)) callback(this.milliseconds)
  }
}

const own = (options: CreateWorkbenchInstanceOptions): WorkbenchInstanceRuntime => {
  const owner = createWorkbenchInstanceRuntime({ scheduler: null, ...options })
  owners.add(owner)
  return owner
}
const keepDuplicate = (owner: WorkbenchInstanceRuntime): WorkbenchInstanceRuntime => {
  const duplicate = owner.duplicate({ onCommitted: undefined, onPersist: undefined })
  owners.add(duplicate)
  return duplicate
}
afterEach(() => {
  for (const owner of owners) owner.dispose()
  owners.clear()
  vi.restoreAllMocks()
})

const templateOf = (id: string): ExperimentTemplate => {
  const template = findExperimentTemplate(id)
  if (template === undefined) throw new Error(`Missing actual catalog template ${id}`)
  return template
}
const sceneOf = (id: string): PhysicsScene => createExperimentSceneRef(templateOf(id), id).scene
const ownerOf = (id: string, options: Partial<CreateWorkbenchInstanceOptions> = {}): WorkbenchInstanceRuntime =>
  own({ scene: sceneOf(id), source: { kind: 'template', id }, templateId: id, ...options })
const reopen = (saved: WorkbenchCommittedState): WorkbenchInstanceRuntime => own({
  instanceKey: saved.instanceKey,
  sceneId: String(saved.scene.id),
  scene: saved.scene,
  originScene: saved.originScene,
  templateId: saved.templateId,
  source: saved.source,
  buildMode: saved.buildMode,
  clock: saved.clock,
  instanceEditRevision: saved.instanceEditRevision,
  persistedHistory: saved.history,
  persistedDraft: saved.draft,
})
const resultOf = (raw: CapturedResult): SimulationResult => {
  if (raw.result === undefined) throw new Error('The actual owner lost its real engine result')
  return raw.result
}
const stateOf = (raw: CapturedResult): SimulationState => {
  if (raw.state === undefined) throw new Error('The actual owner lost its held engine state')
  return raw.state
}
const objectOf = (state: SimulationState, id?: string) => {
  const object = id === undefined ? state.objects[0] : state.objects.find(entry => entry.id === id)
  if (object === undefined) throw new Error(`Missing numerical engine object ${id ?? '0'}`)
  return object
}
const scalarOf = (raw: CapturedResult, key: string, scope: 'state' | 'result' | 'first' = 'result'): Quantity => {
  const derived = scope === 'state' ? stateOf(raw).derived
    : scope === 'first' ? resultOf(raw).states[0]?.derived ?? [] : resultOf(raw).derivedQuantities
  return derivedScalar(derived, key)
}
const nativeObject = (raw: CapturedResult, key: string): JsonObject => {
  const value = raw.rawState?.[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Missing retained native ${key}`)
  }
  return value as JsonObject
}
const nativeNumber = (object: JsonObject, key: string): number => {
  const value = object[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing native numerical ${key}`)
  return value
}
const near = (actual: number, expected: number, label: string, relative = 1e-9, absolute = 1e-30): void => {
  expect(Number.isFinite(actual), label).toBe(true)
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`)
    .toBeLessThanOrEqual(Math.max(Math.abs(expected) * relative, absolute))
}
const expectScalar = (
  raw: CapturedResult, key: string, expected: number, unit: Quantity['unit'],
  dimension: Quantity['dimension'], scope: 'state' | 'result' | 'first' = 'result',
): void => {
  const actual = scalarOf(raw, key, scope)
  expect(actual.unit, key).toBe(unit)
  expect(actual.dimension, key).toBe(dimension)
  // Circuit fixtures approximate ideal meters with finite internal resistance.
  const relative = raw.engineInfo.id === 'engine-circuit' ? 1e-6 : 1e-9
  near(canonicalValue(actual), expected, key, relative)
}
const expectVector = (
  actual: QuantityVector | undefined, expected: readonly [number, number, number],
  unit: string, dimension: QuantityVector['dimension'], label: string,
): void => {
  if (actual === undefined) throw new Error(`Missing engine vector ${label}`)
  expect(actual.unit, label).toBe(unit)
  expect(actual.dimension, label).toBe(dimension)
  const vectorScale = Math.max(...expected.map(value => Math.abs(value)))
  for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) {
    near(actual.vector[axis], expected[index]!, `${label}.${axis}`, 1e-9, Math.max(vectorScale * 1e-12, 1e-30))
  }
}
const bytes = (value: unknown): string => canonicalStringify(value)
const hash = (value: unknown): string => createHash('sha256').update(bytes(value)).digest('hex')
const refOf = <K extends ObjectRef['kind']>(kind: K, value: unknown): ObjectRef<K> => ({ kind, digest: hash(value) })

/** Check the source value, not JSON.stringify's silent removal of executable/non-finite fields. */
const assertPlainFinite = (value: unknown, path = '$', optionalFields = false): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${path}`)
    return
  }
  if (value === undefined && optionalFields) return
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertPlainFinite(item, `${path}[${index}]`, optionalFields)
    return
  }
  if (typeof value !== 'object' || value === null) throw new Error(`Non-JSON/executable value at ${path}`)
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`Non-plain object at ${path}`)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) throw new Error(`Executable accessor at ${path}.${key}`)
    if (key === 'sampleReadout') throw new Error(`Renderer callback leaked into ${path}`)
    assertPlainFinite(descriptor.value, `${path}.${key}`, optionalFields)
  }
}
const assertUnits = (value: unknown, path = '$'): void => {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach((item, index) => assertUnits(item, `${path}[${index}]`)); return }
  const object = value as Record<string, unknown>
  if (typeof object.unit === 'string' && typeof object.dimension === 'string') {
    const unit = findUnit(object.unit)
    if (unit === undefined || unit.dimension !== object.dimension) throw new Error(`Invalid physical unit at ${path}`)
  }
  for (const [key, child] of Object.entries(object)) assertUnits(child, `${path}.${key}`)
}
const expectAligned = (owner: WorkbenchInstanceRuntime, raw = owner.captureRaw()): void => {
  const saved = owner.serialize()
  const result = resultOf(raw)
  expect(canonicalStringify(raw.scene)).toBe(canonicalStringify(saved.scene))
  expect(raw.scene.id).toBe(owner.getScene().id)
  expect(raw.scene.revision).toBe(owner.getScene().revision)
  expect(raw.request?.sceneId).toBe(raw.scene.id)
  expect(raw.request?.sceneRevision).toBe(raw.scene.revision)
  expect(raw.request?.trace.sceneId).toBe(raw.scene.id)
  expect(raw.request?.trace.sceneRevision).toBe(raw.scene.revision)
  expect(result.sceneId).toBe(raw.scene.id)
  expect(result.sceneRevision).toBe(raw.scene.revision)
  expect(result.simulationId).toBe(raw.request?.simulationId)
  expect(raw.engineInfo.id).toBe(result.metadata.engineId)
  expect(raw.engineInfo.version).toBe(result.metadata.engineVersion)
  expect(raw.engineInfo.release).toEqual(saved.scene.metadata.experimentRelease)
  const displayClock = owner.frames.getSnapshot().clock
  expect(raw.clock.rate).toBe(displayClock.rate)
  expect(raw.clock.running).toBe(displayClock.running)
  if (raw.clock.time !== displayClock.time) {
    expect(raw.engineInfo.id).toBe('engine-wave')
    expect(displayClock.total).toBeGreaterThan(0)
    expect(raw.clock.time).toBeGreaterThan(displayClock.total)
    expect(raw.clock.total).toBeGreaterThanOrEqual(raw.clock.time)
    near(displayClock.time, raw.clock.time % displayClock.total, 'periodic chart cursor', 1e-9, 1e-12)
  } else expect(raw.clock.total).toBe(displayClock.total)
  expect(raw.clock).toEqual(saved.clock)
  if (raw.cursor.kind === 'time') {
    expect(canonicalValue(raw.cursor.time)).toBe(raw.clock.time)
    expect(result.states.length).toBeGreaterThan(3)
    if (raw.engineInfo.id === 'engine-wave' && raw.request?.options.endTime !== undefined) {
      // The current demonstration can outlive the exported history window;
      // only the actual submitted request defines that window's endpoint.
      near(canonicalValue(result.states.at(-1)!.time), canonicalValue(raw.request.options.endTime), 'retained request endpoint')
    }
    // Some benches retain a native currentState, not a generic SimulationState.
    if (raw.state !== undefined) {
      const held = raw.state
      // Collision playback retains its nearest real sample, not a newly retimed state.
      if (canonicalValue(held.time) !== raw.clock.time) {
        expect(result.states).toContainEqual(held)
        expect(raw.diagnostics).toContainEqual(expect.objectContaining({ code: 'SAMPLED_STATE_CURSOR_OFFSET' }))
      }
    } else {
      expect(raw.rawState?.currentState).toBeDefined()
    }
  } else {
    expect(raw.cursor.kind).toBe('static')
    expect(raw.clock).toMatchObject({ time: 0, total: 0, running: false })
  }
}
const parameterOf = (owner: WorkbenchInstanceRuntime, id: string): QuantityParameter => {
  const parameter = owner.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(entry => entry.id === id)
  if (parameter === undefined) throw new Error(`Missing presented parameter ${id}`)
  return parameter
}
const choiceOf = (owner: WorkbenchInstanceRuntime, id: string) => {
  const choice = owner.frames.getSnapshot().inspector.flatMap(section => section.choices ?? []).find(entry => entry.id === id)
  if (choice === undefined) throw new Error(`Missing presented choice ${id}`)
  return choice
}
const safeEdit = (parameter: QuantityParameter): number => {
  if (!Number.isFinite(parameter.value)) throw new Error(`Non-finite presented ${parameter.id}`)
  const magnitude = Math.abs(parameter.value)
  const step = Math.abs(parameter.step ?? (magnitude === 0 ? 0.1 : magnitude * 0.05))
  const integral = /harmonic|turns|^slider:/i.test(parameter.id)
  const disproportionate = magnitude > 0 && (step > magnitude * 0.25 || step < magnitude * 1e-5)
  const delta = integral ? Math.max(1, step) : disproportionate ? magnitude * 0.05 : step
  // Leave headroom for the real transformer's fivefold step-up choice.
  const sign = parameter.value < 0 || parameter.id === 'primary-turns' ? -1 : 1
  const valid = (value: number) => Number.isFinite(value) && value !== parameter.value && value !== 0 &&
    (parameter.min === undefined || value >= parameter.min) && (parameter.max === undefined || value <= parameter.max)
  for (const value of [parameter.value + sign * delta, parameter.value - sign * delta]) {
    if (valid(value)) return value
  }
  throw new Error(`No safe, changed finite value for presented ${parameter.id}`)
}
const expectOneGesture = (
  owner: WorkbenchInstanceRuntime, before: WorkbenchCommittedState, label?: string,
): WorkbenchCommittedState => {
  const after = owner.serialize()
  expect(after.instanceEditRevision).toBe(before.instanceEditRevision + 1)
  expect(after.scene.revision).toBeGreaterThan(before.scene.revision)
  expect(after.history.past).toHaveLength(before.history.past.length + 1)
  expect(after.history.future).toEqual([])
  const entry = after.history.past.at(-1)!
  expect(entry.before).toEqual(before.scene)
  expect(entry.after).toEqual(after.scene)
  if (label !== undefined) expect(entry.label).toBe(label)
  return after
}

interface Baseline {
  readonly key: string
  readonly value: number
  readonly unit: Quantity['unit']
  readonly dimension: Quantity['dimension']
  readonly scope?: 'state' | 'result' | 'first'
}
const baseline = (
  key: string, value: number, unit: Quantity['unit'], dimension: Quantity['dimension'],
  scope?: Baseline['scope'],
): Baseline => ({ key, value, unit, dimension, ...(scope === undefined ? {} : { scope }) })

// Explicit textbook numbers cover every actual catalog row, including sibling benches.
const baselines: Readonly<Record<string, readonly Baseline[]>> = {
  'uniform-linear': [baseline('velocity_magnitude', 4, 'm/s', 'velocity', 'state')],
  'average-speed': [baseline('velocity_magnitude', 0, 'm/s', 'velocity', 'state')],
  'uniform-acceleration': [baseline('velocity_magnitude', 2, 'm/s', 'velocity', 'state')],
  'projectile-horizontal': [baseline('flight_time', Math.sqrt(40 / 9.8), 's', 'time')],
  'projectile-oblique': [baseline('flight_time', 40 * Math.sin(40 * Math.PI / 180) / 9.8, 's', 'time')],
  'newton-second-law': [baseline('net_force_magnitude', 10, 'N', 'force')],
  incline: [baseline('incline_acceleration', 9.8 * (0.5 - 0.2 * Math.cos(Math.PI / 6)), 'm/s^2', 'acceleration')],
  'mechanical-energy': [baseline('potential_energy', 17.64, 'J', 'energy'), baseline('kinetic_energy', 17.64, 'J', 'energy')],
  'ramp-friction': [baseline('friction_work', 3.528, 'J', 'energy'), baseline('kinetic_energy', 14.112, 'J', 'energy')],
  'lever-balance': [baseline('left_moment', 0.294, 'N*m', 'torque'), baseline('right_moment', 0.294, 'N*m', 'torque')],
  'collision-elastic': [baseline('total_kinetic_energy', 3.125, 'J', 'energy', 'first')],
  'collision-inelastic': [baseline('total_kinetic_energy', 2.56, 'J', 'energy', 'first')],
  'collision-perfectly-inelastic': [baseline('total_kinetic_energy', 4.5, 'J', 'energy', 'first')],
  'vt-area': [baseline('velocity_magnitude', 2, 'm/s', 'velocity', 'state')],
  'force-composition': [baseline('net_force_magnitude', 5, 'N', 'force')],
  'concurrent-equilibrium': [baseline('net_force_magnitude', 0, 'N', 'force')],
  'apparent-weight': [baseline('velocity_magnitude', 1, 'm/s', 'velocity', 'state')],
  'chase-meeting': [baseline('total_kinetic_energy', 5, 'J', 'energy', 'first')],
  'hooke-law': [baseline('spring_extension', 0.2, 'm', 'length')],
  'spring-oscillator': [baseline('period', 2 * Math.PI / Math.sqrt(50), 's', 'time')],
  'circular-orbit': [baseline('orbital_speed', Math.sqrt(3.986004418e14 / 6.8e6), 'm/s', 'velocity')],
  'simple-pendulum': [baseline('period', 2 * Math.PI * Math.sqrt(2 / 9.8), 's', 'time')],
  'friction-static': [baseline('static_limit', 9.8, 'N', 'force'), baseline('slip_time', 4.9, 's', 'time')],
  'friction-mu': [baseline('normal_force', 19.6, 'N', 'force')],
  'point-charge': [baseline('electric_field_magnitude', COULOMB * 5e-6 / 0.2 ** 2, 'V/m', 'electric_field')],
  'multi-point-charge': [baseline('electric_field_magnitude', COULOMB * 8e-7 / (0.02 ** 1.5), 'V/m', 'electric_field')],
  'uniform-electric': [],
  'parallel-plate': [],
  'straight-wire-field': [baseline('magnetic_flux_density', 4e-5, 'T', 'magnetic_flux_density')],
  'solenoid-field': [baseline('magnetic_flux_density', 4 * Math.PI * 1e-3, 'T', 'magnetic_flux_density')],
  electromagnet: [baseline('pole_face_pull', 3.2 * Math.PI, 'N', 'force')],
  motor: [baseline('motor_torque', 0.24, 'N*m', 'torque')],
  'magnetic-circular': [baseline('cyclotron_radius', 1.67e-27 * 2e6 / (1.6e-19 * 0.5), 'm', 'length')],
  'series-circuit': [baseline('main_current', 0.2, 'A', 'electric_current', 'state')],
  'parallel-circuit': [baseline('main_current', 1, 'A', 'electric_current', 'state')],
  'mixed-circuit': [baseline('main_current', 1.5, 'A', 'electric_current', 'state')],
  'short-circuit': [baseline('main_current', 12, 'A', 'electric_current', 'state')],
  'rheostat-circuit': [baseline('main_current', 0.6, 'A', 'electric_current', 'state')],
  'va-resistance': [baseline('main_current', 0.3, 'A', 'electric_current', 'state')],
  'bulb-power': [baseline('main_current', 4.5 / 14.3, 'A', 'electric_current', 'state')],
  'emf-measurement': [baseline('main_current', 1.8, 'A', 'electric_current', 'state')],
  pinhole: [baseline('image_height', 0.03, 'm', 'length')],
  'total-reflection': [baseline('critical_angle', Math.asin(2 / 3), 'rad', 'angle')],
  'plane-mirror': [baseline('image_height', 0.06, 'cm', 'length')],
  'convex-lens': [baseline('image_height', 0.03, 'cm', 'length')],
  'concave-mirror': [baseline('image_height', 0.03, 'cm', 'length')],
  'convex-mirror': [baseline('image_height', 0.015, 'cm', 'length')],
  'echo-ranging': [baseline('echo_time', 2, 's', 'time')],
  noise: [baseline('sound_level', 100 - 10 * Math.log10(4 * Math.PI) - 15, '', 'dimensionless')],
  buoyancy: [baseline('block_weight', 2.646, 'N', 'force'), baseline('buoyant_force', 0.98, 'N', 'force')],
  'solid-pressure': [baseline('contact_pressure', 1000, 'Pa', 'pressure'), baseline('comparison_pressure', 4000, 'Pa', 'pressure')],
  'liquid-pressure': [baseline('liquid_pressure', 1960, 'Pa', 'pressure'), baseline('comparison_liquid_pressure', 2156, 'Pa', 'pressure')],
  'atmospheric-pressure': [baseline('barometer_column', 101300 / (13600 * 9.8), 'm', 'length')],
  thermometer: [baseline('reading_temperature', 298.15, 'K', 'temperature')],
  'crystal-melting': [baseline('melting_duration', 668, 's', 'time'), baseline('total_heat', 41800, 'J', 'energy')],
  'boiling-water': [baseline('heater_power', 500, 'W', 'power')],
  'heat-capacity-comparison': [baseline('temperature_rise', 50, 'K', 'temperature'), baseline('comparison_temperature_rise', 100, 'K', 'temperature')],
  'velocity-selector': [baseline('speed', 1e5, 'm/s', 'velocity', 'state')],
  'mass-spectrometer': [baseline('speed', 1e5, 'm/s', 'velocity', 'state')],
  'composite-eb': [baseline('speed', 1e5, 'm/s', 'velocity', 'state')],
  'composite-ebg': [baseline('speed', 1e5, 'm/s', 'velocity', 'state')],
  'multi-region-field': [baseline('speed', 1e5, 'm/s', 'velocity', 'first')],
  cyclotron: [baseline('cyclotron_period', 2 * Math.PI * 1.67e-27 / (1.6e-19 * 1.5), 's', 'time')],
  'induction-bar-motion': [baseline('induced_emf', 0.2, 'V', 'electric_potential', 'state')],
  transformer: [baseline('secondary_voltage', 44, 'V', 'electric_potential'), baseline('secondary_current', 0.5, 'A', 'electric_current')],
  'induction-double-bar-momentum': [baseline('induced_emf', 0.2, 'V', 'electric_potential', 'state')],
  'induction-double-bar-force': [baseline('loop_resistance', 0.1, 'Ω', 'resistance', 'state')],
  'induction-flux-change': [baseline('induced_emf', -0.05, 'V', 'electric_potential', 'state')],
  'wave-travelling': [baseline('wave_speed', 2, 'm/s', 'velocity'), baseline('period', 0.2, 's', 'time')],
  'wave-interference': [baseline('resultant_amplitude', 0.06, 'm', 'length')],
  'wave-standing': [baseline('frequency', 40, 'Hz', 'frequency')],
  'wave-longitudinal': [baseline('compression_spacing', 0.25, 'm', 'length')],
  'wave-reflection-refraction': [baseline('refracted_angle', Math.asin(0.25), 'rad', 'angle')],
  'wave-diffraction': [baseline('diffraction_angle', Math.PI / 6, 'rad', 'angle')],
  'wave-doppler': [baseline('observed_frequency', 500 / 0.9, 'Hz', 'frequency')],
  'photoelectric-effect': [baseline('photon_energy', H * C / 400e-9, 'J', 'energy')],
}

/** Numeric laws operate on committed scene facts and held quantities, never formatted cells. */
const expectPhysics = (template: ExperimentTemplate, raw: CapturedResult): void => {
  // A native bench's full result still contains genuine numerical states; do not
  // invent a generic captured-state field for a native phase/immersion capture.
  const state = raw.state ?? resultOf(raw).states[0]!
  const scene = raw.scene
  if (template.domain === 'circuit') {
    const circuit = scene.circuits[0]!
    const source = circuit.components.find(component => component.type === 'voltage_source')!
    if (source.type !== 'voltage_source') throw new Error('Real circuit lost its voltage source')
    const resistor = (id: string): number => {
      const component = circuit.components.find(entry => String(entry.id) === id)
      if (component?.type === 'resistor') return canonicalValue(component.resistance)
      if (component?.type === 'variable_resistor') return canonicalValue(component.totalResistance) * component.sliderPosition
      throw new Error(`Missing circuit resistance ${id}`)
    }
    const external = template.id === 'series-circuit' ? resistor('r1') + resistor('r2')
      : template.id === 'parallel-circuit' ? 1 / (1 / resistor('r1') + 1 / resistor('r2'))
      : template.id === 'mixed-circuit' ? resistor('r1') + 1 / (1 / resistor('r2') + 1 / resistor('r3'))
      : template.id === 'short-circuit' ? 0
      : template.id === 'emf-measurement' ? resistor('rv') : resistor('r0') + resistor('rv')
    const open = circuit.components.some(component => component.type === 'switch' && component.state === 'open')
    const internal = source.internalResistance === undefined ? 0 : canonicalValue(source.internalResistance)
    let expected = open ? 0 : canonicalValue(source.voltage) / (internal + external)
    if (template.id === 'emf-measurement') {
      // V stays across the battery when S opens the ammeter/rheostat branch.
      // The finite 1 GΩ voltmeter loads the source: R_ext = R_load || R_V,
      // or just R_V with S open. main_current includes this meter current.
      const meter = circuit.components.find(component => component.type === 'voltmeter')
      if (meter?.type !== 'voltmeter') throw new Error('EMF measurement lost its battery voltmeter')
      const resistance = meter.internalResistance === undefined || canonicalValue(meter.internalResistance) <= 0
        ? 1e9 : canonicalValue(meter.internalResistance)
      const loadedExternal = open ? resistance : 1 / (1 / external + 1 / resistance)
      expected = canonicalValue(source.voltage) / (internal + loadedExternal)
      if (open) {
        const first = resultOf(raw).states[0]!
        const ammeterCurrent = objectOf(first, 'am').values?.current
        const voltmeterCurrent = objectOf(first, String(meter.id)).values?.current
        if (ammeterCurrent === undefined || voltmeterCurrent === undefined ||
          !isScalarQuantity(ammeterCurrent) || !isScalarQuantity(voltmeterCurrent)) {
          throw new Error('EMF measurement lost its actual meter currents')
        }
        // Partial-pivot Gaussian elimination subtracts O(E/R_load) currents.
        // Allow accumulated double roundoff for this small MNA system, far
        // below the physical ~5 nA voltmeter branch; mathematical zero is not
        // represented exactly by the solved source-current unknown.
        const currentScale = Math.abs(canonicalValue(source.voltage)) / Math.max(internal + external, 1e-6)
        const roundoffAmps = 64 * Number.EPSILON * currentScale
        near(canonicalValue(ammeterCurrent), 0, 'open load branch current', 1e-9, roundoffAmps)
        near(Math.abs(canonicalValue(voltmeterCurrent)), expected, 'battery voltmeter loading current', 1e-6)
      }
    }
    // All catalog edits settle at t=0; rheostat time sweeps are checked separately.
    expectScalar(raw, 'main_current', expected, 'A', 'electric_current', 'first')
    for (const object of resultOf(raw).states[0]!.objects) {
      const current = object.values?.current
      const voltage = object.values?.voltage
      const power = object.values?.power
      if (current !== undefined && voltage !== undefined && power !== undefined &&
        isScalarQuantity(current) && isScalarQuantity(voltage) && isScalarQuantity(power)) {
        const expectedPower = object.id === String(source.id) || object.id === String(circuit.id)
          ? canonicalValue(source.voltage) * current.value : current.value * voltage.value
        near(power.value, expectedPower, `${object.id}: source E·I / load U·I`, 1e-9, 1e-12)
      }
    }
    return
  }
  if (template.id.startsWith('collision-') || template.id === 'chase-meeting') {
    const first = resultOf(raw).states[0]!
    const momentum: [number, number, number] = [0, 0, 0]
    let kinetic = 0
    for (const body of scene.bodies) {
      const mass = canonicalValue(body.mass)
      const velocity = body.velocity.vector
      for (const [index, axis] of (['x', 'y', 'z'] as const).entries()) momentum[index]! += mass * velocity[axis]
      kinetic += 0.5 * mass * (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
      expectVector(objectOf(first, body.id).velocity, [velocity.x, velocity.y, velocity.z], 'm/s', 'velocity', body.id)
    }
    expectVector(derivedVector(first.derived, 'total_momentum'), momentum, 'kg*m/s', 'momentum', 'Σp')
    expectScalar(raw, 'total_kinetic_energy', kinetic, 'J', 'energy', 'first')
    expect(resultOf(raw).states).toHaveLength(1024)
    return
  }
  if (template.id === 'mechanical-energy' || template.id === 'ramp-friction') {
    const model = resolveEnergyModel(scene)
    const potential = model.mass * model.gravity * model.releaseHeight
    const friction = model.frictionCoefficient * potential / Math.tan(model.inclineAngle)
    expectScalar(raw, 'potential_energy', potential, 'J', 'energy')
    expectScalar(raw, 'friction_work', friction, 'J', 'energy')
    expectScalar(raw, 'kinetic_energy', Math.max(0, potential - friction), 'J', 'energy')
    return
  }
  if (template.id === 'lever-balance') {
    const model = nativeObject(raw, 'model')
    const left = model.left as JsonObject
    const right = model.right as JsonObject
    const gravity = nativeNumber(model, 'gravity')
    expectScalar(raw, 'left_moment', nativeNumber(left, 'mass') * gravity * nativeNumber(left, 'armLength'), 'N*m', 'torque')
    expectScalar(raw, 'right_moment', nativeNumber(right, 'mass') * gravity * nativeNumber(right, 'armLength'), 'N*m', 'torque')
    return
  }
  if (template.domain === 'mechanics') {
    const model = resolveMechanicsModel(scene)
    const object = objectOf(state, model.bodyId)
    const acceleration = object.acceleration!.vector
    expectVector(derivedVector(state.derived, 'net_force'),
      [model.mass * acceleration.x, model.mass * acceleration.y, model.mass * acceleration.z], 'N', 'force', 'F=ma')
    const velocity = object.velocity!.vector
    expectScalar(raw, 'velocity_magnitude', Math.hypot(velocity.x, velocity.y, velocity.z), 'm/s', 'velocity', 'state')
    if (model.modelId === 'circular_orbit') {
      expectScalar(raw, 'orbital_speed', Math.sqrt(model.gravitationalParameter / model.radius), 'm/s', 'velocity')
      expectScalar(raw, 'orbital_period', 2 * Math.PI * model.radius / Math.sqrt(model.gravitationalParameter / model.radius), 's', 'time')
    } else if (model.modelId === 'spring_statics') {
      const spring = scene.constraints.find(entry => entry.type === 'spring')!
      const stiffness = Number(spring.parameters.stiffness)
      const gravity = scene.fields.find(entry => entry.type === 'uniform_gravity')!
      if (gravity.type !== 'uniform_gravity') throw new Error('Statics lost gravity')
      expectScalar(raw, 'spring_extension', model.mass * Math.abs(gravity.acceleration.vector.y) / stiffness, 'm', 'length')
    } else if (model.modelId === 'uniform_linear_motion' || model.modelId === 'uniformly_accelerated_motion' || model.modelId === 'newton_second_law') {
      const t = canonicalValue(state.time)
      expectVector(object.position, [
        model.position.x + model.velocity.x * t + 0.5 * model.acceleration.x * t ** 2,
        model.position.y + model.velocity.y * t + 0.5 * model.acceleration.y * t ** 2,
        model.position.z + model.velocity.z * t + 0.5 * model.acceleration.z * t ** 2,
      ], 'm', 'length', 'x=x0+v0t+at²/2')
    }
    return
  }
  if (template.id === 'point-charge' || template.id === 'multi-point-charge') {
    const probe = fieldSamplePointOf(scene)
    if (probe === undefined) throw new Error('Real point-charge catalog scene lost its sample location')
    const field = { x: 0, y: 0, z: 0 }
    for (const charge of sourceChargesOf(scene.particles, scene.fields)) {
      const position = charge.position.vector
      const offset = { x: probe.x - position.x, y: probe.y - position.y, z: probe.z - position.z }
      const distance = Math.hypot(offset.x, offset.y, offset.z)
      for (const axis of ['x', 'y', 'z'] as const) field[axis] += COULOMB * canonicalValue(charge.charge!) * offset[axis] / distance ** 3
    }
    expectScalar(raw, 'electric_field_magnitude', Math.hypot(field.x, field.y, field.z), 'V/m', 'electric_field')
    return
  }
  if (template.domain === 'electric') {
    const particle = scene.particles[0]!
    const field = scene.fields.find(entry => entry.type === 'uniform_electric')!
    if (field.type !== 'uniform_electric') throw new Error('Real electric field disappeared')
    const qOverM = canonicalValue(particle.charge!) / canonicalValue(particle.mass)
    const expected: [number, number, number] = [
      qOverM * field.fieldStrength.vector.x, qOverM * field.fieldStrength.vector.y, qOverM * field.fieldStrength.vector.z,
    ]
    const active = template.id === 'parallel-plate'
      ? resultOf(raw).states.find(sample => Math.hypot(...Object.values(objectOf(sample).acceleration!.vector)) > 0)
      : state
    if (active === undefined) throw new Error('Bounded field lost all of its actual acceleration samples')
    expectVector(objectOf(active).acceleration, expected, 'm/s^2', 'acceleration', 'a=qE/m')
    return
  }
  if (template.id === 'magnetic-circular') {
    const particle = scene.particles[0]!
    const field = scene.fields.find(entry => entry.type === 'uniform_magnetic')!
    if (field.type !== 'uniform_magnetic') throw new Error('Magnetic field disappeared')
    const B = Math.abs(field.magneticFluxDensity.vector.z)
    const charge = Math.abs(canonicalValue(particle.charge!))
    const mass = canonicalValue(particle.mass)
    const velocity = particle.velocity.vector
    expectScalar(raw, 'cyclotron_radius', mass * Math.hypot(velocity.x, velocity.y, velocity.z) / (charge * B), 'm', 'length')
    expectScalar(raw, 'cyclotron_period', 2 * Math.PI * mass / (charge * B), 's', 'time')
    return
  }
  if (template.domain === 'magnetic') {
    const model = nativeObject(raw, 'model')
    const current = Math.abs(nativeNumber(model, 'current'))
    if (template.id === 'motor') {
      const area = nativeNumber(model, 'sideLength') * nativeNumber(model, 'coilWidth')
      const torque = nativeNumber(model, 'turns') * nativeNumber(model, 'magneticFluxDensity') * nativeNumber(model, 'current') * area * Math.cos(nativeNumber(model, 'coilAngle'))
      expectScalar(raw, 'motor_torque', torque, 'N*m', 'torque')
    } else {
      const expected = template.id === 'straight-wire-field' ? MU0 * current / (2 * Math.PI * nativeNumber(model, 'probeDistance'))
        : MU0 * nativeNumber(model, 'turns') * current / nativeNumber(model, 'coilLength') *
          (template.id === 'electromagnet' ? nativeNumber(model, 'coreRelativePermeability') : 1)
      expectScalar(raw, 'magnetic_flux_density', expected, 'T', 'magnetic_flux_density')
    }
    return
  }
  if (template.domain === 'composite') {
    const particle = scene.particles[0]!
    const velocity = objectOf(state).velocity!.vector
    expectScalar(raw, 'kinetic_energy', 0.5 * canonicalValue(particle.mass) * (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2), 'J', 'energy', 'state')
    if (template.id !== 'cyclotron') {
      const electric = derivedVector(state.derived, 'electric_force_vector').vector
      const magnetic = derivedVector(state.derived, 'magnetic_force_vector').vector
      const gravity = derivedVector(state.derived, 'gravity_force_vector').vector
      expectVector(derivedVector(state.derived, 'net_force_vector'), [
        electric.x + magnetic.x + gravity.x, electric.y + magnetic.y + gravity.y, electric.z + magnetic.z + gravity.z,
      ], 'N', 'force', 'Fnet=Fe+Fm+Fg')
      const active = resultOf(raw).states.find(sample => sample.derived.some(entry => entry.key === 'selected_velocity'))
      if (active !== undefined) {
        const fields = scene.fields.filter(field => field.regionId === undefined ||
          field.regionId === scene.fields.find(candidate => candidate.type === 'uniform_electric')?.regionId)
        const electricField = fields.find(field => field.type === 'uniform_electric')
        const magneticField = fields.find(field => field.type === 'uniform_magnetic')
        if (electricField?.type === 'uniform_electric' && magneticField?.type === 'uniform_magnetic') {
          const strength = Math.hypot(...Object.values(electricField.fieldStrength.vector))
          const magneticStrength = Math.hypot(...Object.values(magneticField.magneticFluxDensity.vector))
          near(canonicalValue(derivedScalar(active.derived, 'selected_velocity')), strength / magneticStrength, 'stored selector v=E/B')
          near(canonicalValue(derivedScalar(active.derived, 'electric_force_magnitude')),
            Math.abs(canonicalValue(particle.charge!)) * strength, 'stored electric force qE')
        }
      }
    }
    return
  }
  if (template.id === 'pinhole') {
    const model = nativeObject(raw, 'model')
    expectScalar(raw, 'image_height', nativeNumber(model, 'objectHeight') * nativeNumber(model, 'screenDistance') / nativeNumber(model, 'objectDistance'), 'm', 'length')
    return
  }
  if (template.id === 'total-reflection') {
    const model = nativeObject(raw, 'model')
    const n1 = nativeNumber(model, 'incidentIndex')
    const n2 = nativeNumber(model, 'refractedIndex')
    if (n1 > n2) expectScalar(raw, 'critical_angle', Math.asin(n2 / n1), 'rad', 'angle')
    const angle = nativeNumber(model, 'incidentAngle')
    if (n1 * Math.sin(angle) < n2) {
      expectScalar(raw, 'refracted_angle', Math.asin(n1 * Math.sin(angle) / n2), 'rad', 'angle')
    }
    return
  }
  if (template.domain === 'optics') {
    const u = canonicalValue(scalarOf(raw, 'object_distance'))
    const height = canonicalValue(scalarOf(raw, 'object_height'))
    const f = template.id === 'plane-mirror' ? undefined : canonicalValue(scalarOf(raw, 'focal_length'))
    const v = f === undefined ? u : 1 / (1 / f - 1 / u)
    near(Math.abs(canonicalValue(scalarOf(raw, 'image_distance'))), Math.abs(v), '1/u+1/v=1/f')
    near(canonicalValue(scalarOf(raw, 'image_height')), height * Math.abs(v / u), "h'=h|v/u|")
    return
  }
  if (template.id === 'echo-ranging') {
    const model = nativeObject(raw, 'model')
    expectScalar(raw, 'echo_time', 2 * nativeNumber(model, 'wallDistance') / nativeNumber(model, 'soundSpeed'), 's', 'time')
    return
  }
  if (template.id === 'noise') {
    const model = nativeObject(raw, 'model')
    const level = nativeNumber(model, 'soundPowerLevel') - 20 * Math.log10(nativeNumber(model, 'distance')) - 10 * Math.log10(4 * Math.PI) - nativeNumber(model, 'barrierAttenuation')
    expectScalar(raw, 'sound_level', level, '', 'dimensionless')
    expectScalar(raw, 'sound_intensity', 1e-12 * 10 ** (level / 10), 'W/m^2', 'intensity')
    return
  }
  if (template.id === 'buoyancy') {
    const model = nativeObject(raw, 'model')
    const current = nativeObject(raw, 'currentState')
    const weight = nativeNumber(model, 'blockMass') * nativeNumber(model, 'gravity')
    const force = nativeNumber(model, 'liquidDensity') * nativeNumber(model, 'gravity') * nativeNumber(current, 'displacedVolume')
    near(nativeNumber(current, 'buoyantForce'), force, 'Fbuoyancy=ρgV')
    near(nativeNumber(current, 'scaleReading'), Math.max(0, weight - force), 'scale=mg-Fbuoyancy', 1e-9, 1e-12)
    return
  }
  if (template.domain === 'fluid') {
    const model = nativeObject(raw, 'model')
    if (template.id === 'solid-pressure') {
      expectScalar(raw, 'contact_pressure', nativeNumber(model, 'force') / nativeNumber(model, 'area'), 'Pa', 'pressure')
    } else if (template.id === 'liquid-pressure') {
      expectScalar(raw, 'liquid_pressure', nativeNumber(model, 'liquidDensity') * nativeNumber(model, 'gravity') * nativeNumber(model, 'depth'), 'Pa', 'pressure')
    } else {
      expectScalar(raw, 'barometer_column', nativeNumber(model, 'atmosphericPressure') / (nativeNumber(model, 'barometerFluidDensity') * nativeNumber(model, 'gravity')), 'm', 'length')
    }
    return
  }
  if (template.id === 'thermometer') {
    const model = nativeObject(raw, 'model')
    const sensitivity = nativeNumber(model, 'bulbVolume') * nativeNumber(model, 'expansionCoefficient') /
      (Math.PI * (nativeNumber(model, 'boreDiameter') / 2) ** 2)
    expectScalar(raw, 'scale_factor', sensitivity, 'm', 'length')
    expectScalar(raw, 'column_length', nativeNumber(model, 'icePointLength') + (nativeNumber(model, 'temperature') - 273.15) * sensitivity, 'm', 'length')
    return
  }
  if (template.domain === 'thermal') {
    const model = nativeObject(raw, 'model')
    const current = nativeObject(raw, 'currentState')
    near(nativeNumber(current, 'heatAbsorbed'), nativeNumber(model, 'heaterPower') * raw.clock.time, 'Q=Pt', 1e-9, 1e-12)
    expect(nativeNumber(current, 'temperature')).toBeGreaterThan(0)
    return
  }
  if (template.id === 'transformer') {
    const model = nativeObject(raw, 'model')
    const ratio = nativeNumber(model, 'secondaryTurns') / nativeNumber(model, 'primaryTurns')
    expectScalar(raw, 'secondary_voltage', nativeNumber(model, 'primaryVoltage') * ratio, 'V', 'electric_potential')
    expectScalar(raw, 'secondary_current', nativeNumber(model, 'primaryCurrent') / ratio, 'A', 'electric_current')
    expectScalar(raw, 'secondary_power', nativeNumber(model, 'primaryVoltage') * nativeNumber(model, 'primaryCurrent'), 'W', 'power')
    return
  }
  if (template.domain === 'induction') {
    const derived = state.derived
    const emf = canonicalValue(derivedScalar(derived, 'induced_emf'))
    const current = canonicalValue(derivedScalar(derived, 'induced_current'))
    const resistance = canonicalValue(derivedScalar(derived, 'loop_resistance'))
    near(current, emf / resistance, 'I=E/R', 1e-9, 1e-12)
    if (template.id === 'induction-flux-change') {
      near(emf, -canonicalValue(derivedScalar(derived, 'flux_rate')), 'E=-dΦ/dt')
    } else {
      const B = canonicalValue(derivedScalar(derived, 'magnetic_flux_density'))
      const L = canonicalValue(derivedScalar(derived, 'bar_length'))
      const velocity = canonicalValue(derivedScalar(derived, template.id === 'induction-bar-motion' ? 'bar_velocity' : 'relative_velocity'))
      near(emf, B * L * velocity, 'E=BLv', 1e-9, 1e-12)
    }
    return
  }
  if (template.domain === 'wave') {
    const model = resolveWaveModel(scene)
    expectScalar(raw, 'period', 1 / model.frequency, 's', 'time')
    expectScalar(raw, 'amplitude', model.amplitude, 'm', 'length')
    if (template.id !== 'wave-doppler') expectScalar(raw, 'wave_speed', model.waveSpeed, 'm/s', 'velocity')
    if (template.id === 'wave-standing') {
      expectScalar(raw, 'frequency', model.harmonic! * model.waveSpeed / (2 * model.stringLength!), 'Hz', 'frequency')
    } else if (template.id === 'wave-interference') {
      const difference = Math.abs(model.pathTwo! - model.pathOne!)
      expectScalar(raw, 'resultant_amplitude', 2 * model.amplitude * Math.abs(Math.cos(Math.PI * difference / model.wavelength)), 'm', 'length')
    }
    return
  }
  if (template.domain === 'modern') {
    const bench = scene.modernPhysicsBenches![0]!
    const photonEnergy = H * C / canonicalValue(bench.photonWavelength)
    const kinetic = Math.max(0, photonEnergy - canonicalValue(bench.workFunction))
    const current = kinetic === 0 ? 0 : E_CHARGE * canonicalValue(bench.lightIntensity) * canonicalValue(bench.cathodeArea) * bench.quantumEfficiency / photonEnergy
    expectScalar(raw, 'photon_energy', photonEnergy, 'J', 'energy')
    expectScalar(raw, 'max_kinetic_energy', kinetic, 'J', 'energy')
    expectScalar(raw, 'stopping_potential', kinetic / E_CHARGE, 'V', 'electric_potential')
    expectScalar(raw, 'photocurrent', current, 'A', 'electric_current')
    return
  }
  throw new Error(`No actual numerical assertion for ${template.id}`)
}

const metricId = (provenance: string, key: string, target: string | undefined, component: MetricComponent, value: Quantity | QuantityVector): string =>
  [provenance, key, target ?? '', component, value.dimension, value.unit].map(part => encodeURIComponent(part)).join(':')
const expectRowQuantity = (
  dataset: DatasetObject, row: DatasetRow, provenance: string, key: string,
  target: string | undefined, value: Quantity | QuantityVector,
): void => {
  const components = 'vector' in value ? ['x', 'y', 'z'] as const : ['scalar'] as const
  for (const component of components) {
    const id = metricId(provenance, key, target, component, value)
    const metric = dataset.metrics.find(entry => entry.id === id)
    if (metric === undefined) throw new Error(`Lost raw metric ${id}`)
    const expected = 'vector' in value && component !== 'scalar' ? value.vector[component]
      : 'value' in value ? value.value : undefined
    if (row.values[id] !== expected || metric.unit !== value.unit || metric.dimension !== value.dimension) {
      throw new Error(`Dataset altered stored numerical evidence ${row.rowId}/${id}`)
    }
  }
}
const expectDerivedRow = (dataset: DatasetObject, row: DatasetRow, entries: readonly DerivedQuantity[]): void => {
  for (const entry of entries) expectRowQuantity(dataset, row, 'derived', entry.key, entry.targetId, entry.value)
}
const expectStateRows = (dataset: DatasetObject, states: readonly SimulationState[]): void => {
  expect(dataset.rows).toHaveLength(states.length)
  for (const [index, state] of states.entries()) {
    const row = dataset.rows[index]!
    expect(row.evidence?.rawTime).toEqual(state.time)
    if (dataset.axes[0]?.kind === 'time') expect(row.axes.time).toBe(canonicalValue(state.time))
    if (dataset.axes[0]?.kind === 'static') expect(row.axes.static).toBe(0)
    for (const object of state.objects) {
      for (const key of ['position', 'velocity', 'acceleration'] as const) {
        const value = object[key]
        if (value !== undefined) expectRowQuantity(dataset, row, 'object', key, object.id, value)
      }
      for (const [key, value] of Object.entries(object.values ?? {})) expectRowQuantity(dataset, row, 'object', key, object.id, value)
    }
    expectDerivedRow(dataset, row, state.derived)
  }
}
interface PublishedEvidence {
  readonly raw: CapturedResult
  readonly scene: ReturnType<typeof createSceneObject>
  readonly datasets: readonly DatasetObject[]
  readonly snapshot: SnapshotObject
}
const publishEvidence = async (owner: WorkbenchInstanceRuntime): Promise<PublishedEvidence> => {
  // Await the real shared module; no test-side public capture/snapshot facsimiles.
  const { publicCapturedResult, createSnapshotObject, captureDatasets } = await import('@physicsos/physics-workbench/data')
  const held = owner.captureRaw()
  const raw = publicCapturedResult(held)
  expect(raw).not.toBe(held)
  expect(raw.scene).not.toBe(held.scene)
  // The owner already published immutable, schema-validated evidence; repeated
  // publication shares that frozen result rather than copying every sample.
  expect(raw.result).toBe(held.result)
  expect(raw).toEqual(held)
  expect(Object.isFrozen(raw.result?.states)).toBe(true)
  assertPlainFinite(raw)
  assertUnits(raw)
  const scene = createSceneObject(raw.scene)
  const sceneRef = refOf('scene', scene)
  const datasets = captureDatasets(raw, { sourceScene: sceneRef })
  const states = datasets.find(dataset => dataset.origin.collection === 'states')
  if (states === undefined) throw new Error('Publication lost the full stored-state dataset')
  expectStateRows(states, resultOf(raw).states)
  expect(states.axes[0]?.kind).toBe(raw.cursor.kind)
  if (resultOf(raw).states.length > 12) {
    expect(states.rows.length).toBeGreaterThan(12)
    // Some existing panels already expose every stored row; capture must never retain fewer.
    expect(states.rows.length).toBeGreaterThanOrEqual(owner.frames.getSnapshot().table.rows.length)
  }
  const measurementDatasets = datasets.filter(dataset => dataset.origin.collection === 'measurements')
  expect(measurementDatasets.reduce((count, dataset) => count + dataset.rows.length, 0)).toBe(resultOf(raw).measurements.length)
  for (const [index, measurement] of resultOf(raw).measurements.entries()) {
    const id = `measurement:${index}:${measurement.id}`
    const dataset = measurementDatasets.find(entry => entry.rows.some(row => row.rowId === id))!
    const row = dataset.rows.find(entry => entry.rowId === id)!
    expectRowQuantity(dataset, row, 'measurement', measurement.definitionId ?? measurement.id, measurement.targetId, measurement.value)
  }
  const derived = datasets.find(dataset => dataset.origin.collection === 'derived')
  if (derived === undefined) throw new Error('Publication lost actual result quantities')
  expectDerivedRow(derived, derived.rows[0]!, resultOf(raw).derivedQuantities)
  const cursor = datasets.find(dataset => dataset.id === `capture:${String(raw.scene.id)}:${raw.scene.revision}:cursor`)
  if (raw.state !== undefined) {
    if (cursor === undefined) throw new Error('Publication lost the genuine held cursor state')
    expectStateRows(cursor, [raw.state])
  } else {
    expect(cursor, 'A native capture must not manufacture a generic cursor sample').toBeUndefined()
    expect(raw.rawState).toBeDefined()
  }
  for (const analysis of raw.analysis ?? []) {
    const published = datasets.find(dataset => dataset.id === analysis.id)
    expect(published?.rows).toEqual(analysis.rows)
    expect(published?.rows).toHaveLength(analysis.rows.length)
    expect(published?.axes).toEqual(analysis.axes)
    expect(published?.metrics).toEqual(analysis.metrics)
    expect(published?.conditions).toEqual(analysis.conditions)
  }
  for (const dataset of datasets) {
    expect(dataset.sourceScene).toEqual(sceneRef)
    expect(dataset.origin.sceneId).toBe(String(raw.scene.id))
    expect(dataset.origin.sceneRevision).toBe(raw.scene.revision)
    assertPlainFinite(dataset)
    assertUnits(dataset)
    const parsed = parseObject(JSON.parse(bytes(dataset)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    expect(parsed.value).toEqual(dataset)
  }
  const saved = owner.serialize()
  const snapshot = createSnapshotObject({ ...raw, sceneRef, instanceId: owner.instanceKey,
    instanceEditRevision: saved.instanceEditRevision, capturedAt: CAPTURED_AT, source: 'client-engine',
    datasets: datasets.map(dataset => refOf('dataset', dataset)),
  })
  expect(snapshot.request).toEqual(raw.request)
  expect(snapshot.result).toEqual(raw.result)
  expect(snapshot.result?.measurements).toEqual(resultOf(raw).measurements)
  expect(snapshot.result?.events).toEqual(resultOf(raw).events)
  expect(snapshot.capturedState).toEqual(raw.state)
  expect(snapshot.rawState).toEqual(raw.rawState)
  expect(snapshot.sceneRevision).toBe(saved.scene.revision)
  expect(snapshot.instanceEditRevision).toBe(saved.instanceEditRevision)
  expect(snapshot.clock).toEqual(saved.clock)
  expect(snapshot.engine.release).toEqual(saved.scene.metadata.experimentRelease)
  const payload = { saved, raw, scene, datasets, snapshot }
  assertPlainFinite(payload)
  assertUnits(payload)
  expect(bytes(JSON.parse(bytes(payload)))).toBe(bytes(payload))
  expect(bytes(payload)).not.toContain('sampleReadout')
  const decoded = parseObject(JSON.parse(bytes(snapshot)))
  expect(decoded.ok).toBe(true)
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.issues))
  expect(decoded.value).toEqual(snapshot)
  return { raw, scene, datasets, snapshot }
}

const sceneFacts = (scene: PhysicsScene): unknown => {
  const { id: _id, revision: _revision, timeline, metadata, ...facts } = scene
  const { currentTime: _time, state: _state, playbackRate: _rate, ...schedule } = timeline
  const { createdAt: _created, updatedAt: _updated, lineage: _lineage, ...annotations } = metadata
  return JSON.parse(bytes({ ...facts, timeline: schedule, metadata: annotations }))
}

describe('actual workbench instance owner · complete template catalog', () => {
  it('covers all selectable rows, all twelve domains, and every real sibling bench', () => {
    expect(templates.length).toBeGreaterThan(3)
    expect(templates.length).toBeGreaterThanOrEqual(40)
    expect(templates).toHaveLength(SELECTABLE_TEMPLATE_COUNT)
    expect(EXPERIMENT_TEMPLATE_GROUPS.flatMap(group => group.templates)).toEqual(EXPERIMENT_TEMPLATES)
    expect(new Set(templates.map(template => template.id)).size).toBe(templates.length)
    expect([...new Set(templates.map(template => template.domain))].sort()).toEqual([...domains].sort())
    expect(Object.keys(baselines).sort()).toEqual(templates.map(template => template.id).sort())
  })

  for (const template of templates) {
    it(`${template.domain}/${template.id}: real controls, gesture history, raw numerical evidence and saved-clock restoration`, async () => {
      const source = createExperimentSceneRef(template, template.id).scene
      const original = bytes(source)
      const committed = vi.fn()
      const persisted = vi.fn()
      const owner = own({ scene: source, originScene: source, templateId: template.id,
        source: { kind: 'template', id: template.id }, onCommitted: committed, onPersist: persisted,
      })
      expect(owner.instanceKey).not.toBe(String(source.id))
      expect(owner.getScene().id).not.toBe(source.id)
      expect(owner.getSnapshot().domain).toBe(template.domain)
      expect(owner.getSnapshot().workspace.status).toBe('verified')
      const initial = owner.captureRaw()
      for (const expected of baselines[template.id]!) {
        expectScalar(initial, expected.key, expected.value, expected.unit, expected.dimension, expected.scope)
      }
      expectPhysics(template, initial)
      expectAligned(owner, initial)
      const parameterIds = owner.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).map(parameter => parameter.id)
      expect(parameterIds.length, `${template.id} has real editable fields`).toBeGreaterThan(0)
      for (const id of parameterIds) {
        const parameter = parameterOf(owner, id)
        const value = safeEdit(parameter)
        const before = owner.serialize()
        const rawBefore = bytes(owner.captureRaw())
        const commitCalls = committed.mock.calls.length
        const persistCalls = persisted.mock.calls.length
        owner.previewParameter(id, value)
        expect(owner.getSnapshot().previewing, id).toBe(true)
        near(parameterOf(owner, id).value, value, `${id}: preview presents the actual tentative value`, 1e-9, Math.abs(parameter.step ?? 0) * 1e-7)
        expect(owner.frames.getSnapshot().sceneRevision, id).toBe(before.scene.revision)
        expect(owner.serialize(), `${id}: preview owns no committed facts/history`).toEqual(before)
        expect(() => owner.captureRaw()).toThrow(/CAPTURE_UNAVAILABLE/)
        owner.recordObservation()
        owner.persist()
        owner.cancelParameterPreview()
        expect(owner.getSnapshot().previewing).toBe(false)
        expect(owner.serialize(), `${id}: cancel restores the complete committed state`).toEqual(before)
        expect(bytes(owner.captureRaw()), `${id}: cancel leaves held numerical evidence unchanged`).toBe(rawBefore)
        expect(committed).toHaveBeenCalledTimes(commitCalls)
        expect(persisted).toHaveBeenCalledTimes(persistCalls)
        owner.commitParameter(id, value)
        expectOneGesture(owner, before, `parameter:${id}`)
        near(parameterOf(owner, id).value, value, `${id}: real field settles to requested value`, 1e-9, Math.abs(parameter.step ?? 0) * 1e-7)
        expect(committed).toHaveBeenCalledTimes(commitCalls + 1)
        expect(persisted).toHaveBeenCalledTimes(persistCalls + 1)
        const raw = owner.captureRaw()
        expectAligned(owner, raw)
        expectPhysics(template, raw)
      }
      const choiceIds = owner.frames.getSnapshot().inspector.flatMap(section => section.choices ?? []).map(choice => choice.id)
      for (const id of choiceIds) {
        const choice = choiceOf(owner, id)
        // "custom" reports a numeric editor's state; it is not a physical preset.
        const option = choice.options.find(entry => entry.value !== choice.value && entry.value !== 'custom')
        if (option === undefined) throw new Error(`No real alternate choice for ${template.id}/${id}`)
        const before = owner.serialize()
        const calls = committed.mock.calls.length
        owner.setChoice(id, option.value)
        const presentationOnly = id === 'standing-mode' || id === 'projectile-comparison'
        if (presentationOnly) {
          const after = owner.serialize()
          expect(after.scene).toEqual(before.scene)
          expect(after.history).toEqual(before.history)
          expect(after.instanceEditRevision).toBe(before.instanceEditRevision)
        } else expectOneGesture(owner, before, `choice:${id}`)
        expect(choiceOf(owner, id).value).toBe(option.value)
        expect(committed).toHaveBeenCalledTimes(calls + (presentationOnly ? 0 : 1))
        const raw = owner.captureRaw()
        expectAligned(owner, raw)
        expectPhysics(template, raw)
        if (presentationOnly) {
          // Exercise both existing lesson views, then restore the original
          // local presentation before the separate persisted-physics test.
          owner.setChoice(id, choice.value)
          expect(choiceOf(owner, id).value).toBe(choice.value)
          expect(owner.serialize().scene).toEqual(before.scene)
          expect(owner.serialize().history).toEqual(before.history)
          expect(committed).toHaveBeenCalledTimes(calls)
        }
      }
      if (template.domain === 'circuit') {
        const beforeMode = owner.serialize()
        owner.enterBuilder()
        expect(owner.getSnapshot().buildMode).toBe('construct')
        expect(owner.serialize().history).toEqual(beforeMode.history)
        expect(owner.serialize().instanceEditRevision).toBe(beforeMode.instanceEditRevision)
      }
      const end = owner.frames.getSnapshot().clock.total
      owner.seek(end > 0 ? end * 0.237 : 0)
      owner.setRate(1.75)
      owner.setRunning(end > 0)
      const captured = await publishEvidence(owner)
      expectAligned(owner, captured.raw)
      const saved = owner.serialize()
      const savedBytes = bytes(saved)
      const restored = reopen(JSON.parse(savedBytes) as WorkbenchCommittedState)
      expect(restored.instanceKey).toBe(saved.instanceKey)
      expect(restored.getScene().id).toBe(saved.scene.id)
      expect(restored.getScene().revision).toBe(saved.scene.revision)
      expect(bytes(restored.serialize())).toBe(bytes(saved))
      const restoredRaw = restored.captureRaw()
      expectAligned(restored, restoredRaw)
      expect(restoredRaw.state).toEqual(captured.raw.state)
      expect(restoredRaw.rawState).toEqual(captured.raw.rawState)
      expect(resultOf(restoredRaw).states).toEqual(resultOf(captured.raw).states)
      expect(resultOf(restoredRaw).measurements).toEqual(resultOf(captured.raw).measurements)
      expect(resultOf(restoredRaw).derivedQuantities).toEqual(resultOf(captured.raw).derivedQuantities)
      expect(restoredRaw.request?.options).toEqual(captured.raw.request?.options)
      const beforeUndo = restored.serialize()
      const entry = beforeUndo.history.past.at(-1)!
      restored.undo()
      expect(restored.serialize().instanceEditRevision).toBe(beforeUndo.instanceEditRevision + 1)
      expect(restored.getScene().id).toBe(saved.scene.id)
      expect(restored.getScene().revision).toBeGreaterThan(beforeUndo.scene.revision)
      expect(sceneFacts(restored.getScene())).toEqual(sceneFacts(entry.before))
      restored.redo()
      expect(restored.serialize().instanceEditRevision).toBe(beforeUndo.instanceEditRevision + 2)
      expect(restored.getScene().id).toBe(saved.scene.id)
      expect(sceneFacts(restored.getScene())).toEqual(sceneFacts(saved.scene))
      expectAligned(restored)
      expect(bytes(owner.serialize())).toBe(savedBytes)
      expect(bytes(source), 'The catalog origin is immutable through editing, capture and restoration').toBe(original)
      assertPlainFinite(owner.frames.getSnapshot(), '$frame', true)
      assertPlainFinite(owner.getSnapshot(), '$summary', true)
      expect(bytes(owner.frames.getSnapshot())).not.toContain('sampleReadout')
    })
  }
})

describe('workbench origin and content-addressed annotation history', () => {
  it('keeps source facts immutable and instance revisions increasing across fact fork, undo, redo and origin restore', async () => {
    const origin = sceneOf('projectile-horizontal')
    origin.revision = 9
    origin.metadata.sourceQuestionId = asQuestionId('owner-question-origin')
    const original = bytes(origin)
    const owner = own({ scene: origin, originScene: origin, sceneId: 'owner-question-world', instanceEditRevision: 40,
      templateId: 'projectile-horizontal', source: { kind: 'question', questionId: 'owner-question-origin' },
    })
    const initialId = owner.getScene().id
    const historical = await publishEvidence(owner)
    const historicalBytes = bytes(historical)
    owner.seek(0.731)
    owner.setHighlight(['launch-height'])
    expect(owner.getScene().id).toBe(initialId)
    expect(owner.serialize().instanceEditRevision).toBe(40)
    owner.previewParameter('height', 30)
    owner.cancelParameterPreview()
    expect(owner.serialize().instanceEditRevision).toBe(40)
    owner.commitParameter('height', 30)
    const forked = owner.serialize()
    expect(forked.scene.id).not.toBe(initialId)
    expect(forked.scene.id).not.toBe(origin.id)
    expect(forked.scene.metadata.lineage).toMatchObject({ branchType: 'experimental', originQuestionId: origin.metadata.sourceQuestionId })
    expect(forked.instanceEditRevision).toBe(41)
    const ownedId = forked.scene.id
    owner.undo()
    expect(owner.getScene().id).toBe(ownedId)
    expect(owner.serialize().instanceEditRevision).toBe(42)
    owner.redo()
    expect(owner.getScene().id).toBe(ownedId)
    expect(owner.serialize().instanceEditRevision).toBe(43)
    const beforeRestore = owner.serialize()
    owner.restoreOrigin()
    expectOneGesture(owner, beforeRestore, 'restore-origin')
    expect(owner.getScene().id).toBe(ownedId)
    expect(owner.serialize().instanceEditRevision).toBe(44)
    expect(sceneFacts(owner.getScene())).toEqual(sceneFacts(origin))
    expect(owner.getSnapshot().capabilities.restoreOrigin).toBe(false)
    expectAligned(owner)
    const noOp = bytes(owner.serialize())
    owner.restoreOrigin()
    expect(bytes(owner.serialize())).toBe(noOp)
    expect(bytes(origin)).toBe(original)
    expect(bytes(historical)).toBe(historicalBytes)
    expect(historical.snapshot.result?.sceneId).toBe(initialId)
    expect(historical.snapshot.instanceEditRevision).toBe(40)
  })

  it('release/notebook edits create new raw identities and hashes without per-frame metadata drift', async () => {
    const owner = ownerOf('uniform-linear')
    owner.seek(0.731)
    const before = await publishEvidence(owner)
    const beforeBytes = bytes(before)
    const release = { kind: 'official' as const, id: 'owner-uniform-v2', experimentId: 'uniform-linear', version: '2.0.0' }
    let saved = owner.serialize()
    owner.setRelease(release)
    expectOneGesture(owner, saved, 'renderer-release')
    const released = await publishEvidence(owner)
    expect(released.raw.scene.id).toBe(before.raw.scene.id)
    expect(released.raw.scene.revision).toBeGreaterThan(before.raw.scene.revision)
    expect(released.raw.engineInfo.release).toEqual(release)
    expect(released.snapshot.engine.release).toEqual(release)
    expect(released.snapshot.result?.sceneRevision).toBe(released.raw.scene.revision)
    expect(hash(released.scene)).not.toBe(hash(before.scene))
    expect(hash(released.snapshot)).not.toBe(hash(before.snapshot))
    expect(resultOf(released.raw).states).toEqual(resultOf(before.raw).states)
    saved = owner.serialize()
    owner.recordObservation()
    expectOneGesture(owner, saved, 'notebook:capture')
    const recorded = await publishEvidence(owner)
    const notebook = readNotebook(owner.getScene())
    expect(notebook).toHaveLength(1)
    expect(notebook[0]?.sceneRevision).toBe(saved.scene.revision)
    expect(notebook[0]?.experimentRelease).toEqual(release)
    expect(hash(recorded.scene)).not.toBe(hash(released.scene))
    expect(hash(recorded.snapshot)).not.toBe(hash(released.snapshot))
    const annotatedScene = bytes(owner.getScene())
    const annotatedHistory = bytes(owner.serialize().history)
    owner.setRunning(true)
    owner.advance(0.1, 100)
    owner.advance(0.1, 200)
    expect(bytes(owner.getScene())).toBe(annotatedScene)
    expect(bytes(owner.serialize().history)).toBe(annotatedHistory)
    saved = owner.serialize()
    owner.setRelease(undefined)
    expectOneGesture(owner, saved, 'renderer-release')
    expect(owner.captureRaw().engineInfo.release).toBeUndefined()
    owner.undo()
    expect(owner.captureRaw().engineInfo.release).toEqual(release)
    expect(readNotebook(owner.getScene())).toEqual(notebook)
    owner.redo()
    expect(owner.captureRaw().engineInfo.release).toBeUndefined()
    saved = owner.serialize()
    owner.removeObservation(notebook[0]!.id)
    expectOneGesture(owner, saved, 'notebook:remove')
    expect(readNotebook(owner.getScene())).toEqual([])
    owner.undo()
    expect(readNotebook(owner.getScene())).toEqual(notebook)
    expect(bytes(before)).toBe(beforeBytes)
    const restored = reopen(JSON.parse(bytes(owner.serialize())) as WorkbenchCommittedState)
    expect(restored.getSnapshot().notebook).toEqual(owner.getSnapshot().notebook)
    expect(restored.serialize().history).toEqual(owner.serialize().history)
    expectAligned(restored)
  })
})

const componentOf = (draft: CircuitDraft, id: string): BuilderComponent => {
  const component = draft.components.find(entry => entry.id === id)
  if (component === undefined) throw new Error(`Missing authored component ${id}`)
  return component
}
const draftOf = (owner: WorkbenchInstanceRuntime): CircuitDraft => {
  const draft = owner.serialize().draft
  if (draft === undefined) throw new Error('The owner lost its current construct draft')
  return draft
}

describe('one physical history across generic controls and circuit authoring', () => {
  it('unifies parameter, slider, placement, switch, add/remove/rotate and wire gestures, including reverse replay', async () => {
    const owner = ownerOf('rheostat-circuit')
    const source = bytes(owner.serialize().originScene)
    owner.enterBuilder()
    const states: WorkbenchCommittedState[] = [owner.serialize()]
    const gesture = (action: () => void, label?: string): void => {
      const before = owner.serialize()
      action()
      states.push(expectOneGesture(owner, before, label))
      expect(draftOf(owner).components.map(component => component.id)).toEqual(draftFromScene(owner.getScene()).components.map(component => component.id))
    }
    const cancelBefore = owner.serialize()
    const captureBefore = bytes(owner.captureRaw())
    owner.previewParameter('emf', 9)
    owner.cancelParameterPreview()
    owner.previewSliderPosition('rv', 0.4)
    owner.cancelSliderPosition()
    owner.previewComponentPlacement('r0', { x: -2.5, y: 1 })
    owner.cancelComponentPlacement()
    owner.beginWire({ componentId: 'bat', terminalKey: 'positive' })
    expect(owner.getSnapshot().pendingWire).toEqual({ componentId: 'bat', terminalKey: 'positive' })
    owner.cancelWire()
    expect(owner.getSnapshot().pendingWire).toBeUndefined()
    expect(owner.serialize()).toEqual(cancelBefore)
    expect(bytes(owner.captureRaw())).toBe(captureBefore)
    gesture(() => { owner.commitParameter('emf', 9) }, 'parameter:emf')
    gesture(() => { owner.previewSliderPosition('rv', 0.4); owner.commitSliderPosition('rv', 0.4) }, 'slider:rv')
    expect(componentOf(draftOf(owner), 'bat').params.voltage).toBe(9)
    expect(componentOf(draftOf(owner), 'rv').params.sliderPosition).toBe(0.4)
    expectScalar(owner.captureRaw(), 'main_current', 9 / 18, 'A', 'electric_current', 'state')
    gesture(() => { owner.previewComponentPlacement('r0', { x: -3.5, y: 1 }); owner.commitComponentPlacement('r0', { x: -3.5, y: 1 }) }, 'component:placement')
    expect(componentOf(draftOf(owner), 'r0').placement).toMatchObject({ x: -3.5, y: 1 })
    gesture(() => { owner.setSwitchState('sw', 'open') }, 'switch:sw')
    expectScalar(owner.captureRaw(), 'main_current', 0, 'A', 'electric_current', 'state')
    gesture(() => { owner.setChoice('switch:sw', 'closed') }, 'choice:switch:sw')
    const ids = new Set(draftOf(owner).components.map(component => component.id))
    gesture(() => { owner.addComponent('resistor', { x: 1, y: 1 }, { resistance: 50 }) }, 'circuit:draft')
    const added = draftOf(owner).components.find(component => !ids.has(component.id))!.id
    const nextNet = draftOf(owner).nextNet
    gesture(() => { owner.rotateComponent(added) }, 'circuit:draft')
    expect(componentOf(draftOf(owner), added).placement.rotation).toBe(90)
    gesture(() => { owner.setComponentParams(added, { resistance: 100 }) }, 'circuit:draft')
    gesture(() => { owner.moveComponent(added, { x: 1.2, y: 2.2 }) }, 'circuit:draft')
    expect(componentOf(draftOf(owner), added).placement).toMatchObject(snapToGrid({ x: 1.2, y: 2.2 }))
    const wireBefore = owner.serialize()
    owner.beginWire({ componentId: added, terminalKey: 'a' })
    expect(owner.serialize()).toEqual(wireBefore)
    gesture(() => { owner.completeWire({ componentId: 'r0', terminalKey: 'a' }) }, 'circuit:draft')
    expect(componentOf(draftOf(owner), added).nets.a).toBe(componentOf(draftOf(owner), 'r0').nets.a)
    expect(draftOf(owner).nextNet).toBeGreaterThanOrEqual(nextNet)
    const alreadyConnected = bytes(owner.serialize())
    owner.beginWire({ componentId: added, terminalKey: 'a' })
    owner.completeWire({ componentId: 'r0', terminalKey: 'a' })
    expect(bytes(owner.serialize())).toBe(alreadyConnected)
    gesture(() => { owner.connectTerminals({ componentId: added, terminalKey: 'b' }, { componentId: 'r0', terminalKey: 'b' }) }, 'circuit:draft')
    expectScalar(owner.captureRaw(), 'main_current', 9 / (8 + 1 / (1 / 10 + 1 / 100)), 'A', 'electric_current', 'state')
    gesture(() => { owner.disconnectTerminal({ componentId: added, terminalKey: 'b' }) }, 'circuit:draft')
    gesture(() => { owner.removeComponent(added) }, 'circuit:draft')
    expect(draftOf(owner).components.some(component => component.id === added)).toBe(false)
    expect(componentOf(draftOf(owner), 'bat').params.voltage).toBe(9)
    expect(componentOf(draftOf(owner), 'rv').params.sliderPosition).toBe(0.4)
    const final = owner.serialize()
    const finalRaw = await publishEvidence(owner)
    let editRevision = final.instanceEditRevision
    let sceneRevision = final.scene.revision
    for (let index = states.length - 2; index >= 0; index -= 1) {
      owner.undo()
      expect(owner.serialize().instanceEditRevision).toBe(++editRevision)
      expect(owner.getScene().revision).toBeGreaterThan(sceneRevision)
      sceneRevision = owner.getScene().revision
      expect(owner.getScene().id).toBe(final.scene.id)
      expect(sceneFacts(owner.getScene())).toEqual(sceneFacts(states[index]!.scene))
      expect(owner.serialize().draft).toEqual(states[index]!.draft)
    }
    for (let index = 1; index < states.length; index += 1) {
      owner.redo()
      expect(owner.serialize().instanceEditRevision).toBe(++editRevision)
      expect(owner.getScene().revision).toBeGreaterThan(sceneRevision)
      sceneRevision = owner.getScene().revision
      expect(sceneFacts(owner.getScene())).toEqual(sceneFacts(states[index]!.scene))
      expect(owner.serialize().draft).toEqual(states[index]!.draft)
    }
    expect(owner.serialize().history).toEqual(final.history)
    expect(bytes(owner.serialize().originScene)).toBe(source)
    expect(finalRaw.snapshot.result?.states).toEqual(resultOf(finalRaw.raw).states)
    const restored = reopen(JSON.parse(bytes(owner.serialize())) as WorkbenchCommittedState)
    expect(restored.serialize()).toEqual(owner.serialize())
    const beforeNew = restored.serialize()
    restored.addComponent('resistor', { x: 3, y: 2 }, { resistance: 20 })
    expectOneGesture(restored, beforeNew, 'circuit:draft')
    expect(componentOf(draftOf(restored), 'bat').params.voltage).toBe(9)
    expect(componentOf(draftOf(restored), 'rv').params.sliderPosition).toBe(0.4)
    expect(owner.serialize().history).toEqual(final.history)
  })

  it('preserves current draft net allocation across generic edits, restore and a subsequent structural edit', () => {
    const owner = ownerOf('rheostat-circuit')
    owner.enterBuilder()
    owner.addComponent('resistor', { x: 1, y: 2 }, { resistance: 50 })
    const cursor = draftOf(owner).nextNet
    owner.commitParameter('emf', 9)
    expect(draftOf(owner).nextNet).toBeGreaterThanOrEqual(cursor)
    owner.previewSliderPosition('rv', 0.5)
    owner.cancelSliderPosition()
    expect(componentOf(draftOf(owner), 'bat').params.voltage).toBe(9)
    const saved = owner.serialize()
    const restored = reopen(JSON.parse(bytes(saved)) as WorkbenchCommittedState)
    expect(draftOf(restored)).toEqual(saved.draft)
    restored.undo()
    restored.redo()
    expect(draftOf(restored)).toEqual(saved.draft)
    restored.restoreOrigin()
    const restoredFacts = sceneFacts(restored.getScene())
    expect(restoredFacts).toEqual(sceneFacts(saved.originScene!))
    restored.addComponent('resistor', { x: 2, y: 1 }, { resistance: 30 })
    expect(componentOf(draftOf(restored), 'bat').params.voltage).toBe(6)
    expect(componentOf(draftOf(restored), 'rv').params.sliderPosition).toBe(0)
    expect(componentOf(draftOf(owner), 'bat').params.voltage).toBe(9)
  })
})

describe('independent instances and copying current, not template, state', () => {
  it('duplicates independently owned current parameters, draft, notebook, release, history and exact playhead', async () => {
    const input = sceneOf('rheostat-circuit')
    const original = bytes(input)
    const first = own({ scene: input, source: { kind: 'template', id: 'rheostat-circuit' }, templateId: 'rheostat-circuit' })
    const second = own({ scene: input, source: { kind: 'template', id: 'rheostat-circuit' }, templateId: 'rheostat-circuit' })
    first.commitParameter('emf', 9)
    first.commitSliderPosition('rv', 0.4)
    first.enterBuilder()
    const initialIds = new Set(draftOf(first).components.map(component => component.id))
    first.addComponent('resistor', { x: 2, y: 1 }, { resistance: 50 })
    const addedId = draftOf(first).components.find(component => !initialIds.has(component.id))!.id
    first.connectTerminals({ componentId: addedId, terminalKey: 'a' }, { componentId: 'r0', terminalKey: 'a' })
    first.connectTerminals({ componentId: addedId, terminalKey: 'b' }, { componentId: 'r0', terminalKey: 'b' })
    const release = { kind: 'official' as const, id: 'owner-current-release', experimentId: 'rheostat-circuit', version: '3.0.0' }
    first.setRelease(release)
    first.recordObservation()
    first.seek(0.731)
    first.setRate(2)
    first.setRunning(true)
    second.seek(0.123)
    const beforeDuplicate = first.serialize()
    const duplicate = keepDuplicate(first)
    expect(new Set([first.instanceKey, second.instanceKey, duplicate.instanceKey]).size).toBe(3)
    expect(new Set([first.getScene().id, second.getScene().id, duplicate.getScene().id]).size).toBe(3)
    expect(sceneFacts(duplicate.getScene())).toEqual(sceneFacts(first.getScene()))
    expect(duplicate.serialize().instanceEditRevision).toBe(beforeDuplicate.instanceEditRevision)
    expect(duplicate.serialize().history).toEqual(beforeDuplicate.history)
    expect(duplicate.serialize().draft).toEqual(beforeDuplicate.draft)
    expect(duplicate.serialize().draft).not.toBe(beforeDuplicate.draft)
    expect(duplicate.getSnapshot().notebook).toEqual(first.getSnapshot().notebook)
    expect(duplicate.getSnapshot().notebook).not.toBe(first.getSnapshot().notebook)
    expect(duplicate.getScene().metadata.experimentRelease).toEqual(release)
    expect(duplicate.getScene().metadata.experimentRelease).not.toBe(first.getScene().metadata.experimentRelease)
    expect(duplicate.frames.getSnapshot().clock).toEqual({ ...first.frames.getSnapshot().clock, running: false })
    const copied = await publishEvidence(duplicate)
    expect(copied.raw.state).toEqual(first.captureRaw().state)
    expect(copied.snapshot.engine.release).toEqual(release)
    const firstState = bytes(first.serialize())
    const secondState = bytes(second.serialize())
    duplicate.commitParameter('emf', 12)
    duplicate.removeObservation(duplicate.getSnapshot().notebook[0]!.id)
    duplicate.setRelease(undefined)
    expect(bytes(first.serialize())).toBe(firstState)
    expect(bytes(second.serialize())).toBe(secondState)
    expect(parameterOf(second, 'emf').value).toBe(6)
    expect(second.frames.getSnapshot().clock.time).toBe(0.123)
    const duplicateState = bytes(duplicate.serialize())
    first.advance(0.1, 100)
    expect(first.frames.getSnapshot().clock.time).toBeCloseTo(0.931, 12)
    expect(bytes(second.serialize())).toBe(secondState)
    expect(bytes(duplicate.serialize())).toBe(duplicateState)
    expect(bytes(input)).toBe(original)
  })

  it('defensively copies externally mutable scene/source/origin inputs before later edits', () => {
    const input = sceneOf('uniform-linear')
    const original = structuredClone(input)
    const source = { kind: 'template' as const, id: 'uniform-linear', title: 'original input', metadata: { author: 'first' } }
    const owner = own({ scene: input, originScene: input, source, templateId: 'uniform-linear' })
    input.bodies[0]!.mass.value = 999
    input.metadata.title = 'modified outside owner'
    source.title = 'modified outside owner'
    source.metadata.author = 'second'
    expect(owner.serialize().originScene).toEqual(original)
    expect(owner.getSnapshot().source).toMatchObject({ title: 'original input', metadata: { author: 'first' } })
    owner.commitParameter('speed', 8)
    owner.restoreOrigin()
    expect(sceneFacts(owner.getScene())).toEqual(sceneFacts(original))
    expect(owner.getScene().bodies[0]!.mass.value).toBe(1)
    expect(owner.getScene().metadata.title).toBe('uniform-linear')
  })
})

describe('single injected clock owner for card/focus displays', () => {
  it('publishes stable renderer frames at high frequency, summaries at low frequency, and stops at the last detach', () => {
    const scheduler = new DeterministicScheduler()
    const committed = vi.fn()
    const persisted = vi.fn()
    const owner = ownerOf('uniform-linear', { scheduler, summaryIntervalMs: 250, onCommitted: committed, onPersist: persisted })
    const frameListener = vi.fn()
    const summaryListener = vi.fn()
    const offFrame = owner.frames.subscribe(frameListener)
    const offSummary = owner.subscribe(summaryListener)
    const functions = [owner.getSnapshot, owner.subscribe, owner.frames.getSnapshot, owner.frames.subscribe, owner.actions]
    expect(owner.frameSource).toBe(owner.frames)
    expect(owner.frames.get).toBe(owner.frames.getSnapshot)
    expect(owner.subscribe).toBe(owner.summaries.subscribe)
    owner.setRunning(true)
    expect(scheduler.pending).toBe(0)
    const detachCard = owner.attachDisplay('canvas-card')
    const detachFocus = owner.attachDisplay('focus-inspector')
    expect(scheduler.pending).toBe(1)
    expect(scheduler.requests).toBe(1)
    scheduler.tick()
    const initialFrame = owner.frames.getSnapshot()
    const initialSummary = owner.getSnapshot()
    const sceneBytes = bytes(owner.getScene())
    frameListener.mockClear()
    summaryListener.mockClear()
    for (let frame = 0; frame < 8; frame += 1) {
      scheduler.tick(25)
      expect(scheduler.pending).toBe(1)
      expect(owner.frames.getSnapshot()).toBe(owner.frames.getSnapshot())
      expect(owner.getSnapshot()).toBe(initialSummary)
    }
    expect(frameListener).toHaveBeenCalledTimes(8)
    expect(summaryListener).not.toHaveBeenCalled()
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.2, 12)
    expect(owner.frames.getSnapshot().view).not.toBe(initialFrame.view)
    for (const key of ['charts', 'table', 'tree', 'verification', 'derivation', 'events', 'trajectoryTimes'] as const) {
      expect(owner.frames.getSnapshot()[key], `stable ${key} identity`).toBe(initialFrame[key])
    }
    const displacement = owner.frames.getSnapshot().inspector
      .flatMap(section => section.derived ?? []).find(entry => entry.id === 's')
    if (displacement === undefined) throw new Error('The live inspector lost its actual displacement reading')
    expect(displacement.unit).toBe('m')
    near(Number(displacement.value), 0.8, 'live inspector displacement at 0.2s')
    expectVector(derivedVector(stateOf(owner.captureRaw()).derived, 'displacement'),
      [0.8, 0, 0], 'm', 'length', 'held engine displacement at 0.2s')
    scheduler.tick(50)
    expect(summaryListener).toHaveBeenCalledTimes(1)
    expect(owner.getSnapshot()).not.toBe(initialSummary)
    expect(owner.getSnapshot().clock.time).toBeCloseTo(0.25, 12)
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.25, 12)
    expect([owner.getSnapshot, owner.subscribe, owner.frames.getSnapshot, owner.frames.subscribe, owner.actions]).toEqual(functions)
    detachCard()
    expect(scheduler.pending).toBe(1)
    scheduler.tick(25)
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.275, 12)
    detachFocus()
    expect(scheduler.pending).toBe(0)
    const detached = bytes(owner.serialize())
    scheduler.elapse(10000)
    scheduler.deliverCancelled()
    scheduler.tick()
    expect(bytes(owner.serialize())).toBe(detached)
    expect(bytes(owner.getScene())).toBe(sceneBytes)
    expect(committed).not.toHaveBeenCalled()
    expect(persisted).not.toHaveBeenCalled()
    owner.attachDisplay('canvas-card')
    scheduler.tick()
    scheduler.tick(25)
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.3, 12)
    owner.setVisible(false)
    expect(scheduler.pending).toBe(0)
    scheduler.elapse(10000)
    scheduler.deliverCancelled()
    owner.setVisible(true)
    expect(owner.frames.getSnapshot().clock.running).toBe(false)
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.3, 12)
    expect(scheduler.pending).toBe(0)
    offFrame()
    offSummary()
  })

  it('attaching the same display again does not reset the single owner clock', () => {
    const scheduler = new DeterministicScheduler()
    const owner = ownerOf('uniform-linear', { scheduler })
    owner.setRunning(true)
    const detach = owner.attachDisplay('canvas-card')
    scheduler.tick()
    scheduler.tick(50)
    owner.attachDisplay('canvas-card')
    expect(scheduler.pending).toBe(1)
    scheduler.tick(50)
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.1, 12)
    detach()
    expect(scheduler.pending).toBe(0)
  })

  it('preview pauses the scheduled engine and cancel resumes without preview time or a committed gesture', () => {
    const scheduler = new DeterministicScheduler()
    const committed = vi.fn()
    const owner = ownerOf('uniform-linear', { scheduler, onCommitted: committed })
    owner.attachDisplay('canvas-card')
    owner.setRunning(true)
    scheduler.tick()
    scheduler.tick(50)
    const before = owner.serialize()
    const rawBefore = bytes(owner.captureRaw())
    owner.previewParameter('speed', 8)
    expect(scheduler.pending).toBe(0)
    scheduler.elapse(10000)
    scheduler.deliverCancelled()
    owner.advance(5, scheduler.now())
    expect(owner.serialize()).toEqual(before)
    owner.cancelParameterPreview()
    expect(owner.serialize()).toEqual(before)
    expect(bytes(owner.captureRaw())).toBe(rawBefore)
    expect(scheduler.pending).toBe(1)
    scheduler.tick()
    scheduler.tick(50)
    expect(owner.frames.getSnapshot().clock.time).toBeCloseTo(0.1, 12)
    expect(owner.serialize().history).toEqual(before.history)
    expect(committed).not.toHaveBeenCalled()
  })

  it('isolates two simultaneous scheduled worlds and disposal cancels callbacks and closes both sources', () => {
    const scheduler = new DeterministicScheduler()
    const onError = vi.fn()
    const onCommitted = vi.fn()
    const onPersist = vi.fn()
    const first = ownerOf('uniform-linear', { scheduler, onError, onCommitted, onPersist })
    const second = ownerOf('uniform-linear', { scheduler })
    first.commitParameter('speed', 8)
    second.commitParameter('speed', 2)
    first.setRate(2)
    first.setRunning(true)
    second.setRunning(true)
    first.attachDisplay('card-1')
    first.attachDisplay('focus-1')
    second.attachDisplay('card-2')
    expect(scheduler.pending).toBe(2)
    const firstFrames = vi.fn()
    const firstSummaries = vi.fn()
    const secondFrames = vi.fn()
    const badListener = vi.fn(() => { throw new Error('test observer failure') })
    const offBad = first.frames.subscribe(badListener)
    first.frames.subscribe(firstFrames)
    first.subscribe(firstSummaries)
    second.frames.subscribe(secondFrames)
    scheduler.tick()
    scheduler.tick(50)
    expect(first.frames.getSnapshot().clock.time).toBeCloseTo(0.1, 12)
    expect(second.frames.getSnapshot().clock.time).toBeCloseTo(0.05, 12)
    expectVector(objectOf(stateOf(first.captureRaw())).position, [0.8, 0, 0], 'm', 'length', 'first world')
    expectVector(objectOf(stateOf(second.captureRaw())).position, [0.1, 0, 0], 'm', 'length', 'second world')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'test observer failure' }))
    expect(firstFrames).toHaveBeenCalledTimes(1)
    expect(secondFrames).toHaveBeenCalledTimes(1)
    const playingFrame = first.frames.getSnapshot()
    const commitCalls = onCommitted.mock.calls.length
    const persistCalls = onPersist.mock.calls.length
    first.dispose()
    const frame = first.frames.getSnapshot()
    const summary = first.summaries.getSnapshot()
    expect(frame.clock).toEqual({ ...playingFrame.clock, running: false })
    first.dispose()
    expect(first.getSnapshot().disposed).toBe(true)
    expect(scheduler.pending).toBe(1)
    scheduler.elapse(50)
    scheduler.deliverCancelled()
    scheduler.tick()
    expect(second.frames.getSnapshot().clock.time).toBeCloseTo(0.1, 12)
    expect(first.frames.getSnapshot()).toBe(frame)
    expect(first.summaries.getSnapshot()).toBe(summary)
    expect(firstFrames).toHaveBeenCalledTimes(1)
    expect(firstSummaries).not.toHaveBeenCalled()
    const lateListener = vi.fn()
    first.frames.subscribe(lateListener)
    first.subscribe(lateListener)
    first.frames.set({ ...frame, clock: { ...frame.clock, time: 999 } })
    first.summaries.set({ ...summary, disposed: false })
    first.commitParameter('speed', 12)
    first.recordObservation()
    first.setRelease(undefined)
    first.setRunning(true)
    first.advance(1, scheduler.now())
    first.attachDisplay('late-focus')
    first.persist()
    expect(first.frames.getSnapshot()).toBe(frame)
    expect(first.summaries.getSnapshot()).toBe(summary)
    expect(lateListener).not.toHaveBeenCalled()
    expect(onCommitted).toHaveBeenCalledTimes(commitCalls)
    expect(onPersist).toHaveBeenCalledTimes(persistCalls)
    expect(() => first.captureRaw()).toThrow(/CAPTURE_UNAVAILABLE/)
    expect(scheduler.pending).toBe(1)
    offBad()
    second.dispose()
    expect(scheduler.pending).toBe(0)
    const secondCount = secondFrames.mock.calls.length
    scheduler.elapse(5000)
    scheduler.deliverCancelled()
    scheduler.tick()
    expect(secondFrames).toHaveBeenCalledTimes(secondCount)
  })
})

describe('actual engine regressions and safe owner boundaries', () => {
  it('edits vertical apparent-weight speed as a magnitude while preserving direction', () => {
    const owner = ownerOf('apparent-weight')
    const before = owner.serialize()
    owner.commitParameter('speed', 2)
    expectOneGesture(owner, before, 'parameter:speed')
    near(parameterOf(owner, 'speed').value, 2, 'presented |v0|')
    expectVector(owner.getScene().bodies[0]!.velocity, [0, 2, 0], 'm/s', 'velocity', 'vertical launch direction')
    owner.seek(0.731)
    const raw = owner.captureRaw()
    expectVector(objectOf(stateOf(raw)).velocity, [0, 2 + 2 * 0.731, 0], 'm/s', 'velocity', 'vertical engine velocity')
    expectVector(objectOf(stateOf(raw)).position, [0, 2 * 0.731 + 0.731 ** 2, 0], 'm', 'length', 'vertical engine position')
    expectAligned(owner, raw)
  })

  it('uses actual frequency/wavelength coupling and below-threshold zeros in a static modern instance', async () => {
    const owner = ownerOf('photoelectric-effect')
    const before = owner.serialize()
    owner.commitParameter('photonFrequency', C / 700e-9)
    expectOneGesture(owner, before, 'parameter:photonFrequency')
    const raw = owner.captureRaw()
    near(canonicalValue(raw.scene.modernPhysicsBenches![0]!.photonWavelength), 700e-9, 'actual edited wavelength')
    expectScalar(raw, 'photon_energy', H * C / 700e-9, 'J', 'energy')
    expectScalar(raw, 'max_kinetic_energy', 0, 'J', 'energy')
    expectScalar(raw, 'photocurrent', 0, 'A', 'electric_current')
    expectScalar(raw, 'stopping_potential', 0, 'V', 'electric_potential')
    expect(resultOf(raw).verification.status).toBe('passed')
    expect(owner.frames.getSnapshot().clock).toMatchObject({ time: 0, total: 0, running: false })
    const evidence = await publishEvidence(owner)
    expect(evidence.snapshot.result?.states).toEqual(resultOf(raw).states)
    owner.undo()
    expect(canonicalValue(scalarOf(owner.captureRaw(), 'photocurrent'))).toBeGreaterThan(0)
    expectAligned(owner)
  })

  it('retains all 1024 collision samples and publishes the unsampled 0.237s cursor without changing held state time', async () => {
    const owner = ownerOf('collision-elastic')
    owner.seek(0.237)
    const raw = owner.captureRaw()
    expect(raw.clock.time).toBe(0.237)
    expect(raw.cursor).toEqual({ kind: 'time', time: { value: 0.237, unit: 's', dimension: 'time' } })
    const samples = resultOf(raw).states
    expect(samples).toHaveLength(1024)
    const nearest = samples.reduce((best, state) =>
      Math.abs(canonicalValue(state.time) - 0.237) < Math.abs(canonicalValue(best.time) - 0.237) ? state : best,
    )
    expect(raw.state).toEqual(nearest)
    expect(canonicalValue(stateOf(raw).time)).not.toBe(0.237)
    const published = await publishEvidence(owner)
    expect(published.snapshot.capturedState).toEqual(nearest)
    expect(published.snapshot.clock.time).toBe(0.237)
    expect(published.snapshot.result?.states).toHaveLength(1024)
    expect(published.snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: 'SAMPLED_STATE_CURSOR_OFFSET' }))
  })

  it('keeps the full 61×49 wave analysis and true SI spatial coordinates rather than the panel rows', async () => {
    const owner = ownerOf('wave-travelling')
    owner.seek(0.037)
    const evidence = await publishEvidence(owner)
    const profile = evidence.datasets.find(dataset => dataset.origin.analysisId === 'wave-profile')
      ?? evidence.datasets.find(dataset => dataset.origin.collection === 'analysis' && dataset.axes.some(axis => axis.kind === 'space'))
    if (profile === undefined) throw new Error('Real travelling wave lost its full time/space profile')
    expect(profile.rows).toHaveLength(61 * 49)
    expect(profile.axes.map(axis => [axis.kind, axis.unit, axis.dimension])).toEqual([
      ['time', 's', 'time'], ['space', 'm', 'length'],
    ])
    const displacement = profile.metrics.find(metric => metric.semanticKey === 'wave_transverse_displacement')!
    expect(displacement).toMatchObject({ unit: 'm', dimension: 'length' })
    const row = profile.rows.find(entry => entry.axes.time === 0 && typeof entry.axes.x === 'number' && Math.abs(entry.axes.x - 0.3) < 1e-12)!
    near(row.values[displacement.id] as number, -0.05, 'real initial displacement y(0.3,0)')
  })

  it('keeps static cursor clocks static while preserving nominal spring-statical sample times and zero-time lever samples', async () => {
    for (const [id, count] of [['hooke-law', 65], ['lever-balance', 25]] as const) {
      const scheduler = new DeterministicScheduler()
      const owner = ownerOf(id, { scheduler })
      owner.attachDisplay(`card-${id}`)
      owner.setRunning(true)
      owner.seek(3)
      owner.step(1)
      owner.advance(5, 5000)
      expect(scheduler.pending).toBe(0)
      const evidence = await publishEvidence(owner)
      expect(evidence.raw.cursor.kind).toBe('static')
      expect(evidence.raw.clock).toMatchObject({ time: 0, total: 0, running: false })
      expect(resultOf(evidence.raw).states).toHaveLength(count)
      const states = evidence.datasets.find(dataset => dataset.origin.collection === 'states')!
      expect(states.rows.every(row => row.axes.static === 0)).toBe(true)
      if (id === 'hooke-law') expect(canonicalValue(resultOf(evidence.raw).states.at(-1)!.time)).toBe(4)
      else expect(resultOf(evidence.raw).states.every(state => canonicalValue(state.time) === 0)).toBe(true)
    }
  })

  it('balanced lever becomes a real dynamic clock after one mass edit, then returns to static on undo', () => {
    const owner = ownerOf('lever-balance')
    expect(owner.frames.getSnapshot().clock.total).toBe(0)
    owner.commitParameter('left-mass', 400)
    expect(owner.frames.getSnapshot().clock.total).toBeGreaterThan(0)
    expect(owner.captureRaw().clock).toEqual(owner.frames.getSnapshot().clock)
    owner.setRunning(true)
    owner.advance(0.1, 100)
    expect(owner.frames.getSnapshot().clock.time).toBeGreaterThan(0)
    owner.undo()
    expect(owner.frames.getSnapshot().clock).toMatchObject({ time: 0, total: 0, running: false })
    expect(owner.captureRaw().cursor.kind).toBe('static')
  })

  it('captures held results without a fresh engine solve after reads, publication or serialize', async () => {
    const owner = ownerOf('uniform-linear')
    owner.seek(0.731)
    const raw = owner.captureRaw()
    const simulate = vi.spyOn(MechanicsEngine.prototype, 'simulate')
    const stateAt = vi.spyOn(MechanicsEngine.prototype, 'stateAt')
    for (let read = 0; read < 5; read += 1) {
      expect(owner.captureRaw()).toEqual(raw)
      owner.serialize()
      owner.getSnapshot()
      owner.frames.getSnapshot()
    }
    await publishEvidence(owner)
    expect(simulate).not.toHaveBeenCalled()
    expect(stateAt).not.toHaveBeenCalled()
  })

  it('rejects invalid finite bounds, non-finite values and unknown actions without history or raw drift', () => {
    const owner = ownerOf('rheostat-circuit')
    const committed = bytes(owner.serialize())
    const held = bytes(owner.captureRaw())
    for (const value of [NaN, Infinity, -Infinity, -1]) {
      owner.commitParameter('emf', value)
      expect(bytes(owner.serialize())).toBe(committed)
      expect(bytes(owner.captureRaw())).toBe(held)
    }
    owner.commitParameter('not-a-presented-parameter', 10)
    owner.setChoice('not-a-presented-choice', 'open')
    owner.setChoice('switch:sw', 'not-an-option')
    owner.setRate(0)
    owner.seek(NaN)
    expect(bytes(owner.serialize())).toBe(committed)
    expect(bytes(owner.captureRaw())).toBe(held)
    expect(owner.getSnapshot().diagnostics.length).toBeGreaterThan(0)
  })

  it.each([
    ['echo-ranging', 'medium'], ['buoyancy', 'liquid'], ['liquid-pressure', 'liquid-density'],
    ['atmospheric-pressure', 'atmospheric-pressure'], ['noise', 'barrier'], ['noise', 'listener-step'],
    ['thermometer', 'filling-liquid'],
  ] as const)('%s/%s custom is a numeric-editor display state, not an extra physical history entry', (id, choice) => {
    const owner = ownerOf(id)
    const before = bytes(owner.serialize())
    const raw = bytes(owner.captureRaw())
    owner.setChoice(choice, 'custom')
    expect(bytes(owner.serialize())).toBe(before)
    expect(bytes(owner.captureRaw())).toBe(raw)
  })

  it('restores both sides of saved history and discards redo only when a new physical gesture commits', () => {
    const owner = ownerOf('rheostat-circuit')
    owner.enterBuilder()
    owner.commitParameter('emf', 9)
    owner.commitSliderPosition('rv', 0.25)
    owner.undo()
    const saved = owner.serialize()
    expect(saved.history.past).toHaveLength(1)
    expect(saved.history.future).toHaveLength(1)
    const restored = reopen(JSON.parse(bytes(saved)) as WorkbenchCommittedState)
    expect(restored.serialize()).toEqual(saved)
    expect(restored.getSnapshot().history).toMatchObject({ canUndo: true, canRedo: true })
    restored.redo()
    expect(restored.serialize().instanceEditRevision).toBe(saved.instanceEditRevision + 1)
    expect(componentOf(draftOf(restored), 'rv').params.sliderPosition).toBe(0.25)
    expectScalar(restored.captureRaw(), 'main_current', 9 / 15, 'A', 'electric_current', 'state')
    restored.undo()
    const beforePreview = restored.serialize()
    restored.previewParameter('emf', 12)
    restored.cancelParameterPreview()
    expect(restored.serialize()).toEqual(beforePreview)
    restored.commitParameter('emf', 12)
    expectOneGesture(restored, beforePreview, 'parameter:emf')
    expect(restored.getSnapshot().history.canRedo).toBe(false)
    expect(owner.serialize()).toEqual(saved)
  })

  it('rejects malformed persisted history and draft instead of quietly replacing current saved state', () => {
    const scene = sceneOf('rheostat-circuit')
    const source: InstanceSource = { kind: 'import' }
    expect(() => createWorkbenchInstanceRuntime({ scene, source, scheduler: null,
      persistedHistory: { past: [{ id: 'not-a-history-entry' }], future: [] },
    })).toThrow(/WORKBENCH_STATE_INVALID/)
    expect(() => createWorkbenchInstanceRuntime({ scene, source, scheduler: null,
      buildMode: 'construct', persistedDraft: { components: 'not-an-array', nextNet: 1 },
    })).toThrow(/WORKBENCH_STATE_INVALID/)
  })
})
