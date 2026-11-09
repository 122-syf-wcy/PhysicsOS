import type { QuantityVector } from '@physicsos/physics-core'
import type { Vector3 } from '@physicsos/physics-math'
import { findUnit, type PhysicalDimension, type Quantity } from '@physicsos/physics-units'
import { isIsoDateTime, type ComponentId, type ObservableId, type QuestionId, type SceneId } from '@physicsos/shared'

import {
  PHYSICS_SCENE_SCHEMA,
  type AcousticBench,
  type AcousticReflector,
  type AcousticSource,
  type Body,
  type Boundary,
  type BoundaryBehavior,
  type Circuit,
  type CircuitComponent,
  type CircuitConnection,
  type CircuitNode,
  type CircuitTerminal,
  type Constraint,
  type CoordinateSystem,
  type CurrentBench,
  type CyclotronBench,
  type EnergyBench,
  type ExperimentObservation,
  type ExperimentReleaseIdentity,
  type Field,
  type FluidTank,
  type Force,
  type InductionBench,
  type LeverBench,
  type LeverHanger,
  type LightBench,
  type MaterialDefinition,
  type MeasurementDefinition,
  type ModernPhysicsBench,
  type NoiseBench,
  type ObservableDefinition,
  type ObservationStyle,
  type OpticalBench,
  type OpticalElement,
  type OpticalObject,
  type OpticalScreen,
  type Particle,
  type PhysicsObjectBase,
  type PhysicsScene,
  type PressureBench,
  type Region,
  type RegionShape,
  type SceneAnnotation,
  type SceneLineage,
  type SceneMetadata,
  type ShapeDefinition,
  type SubmergedBlock,
  type TankLiquid,
  type ThermalBench,
  type ThermalSample,
  type ThermometerBench,
  type Timeline,
  type TransformerBench,
  type WaveBench,
} from './scene.ts'

export interface SceneParseIssue {
  /** RFC 6901 JSON Pointer of the rejected value; the root is an empty string. */
  readonly path: string
  readonly code: string
  readonly message: string
}

export type SceneParseResult =
  | { readonly ok: true; readonly value: PhysicsScene }
  | { readonly ok: false; readonly issues: readonly SceneParseIssue[] }

type JsonValue = null | boolean | string | number | JsonValue[] | JsonObject
interface JsonObject {
  [key: string]: JsonValue
}

const escapePointerToken = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1')

/** Internal locations are generated paths, never paths supplied by the caller. */
const issuePointer = (path: string): string => {
  const tokens: string[] = []
  const tokenPattern = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g
  for (const match of path.matchAll(tokenPattern)) {
    const property = match[1] ?? match[2]
    if (property !== undefined) {
      tokens.push(escapePointerToken(property))
    } else if (match[3] !== undefined) {
      const key: unknown = JSON.parse(match[3])
      if (typeof key === 'string') tokens.push(escapePointerToken(key))
    }
  }
  return tokens.length === 0 ? '' : `/${tokens.join('/')}`
}

class ParseContext {
  readonly issues: SceneParseIssue[] = []

  reject(path: string, code: string, message: string): false {
    this.issues.push({ path: issuePointer(path), code, message })
    return false
  }
}

const propertyPath = (path: string, key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isArray = (value: unknown): value is unknown[] => Array.isArray(value)

const unsafeKeys: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor'])

interface JsonEntry {
  readonly key: string
  readonly value: unknown
}

interface JsonVisit {
  readonly kind: 'visit'
  readonly input: unknown
  readonly path: string
  readonly assign: (value: JsonValue) => void
}

interface JsonLeave {
  readonly kind: 'leave'
  readonly input: object
}

/** Read descriptors, never getters, before accepting any object's properties. */
const dataEntries = (
  input: object,
  path: string,
  array: boolean,
  context: ParseContext,
): { readonly entries: readonly JsonEntry[]; readonly length: number } | undefined => {
  const entries: JsonEntry[] = []
  let valid = true
  let length = 0
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string') {
      valid = context.reject(path, 'non_json_key', 'JSON objects cannot have symbol keys.')
      continue
    }
    const location = array && /^(0|[1-9][0-9]*)$/.test(key) ? `${path}[${key}]` : propertyPath(path, key)
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (descriptor === undefined) {
      valid = context.reject(location, 'unsafe_property', 'Property descriptors must be stable data descriptors.')
      continue
    }
    if ('get' in descriptor || 'set' in descriptor) {
      valid = context.reject(location, 'accessor_property', 'Accessors are not scene data and are never evaluated.')
      continue
    }
    const value: unknown = descriptor.value
    if (array && key === 'length') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        valid = context.reject(location, 'invalid_array', 'An array must have a non-negative integral length.')
      } else {
        length = value
      }
      continue
    }
    if (unsafeKeys.has(key)) {
      valid = context.reject(location, 'unsafe_key', 'Prototype-changing property names are not accepted.')
      continue
    }
    if (!descriptor.enumerable) {
      valid = context.reject(location, 'non_json_property', 'Non-enumerable properties are not JSON data.')
      continue
    }
    entries.push({ key, value })
  }
  if (array) {
    for (const entry of entries) {
      const index = Number(entry.key)
      if (!/^(0|[1-9][0-9]*)$/.test(entry.key) || !Number.isSafeInteger(index) || index >= length) {
        valid = context.reject(propertyPath(path, entry.key), 'non_json_property', 'Arrays may contain only indexed elements.')
      }
    }
    if (entries.length !== length) {
      valid = context.reject(path, 'sparse_array', 'Sparse arrays are not accepted as scene data.')
    }
  }
  return valid ? { entries, length } : undefined
}

/**
 * Clone JSON data without invoking accessors, toJSON, iterators or constructors.
 * An explicit traversal stack supports deeply nested metadata. The active set
 * rejects cycles, while a shared non-cyclic value is copied at each occurrence.
 */
const cloneJson = (input: unknown, context: ParseContext): JsonValue | undefined => {
  let root: JsonValue | undefined
  const active = new WeakSet<object>()
  const stack: (JsonVisit | JsonLeave)[] = [{
    kind: 'visit',
    input,
    path: '$',
    assign: (value) => { root = value },
  }]

  while (stack.length > 0) {
    const task = stack.pop()
    if (task === undefined) break
    if (task.kind === 'leave') {
      active.delete(task.input)
      continue
    }
    const value = task.input
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      task.assign(value)
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) task.assign(value)
      else context.reject(task.path, 'non_finite_number', 'Every scene number, including metadata numbers, must be finite.')
      continue
    }
    if (typeof value !== 'object') {
      context.reject(task.path, 'non_json_value', 'Only null, booleans, strings, finite numbers, arrays and plain data objects are accepted.')
      continue
    }
    if (active.has(value)) {
      context.reject(task.path, 'cyclic_value', 'Scene data cannot contain a cycle.')
      continue
    }

    let array: boolean
    let properties: ReturnType<typeof dataEntries>
    try {
      array = Array.isArray(value)
      const prototype: unknown = Object.getPrototypeOf(value)
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        context.reject(task.path, 'non_plain_object', 'Class instances and objects with custom prototypes are not JSON scene data.')
        continue
      }
      properties = dataEntries(value, task.path, array, context)
    } catch {
      context.reject(task.path, 'unsafe_object', 'The object could not be inspected as plain JSON data.')
      continue
    }
    if (properties === undefined) continue

    const output: JsonObject | JsonValue[] = array ? [] : {}
    if (array && isArray(output)) output.length = properties.length
    task.assign(output)
    active.add(value)
    stack.push({ kind: 'leave', input: value })
    for (let index = properties.entries.length - 1; index >= 0; index -= 1) {
      const entry = properties.entries[index]
      if (entry === undefined) continue
      const key = entry.key
      stack.push({
        kind: 'visit',
        input: entry.value,
        path: array ? `${task.path}[${key}]` : propertyPath(task.path, key),
        assign: (child) => {
          Object.defineProperty(output, key, {
            value: child,
            enumerable: true,
            configurable: true,
            writable: true,
          })
        },
      })
    }
  }
  return context.issues.length === 0 ? root : undefined
}

type Check<T> = (input: unknown, path: string, context: ParseContext) => input is T
interface RequiredProperty<T> {
  readonly optional: false
  readonly check: Check<T>
}
interface OptionalProperty<T> {
  readonly optional: true
  readonly check: Check<T>
}
type PropertyCheck = RequiredProperty<unknown> | OptionalProperty<unknown>

/** All contract fields, including optional fields, must have an explicit check. */
type ObjectProperties<T extends object> = {
  [K in keyof T]-?: {} extends Pick<T, K>
    ? OptionalProperty<Exclude<T[K], undefined>>
    : RequiredProperty<T[K]>
}

const required = <T>(check: Check<T>): RequiredProperty<T> => ({ optional: false, check })
const optional = <T>(check: Check<T>): OptionalProperty<T> => ({ optional: true, check })

const objectOf = <T extends object>(
  properties: ObjectProperties<T>,
  allowExtensions = false,
): Check<T> => {
  const entries = Object.entries(properties) as [string, PropertyCheck][]
  return (input, path, context): input is T => {
    if (!isRecord(input)) return context.reject(path, 'invalid_type', 'Expected a plain data object.')
    let valid = true
    for (const [key, property] of entries) {
      const location = propertyPath(path, key)
      if (!hasOwn(input, key)) {
        if (!property.optional) valid = context.reject(location, 'missing_property', 'This contract property is required.')
      } else if (!property.check(input[key], location, context)) {
        valid = false
      }
    }
    if (!allowExtensions) {
      for (const key of Object.keys(input)) {
        if (!hasOwn(properties, key)) {
          valid = context.reject(propertyPath(path, key), 'unexpected_property', 'This property is not part of the scene contract.')
        }
      }
    }
    return valid
  }
}

const refine = <T>(
  shape: Check<T>,
  refinement: (input: T, path: string, context: ParseContext) => boolean,
): Check<T> => (input, path, context): input is T =>
  shape(input, path, context) && refinement(input, path, context)

const stringValue: Check<string> = (input, path, context): input is string =>
  typeof input === 'string' || context.reject(path, 'invalid_type', 'Expected a string.')

const identifier = <T extends string = string>(): Check<T> =>
  (input, path, context): input is T =>
    (typeof input === 'string' && input.trim().length > 0) ||
    context.reject(path, 'invalid_identifier', 'Expected a non-empty string identifier; no prefix is required.')

const booleanValue: Check<boolean> = (input, path, context): input is boolean =>
  typeof input === 'boolean' || context.reject(path, 'invalid_type', 'Expected a boolean.')

const finiteNumber: Check<number> = (input, path, context): input is number => {
  if (typeof input !== 'number') return context.reject(path, 'invalid_type', 'Expected a number.')
  return Number.isFinite(input) || context.reject(path, 'non_finite_number', 'Expected a finite number.')
}

const revision: Check<number> = refine(finiteNumber, (input, path, context) =>
  (Number.isSafeInteger(input) && input >= 0) ||
  context.reject(path, 'invalid_revision', 'Expected a non-negative safe integer revision.'))

const dateTime: Check<string> = refine(stringValue, (input, path, context) =>
  isIsoDateTime(input) || context.reject(path, 'invalid_datetime', 'Expected a valid date-time string.'))

const literal = <T extends string | number>(expected: T): Check<T> =>
  (input, path, context): input is T =>
    input === expected || context.reject(path, 'invalid_literal', `Expected ${JSON.stringify(expected)}.`)

const oneOf = <const T extends readonly string[]>(values: T): Check<T[number]> => {
  const allowed: ReadonlySet<string> = new Set(values)
  return (input, path, context): input is T[number] =>
    (typeof input === 'string' && allowed.has(input)) ||
    context.reject(path, 'invalid_enum', `Expected one of ${values.map((value) => JSON.stringify(value)).join(', ')}.`)
}

const listOf = <T>(item: Check<T>): Check<T[]> =>
  (input, path, context): input is T[] => {
    if (!isArray(input)) return context.reject(path, 'invalid_type', 'Expected an array.')
    let valid = true
    for (let index = 0; index < input.length; index += 1) {
      if (!item(input[index], `${path}[${index}]`, context)) valid = false
    }
    return valid
  }

const jsonRecord: Check<Record<string, unknown>> = (input, path, context): input is Record<string, unknown> =>
  isRecord(input) || context.reject(path, 'invalid_type', 'Expected a JSON data object, not an array.')

type VariantChecks<T extends { type: string }> = {
  [K in T['type']]: Check<Extract<T, { type: K }>>
}

const taggedUnion = <T extends { type: string }>(variants: VariantChecks<T>): Check<T> => {
  const checks = variants as Readonly<Record<string, Check<T>>>
  return (input, path, context): input is T => {
    if (!isRecord(input)) return context.reject(path, 'invalid_type', 'Expected a discriminated data object.')
    const type = input['type']
    if (typeof type !== 'string' || !hasOwn(checks, type)) {
      return context.reject(propertyPath(path, 'type'), 'invalid_union', `Expected a supported type: ${Object.keys(checks).join(', ')}.`)
    }
    const check = checks[type]
    return check !== undefined && check(input, path, context)
  }
}

const vector3 = objectOf<Vector3>({
  x: required(finiteNumber),
  y: required(finiteNumber),
  z: required(finiteNumber),
})

const unitFor = (dimension: PhysicalDimension): Check<string> =>
  (input, path, context): input is string => {
    if (!stringValue(input, path, context)) return false
    const definition = findUnit(input)
    if (definition === undefined) return context.reject(path, 'unknown_unit', 'The unit must be registered in physics-units.')
    return definition.dimension === dimension ||
      context.reject(path, 'dimension_mismatch', `The registered unit must have dimension ${dimension}.`)
  }

const dimensionIs = <D extends PhysicalDimension>(dimension: D): Check<D> =>
  (input, path, context): input is D =>
    input === dimension || context.reject(path, 'dimension_mismatch', `This quantity must declare dimension ${dimension}.`)

const canonicalFinite = (value: number, unit: string, path: string, context: ParseContext): boolean => {
  const definition = findUnit(unit)
  if (definition === undefined) return context.reject(path, 'unknown_unit', 'The unit must be registered in physics-units.')
  return Number.isFinite(value * definition.toSI) ||
    context.reject(path, 'canonical_overflow', 'The value overflows when converted to canonical SI units.')
}

const quantityOf = <D extends PhysicalDimension>(dimension: D): Check<Quantity<D>> =>
  refine(objectOf<Quantity<D>>({
    value: required(finiteNumber),
    unit: required(unitFor(dimension)),
    dimension: required(dimensionIs(dimension)),
  }), (input, path, context) =>
    canonicalFinite(input.value, input.unit, propertyPath(path, 'value'), context))

const quantityVectorOf = <D extends PhysicalDimension>(dimension: D): Check<QuantityVector<D>> =>
  refine(objectOf<QuantityVector<D>>({
    vector: required(vector3),
    unit: required(unitFor(dimension)),
    dimension: required(dimensionIs(dimension)),
  }), (input, path, context) => {
    let valid = true
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!canonicalFinite(input.vector[axis], input.unit, `${path}.vector.${axis}`, context)) valid = false
    }
    return valid
  })

const quantityPairOf = <D extends PhysicalDimension>(dimension: D): Check<readonly [Quantity<D>, Quantity<D>]> => {
  const item = quantityOf(dimension)
  return (input, path, context): input is readonly [Quantity<D>, Quantity<D>] => {
    if (!isArray(input)) return context.reject(path, 'invalid_type', 'Expected a two-element quantity tuple.')
    let valid = input.length === 2 || context.reject(path, 'invalid_tuple', 'Expected exactly two quantities in this tuple.')
    for (let index = 0; index < input.length; index += 1) {
      if (!item(input[index], `${path}[${index}]`, context)) valid = false
    }
    return valid
  }
}

const coordinateSystem = refine(objectOf<CoordinateSystem>({
  type: required(literal('cartesian')),
  origin: required(vector3),
  axes: required(objectOf<CoordinateSystem['axes']>({
    x: required(vector3),
    y: required(vector3),
    z: required(vector3),
  })),
  lengthUnit: required(unitFor('length')),
}), (input, path, context) => {
  let valid = true
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!canonicalFinite(input.origin[axis], input.lengthUnit, `${path}.origin.${axis}`, context)) valid = false
    const direction = input.axes[axis]
    if (direction.x === 0 && direction.y === 0 && direction.z === 0) {
      valid = context.reject(`${path}.axes.${axis}`, 'invalid_axis', 'A coordinate axis must be a non-zero finite vector.')
    }
  }
  return valid
})

const timeline = refine(objectOf<Timeline>({
  currentTime: required(quantityOf('time')),
  startTime: required(quantityOf('time')),
  endTime: optional(quantityOf('time')),
  state: required(oneOf(['idle', 'running', 'paused', 'completed', 'error'])),
  playbackRate: required(finiteNumber),
  simulationTimeStep: optional(quantityOf('time')),
}), (input, path, context) => {
  let valid = true
  if (input.playbackRate <= 0) {
    valid = context.reject(`${path}.playbackRate`, 'invalid_playback_rate', 'Playback rate must be greater than zero.')
  }
  if (input.simulationTimeStep !== undefined && input.simulationTimeStep.value <= 0) {
    valid = context.reject(`${path}.simulationTimeStep.value`, 'invalid_time_step', 'Simulation time step must be greater than zero.')
  }
  if (input.endTime !== undefined) {
    const startUnit = findUnit(input.startTime.unit)
    const endUnit = findUnit(input.endTime.unit)
    if (startUnit !== undefined && endUnit !== undefined &&
        input.endTime.value * endUnit.toSI < input.startTime.value * startUnit.toSI) {
      valid = context.reject(`${path}.endTime`, 'invalid_time_range', 'End time cannot precede start time; a zero-duration timeline is allowed.')
    }
  }
  return valid
})

const baseProperties = {
  id: required(identifier()),
  name: optional(stringValue),
  enabled: optional(booleanValue),
  tags: optional(listOf(stringValue)),
  metadata: optional(jsonRecord),
} satisfies ObjectProperties<PhysicsObjectBase>

const shape = taggedUnion<ShapeDefinition>({
  circle: objectOf<Extract<ShapeDefinition, { type: 'circle' }>>({
    type: required(literal('circle')),
    radius: required(quantityOf('length')),
  }),
  rectangle: objectOf<Extract<ShapeDefinition, { type: 'rectangle' }>>({
    type: required(literal('rectangle')),
    width: required(quantityOf('length')),
    height: required(quantityOf('length')),
  }),
  polygon: objectOf<Extract<ShapeDefinition, { type: 'polygon' }>>({
    type: required(literal('polygon')),
    vertices: required(listOf(quantityVectorOf('length'))),
  }),
  segment: objectOf<Extract<ShapeDefinition, { type: 'segment' }>>({
    type: required(literal('segment')),
    start: required(quantityVectorOf('length')),
    end: required(quantityVectorOf('length')),
  }),
  point: objectOf<Extract<ShapeDefinition, { type: 'point' }>>({
    type: required(literal('point')),
  }),
})

const material = objectOf<MaterialDefinition>({
  density: optional(quantityOf('density')),
  frictionCoefficient: optional(finiteNumber),
  staticFrictionCoefficient: optional(finiteNumber),
  restitution: optional(finiteNumber),
  custom: optional(jsonRecord),
})

const body = objectOf<Body>({
  ...baseProperties,
  type: required(literal('rigid_body')),
  mass: required(quantityOf('mass')),
  position: required(quantityVectorOf('length')),
  velocity: required(quantityVectorOf('velocity')),
  acceleration: optional(quantityVectorOf('acceleration')),
  shape: required(shape),
  material: optional(material),
  fixed: optional(booleanValue),
})

const particle = objectOf<Particle>({
  ...baseProperties,
  type: required(literal('particle')),
  mass: required(quantityOf('mass')),
  charge: optional(quantityOf('electric_charge')),
  position: required(quantityVectorOf('length')),
  velocity: required(quantityVectorOf('velocity')),
  acceleration: optional(quantityVectorOf('acceleration')),
  species: optional(stringValue),
  fixed: optional(booleanValue),
})

const fieldProperties = { ...baseProperties, regionId: optional(identifier()) }
const field = taggedUnion<Field>({
  uniform_electric: objectOf<Extract<Field, { type: 'uniform_electric' }>>({
    ...fieldProperties,
    type: required(literal('uniform_electric')),
    fieldStrength: required(quantityVectorOf('electric_field')),
  }),
  uniform_magnetic: objectOf<Extract<Field, { type: 'uniform_magnetic' }>>({
    ...fieldProperties,
    type: required(literal('uniform_magnetic')),
    magneticFluxDensity: required(quantityVectorOf('magnetic_flux_density')),
  }),
  uniform_gravity: objectOf<Extract<Field, { type: 'uniform_gravity' }>>({
    ...fieldProperties,
    type: required(literal('uniform_gravity')),
    acceleration: required(quantityVectorOf('acceleration')),
  }),
  point_charge: objectOf<Extract<Field, { type: 'point_charge' }>>({
    ...fieldProperties,
    type: required(literal('point_charge')),
    sourceParticleId: required(identifier()),
  }),
})

const force = objectOf<Force>({
  ...baseProperties,
  type: required(oneOf(['gravity', 'normal', 'friction', 'tension', 'spring', 'electric', 'lorentz', 'ampere', 'drag', 'custom'])),
  targetId: required(identifier()),
  sourceId: optional(identifier()),
  vector: optional(quantityVectorOf('force')),
  derived: optional(booleanValue),
  model: optional(stringValue),
})

const regionShape = taggedUnion<RegionShape>({
  rectangle: objectOf<Extract<RegionShape, { type: 'rectangle' }>>({
    type: required(literal('rectangle')),
    width: required(quantityOf('length')),
    height: required(quantityOf('length')),
  }),
  circle: objectOf<Extract<RegionShape, { type: 'circle' }>>({
    type: required(literal('circle')),
    radius: required(quantityOf('length')),
  }),
  polygon: objectOf<Extract<RegionShape, { type: 'polygon' }>>({
    type: required(literal('polygon')),
    vertices: required(listOf(quantityVectorOf('length'))),
  }),
  half_plane: objectOf<Extract<RegionShape, { type: 'half_plane' }>>({
    type: required(literal('half_plane')),
    normal: required(vector3),
    offset: required(quantityOf('length')),
  }),
  unbounded: objectOf<Extract<RegionShape, { type: 'unbounded' }>>({
    type: required(literal('unbounded')),
  }),
})

const region = objectOf<Region>({
  ...baseProperties,
  shape: required(regionShape),
  center: required(quantityVectorOf('length')),
})

const boundaryBehavior = taggedUnion<BoundaryBehavior>({
  pass_through: objectOf<Extract<BoundaryBehavior, { type: 'pass_through' }>>({
    type: required(literal('pass_through')),
  }),
  reflect: objectOf<Extract<BoundaryBehavior, { type: 'reflect' }>>({
    type: required(literal('reflect')),
    restitution: optional(finiteNumber),
  }),
  stop: objectOf<Extract<BoundaryBehavior, { type: 'stop' }>>({
    type: required(literal('stop')),
  }),
  custom: objectOf<Extract<BoundaryBehavior, { type: 'custom' }>>({
    type: required(literal('custom')),
    model: required(stringValue),
  }),
})

const boundary = objectOf<Boundary>({
  ...baseProperties,
  type: required(oneOf(['line', 'segment', 'circle', 'rectangle', 'polygon'])),
  geometry: required(shape),
  behavior: optional(boundaryBehavior),
})

const constraint = objectOf<Constraint>({
  ...baseProperties,
  type: required(oneOf(['fixed', 'distance', 'rope', 'hinge', 'surface', 'spring', 'track', 'custom'])),
  targets: required(listOf(identifier())),
  parameters: required(jsonRecord),
})

const componentProperties = {
  id: required(identifier<ComponentId>()),
  name: optional(stringValue),
  enabled: optional(booleanValue),
}
const circuitComponent = taggedUnion<CircuitComponent>({
  resistor: objectOf<Extract<CircuitComponent, { type: 'resistor' }>>({
    ...componentProperties,
    type: required(literal('resistor')),
    resistance: required(quantityOf('resistance')),
  }),
  voltage_source: objectOf<Extract<CircuitComponent, { type: 'voltage_source' }>>({
    ...componentProperties,
    type: required(literal('voltage_source')),
    voltage: required(quantityOf('electric_potential')),
    internalResistance: optional(quantityOf('resistance')),
  }),
  switch: objectOf<Extract<CircuitComponent, { type: 'switch' }>>({
    ...componentProperties,
    type: required(literal('switch')),
    state: required(oneOf(['open', 'closed'])),
  }),
  ammeter: objectOf<Extract<CircuitComponent, { type: 'ammeter' }>>({
    ...componentProperties,
    type: required(literal('ammeter')),
    internalResistance: optional(quantityOf('resistance')),
  }),
  voltmeter: objectOf<Extract<CircuitComponent, { type: 'voltmeter' }>>({
    ...componentProperties,
    type: required(literal('voltmeter')),
    internalResistance: optional(quantityOf('resistance')),
  }),
  variable_resistor: objectOf<Extract<CircuitComponent, { type: 'variable_resistor' }>>({
    ...componentProperties,
    type: required(literal('variable_resistor')),
    totalResistance: required(quantityOf('resistance')),
    sliderPosition: required(finiteNumber),
  }),
  capacitor: objectOf<Extract<CircuitComponent, { type: 'capacitor' }>>({
    ...componentProperties,
    type: required(literal('capacitor')),
    capacitance: required(quantityOf('capacitance')),
    initialVoltage: optional(quantityOf('electric_potential')),
  }),
  inductor: objectOf<Extract<CircuitComponent, { type: 'inductor' }>>({
    ...componentProperties,
    type: required(literal('inductor')),
    inductance: required(quantityOf('inductance')),
  }),
})

const circuitNode = objectOf<CircuitNode>({ id: required(identifier()), label: optional(stringValue) })
const circuitTerminal = objectOf<CircuitTerminal>({
  id: required(identifier()),
  componentId: required(identifier<ComponentId>()),
  terminalKey: required(identifier()),
})
const circuitConnection = objectOf<CircuitConnection>({
  id: required(identifier()),
  from: required(circuitTerminal),
  to: required(circuitTerminal),
})
const circuit = objectOf<Circuit>({
  ...baseProperties,
  type: required(literal('circuit')),
  nodes: required(listOf(circuitNode)),
  components: required(listOf(circuitComponent)),
  connections: required(listOf(circuitConnection)),
})

const opticalObject = objectOf<OpticalObject>({
  id: required(identifier()),
  name: optional(stringValue),
  position: required(quantityOf('length')),
  height: required(quantityOf('length')),
})
const opticalElementProperties = {
  id: required(identifier()),
  name: optional(stringValue),
  enabled: optional(booleanValue),
  position: required(quantityOf('length')),
  apertureRadius: optional(quantityOf('length')),
}
const opticalElement = taggedUnion<OpticalElement>({
  thin_lens: objectOf<Extract<OpticalElement, { type: 'thin_lens' }>>({
    ...opticalElementProperties,
    type: required(literal('thin_lens')),
    focalLength: required(quantityOf('length')),
  }),
  plane_mirror: objectOf<Extract<OpticalElement, { type: 'plane_mirror' }>>({
    ...opticalElementProperties,
    type: required(literal('plane_mirror')),
  }),
  curved_mirror: objectOf<Extract<OpticalElement, { type: 'curved_mirror' }>>({
    ...opticalElementProperties,
    type: required(literal('curved_mirror')),
    focalLength: required(quantityOf('length')),
  }),
})
const opticalScreen = objectOf<OpticalScreen>({
  id: required(identifier()),
  name: optional(stringValue),
  position: required(quantityOf('length')),
})
const opticalBench = objectOf<OpticalBench>({
  ...baseProperties,
  type: required(literal('optical_bench')),
  object: required(opticalObject),
  elements: required(listOf(opticalElement)),
  screen: optional(opticalScreen),
})

const acousticSource = objectOf<AcousticSource>({
  id: required(identifier()),
  name: optional(stringValue),
  position: required(quantityOf('length')),
})
const acousticReflector = objectOf<AcousticReflector>({
  id: required(identifier()),
  name: optional(stringValue),
  position: required(quantityOf('length')),
})
const acousticBench = objectOf<AcousticBench>({
  ...baseProperties,
  type: required(literal('acoustic_bench')),
  source: required(acousticSource),
  reflector: required(acousticReflector),
  soundSpeed: required(quantityOf('velocity')),
})

const submergedBlock = objectOf<SubmergedBlock>({
  id: required(identifier()),
  name: optional(stringValue),
  mass: required(quantityOf('mass')),
  volume: required(quantityOf('volume')),
  height: required(quantityOf('length')),
})
const tankLiquid = objectOf<TankLiquid>({
  id: required(identifier()),
  name: optional(stringValue),
  density: required(quantityOf('density')),
})
const fluidTank = objectOf<FluidTank>({
  ...baseProperties,
  type: required(literal('fluid_tank')),
  block: required(submergedBlock),
  liquid: required(tankLiquid),
  lowerRate: required(quantityOf('velocity')),
  gravity: required(quantityOf('acceleration')),
})

const thermalSample = objectOf<ThermalSample>({
  id: required(identifier()),
  name: optional(stringValue),
  mass: required(quantityOf('mass')),
  solidSpecificHeat: required(quantityOf('specific_heat')),
  liquidSpecificHeat: required(quantityOf('specific_heat')),
  latentHeat: required(quantityOf('specific_latent_heat')),
  meltingPoint: required(quantityOf('temperature')),
  boilingPoint: optional(quantityOf('temperature')),
  vaporizationHeat: optional(quantityOf('specific_latent_heat')),
  initialTemperature: required(quantityOf('temperature')),
})
const thermalBench = objectOf<ThermalBench>({
  ...baseProperties,
  type: required(literal('thermal_bench')),
  sample: required(thermalSample),
  comparisonSample: optional(thermalSample),
  heaterPower: required(quantityOf('power')),
  runDuration: optional(quantityOf('time')),
})

const leverHanger = objectOf<LeverHanger>({
  id: required(identifier()),
  name: optional(stringValue),
  side: required(oneOf(['left', 'right'])),
  mass: required(quantityOf('mass')),
  armLength: required(quantityOf('length')),
})
const leverBench = objectOf<LeverBench>({
  ...baseProperties,
  type: required(literal('lever_bench')),
  beamLength: required(quantityOf('length')),
  gravity: required(quantityOf('acceleration')),
  hangers: required(listOf(leverHanger)),
})

const inductionBench = objectOf<InductionBench>({
  ...baseProperties,
  type: required(oneOf(['bar_motion', 'flux_change', 'double_bar_rail'])),
  magneticFluxDensity: required(quantityOf('magnetic_flux_density')),
  resistance: required(quantityOf('resistance')),
  barLength: optional(quantityOf('length')),
  barVelocity: optional(quantityOf('velocity')),
  coilArea: optional(quantityOf('area')),
  coilAngle: optional(quantityOf('angle')),
  fluxRate: optional(quantityOf('magnetic_flux_rate')),
  barMasses: optional(quantityPairOf('mass')),
  barVelocities: optional(quantityPairOf('velocity')),
  barPositions: optional(quantityPairOf('length')),
  externalForce: optional(quantityOf('force')),
})

const waveBench = objectOf<WaveBench>({
  ...baseProperties,
  type: required(oneOf(['travelling', 'interference', 'standing', 'longitudinal', 'reflection_refraction', 'diffraction', 'doppler'])),
  amplitude: required(quantityOf('length')),
  frequency: required(quantityOf('frequency')),
  wavelength: optional(quantityOf('length')),
  ropeLength: optional(quantityOf('length')),
  sourceSeparation: optional(quantityOf('length')),
  pathOne: optional(quantityOf('length')),
  pathTwo: optional(quantityOf('length')),
  stringLength: optional(quantityOf('length')),
  harmonic: optional(finiteNumber),
  waveSpeed: optional(quantityOf('velocity')),
  mediumLength: optional(quantityOf('length')),
  incidentSpeed: optional(quantityOf('velocity')),
  transmittedWaveSpeed: optional(quantityOf('velocity')),
  incidentAngle: optional(quantityOf('angle')),
  slitWidth: optional(quantityOf('length')),
  screenDistance: optional(quantityOf('length')),
  diffractionOrder: optional(finiteNumber),
  sourceSpeed: optional(quantityOf('velocity')),
  observerSpeed: optional(quantityOf('velocity')),
  sourceDirection: optional(oneOf(['approaching', 'receding'])),
  observerDirection: optional(oneOf(['approaching', 'receding', 'stationary'])),
})

const cyclotronBench = objectOf<CyclotronBench>({
  ...baseProperties,
  type: required(literal('cyclotron')),
  magneticFluxDensity: required(quantityOf('magnetic_flux_density')),
  magneticOrientation: required(oneOf(['into_page', 'out_of_page'])),
  gapVoltage: required(quantityOf('electric_potential')),
  gapWidth: required(quantityOf('length')),
  deeRadius: required(quantityOf('length')),
})
const modernPhysicsBench = objectOf<ModernPhysicsBench>({
  ...baseProperties,
  type: required(literal('photoelectric_effect')),
  workFunction: required(quantityOf('energy')),
  photonWavelength: required(quantityOf('length')),
  lightIntensity: required(quantityOf('intensity')),
  cathodeArea: required(quantityOf('area')),
  quantumEfficiency: required(finiteNumber),
})

const pressureBench = objectOf<PressureBench>({
  ...baseProperties,
  type: required(oneOf(['solid', 'liquid', 'atmospheric'])),
  force: optional(quantityOf('force')),
  area: optional(quantityOf('area')),
  comparisonArea: optional(quantityOf('area')),
  gravity: optional(quantityOf('acceleration')),
  liquidDensity: optional(quantityOf('density')),
  depth: optional(quantityOf('length')),
  comparisonDepth: optional(quantityOf('length')),
  comparisonLiquidDensity: optional(quantityOf('density')),
  atmosphericPressure: optional(quantityOf('pressure')),
  barometerFluidDensity: optional(quantityOf('density')),
  hemisphereRadius: optional(quantityOf('length')),
})
const currentBench = objectOf<CurrentBench>({
  ...baseProperties,
  type: required(oneOf(['straight_wire', 'solenoid', 'electromagnet', 'motor'])),
  current: optional(quantityOf('electric_current')),
  probeDistance: optional(quantityOf('length')),
  comparisonDistance: optional(quantityOf('length')),
  turns: optional(quantityOf('dimensionless')),
  comparisonTurns: optional(quantityOf('dimensionless')),
  coilLength: optional(quantityOf('length')),
  coreRelativePermeability: optional(quantityOf('dimensionless')),
  comparisonCoreRelativePermeability: optional(quantityOf('dimensionless')),
  coreArea: optional(quantityOf('area')),
  gravity: optional(quantityOf('acceleration')),
  magneticFluxDensity: optional(quantityOf('magnetic_flux_density')),
  sideLength: optional(quantityOf('length')),
  coilWidth: optional(quantityOf('length')),
  coilAngle: optional(quantityOf('angle')),
})
const energyBench = objectOf<EnergyBench>({
  ...baseProperties,
  type: required(literal('energy_bench')),
  mass: required(quantityOf('mass')),
  gravity: required(quantityOf('acceleration')),
  releaseHeight: required(quantityOf('length')),
  inclineAngle: required(quantityOf('angle')),
  frictionCoefficient: required(quantityOf('dimensionless')),
})
const lightBench = objectOf<LightBench>({
  ...baseProperties,
  type: required(oneOf(['pinhole', 'total_reflection'])),
  objectHeight: optional(quantityOf('length')),
  objectDistance: optional(quantityOf('length')),
  screenDistance: optional(quantityOf('length')),
  incidentIndex: optional(quantityOf('dimensionless')),
  refractedIndex: optional(quantityOf('dimensionless')),
  incidentAngle: optional(quantityOf('angle')),
})
const transformerBench = objectOf<TransformerBench>({
  ...baseProperties,
  type: required(literal('transformer')),
  primaryVoltage: required(quantityOf('electric_potential')),
  primaryCurrent: required(quantityOf('electric_current')),
  primaryTurns: required(quantityOf('dimensionless')),
  secondaryTurns: required(quantityOf('dimensionless')),
})
const thermometerBench = objectOf<ThermometerBench>({
  ...baseProperties,
  type: required(literal('liquid_in_glass')),
  bulbVolume: required(quantityOf('volume')),
  boreDiameter: required(quantityOf('length')),
  expansionCoefficient: required(quantityOf('dimensionless')),
  temperature: required(quantityOf('temperature')),
  icePointLength: required(quantityOf('length')),
})
const noiseBench = objectOf<NoiseBench>({
  ...baseProperties,
  type: required(literal('noise')),
  soundPowerLevel: required(quantityOf('dimensionless')),
  distance: required(quantityOf('length')),
  barrierAttenuation: required(quantityOf('dimensionless')),
})

const measurement = objectOf<MeasurementDefinition>({
  id: required(identifier()),
  type: required(oneOf(['position', 'velocity', 'acceleration', 'force', 'energy', 'current', 'voltage', 'electric_field', 'magnetic_field', 'custom'])),
  targetId: optional(identifier()),
  componentId: optional(identifier<ComponentId>()),
  enabled: required(booleanValue),
})
const observationStyle = objectOf<ObservationStyle>({
  emphasis: optional(oneOf(['normal', 'highlight'])),
  labelVisible: optional(booleanValue),
  scale: optional(finiteNumber),
  token: optional(stringValue),
})
const observable = objectOf<ObservableDefinition>({
  id: required(identifier<ObservableId>()),
  type: required(oneOf(['force', 'velocity', 'acceleration', 'momentum', 'trajectory', 'electric_field', 'electric_potential', 'magnetic_field', 'energy', 'current', 'voltage', 'measurement', 'graph', 'geometry', 'annotation'])),
  targetId: optional(identifier()),
  visible: required(booleanValue),
  style: optional(observationStyle),
  parameters: optional(jsonRecord),
})
const annotation = objectOf<SceneAnnotation>({
  id: required(identifier()),
  type: required(oneOf(['label', 'formula', 'marker', 'guide', 'teacher_note'])),
  targetId: optional(identifier()),
  content: required(stringValue),
  visible: required(booleanValue),
})

const lineage = objectOf<SceneLineage>({
  origin: required(oneOf(['question', 'template', 'blank'])),
  branchType: required(literal('experimental')),
  originQuestionId: optional(identifier<QuestionId>()),
  originSceneId: required(identifier<SceneId>()),
  parentSceneId: required(identifier<SceneId>()),
  parentRevision: required(revision),
  forkedAt: required(dateTime),
})

type OfficialRelease = Extract<ExperimentReleaseIdentity, { readonly kind: 'official' }>
type CommunityRelease = Exclude<ExperimentReleaseIdentity, OfficialRelease>
const officialRelease = objectOf<OfficialRelease>({
  kind: required(literal('official')),
  id: required(identifier()),
  experimentId: required(identifier()),
  version: required(identifier()),
})
const sha256 = refine(stringValue, (input, path, context) =>
  /^[a-fA-F0-9]{64}$/.test(input) || context.reject(path, 'invalid_sha256', 'Expected a 64-character hexadecimal SHA-256 digest.'))
const communityRelease = objectOf<CommunityRelease>({
  kind: optional(literal('community')),
  id: required(identifier()),
  experimentId: required(identifier()),
  version: required(identifier()),
  sha256: required(sha256),
})
const experimentRelease: Check<ExperimentReleaseIdentity> = (input, path, context): input is ExperimentReleaseIdentity => {
  if (!isRecord(input)) return context.reject(path, 'invalid_type', 'Expected an experiment release identity.')
  if (input['kind'] === 'official') return officialRelease(input, path, context)
  if (!hasOwn(input, 'kind') || input['kind'] === 'community') return communityRelease(input, path, context)
  return context.reject(`${path}.kind`, 'invalid_enum', 'Experiment release kind must be official or community; community kind may be omitted.')
}

const checkUnique = <T extends { readonly id: string }>(
  values: readonly T[],
  path: string,
  context: ParseContext,
): boolean => {
  let valid = true
  const seen = new Map<string, string>()
  values.forEach((value, index) => {
    const location = `${path}[${index}].id`
    const previous = seen.get(value.id)
    if (previous !== undefined) valid = context.reject(location, 'duplicate_id', `This identifier is already defined at ${previous}.`)
    else seen.set(value.id, location)
  })
  return valid
}

// Notebook parameters use presentation units, not dimensioned Quantity values.
const observationParameter = objectOf<ExperimentObservation['parameters'][number]>({
  id: required(identifier()),
  value: required(finiteNumber),
  unit: required(stringValue),
})
const experimentObservation = refine(objectOf<ExperimentObservation>({
  experimentRelease: optional(experimentRelease),
  id: required(identifier()),
  recordedAt: required(stringValue),
  sceneId: required(identifier()),
  sceneRevision: required(revision),
  columns: required(listOf(stringValue)),
  values: required(listOf(stringValue)),
  parameters: required(listOf(observationParameter)),
}), (input, path, context) => {
  let valid = checkUnique(input.parameters, `${path}.parameters`, context)
  if (input.columns.length !== input.values.length) {
    valid = context.reject(`${path}.values`, 'invalid_observation_row', 'Observation values must have the same length as columns.')
  }
  return valid
})
const experimentNotebook = refine(objectOf<NonNullable<SceneMetadata['experimentNotebook']>>({
  version: required(literal(1)),
  entries: required(listOf(experimentObservation)),
}), (input, path, context) => checkUnique(input.entries, `${path}.entries`, context))

const actor = objectOf<NonNullable<SceneMetadata['createdBy']>>({
  type: required(oneOf(['user', 'agent', 'system', 'teacher', 'migration'])),
  id: optional(stringValue),
})
const metadata = objectOf<SceneMetadata>({
  experimentRelease: optional(experimentRelease),
  experimentNotebook: optional(experimentNotebook),
  createdAt: required(dateTime),
  updatedAt: required(dateTime),
  createdBy: optional(actor),
  title: optional(stringValue),
  description: optional(stringValue),
  curriculumTags: optional(listOf(stringValue)),
  knowledgeTags: optional(listOf(stringValue)),
  sourceQuestionId: optional(identifier<QuestionId>()),
  engineVersion: optional(stringValue),
  lineage: optional(lineage),
}, true)

const sceneShape = objectOf<PhysicsScene>({
  schemaVersion: required(literal(PHYSICS_SCENE_SCHEMA)),
  id: required(identifier<SceneId>()),
  revision: required(revision),
  dimension: required(oneOf(['2d', '3d'])),
  coordinateSystem: required(coordinateSystem),
  timeline: required(timeline),
  bodies: required(listOf(body)),
  particles: required(listOf(particle)),
  fields: required(listOf(field)),
  forces: required(listOf(force)),
  regions: required(listOf(region)),
  boundaries: required(listOf(boundary)),
  constraints: required(listOf(constraint)),
  circuits: required(listOf(circuit)),
  opticalBenches: required(listOf(opticalBench)),
  acousticBenches: required(listOf(acousticBench)),
  fluidTanks: required(listOf(fluidTank)),
  thermalBenches: required(listOf(thermalBench)),
  leverBenches: required(listOf(leverBench)),
  inductionBenches: optional(listOf(inductionBench)),
  waveBenches: optional(listOf(waveBench)),
  cyclotronBenches: optional(listOf(cyclotronBench)),
  modernPhysicsBenches: optional(listOf(modernPhysicsBench)),
  pressureBenches: optional(listOf(pressureBench)),
  currentBenches: optional(listOf(currentBench)),
  energyBenches: optional(listOf(energyBench)),
  lightBenches: optional(listOf(lightBench)),
  transformerBenches: optional(listOf(transformerBench)),
  thermometerBenches: optional(listOf(thermometerBench)),
  noiseBenches: optional(listOf(noiseBench)),
  measurementDefinitions: required(listOf(measurement)),
  observableDefinitions: required(listOf(observable)),
  annotations: required(listOf(annotation)),
  metadata: required(metadata),
})

type TargetKind =
  | 'body' | 'particle' | 'field' | 'force' | 'region' | 'boundary' | 'constraint'
  | 'circuit' | 'component' | 'optical_bench' | 'optical_object' | 'optical_element' | 'optical_screen'
  | 'acoustic_bench' | 'acoustic_source' | 'acoustic_reflector' | 'fluid_tank' | 'block' | 'liquid'
  | 'thermal_bench' | 'thermal_sample' | 'lever_bench' | 'lever_hanger' | 'induction_bench' | 'wave_bench'
  | 'cyclotron_bench' | 'modern_physics_bench' | 'pressure_bench' | 'current_bench' | 'energy_bench'
  | 'light_bench' | 'transformer_bench' | 'thermometer_bench' | 'noise_bench'
interface TargetIdentity {
  readonly path: string
  readonly kind: TargetKind
}

/** Circuit nets, wires and terminal declarations have circuit-local namespaces. */
const checkCircuitReferences = (value: Circuit, path: string, context: ParseContext): void => {
  checkUnique(value.nodes, `${path}.nodes`, context)
  checkUnique(value.connections, `${path}.connections`, context)
  const components = new Map(value.components.map((component) => [String(component.id), component]))
  const terminalIds = new Map<string, { readonly componentId: string; readonly key: string; readonly path: string }>()
  const terminalPairs = new Map<string, string>()

  const checkTerminal = (terminal: CircuitTerminal, location: string): void => {
    const component = components.get(terminal.componentId)
    if (component === undefined) {
      context.reject(`${location}.componentId`, 'invalid_reference', 'The terminal must reference a component in the same circuit.')
    } else {
      const keys: readonly string[] = component.type === 'voltage_source' ? ['positive', 'negative'] : ['a', 'b']
      if (!keys.includes(terminal.terminalKey)) {
        context.reject(`${location}.terminalKey`, 'invalid_terminal', `This component exposes only ${keys.join(' and ')} terminals.`)
      }
    }
    const previous = terminalIds.get(terminal.id)
    if (previous !== undefined && (previous.componentId !== terminal.componentId || previous.key !== terminal.terminalKey)) {
      context.reject(`${location}.id`, 'duplicate_id', `The terminal identifier denotes a different terminal at ${previous.path}.`)
    } else if (previous === undefined) {
      terminalIds.set(terminal.id, { componentId: terminal.componentId, key: terminal.terminalKey, path: `${location}.id` })
    }
    const pair = JSON.stringify([terminal.componentId, terminal.terminalKey])
    const previousId = terminalPairs.get(pair)
    if (previousId !== undefined && previousId !== terminal.id) {
      context.reject(`${location}.id`, 'inconsistent_terminal', 'Repeated declarations of the same component terminal must use the same identifier.')
    } else if (previousId === undefined) {
      terminalPairs.set(pair, terminal.id)
    }
  }

  value.connections.forEach((connection, index) => {
    checkTerminal(connection.from, `${path}.connections[${index}].from`)
    checkTerminal(connection.to, `${path}.connections[${index}].to`)
  })
}

const checkReferences = (scene: PhysicsScene, context: ParseContext): void => {
  const objects = new Map<string, TargetIdentity>()
  const register = (id: string, path: string, kind: TargetKind): void => {
    const previous = objects.get(id)
    if (previous !== undefined) context.reject(path, 'duplicate_id', `This object identifier is already defined at ${previous.path}.`)
    else objects.set(id, { path, kind })
  }
  const registerList = <T extends { readonly id: string }>(values: readonly T[], path: string, kind: TargetKind): void => {
    values.forEach((value, index) => register(value.id, `${path}[${index}].id`, kind))
  }

  registerList(scene.bodies, '$.bodies', 'body')
  registerList(scene.particles, '$.particles', 'particle')
  registerList(scene.fields, '$.fields', 'field')
  registerList(scene.forces, '$.forces', 'force')
  registerList(scene.regions, '$.regions', 'region')
  registerList(scene.boundaries, '$.boundaries', 'boundary')
  registerList(scene.constraints, '$.constraints', 'constraint')
  registerList(scene.circuits, '$.circuits', 'circuit')
  scene.circuits.forEach((value, index) => {
    registerList(value.components, `$.circuits[${index}].components`, 'component')
    checkCircuitReferences(value, `$.circuits[${index}]`, context)
  })
  registerList(scene.opticalBenches, '$.opticalBenches', 'optical_bench')
  scene.opticalBenches.forEach((value, index) => {
    register(value.object.id, `$.opticalBenches[${index}].object.id`, 'optical_object')
    registerList(value.elements, `$.opticalBenches[${index}].elements`, 'optical_element')
    if (value.screen !== undefined) register(value.screen.id, `$.opticalBenches[${index}].screen.id`, 'optical_screen')
  })
  registerList(scene.acousticBenches, '$.acousticBenches', 'acoustic_bench')
  scene.acousticBenches.forEach((value, index) => {
    register(value.source.id, `$.acousticBenches[${index}].source.id`, 'acoustic_source')
    register(value.reflector.id, `$.acousticBenches[${index}].reflector.id`, 'acoustic_reflector')
  })
  registerList(scene.fluidTanks, '$.fluidTanks', 'fluid_tank')
  scene.fluidTanks.forEach((value, index) => {
    register(value.block.id, `$.fluidTanks[${index}].block.id`, 'block')
    register(value.liquid.id, `$.fluidTanks[${index}].liquid.id`, 'liquid')
  })
  registerList(scene.thermalBenches, '$.thermalBenches', 'thermal_bench')
  scene.thermalBenches.forEach((value, index) => {
    register(value.sample.id, `$.thermalBenches[${index}].sample.id`, 'thermal_sample')
    if (value.comparisonSample !== undefined) register(value.comparisonSample.id, `$.thermalBenches[${index}].comparisonSample.id`, 'thermal_sample')
  })
  registerList(scene.leverBenches, '$.leverBenches', 'lever_bench')
  scene.leverBenches.forEach((value, index) => registerList(value.hangers, `$.leverBenches[${index}].hangers`, 'lever_hanger'))
  registerList(scene.inductionBenches ?? [], '$.inductionBenches', 'induction_bench')
  registerList(scene.waveBenches ?? [], '$.waveBenches', 'wave_bench')
  registerList(scene.cyclotronBenches ?? [], '$.cyclotronBenches', 'cyclotron_bench')
  registerList(scene.modernPhysicsBenches ?? [], '$.modernPhysicsBenches', 'modern_physics_bench')
  registerList(scene.pressureBenches ?? [], '$.pressureBenches', 'pressure_bench')
  registerList(scene.currentBenches ?? [], '$.currentBenches', 'current_bench')
  registerList(scene.energyBenches ?? [], '$.energyBenches', 'energy_bench')
  registerList(scene.lightBenches ?? [], '$.lightBenches', 'light_bench')
  registerList(scene.transformerBenches ?? [], '$.transformerBenches', 'transformer_bench')
  registerList(scene.thermometerBenches ?? [], '$.thermometerBenches', 'thermometer_bench')
  registerList(scene.noiseBenches ?? [], '$.noiseBenches', 'noise_bench')

  // Definitions have their own identity namespaces, separate from physical targets.
  checkUnique(scene.measurementDefinitions, '$.measurementDefinitions', context)
  checkUnique(scene.observableDefinitions, '$.observableDefinitions', context)
  checkUnique(scene.annotations, '$.annotations', context)

  const reference = (id: string | undefined, path: string, expected?: TargetKind): void => {
    if (id === undefined) return
    const target = objects.get(id)
    if (target === undefined || (expected !== undefined && target.kind !== expected)) {
      context.reject(path, 'invalid_reference', expected === undefined
        ? 'The reference must identify an existing internal physical target.'
        : `The reference must identify an existing ${expected}.`)
    }
  }
  scene.fields.forEach((value, index) => {
    reference(value.regionId, `$.fields[${index}].regionId`, 'region')
    if (value.type === 'point_charge') reference(value.sourceParticleId, `$.fields[${index}].sourceParticleId`, 'particle')
  })
  scene.forces.forEach((value, index) => {
    reference(value.targetId, `$.forces[${index}].targetId`)
    reference(value.sourceId, `$.forces[${index}].sourceId`)
  })
  scene.constraints.forEach((value, index) => {
    value.targets.forEach((target, targetIndex) => reference(target, `$.constraints[${index}].targets[${targetIndex}]`))
  })
  scene.measurementDefinitions.forEach((value, index) => {
    reference(value.targetId, `$.measurementDefinitions[${index}].targetId`)
    reference(value.componentId, `$.measurementDefinitions[${index}].componentId`, 'component')
  })
  scene.observableDefinitions.forEach((value, index) => reference(value.targetId, `$.observableDefinitions[${index}].targetId`))
  scene.annotations.forEach((value, index) => reference(value.targetId, `$.annotations[${index}].targetId`))
}

/**
 * Parse the complete scene contract from untrusted, plain JSON data.
 *
 * Successful parsing returns a detached copy with unchanged authored values and
 * safe JSON metadata extensions. Optional specialist collections remain absent
 * when absent in the input. Physical plausibility and engine solvability are
 * deliberately not prerequisites for saving an authored scene.
 */
export const parsePhysicsScene = (input: unknown): SceneParseResult => {
  const context = new ParseContext()
  const value = cloneJson(input, context)
  if (value === undefined || !sceneShape(value, '$', context)) {
    return { ok: false, issues: context.issues }
  }
  checkReferences(value, context)
  if (context.issues.length > 0) return { ok: false, issues: context.issues }
  return { ok: true, value }
}
